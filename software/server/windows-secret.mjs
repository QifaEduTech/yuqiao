import {spawnPowerShell} from './powershell.mjs';

// Pass secrets through stdin, never argv or logs. Uses the current Windows user's DPAPI.
export function protectSecret(value){return new Promise((ok,no)=>{
  const child=spawnPowerShell(['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s)); $s.Dispose()"],{stdio:['pipe','pipe','ignore'],windowsHide:true});
  let output='';const timer=setTimeout(()=>{child.kill();no(Error('Secret encryption timeout'));},10000);
  child.stdout.on('data',v=>output+=v);child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);no(Error('Secret encryption failed'));});
  child.on('close',code=>{clearTimeout(timer);code?no(Error('Secret encryption failed')):ok(output.trim());});child.stdin.end(value);
});}
