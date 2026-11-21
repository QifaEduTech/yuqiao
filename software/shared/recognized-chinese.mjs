import config from './recognized-chinese.json' with {type:'json'};

// This is a bounded Chinese word-order formatter, not a recognition model or
// an LLM translation. Every source token must occur exactly once in the result.
const classes={subject:config.subjects,predicate:config.predicates,verb:config.verbs,symptom:config.symptoms,place:config.places,needObject:config.needObjects};
for(const rule of config.rules){
 const indices=rule.order.filter(v=>typeof v==='number').sort((a,b)=>a-b);
 const allowedInsertion=rule.id==='subject-fever'?'了':'在';
 if(indices.length!==rule.pattern.length||indices.some((v,i)=>v!==i)||rule.order.some(v=>typeof v!=='number'&&v!==allowedInsertion))throw Error('Invalid Chinese coverage rule: '+rule.id);
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

// Match two grounded clauses in either order. Within the help clause only
// the order of the already identified role, request and verb is normalized.
function feverHelp(words){
 for(const feverStart of [0,words.length-2]){
  if(words[feverStart]!=='我'||words[feverStart+1]!=='发烧')continue;
  const requestStart=feverStart===0?2:0;
  const request=words.slice(requestStart,feverStart===0?words.length:feverStart);
  const hasSubject=request[0]==='我';
  const body=hasSubject?request.slice(1):request;
  if(!body.includes('帮助')||body.some(w=>!['需要','医生','帮助'].includes(w))||new Set(body).size!==body.length)continue;
  const needs=body.includes('需要');
  const hasDoctor=body.includes('医生');
  const ordered=[...(hasSubject?['我']:[]),...(needs?['需要']:[]),...(hasDoctor?['医生']:[]),'帮助'];
  return {
   inferredWords:needs?[]:['需要'],
   clauses:[
    {ruleId:'subject-fever',text:'我发烧了',sourceIndices:[feverStart,feverStart+1],inserted:['了'],question:false},
    {ruleId:'fever-help-request',text:(hasSubject?'我':'')+'需要'+(hasDoctor?'医生':'')+'帮助',
     sourceIndices:ordered.map(word=>requestStart+request.indexOf(word)),inserted:needs?[]:['需要'],question:false},
   ],
  };
 }
 return null;
}

export function organizeUtterance(input,{partial=false}={}){
 const original=organizeRecognizedWords(input,{partial});
 const {sourceWords:words,sourceText}=original;
 if(!sourceText)return original;
 const repair=feverHelp(words);
 if(repair){
  return {...original,...repair,text:joinClauses(repair.clauses),status:'ready',
   reason:repair.inferredWords.length?'contextual_need':'word_order'};
 }
 if(original.status==='ready')return original;
 const formatted=partial?organizeRecognizedWords(words):original;
 return {...original,text:formatted.status==='ready'?formatted.text:sourceText};
}

export function organizeCompletedParagraph(paragraph){
 return {...paragraph,chinese:organizeUtterance(paragraph.words,{partial:paragraph.partial})};
}
