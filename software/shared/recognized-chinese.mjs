import config from './recognized-chinese.json' with {type:'json'};

// This is a bounded Chinese word-order formatter, not a recognition model or
// an LLM translation. Every source token must occur exactly once in the result.
const classes={subject:config.subjects,predicate:config.predicates,verb:config.verbs,symptom:config.symptoms,place:config.places,needObject:config.needObjects};
for(const rule of config.rules){
 const indices=rule.order.filter(v=>typeof v==='number').sort((a,b)=>a-b);
 if(indices.length!==rule.pattern.length||indices.some((v,i)=>v!==i)||rule.order.some(v=>typeof v!=='number'&&v!=='在'))throw Error('Invalid Chinese coverage rule: '+rule.id);
}
const reserved=new Set(config.reserved),greetings=new Set(config.greetings);
const matches=(token,word)=>token==='$object'?!reserved.has(word):token.startsWith('$')?classes[token.slice(1)]?.includes(word):token===word;
const joinClauses=clauses=>clauses.map((c,i)=>c.text+(c.question?'？':i===clauses.length-1?'。':clauses[i+1].question?'。':'，')).join('');

export function organizeRecognizedWords(input,{partial=false}={}){
 const words=Array.isArray(input)?[...input]:[];
 const valid=words.length>0&&words.length<=config.maxWords&&words.every(w=>typeof w==='string'&&w.length>0&&w.length<=100&&w.trim()===w&&!/[\s，,。.!！?？、;；:：\n\r]/u.test(w))&&words.join('').length+1<=config.maxCharacters;
 const base={version:config.version,sourceWords:words,sourceText:valid?words.join('')+'。':'',text:'',status:'needs_review',reason:'invalid_words',clauses:[]};
 if(!valid)return base;
 const review=reason=>({...base,text:words.join('，')+'。',reason});
 if(partial)return review('incomplete_recognition');
 // A single confirmed label can still be spoken literally, including a newly
 // enabled private word. No subject, question, negation or intent is inferred.
 if(words.length===1)return {...base,text:words[0]+'。',status:'ready',reason:'literal',clauses:[{ruleId:'literal',text:words[0],sourceIndices:[0],inserted:[],question:false}]};
 const memo=new Map();
 function parse(start){
  if(start===words.length)return [[]];
  if(memo.has(start))return memo.get(start);
  const candidates=[];
  if(greetings.has(words[start]))candidates.push({length:1,ruleId:'greeting',text:words[start],sourceIndices:[start],inserted:[],question:false});
  for(const rule of config.rules){
   if(start+rule.pattern.length>words.length||!rule.pattern.every((token,i)=>matches(token,words[start+i])))continue;
   candidates.push({length:rule.pattern.length,ruleId:rule.id,text:rule.order.map(v=>typeof v==='number'?words[start+v]:v).join(''),sourceIndices:rule.order.filter(v=>typeof v==='number').map(v=>start+v),inserted:rule.order.filter(v=>typeof v==='string'),question:!!rule.question});
  }
  const solutions=new Map();
  for(const {length,...clause} of candidates){
   for(const rest of parse(start+length)){
    const clauses=[clause,...rest];solutions.set(joinClauses(clauses),clauses);
    // Two distinct full interpretations are sufficient to reject ambiguity.
    if(solutions.size>1){const result=[...solutions.values()];memo.set(start,result);return result;}
   }
  }
  const result=[...solutions.values()];memo.set(start,result);return result;
 }
 const solutions=parse(0);
 if(solutions.length!==1)return review(solutions.length?'ambiguous_structure':'unsupported_structure');
 const clauses=solutions[0],indices=clauses.flatMap(c=>c.sourceIndices).sort((a,b)=>a-b),text=joinClauses(clauses);
 if(indices.length!==words.length||indices.some((v,i)=>v!==i)||text.length>config.maxCharacters)return review('invalid_coverage');
 return {...base,text,status:'ready',reason:clauses.some(c=>c.ruleId.includes('need')&&c.ruleId!=='subject-predicate-object')?'word_order':'punctuation',clauses};
}
