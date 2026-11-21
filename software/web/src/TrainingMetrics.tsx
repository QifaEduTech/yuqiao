type Counts={tp:number;fn:number;fp:number;tn:number};
type Row={signId:string;text:string;recall:number|null;precision:number|null;accuracy?:number|null;falsePositiveRate?:number|null;counts?:Counts;passed:boolean};
type Layers={perClass?:Row[];recordingPerClass?:Row[];classificationPerClass?:Row[];evaluationVersion?:string};
export type MetricsReport=Layers&{reassessment?:(Layers&{mode:string});};
const metric=(value:number|null|undefined)=>value==null?'无法计算':(value*100).toFixed(1)+'%';
export default function TrainingMetrics({report}:{report:MetricsReport}){
 const view=report.reassessment??report;
 return <>{report.reassessment&&<p className="small-hint">以下是同一模型对原测试视频的分层复查，未重新训练；原始自动收尾成绩仍保留。</p>}{report.perClass?.map(original=>{
  const auto=view.perClass?.find(r=>r.signId===original.signId)??original,clip=view.recordingPerClass?.find(r=>r.signId===original.signId),model=view.classificationPerClass?.find(r=>r.signId===original.signId);
  const c=auto.counts,positives=c?c.tp+c.fn:0,negatives=c?c.fp+c.tn:0;
  return <div key={original.signId} className="training-metrics"><strong>{original.text} · {original.passed?'本轮已达标':'继续完善'}</strong>{c&&<p>本轮测试：本动作 {positives} 条，非本动作 {negatives} 条。</p>}
   {positives>0?<>{clip?<p><b>录像识别：{metric(clip.recall)}</b>（{clip.counts?.tp} / {positives} 条）</p>:<p>录像识别率：旧报告未单独统计。</p>}<p>实时自动收尾成功率：{metric(auto.recall)}（{c?.tp} / {positives} 条）</p></>:<p>尚无本动作的新测试，不能判断识别率或召回率。</p>}
   {clip&&positives>0&&<p className="small-hint">录像在片段结束时确认稳定结果；自动收尾需要观察到真实无手尾段。</p>}
   {clip&&positives>0&&<details><summary>查看分类与误报指标</summary><p>录像准确率 {metric(clip.accuracy)} · 录像精确率 {metric(clip.precision)} · 误报率 {negatives?metric(clip.falsePositiveRate):'未测试'}</p>{model&&<p>整段模型分类召回率：{metric(model.recall)}。仍使用原来的置信度和拒识条件。</p>}</details>}
   {!negatives&&<p className="small-hint">尚无非本动作测试，误报未评估。</p>}
   {positives===0&&negatives>0&&<p className="small-hint">只有非本动作对照，不能把未误报当作已经学会这个动作。</p>}
  </div>;
 })}<p className="small-hint">自动启用仍按原完整流程逐类检查。小样本结果不代表已充分训练。</p></>;
}
