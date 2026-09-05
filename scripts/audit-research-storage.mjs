import fs from 'node:fs';
import path from 'node:path';

// Read-only: report references and unreferenced files; never remove anything.
export function auditLocalStorage(storeFile, storageRoot) {
  const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  const root = path.resolve(storageRoot);
  const referenced = new Set([...(data.files || []), ...(data.datasets || [])].map(r => r.storage_key || r.storage_path).filter(Boolean).map(k => k.replaceAll('\\','/')));
  const actual = [];
  function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    const target=path.join(directory,entry.name);
    if(entry.isSymbolicLink()) continue;
    if(entry.isDirectory()) walk(target); else if(entry.isFile()) actual.push(path.relative(root,target).replaceAll('\\','/'));
  } }
  if(fs.existsSync(root))walk(root);
  const objects=new Set(actual);
  return { read_only:true, checked_at:new Date().toISOString(), referenced_count:referenced.size, object_count:objects.size, missing:[...referenced].filter(k=>!objects.has(k)), unreferenced:actual.filter(k=>!referenced.has(k)), partial:actual.filter(k=>k.endsWith('.partial')) };
}
if(process.argv[1] && path.resolve(process.argv[1])===import.meta.filename) {
  const [storeFile,storageRoot]=process.argv.slice(2);
  if(!storeFile||!storageRoot)throw new Error('Usage: node scripts/audit-research-storage.mjs <research.json> <storage-directory>');
  console.log(JSON.stringify(auditLocalStorage(storeFile,storageRoot),null,2));
}
