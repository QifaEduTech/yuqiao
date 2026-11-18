import limits from '../../shared/sign-motion-windows.json';
export function motionFeedback(result:{preview:unknown;status?:string;reason?:string;missing?:string[]}){
 if(result.preview)return '';
 if(result.reason==='too_many_actions')return `这段话超过一次最多${limits.maxActions}个动作，请分开提交。原话已保留。`;
 if(result.reason==='too_long')return `这段动作超过${limits.maxDuration}秒，请分开提交。原话已保留。`;
 if(result.status==='asset_missing')return '对应动作资源尚未准备好，原话已保留，请稍后重试。';
 const missing=[...new Set((result.missing??[]).filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
 if(missing.length)return `暂时无法完整表达：还缺少「${missing.join('」、「')}」的动作或表达方式。原话已保留，整句未播放。`;
 return '暂时无法完整表达这段内容，原话已保留，整句未播放。请换一种说法或查阅手语词典。';
}
