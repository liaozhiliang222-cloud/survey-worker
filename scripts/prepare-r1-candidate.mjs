import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const files=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean).sort();
const excluded=[];const entries=[];
for(const file of files){
 if (/^(tmp\/|docs\/validation\/r1\/|\.pytest_cache\/)|(^|\/)(node_modules|__pycache__)\/|^kano-.*\.(png|pptx|txt|json)$/.test(file)){excluded.push(file);continue;}
 if(!fs.existsSync(file)){excluded.push(file);continue;}
 const bytes=fs.readFileSync(file);entries.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const digest=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const snapshot=path.join(root,'.data','release-r1',digest);
fs.mkdirSync(snapshot,{recursive:true});
for(const entry of entries){const target=path.join(snapshot,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(entry.path,target);if(createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==entry.sha256)throw Error(`Snapshot mismatch: ${entry.path}`);}
const manifest={candidate:`r1-${digest.slice(0,16)}`,baseCommit:git('rev-parse','HEAD'),branch:git('branch','--show-current'),createdAt:new Date().toISOString(),node:process.version,sourceDigest:digest,snapshot,entries,excluded,limitations:['Workspace snapshot, not a clean committed production release.','Environment secrets and validation outputs are excluded.','Windows/Python 3.12 acceptance dependencies are pinned; Linux deployment dependencies must be validated on its target host.']};
fs.writeFileSync('docs/validation/r1/candidate.json',JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(snapshot,'CANDIDATE.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`${manifest.candidate}: ${entries.length} files verified at ${snapshot}`);
