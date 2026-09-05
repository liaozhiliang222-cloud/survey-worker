// Rebuild a recorded snapshot in an independent local Git repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/validation/r1/candidate.json'),'utf8'));
assert.equal(process.version.slice(1),fs.readFileSync(path.join(root,'.node-version'),'utf8').trim(),'Use the recorded Node version');
const runId=`${manifest.candidate}-${randomUUID().slice(0,8)}`;
const checkout=path.join(root,'.data','r1-rebuild',runId);
const output=path.join(root,'docs/validation/r1/rebuild',runId);
fs.mkdirSync(checkout,{recursive:true});fs.mkdirSync(output,{recursive:true});
const env={...process.env,PYTHONUTF8:'1',PYTHONNOUSERSITE:'1'};
for(const key of Object.keys(env)) if(/API_KEY|TOKEN|SECRET|PASSWORD|^HARNESS_|^RESEARCH_|^OPENAI_|^PYTHONPATH$|^PYTHONHOME$|^NODE_PATH$/.test(key)) delete env[key];
const summary={candidate:manifest.candidate,sourceDigest:manifest.sourceDigest,checkout,startedAt:new Date().toISOString(),platform:process.platform,node:process.version,checks:[]};
const save=()=>fs.writeFileSync(path.join(output,'rebuild.json'),JSON.stringify(summary,null,2)+'\n');
function run(name,command,args,options={}){
 const out=spawnSync(command,args,{cwd:checkout,env,encoding:'utf8',windowsHide:true,timeout:15*60*1000,maxBuffer:40*1024*1024,...options});
 fs.writeFileSync(path.join(output,`${name}.txt`),(out.stdout||'')+'\n'+(out.stderr||''));
 summary.checks.push({name,exitCode:out.status,error:out.error?.message});save();console.log(name,out.status);
 assert.equal(out.status,0,`${name} failed; see ${output}`);return out.stdout.trim();
}
const hash=b=>createHash('sha256').update(b).digest('hex');
try {
 assert.equal(hash(JSON.stringify(manifest.entries)),manifest.sourceDigest);
 for(const entry of manifest.entries){
  assert.ok(!path.isAbsolute(entry.path)&&!entry.path.split(/[\\/]/).includes('..'));
  const source=path.resolve(manifest.snapshot,entry.path);const bytes=fs.readFileSync(source);assert.equal(hash(bytes),entry.sha256,entry.path);
  const target=path.join(checkout,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 }
 run('git-init','git',['init','--initial-branch=codex/r1-candidate']);
 run('git-line-endings','git',['config','core.autocrlf','false']);
 const paths=path.join(output,'source-paths.txt');fs.writeFileSync(paths,manifest.entries.map(e=>e.path).join('\0')+'\0');
 run('git-add','git',['add','--force',`--pathspec-from-file=${paths}`,'--pathspec-file-nul']);
 run('git-commit','git',['-c','user.name=SurveyKit Candidate','-c','user.email=candidate@localhost','-c','commit.gpgsign=false','commit','--no-verify','-m',`Local acceptance snapshot ${manifest.candidate}`]);
 summary.commit=run('git-revision','git',['rev-parse','HEAD']);
 assert.equal(run('git-clean-before','git',['status','--porcelain']), '');
 run('npm-ci',process.platform==='win32'?'npm.cmd':'npm',['ci'],{shell:process.platform==='win32'});
 const venv=path.join(checkout,'.data','venv');
 run('python-venv','python',['-m','venv',venv]);
 const python=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const version=run('python-version',python,['--version']);assert.ok(version.startsWith('Python 3.12.'),'R1 lock targets Python 3.12');
 assert.equal(process.platform,'win32','This evidence lock is Windows-specific; resolve a separate target lock on other platforms');
 run('python-install',python,['-m','pip','install','-r','tests/requirements-r1-win-py312.lock']);
 run('python-check',python,['-m','pip','check']);
 for(const key of Object.keys(env))if(key.toLowerCase()==='path'){env[key]=path.dirname(python)+path.delimiter+env[key];break;}
 run('validation',process.execPath,['scripts/validate-r1.mjs',`--output-dir=${output}`]);
 for(const entry of manifest.entries)assert.equal(hash(fs.readFileSync(path.join(checkout,entry.path))),entry.sha256,`Changed after tests: ${entry.path}`);
 assert.equal(run('git-clean-after','git',['status','--porcelain']), '');
 summary.ok=true;
} catch(error){summary.ok=false;summary.error=error.stack;process.exitCode=1;console.error(error.message);}
summary.completedAt=new Date().toISOString();save();console.log(`Rebuild ${summary.ok?'PASS':'FAIL'}: ${path.join(output,'rebuild.json')}`);
