import {createInterface} from 'node:readline';
import {DatabaseSync} from './database.mjs';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
  try{const {sql,params=[]}=JSON.parse(line);if(typeof sql!=='string'||!/^SELECT\s/i.test(sql.trim())||sql.includes(';'))throw Error('Read-only query required');const result=db.prepare(sql).all(...params);process.stdout.write(JSON.stringify({rows:result})+'\n');}
  catch{process.stdout.write(JSON.stringify({error:'Project database read failed'})+'\n');}
}
db.close();
