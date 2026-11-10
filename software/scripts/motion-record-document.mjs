// Keep editable motion notes together; do not recreate per-motion Markdown.
export function upsertMotionRecord(document,id,record){
  if(!/^csl\.[a-z0-9_.-]+$/.test(id))throw Error('Invalid motion document ID');
  const start=`<!-- motion:${id}:start -->`,end=`<!-- motion:${id}:end -->`;
  const section=`${start}\n<a id="motion-${id}"></a>\n\n${record.trim()}\n\n${end}`;
  const first=document.indexOf(start),last=document.indexOf(end);
  if(first<0&&last<0)return `${document.trimEnd()}\n\n${section}\n`;
  if(first<0||last<first||document.indexOf(start,first+start.length)>=0||document.indexOf(end,last+end.length)>=0)throw Error('Invalid motion document markers');
  return document.slice(0,first)+section+document.slice(last+end.length);
}
