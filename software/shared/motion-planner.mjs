import catalog from './sign-motion-catalog.json' with {type:'json'};
import windows from './sign-motion-windows.json' with {type:'json'};

const separator=/[\s，,。.!！?？、;；:：]/u;
const words=windows.entries.map(window=>{
 const entry=catalog.entries.find(e=>e.id===window.id);
 if(!entry||entry.version!==window.version||window.activeFrom<0||window.activeTo<=window.activeFrom||window.activeTo>window.duration)throw Error('Stale or invalid motion window: '+window.id);
 return {...entry,...window};
}).sort((a,b)=>b.label.length-a.label.length);
// IDs distinguish playback requests, not security identities. The receiver
// recomputes the full plan from the input and checks every version/range.
function identity(value){let h=2166136261;for(const char of value){h^=char.codePointAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}

export function planMotionText(input){
 if(typeof input!=='string'||!input.trim()||input.length>2000)return {status:'unsupported',missing:[],reason:'empty_or_long'};
 const text=input.trim(),tokens=[],missing=[];let cursor=0;
 const matchAt=i=>words.find(word=>text.startsWith(word.label,i));
 while(cursor<text.length){
  if(separator.test(text[cursor])){cursor++;continue;}
  const word=matchAt(cursor);
  if(word){tokens.push(word);cursor+=word.label.length;continue;}
  const start=cursor++;
  while(cursor<text.length&&!separator.test(text[cursor])&&!matchAt(cursor))cursor++;
  missing.push(text.slice(start,cursor));
 }
 if(missing.length||!tokens.length)return {status:'unsupported',missing:[...new Set(missing)],reason:'unknown_content'};
 if(tokens.length>windows.maxActions)return {status:'unsupported',missing:[],reason:'too_many_actions'};
 if(tokens.length===1)return {status:'single',entry:tokens[0]};
 const steps=tokens.map((word,i)=>({id:word.id,version:word.version,from:i===0?0:word.activeFrom,to:i===tokens.length-1?word.duration:word.activeTo,transition:i===0?0:windows.transition}));
 const duration=Number(steps.reduce((sum,s)=>sum+s.to-s.from+s.transition,0).toFixed(6));
 if(duration>windows.maxDuration)return {status:'unsupported',missing:[],reason:'too_long'};
 const version='auto-sequence-1',id='csl.sequence_'+identity(JSON.stringify({text,version,steps}));
 return {status:'sequence',preview:{id,label:text,version,status:'authored_unverified',kind:'sequence',steps,duration}};
}
