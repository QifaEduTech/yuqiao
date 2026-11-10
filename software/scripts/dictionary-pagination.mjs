import {renderDictionaryRow,toClientRow} from './dictionary-rows.mjs';
export const paginationMarkup=`<div class="dictionary-pages" aria-label="词典分页"><button id="dictionary-prev" type="button">← 上一页</button><span id="dictionary-page" aria-live="polite"></span><button id="dictionary-next" type="button">下一页 →</button></div>`;
export const crawlMarkup=`<div id="dictionary-crawl-progress" class="crawl-progress" hidden><span id="dictionary-crawl-text" role="status"></span><button id="dictionary-refresh" type="button" hidden>加载新词条</button></div>`;
export const paginationCss=`.dictionary-pages{display:flex;align-items:center;justify-content:center;gap:20px;margin:20px 0}.dictionary-pages button,.crawl-progress button{font:inherit;background:#fff;color:#315e45;border:1px solid #bfd1c4;border-radius:7px;padding:8px 16px;cursor:pointer}.dictionary-pages button:disabled{opacity:.4;cursor:default}.dictionary-pages span{font-size:13px;color:#647c6b}.crawl-progress{display:flex;align-items:center;gap:15px;justify-content:space-between;padding:12px 15px;border:1px solid #d5e1d7;border-radius:8px;background:#eef4e9;font-size:13px;color:#62775d;margin:18px 0}.crawl-progress button{font-size:12px;white-space:nowrap}@media(max-width:600px){.dictionary-pages{gap:10px}.dictionary-pages button{padding:8px}.crawl-progress{align-items:flex-start;flex-direction:column;gap:8px}}`;
export function makePageData(rows){return JSON.stringify(rows.map(toClientRow)).replaceAll('<',String.fromCharCode(92)+'u003c');}
export const paginationScript=`
${renderDictionaryRow.toString()}
const dictionaryData=JSON.parse(document.getElementById('dictionary-data').textContent);let dictionaryPage=0;const pageSize=10;
function filterRows(reset=true){
 if(reset)dictionaryPage=0;
 const query=document.getElementById('dictionary-search').value.trim(),category=document.getElementById('dictionary-category').value;
 const filtered=dictionaryData.filter(row=>row.word.includes(query)&&(category==='all'||category===row.category));
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize));dictionaryPage=Math.max(0,Math.min(dictionaryPage,pages-1));
 document.querySelector('tbody').innerHTML=filtered.slice(dictionaryPage*pageSize,(dictionaryPage+1)*pageSize).map(renderDictionaryRow).join('');
 document.getElementById('dictionary-count').textContent='显示 '+filtered.length+' / '+dictionaryData.length+' 条';document.getElementById('dictionary-empty').hidden=filtered.length!==0;
 document.getElementById('dictionary-page').textContent='第 '+(dictionaryPage+1)+' / '+pages+' 页 · 每页 '+pageSize+' 条';
 document.getElementById('dictionary-prev').disabled=dictionaryPage===0;document.getElementById('dictionary-next').disabled=dictionaryPage>=pages-1;
 if(location.protocol==='file:')for(const link of document.querySelectorAll('a[href^="/"]'))link.href=new URL(link.getAttribute('href'),'http://127.0.0.1:5173').href;
}
document.getElementById('dictionary-search').addEventListener('input',()=>filterRows());document.getElementById('dictionary-category').addEventListener('change',()=>filterRows());
document.getElementById('dictionary-prev').onclick=()=>{dictionaryPage--;filterRows(false);document.querySelector('.table-wrap').scrollIntoView({block:'start'});};
document.getElementById('dictionary-next').onclick=()=>{dictionaryPage++;filterRows(false);document.querySelector('.table-wrap').scrollIntoView({block:'start'});};
filterRows();
`;
