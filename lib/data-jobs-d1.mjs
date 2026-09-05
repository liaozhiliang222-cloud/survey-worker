import { jobTables } from './data-job-stage.mjs';

export function d1DataJobs(db) {
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const run = (sql, ...args) => stmt(sql, ...args).run();
  const first = (sql, ...args) => stmt(sql, ...args).first();
  const all = async (sql, ...args) => (await stmt(sql, ...args).all()).results || [];
  const now = () => new Date().toISOString();
  return {
    async createDataJob(uid,pid,input) {
      const ts=now(); const key=input.idempotency_key || crypto.randomUUID();
      await run("INSERT INTO research_data_jobs(id,project_id,user_id,dataset_id,tool_id,status,input,idempotency_key,request_hash,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?,?,?) ON CONFLICT(project_id,idempotency_key) DO NOTHING",crypto.randomUUID(),pid,uid,input.dataset_id,input.tool_id,JSON.stringify(input.input || {}),key,input.request_hash || '',ts,ts);
      return first('SELECT * FROM research_data_jobs WHERE project_id=? AND idempotency_key=?',pid,key);
    },
    getDataJob: (pid,id) => first('SELECT * FROM research_data_jobs WHERE project_id=? AND id=?',pid,id),
    listDataJobs: (pid) => all('SELECT * FROM research_data_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100',pid),
    listRunnableDataJobs: (limit=4) => all("SELECT * FROM research_data_jobs WHERE status='pending' ORDER BY created_at LIMIT ?",limit),
    async claimDataJob(pid,id,token,lease,timeout) {
      const ts=now(); await run("UPDATE research_data_jobs SET status='running',progress=10,lease_token=?,lease_expires_at=?,heartbeat_at=?,deadline_at=?,attempt=attempt+1,updated_at=? WHERE project_id=? AND id=? AND status='pending'",token,new Date(Date.now()+lease).toISOString(),ts,new Date(Date.now()+timeout).toISOString(),ts,pid,id);
      return first("SELECT * FROM research_data_jobs WHERE project_id=? AND id=? AND status='running' AND lease_token=?",pid,id,token);
    },
    async heartbeatDataJob(pid,id,token,lease) {
      const ts=now(); const res=await run("UPDATE research_data_jobs SET heartbeat_at=?,updated_at=?,lease_expires_at=MIN(?,deadline_at) WHERE project_id=? AND id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND deadline_at>?",ts,ts,new Date(Date.now()+lease).toISOString(),pid,id,token,ts,ts); return res.meta.changes>0;
    },
    expireDataJobs() { const ts=now(); return run("UPDATE research_data_jobs SET status='failed',error='DATA_JOB_LEASE_EXPIRED',lease_token=NULL,completed_at=?,updated_at=? WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=? OR deadline_at<=?)",ts,ts,ts,ts); },
    failDataJob(pid,id,token,error) { return run("UPDATE research_data_jobs SET status='failed',error=?,lease_token=NULL,completed_at=?,updated_at=? WHERE project_id=? AND id=? AND status='running' AND lease_token=?",error,now(),now(),pid,id,token); },
    async controlDataJob(pid,id,action) {
      if (action==='cancel') await run("UPDATE research_data_jobs SET status='cancelled',lease_token=NULL,completed_at=?,updated_at=? WHERE project_id=? AND id=? AND status IN ('pending','running')",now(),now(),pid,id);
      if (action==='retry') await run("UPDATE research_data_jobs SET status='pending',error='',progress=0,lease_token=NULL,completed_at=NULL,updated_at=? WHERE project_id=? AND id=? AND status='failed'",now(),pid,id);
      return this.getDataJob(pid,id);
    },
    async publishDataJob(pid,id,token,records,result) {
      const ts=now();
      const commands=[stmt("INSERT INTO research_data_job_commits(job_id,lease_token,checked_at,valid) VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM research_data_jobs WHERE project_id=? AND id=? AND status='running' AND lease_token=? AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND deadline_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END)",id,token,ts,pid,id,token)];
      for (const [key,table] of Object.entries(jobTables)) for (const row of records[key]) {
        if (row.project_id!==pid) throw new Error('DATA_JOB_RECORD_SCOPE');
        const fields=Object.keys(row); if (fields.some((f)=> !/^[a-z_]+$/.test(f))) throw new Error('DATA_JOB_RECORD_FIELD');
        commands.push(stmt(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`,...fields.map((f)=>row[f]??null)));
      }
      commands.push(stmt("UPDATE research_data_jobs SET status='completed',progress=100,result=?,error='',lease_token=NULL,completed_at=?,updated_at=? WHERE project_id=? AND id=? AND lease_token=?",JSON.stringify(result),ts,ts,pid,id,token));
      await db.batch(commands); return true;
    },
  };
}
