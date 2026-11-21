"""Paired stream metrics, independent of the PyTorch training environment."""
import time
import numpy as np
from unified_runtime import UnifiedStream, metrics


def evaluate(rows,model):
    word_to_label={'谢谢':1,'帮助':2,'需要':3,'我':4}
    truth=[]; base_predictions=[]; predictions=[]; clip_predictions=[];details=[];latencies=[]
    for r in rows:
        stream=UnifiedStream(model); seen=set();events=[];conflict=False
        for t,frame in zip(r['times'],r['frames']):
            tic=time.perf_counter();v=stream.push(t,frame);latencies.append((time.perf_counter()-tic)*1000)
            if v['candidate']:
                seen.add(v['candidate'])
            if v['event']:
                events.append(v['event']['label'])
                seen.add(v['event']['label'])
            conflict |= v['conflict']
        base=r['baseline'];base_seen={word_to_label[w] for w in base['candidates']+base['events']}
        base_events=[word_to_label[w] for w in base['events']]
        a=next(iter(base_seen)) if len(base_seen)==1 and not base['conflict'] else 0
        b=next(iter(seen)) if len(seen)==1 and not conflict else 0
        truth.append(r['label']);base_predictions.append(a);predictions.append(b);clip_predictions.append(model.classify(r['frames']))
        details.append({'sourceHash':r['sourceHash'],'truth':r['label'],'A':a,'B':b,
                        'A_candidates':sorted(base_seen),'B_candidates':sorted(seen),'A_events':base_events,'B_events':events,
                        'A_conflict':base['conflict'],'B_conflict':conflict,'quality':r['quality']})
    def events_report(prefix):
        positive=[r for r in details if r['truth']]
        unknown=[r for r in details if not r['truth']]
        return {'positiveClips':len(positive),
                'exactlyOneCorrectCompletion':sum(r[prefix+'_events']==[r['truth']] for r in positive),
                'missingCorrectCompletion':sum(r['truth'] not in r[prefix+'_events'] for r in positive),
                'extraCompletionEvents':sum(max(0,len(r[prefix+'_events'])-1) for r in positive),
                'wrongCompletionEvents':sum(sum(e!=r['truth'] for e in r[prefix+'_events']) for r in positive),
                'unknownClips':len(unknown),'unknownWithAnyCandidate':sum(bool(r[prefix+'_candidates']) for r in unknown),
                'unknownWithAnyCompletion':sum(bool(r[prefix+'_events']) for r in unknown),
                'conflictedClips':sum(r[prefix+'_conflict'] for r in details)}
    return {'A':metrics(truth,base_predictions),'B':metrics(truth,predictions),
            'B_offlineWholeClipDiagnostic':metrics(truth,clip_predictions),
            'events':{'A':events_report('A'),'B':events_report('B')},
            'B_runtime':{'frameMeanMs':float(np.mean(latencies)),'frameP95Ms':float(np.percentile(latencies,95)),
                         'framesPerSecondExcludingTracking':1000/float(np.mean(latencies)), 'frames':len(latencies)},'details':details}
