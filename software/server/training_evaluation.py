"""Current-word exam policy. Old-word regression is no longer an enable gate."""
def summarize_test_counts(counts):
    values=[counts.get(k) for k in ('tp','fn','fp','tn')]
    if any(type(n) is not int or n<0 for n in values):
        raise ValueError('Invalid test counts')
    tp,fn,fp,tn=values
    recall=tp/(tp+fn) if tp+fn else None
    precision=tp/(tp+fp) if tp+fp else None
    false_positive_rate=fp/(fp+tn) if fp+tn else None
    sufficient=tp+fn>=20 and fp+tn>=20
    return {'counts':counts,'recall':recall,'precision':precision,
            'falsePositiveRate':false_positive_rate,'testSufficient':sufficient,
            'passed':bool(sufficient and recall is not None and precision is not None
                          and false_positive_rate is not None and recall>=.9
                          and precision>=.9 and false_positive_rate<=.05)}
