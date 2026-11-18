import type {OrganizedParagraph} from '../../shared/recognized-chinese.mjs';

export default function RecognizedParagraph({item}:{item:OrganizedParagraph}){
 const review=item.chinese.status!=='ready';
 return <section className={`realtime-paragraph ${review?'needs-review':'is-final'}`}>
  <h3>{item.partial?'片段待核对 · 未自动播报':review?'语义待核对 · 未自动播报':'整理后的中文'}</h3>
  <p data-testid="paragraph-final" data-partial={item.partial} data-chinese-status={item.chinese.status}>{item.chinese.text||item.text}</p>
  {review&&<span>保留识别到的词，请重新表达不清楚的部分。</span>}
  {item.endReason==='quiet'&&<span className="paragraph-auto-ended" data-testid="paragraph-auto-ended">本段已自动结束，可继续做下一段。</span>}
  <details className="paragraph-source"><summary>查看原始识别</summary><p data-testid="paragraph-source">{item.words.join(' → ')}</p></details>
 </section>;
}
