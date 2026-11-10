import {DatabaseSync as SQLiteDatabase} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {deserialize} from 'node:v8';

// Existing short synchronous transactions remain indivisible in this local server.
// A persistent worker owns the MySQL connection; no per-query process or credential argument.
export class DatabaseSync {
  constructor(path,options={}){
    const root=dirname(resolve(path)),configPath=join(root,'secrets/mysql.json');
    if(!existsSync(configPath)){
      if(existsSync(join(root,'mysql-active.json')))throw Error('MySQL configuration missing; refusing to recreate SQLite');
      const database=new SQLiteDatabase(path,options);database.engine='sqlite';return database;
    }
    this.engine='mysql';this.buffer=new SharedArrayBuffer(16*1024*1024+8);this.control=new Int32Array(this.buffer,0,2);this.closed=false;
    this.worker=new Worker(new URL('./mysql-worker.mjs',import.meta.url),{execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type')),workerData:{buffer:this.buffer,configPath,readOnly:!!options.readOnly}});
    this.worker.on('error',()=>{});this.worker.unref();
    try{this.wait();}catch(error){this.closed=true;void this.worker.terminate();throw error;}
  }
  wait(){
    if(Atomics.wait(this.control,0,0,15000)==='timed-out'){this.closed=true;void this.worker.terminate();throw Error('MySQL timeout; connection closed, restart service before retrying writes');}
    const response=deserialize(Buffer.from(new Uint8Array(this.buffer,8,Atomics.load(this.control,1))));
    if(response.error)throw Object.assign(new Error(response.error),{code:response.code});return response.result;
  }
  call(op,sql,params=[]){if(this.closed)throw Error('Database closed');Atomics.store(this.control,0,0);this.worker.postMessage({op,sql,params});return this.wait();}
  exec(sql){return this.call('exec',sql);}
  prepare(sql){return {get:(...args)=>this.call('get',sql,args),all:(...args)=>this.call('all',sql,args),run:(...args)=>this.call('run',sql,args)};}
  close(){if(this.closed)return;try{this.call('close');}finally{this.closed=true;void this.worker.terminate();}}
}
