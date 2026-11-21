import {existsSync,realpathSync,lstatSync,unlinkSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {removeArchivedRecord} from './training-archive.mjs';
import {removeHelpModelReview} from './help-model-review.mjs';

function ownedFile(root,relative){
 const base=resolve(root),file=resolve(base,relative);
 if(!file.startsWith(base+sep))throw Object.assign(Error('录像路径无效，未删除。'),{status:409});
 if(existsSync(file)&&(lstatSync(file).isSymbolicLink()||!realpathSync(file).startsWith(realpathSync(base)+sep)))throw Object.assign(Error('录像路径无效，未删除。'),{status:409});
 return file;
}
// Shared by the authenticated API and explicit local maintenance. No await before
// media/database/workbench removal, so another in-process job cannot start midway.
export async function deleteOwnedRecord({db,dataDir,training,owner,recordId}){
 const record=db.prepare('SELECT id,kind,media_file FROM records WHERE id=? AND user_id=?').get(recordId,owner);
 if(!record)throw Object.assign(Error('记录不存在。'),{status:404});
 if(record.kind==='video'&&training.running)throw Object.assign(Error('训练正在进行，请先停止本轮再删除视频。'),{status:409});
 const media=record.media_file?ownedFile(resolve(dataDir,'media'),record.media_file):null;
 const motion=ownedFile(resolve(dataDir,'sign-motions'),record.id+'.json');
 if(media&&existsSync(media))unlinkSync(media);
 if(existsSync(motion))unlinkSync(motion);
 db.prepare('DELETE FROM records WHERE id=? AND user_id=?').run(record.id,owner);
 training.removeRecord(owner,record.id);
 removeArchivedRecord(dataDir,record.id);
 await removeHelpModelReview(dataDir,record.id);
 return {ok:true};
}
