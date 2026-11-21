import rules from './sign-expression-rules.json' with {type:'json'};
import catalog from './sign-motion-catalog.json' with {type:'json'};
import {planMotionText} from './motion-planner.mjs';
import {resolveInputPreview} from './sign-preview.mjs';
import {expandedExpressionRules} from './sign-expression-phrases.mjs';

// Rules apply to entire punctuation-delimited clauses, never to a substring.
// No stopword removal, fuzzy matching, unknown-word deletion or LLM inference.
const byInput=new Map();
for(const rule of [...rules.rules,...expandedExpressionRules]){
 if(!rule.id||!rule.note||planMotionText(rule.output).status==='unsupported')throw Error('Invalid expression rule: '+rule.id);
 for(const input of rule.inputs){if(!input||byInput.has(input))throw Error('Duplicate expression phrase');byInput.set(input,rule);}
}

export function resolveExpression(input){
 if(typeof input!=='string'||!input.trim()||input.length>2000)return {status:'unsupported',entry:null,preview:null,missing:[],reason:'empty_or_long',expression:null};
 const originalText=input,changes=[];
 const exact=resolveInputPreview(input);
 let actionText=input.trim();
 if(!exact.preview){
  const clauses=input.split(/[，,。.!！?？、;；:：\n\r]+/u).map(s=>s.trim()).filter(Boolean);
  if(!clauses.length)return {...exact,expression:null};
  // If a clause is unknown, retain it verbatim. The strict planner will reject
  // the WHOLE result rather than returning a playable partial suggestion.
  actionText=clauses.map(clause=>{
   if(resolveInputPreview(clause).preview)return clause;
   const rule=byInput.get(clause);if(!rule)return clause;
   changes.push({ruleId:rule.id,from:clause,to:rule.output,note:rule.note});return rule.output;
  }).join('，');
 }
 const result=changes.length?resolveInputPreview(actionText):exact;
 // A question mark is not a disposable separator. Location/what questions
 // have explicit lexical actions; yes/no intonation cannot be invented.
 const parts=input.split(/([，,。.!！?？、;；:：\n\r]+)/u),questionMissing=[];
 for(let i=0;i<parts.length;i+=2){
  if(!/[?？]/u.test(parts[i+1]||''))continue;
  const clause=parts[i].trim(),mapped=byInput.get(clause)?.output??clause,plan=planMotionText(mapped);
  const ids=plan.status==='single'?[plan.entry.id]:plan.status==='sequence'?plan.preview.steps.map(s=>s.id):[];
  if(!ids.some(id=>['csl.ref.bmcx.3789','csl.ref.bmcx.3796'].includes(id)))questionMissing.push('疑问语气：'+clause+'？');
 }
 if(questionMissing.length)return {...result,status:'unsupported',entry:null,preview:null,expression:null,reason:'unsupported_question',missing:[...new Set([...(result.missing||[]),...questionMissing])]};
 if(!result.preview)return {...result,expression:null};
 const plan=planMotionText(actionText);
 const steps=plan.status==='sequence'?plan.preview.steps.map(step=>({id:step.id,label:catalog.entries.find(e=>e.id===step.id).label,version:step.version})):
  [{id:result.preview.id,label:result.preview.label,version:result.preview.version}];
 return {...result,expression:{originalText,actionText,steps,changes,ruleVersion:rules.version,requiresConfirmation:true}};
}
