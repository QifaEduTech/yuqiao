import type {ParagraphResult} from '../../shared/realtime-paragraph.mjs';
export function paragraphEndHint(paragraph:ParagraphResult|undefined){
 if(!paragraph?.autoEnd)return '';
 return `双手已离开画面，约${Math.max(1,Math.ceil(paragraph.autoEnd.remainingMs/1000))}秒后自动整理；继续做动作可接着本段。`;
}
