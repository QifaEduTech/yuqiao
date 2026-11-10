// A shared row renderer avoids repeating table markup thousands of times in the HTML.
export function renderDictionaryRow(row){
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 return '<tr data-id="'+esc(row.id)+'" data-word="'+esc(row.word)+'" data-category="'+esc(row.category)+'"><th scope="row">'+esc(row.word)+'<small>'+esc(row.category)+'</small></th><td class="description-cell"><p>'+esc(row.description||'动作解释待补充。')+'</p></td><td>'+(row.href?'<a class="preview" href="/learning.html?motion='+encodeURIComponent(row.id)+'">学习这个动作</a>':'<span class="not-authored">暂无示范</span>')+'</td></tr>';
}
export function toClientRow(row){
 const value={id:row.id,word:row.text,description:row.description,category:row.category,kind:row.referenceOnly?'source':row.referenceMaterial?'reference':'project'};
 if(row.sourceId){value.sourceId=row.sourceId;if(row.preview){value.note=row.note;value.links=row.references;}}
 else{value.source=row.source;value.note=row.note;if(row.references?.length)value.links=row.references;}
 if(row.preview){value.animated=true;value.href=row.href;value.version=row.preview.version;}
 if(row.recognized)value.recognized=true;
 if(row.sequence&&row.sequence!=='—')value.sequence=row.sequence;
 return value;
}
