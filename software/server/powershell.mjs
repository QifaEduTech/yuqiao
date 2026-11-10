import {spawn, spawnSync} from 'node:child_process';

// PowerShell 7 (pwsh) is preferred when installed. Windows PowerShell 5.1 runs
// the same DPAPI helpers, so fall back instead of failing startup when pwsh is
// missing. Nothing about the protection or the secret changes between them.
let cached;
export function powershellCommand(){
  if(cached)return cached;
  if(process.platform!=='win32')return cached='pwsh';
  const probe=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command','exit 0'],{windowsHide:true,stdio:'ignore'});
  cached=probe.error?'powershell':'pwsh';
  return cached;
}

export function spawnPowerShell(args,options){return spawn(powershellCommand(),args,options);}
