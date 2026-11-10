import {createRoot} from 'react-dom/client';
import './styles.css';
import './review.css';

function RetiredReview(){
  return <main className="review-page"><header className="review-header"><a href="/">← 返回语桥</a><strong>数字人模型</strong></header><section style={{maxWidth:680,margin:'50px auto',lineHeight:1.9}}><h1>已选用 Anny</h1><p>Base_Female 与 AvatarSample_E 两个 VRM 备选已按要求删除，旧模型预览已停用。</p><p>主页面的数字人空间已使用 Anny。固定“谢谢”动作的核对入口保留在独立预览页。</p><a className="primary-button" href="/anny-review.html">打开 Anny 动作预览</a></section></main>;
}
createRoot(document.getElementById('root')!).render(<RetiredReview/>);
