// Finite, whole-clause phrases using existing actions. These are mappings of
// wording, not professional sign-language validation or unrestricted translation.
export const expandedExpressionRules=[];
const add=(id,inputs,output,note)=>expandedExpressionRules.push({id,inputs,output,note});
const helperWords=['医生','志愿者','你'];
const helpVerbs=['帮忙','帮一下忙','帮帮忙'];
const helpMeVerbs=['帮我','帮帮我','帮我一下'];
const forms=(prefixes,helper,verbs)=>prefixes.flatMap(prefix=>verbs.map(verb=>prefix+helper+verb));

for(const helper of helperWords){
 add('request-'+helper,forms(['我想请','我想要请','我请'],helper,helpVerbs),'我请'+helper+'帮助','用“请”表达请求，保留请求人和提供帮助的人，不额外指定帮助对象。');
 add('request-me-'+helper,forms(['我想请','我想要请','我请'],helper,helpMeVerbs),'我请'+helper+'帮助我','保留请求人、提供帮助的人和帮助对象；两处“我”均保留。');
 add('polite-help-'+helper,forms(['请','麻烦'],helper,helpVerbs),'请'+helper+'帮助','用“请”表达礼貌请求，保留提供帮助的人。');
 add('polite-help-me-'+helper,forms(['请','麻烦'],helper,helpMeVerbs),'请'+helper+'帮助我','用“请、帮助”表达请求，保留提供帮助的人和“我”这个对象。');
 add('need-help-'+helper,['我需要'+helper+'帮忙','我需要'+helper+'的帮助'],'我需要'+helper+'帮助','保留“我”的需求和提供帮助的人。');
 add('address-help-'+helper,forms([helper+'请'],'',helpMeVerbs),helper+'请帮助我','保留称呼、礼貌请求和帮助对象。');
 add('thank-help-'+helper,['感谢'+helper+'帮忙','感谢'+helper+'的帮助','谢谢'+helper+'帮忙','谢谢'+helper+'的帮助'],'谢谢'+helper+'帮助','表达对其帮助的感谢，不补充原话没有指明的受助者。');
 add('thank-help-me-'+helper,['感谢'+helper+'帮我','感谢'+helper+'帮助我','谢谢'+helper+'帮我'],'谢谢'+helper+'帮助我','保留感谢、帮助的人和接受帮助的“我”。');
 for(const task of ['挂号','检查']){
  add('help-task-'+helper+'-'+task,['请'+helper+'帮我'+task,'麻烦'+helper+'帮我'+task],'请'+helper+'帮助我'+task,'保留帮助的人、对象和所请求的事项，不增加办理结果或医疗判断。');
  add('request-task-'+helper+'-'+task,['我想请'+helper+'帮我'+task,'我请'+helper+'帮我'+task],'我请'+helper+'帮助我'+task,'保留请求人、帮助的人、对象和事项，不把请求表达成已完成。');
 }
}
for(const task of ['挂号','检查']){
 add('help-my-task-'+task,['请帮我'+task,'请帮我'+task+'一下','麻烦帮我'+task],'请帮助我'+task,'用已有动作表达协助请求，保留对象与事项，不补充原话没有指明的人。');
}
add('my-help-need',['我想得到帮助','我想获得帮助','我想请求帮助'],'我需要帮助','用已有的“需要”表达寻求帮助的需求，保留“我”。');
for(const place of ['医生','志愿者','医院','门诊','挂号','报告']){
 add('polite-where-'+place,['请问'+place+'在哪里','请问'+place+'在哪儿','请问'+place+'在哪','请问'+place+'在什么地方'],'请'+place+'哪里','用“请”表达礼貌，用“哪里”保留位置询问，保留询问对象。');
}
