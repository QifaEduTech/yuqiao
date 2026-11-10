import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareTrainingArchive,applyTrainingArchive} from '../server/training-archive.mjs';
const args=process.argv.slice(2),root=resolve('data');
if(args[0]==='--plan'&&args.length<=2){
  if(args[1]&&args[1]!=='--include-other-owners')throw Error('unknown_argument');
  const report=JSON.parse(readFileSync('docs/assets/realtime-thumb-gate-2026-10-20.json','utf8'));
  const plan=prepareTrainingArchive(root,{includeOtherOwners:args.includes('--include-other-owners'),developmentSamples:report.reports.map(x=>x.sampleNumber)});
  mkdirSync(resolve(root,'maintenance'),{recursive:true});const file=resolve(root,`maintenance/training-plan-${plan.id}.json`);writeFileSync(file,JSON.stringify(plan,null,2),{flag:'wx'});console.log(JSON.stringify({plan:file,summary:plan.summary}));
}else if(args[0]==='--apply'&&args.length===2){
  const path=resolve(args[1]);if(!path.startsWith(resolve(root,'maintenance')+'\\'))throw Error('plan_outside_maintenance');
  const plan=JSON.parse(readFileSync(path,'utf8'));if(resolve(plan.root)!==root)throw Error('wrong_project_data');console.log(JSON.stringify(applyTrainingArchive(plan)));
}else throw Error('Use --plan [--include-other-owners], then --apply <plan path>.');
