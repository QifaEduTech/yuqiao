export function validHandTracking(value) {
  return !!value && Number.isInteger(value.width) && value.width >= 16 && value.width <= 640
    && Number.isInteger(value.height) && value.height >= 16 && value.height <= 640
    && value.mirrored === true && Array.isArray(value.hands) && value.hands.length <= 2
    && value.hands.every(hand => hand && ['Left','Right'].includes(hand.side)
      && Array.isArray(hand.points) && hand.points.length === 21
      && hand.points.every(point => Array.isArray(point) && point.length === 2
        && point.every(n => Number.isFinite(n) && n >= -1 && n <= 2)));
}
export function validMeCheck(value){
  const degree=v=>v===null||v===undefined||Number.isFinite(v)&&v>=0&&v<=180;
  const bounded=v=>v===null||v===undefined||Number.isFinite(v)&&v>=-1&&v<=1;
  return value===null || !!value && ['bodyVisible','frameSupported','stableSupported'].every(k=>typeof value[k]==='boolean')
    && (value.chestReferenced===undefined||typeof value.chestReferenced==='boolean')
    && (value.modelScore===null || Number.isFinite(value.modelScore)&&value.modelScore>=0&&value.modelScore<=1)
    && Array.isArray(value.hands)&&value.hands.length<=2&&value.hands.every(h=>h&&degree(h.indexAngle)&&degree(h.indexAngle2d)
      &&['indexExtended','otherFingersFolded','towardChest','nearBody'].every(k=>typeof h[k]==='boolean')
      &&bounded(h.chestCosine)&&bounded(h.shoulderCosine)&&bounded(h.indexDepthFraction)
      &&['indexPointing','recedingIndex'].every(k=>h[k]===undefined||typeof h[k]==='boolean')
      &&(h.tipDistance===undefined||h.tipDistance===null||Number.isFinite(h.tipDistance)&&h.tipDistance>=0&&h.tipDistance<=10));
}
export function validLiveResult(value, targetText, targetSignId, maxSamples) {
  const labels=Array.isArray(targetText)?targetText:[targetText],ids=Array.isArray(targetSignId)?targetSignId:[targetSignId];
  if(labels.length!==ids.length||!labels.length||new Set(labels).size!==labels.length)return false;
  if (!value || !['waiting','observing','candidate','uncertain'].includes(value.status)
      || ![null,...labels].includes(value.candidate)
      || (value.status === 'candidate') !== labels.includes(value.candidate)
      || !['collecting','waiting','ending','ready_to_finish','reset_required','emitted'].includes(value.eventState)
      || !Number.isFinite(value.processingMs) || value.processingMs < 0
      || !Number.isInteger(value.samples) || value.samples < 0 || value.samples > maxSamples
      || !Number.isInteger(value.handSamples) || value.handSamples < 0 || value.handSamples > value.samples) return false;
  // Additive field: older sessions without an overlay remain readable.
  if (value.handTracking !== undefined && !validHandTracking(value.handTracking)) return false;
  if (value.meCheck !== undefined && !validMeCheck(value.meCheck)) return false;
  if (value.helpScore !== undefined && value.helpScore !== null && (!Number.isFinite(value.helpScore) || value.helpScore < 0 || value.helpScore > 1)) return false;
  if (value.motionSupported !== undefined && value.motionSupported !== null && typeof value.motionSupported !== 'boolean') return false;
  const event = value.event;
  if (event === null) return value.eventState !== 'emitted';
  return value.eventState === 'emitted' && value.status === 'waiting' && value.candidate === null
    && event && Number.isSafeInteger(event.id) && event.id > 0
    && labels.includes(event.text) && event.signId === ids[labels.indexOf(event.text)]
    && Number.isSafeInteger(event.startMs) && event.startMs >= 0
    && Number.isSafeInteger(event.endMs) && event.endMs > event.startMs;
}
