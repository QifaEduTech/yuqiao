import development from '../../shared/sign-development-actions.json';
import prefixes from '../../shared/sample-numbering.json';

export function ActionCollectionGuide({category}:{category:string}){
  const action=development.actions.find(a=>a.category===category);
  if(!action)return null;
  return <p>{action.text}采集：{action.referenceDescription} {action.nextCollection?.note} 编号{prefixes[category as keyof typeof prefixes]}类；保存不会自动识别或训练。
    <a href={`/anny-review.html?motion=${action.signId}&version=${action.referenceVersion}`} target="_blank" rel="noreferrer">查看{action.text}动作参考</a>
  </p>;
}
