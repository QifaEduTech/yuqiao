"""Publish only aggregate experimental evidence; private sources never leave data/."""
from collections import Counter
import ctypes
import hashlib
import json
from pathlib import Path
import platform
import re
import statistics
import sys

ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'data/experiments/unified-2026-11-17'


def read(path):return json.loads(Path(path).read_text(encoding='utf8'))
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):Path(path).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def stats(values):return {'mean':statistics.mean(values),'stdPopulation':statistics.pstdev(values),'min':min(values),'max':max(values),'median':statistics.median(values)}


def main():
    p=read(D/'plan.json');results=read(D/'results.json');extraction=read(D/'extraction.json');repeat=read(D/'efficiency-repeat.json')
    workbench=[];workbench_files={}
    for state_path in (ROOT/'data/training-workbench').glob('*/state.json'):
        state=read(state_path);workbench_files[str(state_path.relative_to(ROOT))]=sha(state_path)
        for action in state['actions']:
            samples=action['samples']
            workbench.append({'text':action['text'],'signId':action['signId'],'state':action['state'],
                              'sampleLinks':len(samples),'trainPositive':sum(s['split']=='train' and s['label']==1 for s in samples),
                              'trainNegative':sum(s['split']=='train' and s['label']==0 for s in samples),
                              'validation':sum(s['split']=='validation' for s in samples),'test':sum(s['split']=='test' for s in samples),
                              'activeVersion':bool(action.get('activeVersion')),
                              'verifiedGroupMetadata':all(s.get('realGroupConfirmed') is True for s in samples) if samples else False,
                              'reasonNotTrained':'no registered validation/test partition; no proven real group isolation'})
    write(D/'workbench-inventory.json',{'files':workbench_files,'summary':workbench})
    configs=['shared/unified-experiment.json','server/unified_runtime.py','server/unified_evaluation.py',
             'scripts/unified-experiment-data.py','scripts/unified-experiment-fit.py','scripts/report-unified-experiment.py',
             'server/realtime_observation.py','server/me_training_features.py','server/sign_training_features.py',
             'server/realtime_multi.py','server/help_tcn_live.py','server/me_live.py','server/need_live.py','server/sign_worker.py']
    artifacts=['models/sign-word-baseline/dynamic_gesture_classifier.tflite','models/help-video-tcn/v1/weights.npz',
               'models/need-video-tcn/experimental-v1/weights.npz','models/me-video-tcn/experimental-v1/weights.npz']
    history=['docs/assets/thanks-pilot-training-2026-10-20.json','docs/assets/help-video-training-2026-10-20.json',
             'docs/assets/need-video-training-2026-10-20.json','docs/assets/me-video-training-2026-10-21.json',
             'docs/assets/me-32.5-source-review-2026-10-21.json','docs/assets/please-second-round-quality-2026-10-22.json',
             'docs/assets/recording-realtime-parity-2026-11-13.json']
    provenance={name:sha(ROOT/name) for name in configs+artifacts+history}
    write(D/'provenance.json',{'files':provenance,'planSha256':sha(D/'plan.json'),
                              'resultsSha256':sha(D/'results.json'),'extractionSha256':sha(D/'extraction.json'),
                              'featureCache':{x['sourceHash']:sha(D/(x['sourceHash']+'.json.gz')) for x in extraction}})
    held_hash={r['sourceHash'] for r in p['rows'] if r['split']=='development_holdout'}
    train_groups={r['group'] for r in p['rows'] if r['split']=='train'}
    challenge_overlap=sum(r['split']=='unknown_challenge' and r['group'] in train_groups for r in p['rows'])
    times=[v for x in extraction if x['sourceHash'] in held_hash for v in x['timing']['baselineFrameMs']]
    # Deterministic percentile without another dependency in the report generator.
    ordered=sorted(times);position=.95*(len(ordered)-1);low=int(position)
    p95=ordered[low]+(ordered[min(low+1,len(ordered)-1)]-ordered[low])*(position-low)
    timingA={'frameMeanMs':statistics.mean(times),'frameP95Ms':p95,'frames':len(times),
             'framesPerSecondExcludingTracking':1000/statistics.mean(times)}
    avatar=[]
    for sign in ['csl.thanks','csl.ref.bmcx.1900','csl.ref.bmcx.1874','csl.me']:
        path=ROOT/'shared/sign-motions/anny'/(sign+'.json')
        a=read(path)
        avatar.append({'signId':sign,'sha256':sha(path),'frames':len(a.get('frames',[])),
                       'representation':'local bone rotations; not image-space MediaPipe landmarks'})
    B=[r['developmentHoldout']['B']['macroTargets'] for r in results]
    report={'date':'2026-11-17','status':'bounded_local_experiment_completed_not_enabled',
            'conclusion':{'precisionImprovementDemonstrated':False,'generalizationValidated':False,
                          'trainingSpeedVsDeployedA':None,'matchedFourBinaryFitSpeedup':statistics.median([
                              sum(x['fitIncludingSetupSeconds'] for x in r['matchedBinary'])/r['B']['fitIncludingSetupSeconds'] for r in repeat['results']]),
                          'avatarBenefit':None},
            'scope':'one performer, reused development videos, whole-source/group split; no independent test',
            'machine':{'os':platform.platform(),'cpu':'AMD Ryzen 9 7945HX with Radeon Graphics','logicalCpus':32,
                       'gpu':'RTX 4060 Laptop 8GB (not used for training)',
                       'extractionAndEvaluation':{'python':'3.12','numpy':'1.26.4','opencv':'4.11.0','mediapipe':'0.10.21'},
                       'training':{'torch':'2.7.1+cpu','numpy':'2.5.4','threads':2}},
            'dataset':{'registered':66,'counts':p['summary'],'independentTestSamples':0,'performers':p['performers'],
                       'allActiveLegacyRegistrationOwners':1,'workbenchAdditionalInventory':workbench,
                       'groupCounts':{s:len({r['group'] for r in p['rows'] if r['split']==s}) for s in p['summary']},
                       'groupSources':dict(Counter(r['groupSource'] for r in p['rows'])),
                       'unknownChallengeGroupOverlapWithTraining':challenge_overlap,
                       'planSha256':sha(D/'plan.json'),'sourceVerification':read(D/'source-verification.json')},
            'protocol':p['protocol'],'codeAndModelHashes':provenance,
            'baselineModelBytes':sum((ROOT/f).stat().st_size for f in artifacts),
            'featureExtraction':{'videos':len(extraction),'frames':sum(r['timing']['frames'] for r in extraction),
                                 'seconds':sum(r['timing']['extractionSeconds'] for r in extraction),
                                 'scope':'shared decoding, resize, single mirror, Hands/Pose and 126/153/178 features; no cached extraction timing',
                                 'sourceTimestampPolicy':'decoder PTS, no interpolated or appended frames'},
            'A':{'developmentHoldout':results[0]['developmentHoldout']['A'],
                 'events':results[0]['developmentHoldout']['events']['A'],'runtime':timingA,'trainingSeconds':None,
                 'limitation':'existing weights and rules have previously seen development sources; cannot impose new split or recover historical training cost'},
            'B':{'macroAcrossSeeds':{k:stats([x[k] for x in B]) for k in ('precision','recall','f1')},
                 'runs':[{k:r[k] for k in ['seed','model','modelBytes','training','runtimeSha256','evaluationNumpyVersion']} | {
                     'developmentHoldout':{k:v for k,v in r['developmentHoldout'].items() if k!='details'},
                     'trainingReplayDiagnostic':{k:v for k,v in r['trainingReplayDiagnostic'].items() if k!='details'},
                     'unknownChallenge':{k:v for k,v in r['unknownChallenge'].items() if k!='details'}} for r in results]},
            'matchedTrainingControl':repeat,
            'C':{'status':'not_run_alignment_conditions_missing','assets':avatar,
                 'available':'MakeHuman163 rig, glTF exporter, four fixed motion assets',
                 'missing':['validated mapping from bone heads/tails to MediaPipe 21-point hands and shoulder reference',
                            'camera projection, body proportions and handedness calibration against paired real observations',
                            'validated missingness/occlusion and monocular depth-noise model'],
                 'interpretation':'no evidence of benefit or harm; unverified animation was not used as ground truth or test data'},
            'definitions':{'precision':'TP/(TP+FP); undefined class precision contributes 0 to macro',
                           'macro':'unweighted average over thanks/help/need/me; unknown separate',
                           'candidateClip':'exactly one distinct candidate/event class and no conflict over registered range; rejected=unknown',
                           'completion':'exactly one correct event, no synthesized EOF/no-hand frames',
                           'timing':'training.seconds is optimizer loop; repeat fitIncludingSetupSeconds also includes tensors/normalization/model/optimizer; exports and interpreter startup excluded',
                           'memory':'process cumulative high-water RSS incl. Python/Torch; CPU only, no GPU training allocation'},
            'limitations':['same performer prevents person-isolated evaluation',
                           'all please challenge clips share conservative groups with some training clips; exploratory development probes only, not group-held-out unknown accuracy',
                           'coarse dates are conservative clusters, not verified capture rounds',
                           'all 12 positive holdout ranges lack >=0.6 s observed no-hands tail; both methods 0/12 completion',
                           'no real continuous multiword or repeated-word sequences; zero extra events is not proof of duplicate suppression',
                           'A is a reused deployed baseline; matched binary control is a new timing experiment, not A reproduction',
                           'four-word small full-batch timing does not predict 30-word training efficiency',
                           'common runtime short-occlusion bug fixed without changing labels, weights, hyperparameters or choosing seeds; all frozen models replayed',
                           'end-to-end camera FPS not benchmarked; inference figures exclude tracking/HTTP/rendering'],
            'verification':{'pythonChecks':{'unified':11,'legacyArbitration':20,'trainingMetrics':5},
                            'torchNumpyMaxError':max(r['model']['numpyParityMaxError'] for r in results),
                            'deterministicRepeatArraysIdentical':repeat['exportArraysExactlyReproduced'],
                            'sourceAndRegistrationRechecked':66,'productionEnabled':False,'uploaded':False}}
    write(ROOT/'docs/assets/unified-recognition-experiment-2026-11-17.json',report)
    build_doc(report)
    print(json.dumps({'precisionMean':report['B']['macroAcrossSeeds']['precision']['mean'],
                      'matchedSpeedup':report['conclusion']['matchedFourBinaryFitSpeedup'],
                      'baselineRuntime':timingA},ensure_ascii=False))


def build_doc(r):
    pct=lambda v:f'{v*100:.2f}%'
    a=r['A']['developmentHoldout']['macroTargets'];b=r['B']['macroAcrossSeeds'];runs=r['B']['runs']
    lines=['<a id="unified-experiment-2026-11-17"></a>','## 2026-11-17 统一模型本机训练对照',
           '已按用户本次明确授权完成本机受控训练，覆盖此前“训练暂缓”的本次实验范围。**未证明精确率提高，不启用新权重。** 原服务和模型保持基线；本次实验不意味着恢复每天6词自动训练。',
           '| 开发对照（17条） | A 现有方案 | B 单一模型（3种子平均） |',
           '|---|---:|---:|',f'| 四词宏平均 precision | {pct(a["precision"])} | {pct(b["precision"]["mean"])} |',
           f'| 四词宏平均 recall | {pct(a["recall"])} | {pct(b["recall"]["mean"])} |',
           f'| 四词宏平均 F1 | {pct(a["f1"])} | {pct(b["f1"]["mean"])} |',
           '| 正确完整结束事件 | 0/12 | 三次均0/12 |',
           'precision=TP/(TP+FP)，指正确输出占该词所有输出的比例；不是模型置信分数。上述结果按登记范围内出现唯一候选词统计，不能替代完成动作识别率。每类无输出时precision按0计入宏平均。',
           '| 种子 | precision | recall | F1 | 背景/其他误报（5条） | 请探索误报（6条，组重叠） |',
           '|---|---:|---:|---:|---:|---:|']
    for x in runs:
        m=x['developmentHoldout']['B']['macroTargets'];e=x['developmentHoldout']['events']['B'];u=x['unknownChallenge']['events']['B']
        lines.append(f'| {x["seed"]} | {pct(m["precision"])} | {pct(m["recall"])} | {pct(m["f1"])} | {e["unknownWithAnyCandidate"]}/5 | {u["unknownWithAnyCandidate"]}/6 |')
    lines += ['固定以第一个种子为参考，不选择表现最好的一次。100% precision那次仍漏2/12个正例；第三次漏5/12个。现有A候选覆盖12/12个正例，背景/其他误报1/5，请挑战误报0/6。',
              '| 词 | 留出正例 | A precision/recall/F1 | B首种子 precision/recall/F1 |','|---|---:|---|---|']
    for name,cn in [('thanks','谢谢'),('help','帮助'),('need','需要'),('me','我')]:
        va=r['A']['developmentHoldout']['perClass'][name];vb=runs[0]['developmentHoldout']['B']['perClass'][name]
        lines.append(f'| {cn} | {va["support"]} | '+ '/'.join(pct(va[k]) for k in ('precision','recall','f1'))+' | '+ '/'.join(pct(vb[k]) for k in ('precision','recall','f1'))+' |')
    lines += ['混淆矩阵行是真实类别，列是预测类别；顺序均为“未知、谢谢、帮助、需要、我”。其余种子完整矩阵见JSON证据。',
              '```text\nA              B（首种子）\n'+'\n'.join(f'{a}    {b}' for a,b in zip(r['A']['developmentHoldout']['confusionMatrix'],runs[0]['developmentHoldout']['B']['confusionMatrix']))+'\n```',
              '66条登记中：训练42条（谢谢9、帮助5、需要3、我5、背景5、其他15）；开发留出17条（四词各3、背景1、其他4）；请6条只作未知探索；不确定1条排除。训练与17条开发留出按已声明拍摄组整体隔离，旧日期粗分组整体留在训练；同源哈希不跨集。请6条与部分训练资料同组，单列探索结果，不计入17条留出，也不是未知动作的独立准确率。1位使用者，无法做跨人划分；已用于旧开发的资料也不是新盲测。A历史权重/规则可能见过这些来源，所以A/B只能回答本次开发对照表现，不能据此证明架构优劣。',
              '统一协议复用可审计的178维手部/身体参照表示，对全部类别使用同一输入。一个5类TCN（4词+背景/未知），训练集统计归一化、固定80轮、固定0.8概率/0.25分差拒识，共同质量、稳定与真实无手结束流程；不增加逐词物理动作阈值。保留实际丢点掩码，不插值；冲突段拒识。前端/生产加载尚未接入，连续不收手交接未验证。',
              '12条留出正例的登记范围末尾无手时长为0至0.272秒，达不到0.6秒结束条件；A/B均0/12完成，未补造结束帧、未改范围。没有自然连续多词/重复词的独立样本，因此漏完成、零多余事件均不能解释为现场能力。11项合成边界检查只验证状态机机制。',
              '**训练效率：有受控计时收益，但无法比较旧部署模型的历史训练耗时。**']
    rep=r['matchedTrainingControl']['results'];bt=[x['B']['fitIncludingSetupSeconds'] for x in rep];dt=[sum(t['fitIncludingSetupSeconds'] for t in x['matchedBinary']) for x in rep]
    lines += ['| 测量项目 | 结果 |','|---|---|',f'| 共享特征提取 | {r["featureExtraction"]["frames"]}帧 / {r["featureExtraction"]["seconds"]:.2f}秒，65条 |',
              f'| B 80轮拟合（含准备，中位数） | {statistics.median(bt):.3f}秒 |',
              f'| 同数据4个二分类TCN，各80轮（中位数） | {statistics.median(dt):.3f}秒 |',
              f'| 受控拟合提速 | {r["conclusion"]["matchedFourBinaryFitSpeedup"]:.2f}倍 |',
              f'| B权重大小 | {runs[0]["modelBytes"]/1024:.1f} KiB |',
              f'| 原部署A四份权重合计 | {r["baselineModelBytes"]/1024:.1f} KiB |',
              f'| 训练进程累计峰值RSS | {max(x["training"]["processPeakRssBytes"] for x in runs)/1024**2:.1f} MiB；未用GPU |',
              f'| A推理每观察帧均值/P95 | {r["A"]["runtime"]["frameMeanMs"]:.3f}/{r["A"]["runtime"]["frameP95Ms"]:.3f}毫秒 |',
              f'| B首种子推理每观察帧均值/P95 | {runs[0]["developmentHoldout"]["B_runtime"]["frameMeanMs"]:.3f}/{runs[0]["developmentHoldout"]["B_runtime"]["frameP95Ms"]:.3f}毫秒 |',
              '计时控制使用相同42条、相同178维预处理、相同机器、CPU两线程、每模型80轮，先2轮热身、交替执行顺序；3种子重复权重逐数组完全一致。4个二分类模型是新增的计时对照，不冒充旧A训练重现，也没有宣称同等准确率。逐模型80轮使其总优化工作量为单模型的4倍。冷启动、特征提取和导出另算；约111秒提取远大于小数据拟合，不等于全流程快4倍。每轮损失、样本吞吐、进程峰值和各次计时均见证据。',
              'A/B推理在同一Python/NumPy环境对同一725帧计时，含质量/状态处理，排除Hands/Pose、HTTP和渲染；数千帧/秒只是已提取特征的理论处理吞吐，不能当摄像头FPS。A历史训练来源异构，无法合理重现历史训练预算。',
              '**数字人辅助C未运行，收益未知。** 已核对四个动作资产与MakeHuman163骨架/导出器。当前资产是局部骨骼旋转，缺少经真人对照核验的21点手部映射、投影/身体比例/左右手校准及丢点/遮挡/单目深度噪声模型。直接套坐标会引入未经验证的替代数据；没有把动画充作真人真值或测试集。',
              '**具体缺口：** 全库旧登记共66条、1个账号；另核对两个账号的工作台：好有7正例/1反例、你有1正例，全部登记为训练用途；现在0条。均无登记验证/测试分区、没有已启用版本，旧格式也未提供已确认真实组标记，不能自动把其中资料改作独立测试。它们未进入本次四词A/B。请仍只有3条既有专项质量通过，另3条待复核；补齐真实新轮的3条清楚请后再决定新增类别。本轮统一通用质量不能覆盖请的双手专项审核。其余新词缺足够且分区明确的登记资料。现有四词不要求重录已经具备的训练原片；要验证泛化需另留未参与调试的真实组/使用者，要验证完成事件需真实可见的结束尾段。当前小样本失败先记录，不用留出集调阈值。',
              '复现命令（项目根目录；inventory首次使用新目录，旧目录会拒绝覆盖）：',
              '```powershell\n.venv-sign/Scripts/python.exe -B scripts/unified-experiment-data.py inventory\n.venv-sign/Scripts/python.exe -B -u scripts/unified-experiment-data.py extract\n.venv-anny/Scripts/python.exe -B scripts/unified-experiment-fit.py --smoke --matched-binary\n.venv-anny/Scripts/python.exe -B scripts/unified-experiment-fit.py --matched-binary\n.venv-sign/Scripts/python.exe -B scripts/unified-experiment-data.py replay\n.venv-anny/Scripts/python.exe -B scripts/unified-experiment-fit.py --benchmark-only\n.venv-sign/Scripts/python.exe -B scripts/unified-experiment-data.py verify\n.venv-sign/Scripts/python.exe -B tests/python/check-unified-experiment.py\n.venv-sign/Scripts/python.exe -B scripts/report-unified-experiment.py\n```',
              '本次私有清单、缓存、逐条结果、权重与哈希链保存在`data/experiments/unified-2026-11-17/`；不上传。公开摘要不含身份、录像路径或关键点。完整汇总见[实验JSON证据](assets/unified-recognition-experiment-2026-11-17.json)。11项新状态/指标检查、20项旧仲裁、5项训练指标检查通过；Torch/NumPy最大导出误差小于1e-6，66条原片与登记复核未变。']
    path=ROOT/'docs/识别与训练.md';text=path.read_text(encoding='utf8');marker='<a id="unified-experiment-2026-11-17"></a>'
    if marker in text:text=text[:text.index(marker)].rstrip()
    section='\n\n'.join(lines)
    section=re.sub(r'(?m)(^\|.*)\n\n(?=\|)',r'\1\n',section)
    path.write_text(text+'\n\n'+section+'\n',encoding='utf8')


if __name__=='__main__':main()
