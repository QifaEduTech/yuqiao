import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const python=resolve(root,'.venv-sign',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child=spawn(python,['-B',resolve(root,'scripts/crawl-sign-dictionary.py'),...process.argv.slice(2)],{cwd:root,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
