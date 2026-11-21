"""Separate model classification, explicit recording output, and automatic ending.

The deployment gate continues to use perClass automatic-event counts. Recording
boundaries are explicit, not artificial no-hand evidence or fresh blind tests.
"""
from unified_runtime import UnifiedStream, SETTLED_END_POLICY

def summarize(labels, counts, policy):
    rows=[]
    for label,c in zip(labels,counts):
        positive=c['tp']+c['fn'];negative=c['fp']+c['tn'];predicted=c['tp']+c['fp']
        recall=c['tp']/positive if positive else None;precision=c['tp']/predicted if predicted else None
        fpr=c['fp']/negative if negative else None;accuracy=(c['tp']+c['tn'])/(positive+negative) if positive+negative else None
        passed=positive>=policy['minTestPositive'] and negative>=policy['minTestNegative'] and recall is not None and precision is not None and fpr is not None and recall>=policy['recallTarget'] and precision>=policy['precisionTarget'] and fpr<=policy['maxFalsePositiveRate']
        rows.append({**label,'counts':c,'accuracy':accuracy,'recall':recall,'precision':precision,'falsePositiveRate':fpr,'passed':bool(passed)})
    return rows

def evaluate_joint(rows,model,labels,policy,*,split='test'):
    blank=lambda:[{'tp':0,'fn':0,'fp':0,'tn':0} for _ in labels]
    automatic,recording,classification=blank(),blank(),blank();details=[]
    for row in rows:
        if row['split']!=split:continue
        live=UnifiedStream(model);events=[];seen=set();conflict=False
        for t,frame in zip(row['times'],row['frames']):
            out=live.push(t,frame);conflict|=out['conflict']
            if out['candidate']:seen.add(out['candidate'])
            if out['event']:events.append(out['event']['label']);seen.add(out['event']['label'])
        whole=model.classify(row['frames'])
        explicit=live.finish_explicit(row['times'][-1],allow_missing=True) if row['times'] else None
        recorded=events+([explicit['label']] if explicit else [])
        if explicit:seen.add(explicit['label'])
        truth=row['label']
        for i in range(1,len(labels)+1):
            conditions=[events==[i] and seen=={i} and not conflict if truth==i else i not in seen and not conflict,
                        recorded==[i] and seen=={i} and not conflict if truth==i else i not in seen and not conflict,
                        whole==i if truth==i else whole!=i]
            for table,correct in zip([automatic,recording,classification],conditions):
                table[i-1]['tp' if truth==i and correct else 'fn' if truth==i else 'tn' if correct else 'fp']+=1
        auto_correct=events==[truth] and seen=={truth} and not conflict if truth else not seen and not conflict
        recording_correct=recorded==[truth] and seen=={truth} and not conflict if truth else not seen and not conflict
        if conflict or len(seen)>1 or len(recorded)>1:reason='出现多个动作或冲突，未确认单个动作。'
        elif recording_correct and not auto_correct:reason='已稳定识别，录像结束时可确认；实时自动收尾尚未触发。'
        elif recording_correct:reason='录像识别和自动收尾均通过。'
        elif not whole:reason='模型置信不足或偏向背景，未确认目标动作。'
        elif whole!=truth:reason='模型分类与目标动作不一致。'
        else:reason='整段分类正确，但逐帧稳定性或结束时的有效证据不足。'
        details.append({'recordId':row['recordId'],'correct':auto_correct,'recordingCorrect':recording_correct,'classificationCorrect':whole==truth,'classificationLabel':whole,'automaticEvents':events,'recordingEvents':recorded,'explicitRecordingEnd':bool(explicit),'candidates':sorted(seen),'reason':reason})
    return {'evaluationVersion':'joint-layered-evaluation-v1','perClass':summarize(labels,automatic,policy),'recordingPerClass':summarize(labels,recording,policy),'classificationPerClass':summarize(labels,classification,policy),'details':details}


def select_end_policy(rows, model, labels, policy):
    """Select once on internal validation, before scoring any held-out tests."""
    validation = [row for row in rows if row['split'] == 'validation']
    summaries = []
    for method in (None, SETTLED_END_POLICY):
        model.end_policy = method
        result = evaluate_joint(validation, model, labels, policy, split='validation')
        wrong = [0] * len(labels)
        background_errors = 0
        for row, detail in zip(validation, result['details']):
            events = detail['automaticEvents']
            for label in set(events):
                if label != row['label']:
                    wrong[label-1] += 1
            if not row['label'] and events:
                background_errors += 1
        counts = [c['counts'] for c in result['perClass']]
        negatives = [c['fp']+c['tn'] for c in counts]
        summaries.append({
            'policy': method or 'no-hand', 'correct': sum(c['tp'] for c in counts),
            'wrongEventsByClass': wrong, 'backgroundErrors': background_errors,
            'maxWrongEventRate': max((w/n for w,n in zip(wrong, negatives) if n), default=1),
            'byWord': [{'text':c['text'], 'counts':c['counts']} for c in result['perClass']],
        })
    baseline, settled = summaries
    use_hold = (settled['correct'] > baseline['correct']
                and settled['maxWrongEventRate'] <= policy['maxFalsePositiveRate']
                and settled['backgroundErrors'] <= baseline['backgroundErrors'])
    model.end_policy = SETTLED_END_POLICY if use_hold else None
    return {'selected': model.end_policy, 'validationClips': len(validation), 'comparisons': summaries}
