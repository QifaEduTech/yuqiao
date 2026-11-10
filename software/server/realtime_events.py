"""Conservative events: stable predictions followed by an observed hands-away boundary.

These are experimental delimiters, not learned natural sign boundaries.
"""
from realtime_window import LiveWindow, CONFIG,recent_thumb_motion


class LiveRecognizer:
    def __init__(self, classify, motion_gate=recent_thumb_motion):
        self.window = LiveWindow(classify,motion_gate)
        self.last_time = None
        self.next_id = 1
        self.clear_segment()

    def clear_segment(self):
        self.started = None
        self.missing_since = None
        self.support_since = None
        self.last_support = None
        self.support_count = 0
        self.qualified = False
        self.blocked = False

    def push(self, t, value):
        if self.last_time is not None and t <= self.last_time:
            raise ValueError('Non-monotonic frame time')
        if self.last_time is not None and t-self.last_time > CONFIG['resetGapSeconds']:
            # A disconnected camera is not evidence that a sign ended.
            self.clear_segment()
            self.window.reset()
        self.last_time = t
        previous_prediction = self.window.last_prediction
        result = self.window.push(t, value)
        fresh = value is not None and self.window.last_prediction != previous_prediction
        event = None
        state = 'collecting'
        rules = CONFIG['events']

        if value is None:
            if self.missing_since is None:
                self.missing_since = t
            state = 'ending' if self.qualified else 'waiting'
            if t-self.missing_since >= CONFIG['missingResetSeconds']:
                if (self.qualified and not self.blocked and self.last_support is not None
                        and self.missing_since-self.last_support <= rules['maxSupportAgeSeconds']):
                    event = {'id': self.next_id, 'signId': CONFIG['targetSignId'],
                             'text': CONFIG['targetText'], 'startMs': round(self.started*1000),
                             'endMs': round(self.missing_since*1000)}
                    self.next_id += 1
                self.clear_segment()
                self.window.reset()
                state = 'emitted' if event else 'waiting'
        else:
            if self.started is None:
                self.started = t
            if self.missing_since is not None:
                # Short tracking loss is not a second action or fresh consensus.
                self.support_since = None
                self.support_count = 0
            self.missing_since = None
            if t-self.started > rules['maxSegmentSeconds']:
                self.blocked = True
                self.qualified = False
            if fresh and not self.blocked:
                if result['candidate'] == CONFIG['targetText']:
                    if self.support_since is None:
                        self.support_since = t
                    self.last_support = t
                    self.support_count += 1
                    if (self.support_count >= rules['minPredictions']
                            and t-self.support_since >= rules['stableSeconds']):
                        self.qualified = True
                else:
                    self.support_since = None
                    self.support_count = 0
                    self.qualified = False
            if self.last_support is not None and t-self.last_support > rules['maxSupportAgeSeconds']:
                self.qualified = False
            state = 'reset_required' if self.blocked else 'ready_to_finish' if self.qualified else 'collecting'
        return {**result, 'event': event, 'eventState': state}
