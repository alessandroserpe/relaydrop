#!/usr/bin/env node
import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';

function privateFile(path){if(!isAbsolute(path)||!statSync(path).isFile()||(statSync(path).mode&0o077))throw Error('File di configurazione o credenziale assente o con permessi non privati.');return readFileSync(path,'utf8');}
function safeTransfer(t,server){return {id:t.id,dashboard:server+'/dashboard',expires_at:t.expires_at,created_at:t.created_at,notification:t.notification,downloads:t.downloads,max_downloads:t.max_downloads};}
async function main(){
 const argsInput=process.argv.slice(2);
 if(argsInput[0]==='status' && /^-[A-Za-z0-9_-]{31}$/.test(argsInput[1]||'')){const [id]=argsInput.splice(1,1);argsInput.push('--',id);}
 const {values,positionals}=parseArgs({args:argsInput,allowPositionals:true,options:{quiet:{type:'boolean'}}});
 const [command,target]=positionals;
 if(!['doctor','send','status','recent'].includes(command)||positionals.length>(['send','status'].includes(command)?2:1))throw Error('Uso: doctor | send FILE [--quiet] | status ID | recent');
 const configPath=process.env.RELAYDROP_AGENT_CONFIG||join(homedir(),'.codex','relaydrop','config.json');
 const config=JSON.parse(privateFile(configPath));const url=new URL(config.server);
 const local=config.allow_http_localhost===true&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.origin!==config.server||url.username||url.password)throw Error('Origine HTTPS configurata non valida.');
 if(!isAbsolute(config.cli_path)||!statSync(config.cli_path).isFile()||!/^[A-Za-z0-9_-]{1,64}$/.test(config.recipient))throw Error('CLI o destinatario configurato non valido.');
 const credential=privateFile(config.token_file).trim();if(!/^[A-Za-z0-9_-]{43}$/.test(credential))throw Error('Credenziale non valida.');
 const api=async path=>{const r=await fetch(config.server+path,{headers:{authorization:'Bearer '+credential},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Verifica RelayDrop non riuscita: HTTP '+r.status);return r.json();};
 if(command==='status'){
  if(!/^[A-Za-z0-9_-]{32}$/.test(target||''))throw Error('ID trasferimento non valido.');
  return safeTransfer(await api('/v1/transfers/'+target),config.server);
 }
 if(command==='recent')return (await api('/v1/transfers')).filter(t=>t.recipient_id===config.recipient).slice(0,10).map(t=>safeTransfer(t,config.server));
 const [me,devices,policy]=await Promise.all([api('/v1/me'),api('/v1/recipient-devices/'+config.recipient),api('/v1/policy')]);
 const count=devices.filter(d=>d.user_id===config.recipient).length;if(!count)throw Error('Nessun browser destinatario registrato: registra prima un dispositivo nella dashboard.');
 const ttl=config.ttl_seconds??86400,downloads=config.max_downloads??20;
 if(!Number.isSafeInteger(ttl)||ttl<1||!Number.isSafeInteger(downloads)||downloads<1||typeof config.notify!=='boolean')throw Error('Limiti o preferenza avvisi non validi nella configurazione.');
 if(command==='doctor')return {ready:true,server:config.server,dashboard:config.server+'/dashboard',identity:me.id,recipient:config.recipient,recipient_devices:count,max_file_bytes:policy.maxFileBytes,ttl_seconds:Math.min(ttl,policy.maxTTL),notifications_default:config.notify};
 if(!target||!isAbsolute(target)||!statSync(target).isFile())throw Error('Indica il percorso assoluto di un file esistente.');
 if(statSync(target).size>policy.maxFileBytes)throw Error('File oltre il limite del servizio.');
 const args=[config.cli_path,'send',resolve(target),'--server',config.server,'--token-file',config.token_file,'--to',config.recipient,'--require-recipient','--ttl',String(Math.min(ttl,policy.maxTTL)),'--downloads',String(Math.min(downloads,policy.maxDownloads))];
 if(config.notify&&!values.quiet)args.push('--notify');if(local)args.push('--allow-http-localhost');
 let output;
 try{output=execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:1900000,maxBuffer:1024*1024});}
 catch{throw Error('Invio non confermato. Non ripetere automaticamente: controlla recent nella casella prima di un nuovo tentativo.');}
 let result;try{result=JSON.parse(output);}catch{throw Error('Risposta non valida dopo l’invio; controlla recent prima di riprovare.');}
 return {...safeTransfer(result,config.server),recipient_devices:result.recipient_devices};
}
main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
