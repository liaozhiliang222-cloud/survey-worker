#!/usr/bin/env node
// 生成把 AI 研究员数据从一个身份迁到另一个身份的 D1 SQL，用于从 anonymous 切到 Cloudflare Access 登录。
// 只输出 SQL，不连接数据库；执行前先导出 D1 备份。R2 文件按项目存储，不需要迁移。
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const OWNED_TABLES = Object.freeze([
  "research_projects",
  "research_project_files",
  "research_tool_results",
  "research_datasets",
  "research_data_jobs",
  "research_analysis_batches",
]);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function buildOwnerMigrationSql({ from = "anonymous:shared-workspace", to, projectIds = [] } = {}) {
  const source = String(from || "").trim();
  const target = String(to || "").trim();
  if (!source || !target) throw new Error("需要同时提供 --from 和 --to。");
  if (source === target) throw new Error("--from 与 --to 不能相同。");
  if (target.length > 320) throw new Error("--to 过长，应为 /api/research/session 返回的 user_id。");
  const ids = [...new Set(projectIds.map((item) => String(item).trim()).filter(Boolean))];
  const projectScope = (column) => ids.length ? ` AND ${column} IN (${ids.map(quote).join(", ")})` : "";
  const lines = [
    `-- AI 研究员数据归属迁移：${source} -> ${target}`,
    `-- 范围：${ids.length ? `${ids.length} 个指定项目` : "源身份下全部项目"}`,
  ];
  for (const table of OWNED_TABLES) {
    const column = table === "research_projects" ? "id" : "project_id";
    lines.push(`UPDATE ${table} SET user_id = ${quote(target)} WHERE user_id = ${quote(source)}${projectScope(column)};`);
  }
  lines.push(`SELECT COUNT(*) AS migrated_projects FROM research_projects WHERE user_id = ${quote(target)};`);
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { projectIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    const value = inline ?? argv[index + 1];
    if (!["--from", "--to", "--project", "--out"].includes(flag)) throw new Error(`未知参数：${flag}`);
    if (inline === undefined) index += 1;
    if (flag === "--from") options.from = value;
    if (flag === "--to") options.to = value;
    if (flag === "--project") options.projectIds.push(...String(value || "").split(","));
    if (flag === "--out") options.out = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const sql = buildOwnerMigrationSql(options);
    if (options.out) { await fs.writeFile(options.out, sql, "utf8"); console.log(`已写入 ${options.out}`); }
    else process.stdout.write(sql);
  } catch (error) {
    console.error(error.message);
    console.error("用法：node scripts/migrate-research-owner.mjs --to <user_id> [--from anonymous:shared-workspace] [--project id1,id2] [--out file.sql]");
    process.exit(1);
  }
}
