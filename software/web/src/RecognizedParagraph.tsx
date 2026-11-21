import type {OrganizedParagraph} from '../../shared/recognized-chinese.mjs';

export default function RecognizedParagraph({item}:{item:OrganizedParagraph}){
 return <section className="realtime-paragraph is-final" aria-live="polite">
  <h3>整理后的中文</h3>
  <p data-testid="paragraph-final" data-partial={item.partial} data-chinese-status={item.chinese.status}>{item.chinese.text||item.text}</p>
  {!!item.chinese.inferredWords?.length&&<span>按上下文补出「{item.chinese.inferredWords.join('、')}」</span>}
 </section>;
}
