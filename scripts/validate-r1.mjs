import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));
const output = path.resolve(process.argv.find(arg => arg.startsWith('--output-dir='))?.slice(13) || 'docs/validation/r1');
fs.mkdirSync(output, { recursive: true });
const checks=[['node','npm test'],['python','npm run test:python'],['pytest','python -m pytest tests/unit -q'],['build','npm run build'],['e2e','npm run test:e2e'],['schema','npm run audit:d1-schema'],['diff','git diff --check']];
const results=[];
for(const [name,command] of checks){const started=new Date().toISOString();const out=spawnSync(command,{shell:true,encoding:'utf8',windowsHide:true,timeout:15*60*1000,maxBuffer:40*1024*1024});fs.writeFileSync(path.join(output,`${name}.txt`),(out.stdout||'')+'\n'+(out.stderr||''));results.push({name,command,started,exitCode:out.status,error:out.error?.message});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(name,out.status);}
process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
