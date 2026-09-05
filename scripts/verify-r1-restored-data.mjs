import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Read backup SQL locally; no remote writes and no claims based only on row counts.
function readSnapshot(file) {
  const database=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
  try {
    database.exec(fs.readFileSync(file,'utf8'));
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[],'Backup contains broken references');
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'research_%' OR name='d1_migrations' OR name='sqlite_sequence') ORDER BY name").all().map(r=>r.name);
    assert.ok(tables.includes('research_projects')&&tables.includes('d1_migrations'),'Not a SurveyKit backup');
    return Object.fromEntries(tables.map(name=>[name,database.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]));
  } finally {database.close();}
}
assert.equal(process.argv.length,4,'Usage: node scripts/verify-r1-restored-data.mjs source.sql restored.sql');
const source=readSnapshot(process.argv[2]);
const restored=readSnapshot(process.argv[3]);
assert.deepEqual(restored,source,'Restored database does not preserve all original rows');
console.log(JSON.stringify({ok:true,tables:Object.entries(source).map(([name,rows])=>({name,rows:rows.length})),totalRows:Object.values(source).reduce((n,rows)=>n+rows.length,0)},null,2));

