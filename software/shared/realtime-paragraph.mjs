import config from './realtime-paragraph.json' with {type:'json'};

export function formatParagraphWords(words){
  const text=words.join('');
  return text?text+'。':'';
}
export function validParagraph(value,labels){
  const words=(v)=>!!v&&Array.isArray(v.words)&&v.words.length<=config.maxWords&&v.words.every(w=>typeof w==='string'&&labels.includes(w))&&v.wordCount===v.words.length&&v.text===formatParagraphWords(v.words)&&v.text.length<=config.maxCharacters;
  if(!words(value)||!['empty','collecting','needs_review'].includes(value.state))return false;
  if(value.state==='empty'&&value.wordCount!==0||value.state==='collecting'&&value.wordCount===0)return false;
  if(value.autoEnd!==undefined&&value.autoEnd!==null&&(!value.wordCount||!Number.isInteger(value.autoEnd.remainingMs)||value.autoEnd.remainingMs<0||value.autoEnd.remainingMs>config.endQuietSeconds*1000))return false;
  const end=value.final;
  return end===null||words(end)&&end.wordCount>0&&Number.isSafeInteger(end.id)&&end.id>0&&typeof end.partial==='boolean'&&Number.isSafeInteger(end.startMs)&&end.startMs>=0&&Number.isSafeInteger(end.endMs)&&end.endMs>end.startMs&&(end.endReason===undefined||['quiet','manual','limit'].includes(end.endReason));
}
