import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {resolveInputPreview} from '../shared/sign-preview.mjs';
import {renderDictionaryRow,toClientRow} from './dictionary-rows.mjs';
import {paginationMarkup,crawlMarkup,paginationCss,makePageData,paginationScript} from './dictionary-pagination.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dictionary=JSON.parse(await readFile(resolve(root,'shared/sign-dictionary.json'),'utf8'));
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
if(dictionary.schemaVersion!==1||!Array.isArray(dictionary.entries))throw Error('Invalid dictionary');
const entries=new Map();
for(const entry of dictionary.entries){
  if(!/^csl\.[a-z0-9_.-]+$/.test(entry.id)||entries.has(entry.id)||typeof entry.text!=='string'||!entry.text.trim()||typeof entry.description!=='string'||!Array.isArray(entry.components)||entry.review!=='not_reviewed')throw Error('Invalid or duplicate dictionary entry');
  entries.set(entry.id,entry);
  if(entry.referenceUrl&&new URL(entry.referenceUrl).protocol!=='https:')throw Error('Reference must use HTTPS');
  for(const link of entry.referenceLinks??[])if(typeof link.label!=='string'||new URL(link.url).protocol!=='https:')throw Error('Invalid reference link');
  if(entry.referenceOnly){
    const source=new URL(entry.sourceUrl);
    if(source.origin!=='https://shouyu.bmcx.com'||!/^\/\d+__shouyud\/$/.test(source.pathname)||source.search||source.hash||entry.description!==''||entry.rightsStatus!=='reuse_unconfirmed')throw Error('Invalid metadata-only source entry');
  }
}
const motionCatalog=JSON.parse(await readFile(resolve(root,'shared/sign-motion-catalog.json'),'utf8'));
const recognitionCatalog=JSON.parse(await readFile(resolve(root,'shared/sign-catalog.json'),'utf8'));
for(const motion of motionCatalog.entries)if(entries.get(motion.id)?.text!==motion.label)throw Error(`Fixed action must be registered in the dictionary: ${motion.id}`);
const rows=dictionary.entries.map(entry=>{
  if(entry.components.some(id=>id===entry.id||!entries.has(id)))throw Error(`Invalid components: ${entry.id}`);
  const fixed=motionCatalog.entries.find(m=>m.id===entry.id&&m.label===entry.text);
  const preview=fixed?{id:fixed.id,label:fixed.label,version:fixed.version,status:'authored_unverified'}:(entry.referenceOnly||entry.referenceMaterial)?null:resolveInputPreview(entry.text).preview;
  const sequence=entry.components.map(id=>entries.get(id).text).join(' → ')||'—';
  const status=preview?'已制作 · 待核对':entry.referenceMaterial?'解释参考 · 未制作动画':entry.referenceOnly?'来源索引 · 待核对':'已登记说明 · 未单独制作';
  const href=preview?`/anny-review.html?${new URLSearchParams({motion:preview.id,version:preview.version})}`:null;
  const references=[...(entry.referenceUrl?[{label:'用户提供的参考图',url:entry.referenceUrl}]:[]),...(entry.referenceLinks??[])];
  return {...entry,sequence,status,preview,href,references,category:entry.category||'项目词条',recognized:recognitionCatalog.entries.some(e=>e.id===entry.id)};
});
const categories=[...new Set(rows.map(r=>r.category))];
const externalCount=rows.filter(r=>r.referenceOnly).length;
const counts=`<div class="dictionary-summary"><span>词条 <b>${rows.length}</b></span><span>已有示范 <b>${rows.filter(r=>r.preview).length}</b></span></div>`;
const filters=`<label>分类 <select id="dictionary-category" aria-label="词条分类"><option value="all">全部分类</option>${categories.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('')}</select></label>`;
const table=rows.slice(0,10).map(row=>renderDictionaryRow(toClientRow(row))).join('\n');
const pageData=makePageData(rows);
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(dictionary.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f8f7;color:#28483d;font-family:"Microsoft YaHei",sans-serif;line-height:1.8}main{max-width:1280px;margin:auto;padding:28px}nav{display:flex;justify-content:space-between;gap:16px;font-size:14px}a{color:#23694f;text-decoration:none}h1{font-size:30px;font-weight:500;margin:32px 0 10px}.intro{color:#62786d;max-width:850px;font-size:14px}.toolbar{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:24px 0 14px}input{font:inherit;border:1px solid #cbdad0;border-radius:8px;padding:8px 12px;background:white;max-width:100%}.table-wrap{overflow-x:auto;border:1px solid #dbe5df;border-radius:12px;background:white}table{border-collapse:collapse;width:100%;min-width:820px;font-size:14px}th,td{padding:16px;text-align:left;border-bottom:1px solid #e4ece7;vertical-align:top}thead{background:#eaf2ed}tbody th{white-space:nowrap;font-size:18px;font-weight:500}td:nth-child(2){min-width:200px}td:nth-child(5){max-width:300px}small{display:block;font-size:12px;color:#738479;margin-top:7px}.status{display:inline-block;padding:3px 8px;border-radius:6px;background:#f5f1e9;color:#86622e;white-space:nowrap;font-size:12px}.available{background:#e9f2ed;color:#2b6a4c}.preview{display:inline-block;border:1px solid #b9d3c3;border-radius:7px;padding:5px 10px;white-space:nowrap}footer{font-size:12px;color:#7b8b80;margin-top:18px}[hidden]{display:none!important}@media(max-width:600px){main{padding:18px}h1{font-size:25px}th,td{padding:12px}.toolbar{gap:8px}}
thead th:nth-child(3){white-space:nowrap}.scroll-hint{font-size:12px;color:#738479;margin:0 0 10px}
.dictionary-summary{display:flex;flex-wrap:wrap;gap:12px 28px;padding:17px 0;border-top:1px solid #d6e1d9;border-bottom:1px solid #d6e1d9;margin:20px 0}.dictionary-summary span{font-size:14px;color:#64776a}.dictionary-summary b{color:#285c43;font-size:24px;font-weight:500;margin-left:7px}select{font:inherit;border:1px solid #cbdad0;border-radius:8px;padding:9px;background:white;color:#28483d;max-width:100%}.source-note{font-size:13px;color:#71806b;background:#edf3e8;padding:12px 15px;border-radius:8px;line-height:1.8}.toolbar label{font-size:14px}.toolbar #dictionary-count{margin-left:auto;font-size:13px}.table-wrap:focus-visible{outline:2px solid #23694f}.source-kind{color:#7c6e43}@media(max-width:600px){.toolbar label{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px}.toolbar input,.toolbar select{width:65%}.toolbar #dictionary-count{margin-left:0}.dictionary-summary{gap:8px 18px}.dictionary-summary b{font-size:20px}}
main{max-width:1280px}.description-cell{min-width:320px}.description-cell p{margin:0;font-size:15px;line-height:1.9}.source-cell{width:290px}.source-cell details{font-size:12px;margin-top:8px}.source-cell summary{cursor:pointer;color:#587768}.not-authored{font-size:13px;color:#83958a}.source-cell details p{margin:8px 0}
${paginationCss}
</style></head><body><main><nav><a href="/">← 返回语桥</a><a href="/anny-review.html">固定动作库</a></nav><h1>${escape(dictionary.title)}</h1><p class="intro">搜索词语或按分类查找，选择已有示范的词语进入学习。</p>${counts}${externalCount?'<p class="source-note">本轮补充外部词典的词名、分类和来源入口。图文复用许可待确认，因此只建立来源索引；新增索引不代表已制作动画或已支持识别。</p>':''}<div class="toolbar"><label>查找词语 <input id="dictionary-search" type="search" placeholder="例如：是、联系" aria-label="查找词语"></label>${filters}<span id="dictionary-count" aria-live="polite">共 ${rows.length} 条</span></div><p class="scroll-hint">每页显示10条，动作示范按需加载。</p><div class="table-wrap" tabindex="0" role="region" aria-label="可横向滚动的词典表格"><table aria-label="项目手语词典表"><thead><tr><th>词语</th><th>动作解释</th><th>动作示范</th></tr></thead><tbody>${table}</tbody></table></div>${paginationMarkup}<p id="dictionary-empty" hidden>没有找到该词，暂未登记。</p><footer>更新：${escape(dictionary.updated)} · 已制作不等于已通过标准手语校验。词典由项目统一维护，后续新动作同步登记。</footer></main><script type="application/json" id="dictionary-data">${pageData}</script><script>
${paginationScript}
if(location.protocol==='file:'){for(const link of document.querySelectorAll('a[href^="/"]'))link.href=new URL(link.getAttribute('href'),'http://127.0.0.1:5173').href;}

</script></body></html>`;
await writeFile(resolve(root,'web/sign-dictionary.html'),html);

// Dictionary source JSON and HTML are the maintained views; no duplicate Markdown table.
console.log(`Dictionary generated: ${rows.length} entries, ${rows.filter(row=>row.preview).length} preview actions; all unreviewed.`);
