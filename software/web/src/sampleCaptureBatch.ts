function chinaStamp(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return {date:`${parts.year}${parts.month}${parts.day}`,time:`${parts.hour}${parts.minute}${parts.second}`};
}
export function newCaptureBatch(userId:string){
  const stamp=chinaStamp(),batch=`capture:${stamp.date}:${stamp.time}:${crypto.randomUUID().replaceAll('-','').slice(0,6)}`;
  try{sessionStorage.setItem(`yuqiao-capture-round:${userId}`,batch);}catch{/* Optional per-tab convenience; the saved record remains authoritative. */}
  return batch;
}
export function currentCaptureBatch(userId:string){
  try{const value=sessionStorage.getItem(`yuqiao-capture-round:${userId}`);return value&&new RegExp(`^capture:${chinaStamp().date}:\\d{6}:[a-f0-9]{6}$`).test(value)?value:'';}catch{return '';}
}
