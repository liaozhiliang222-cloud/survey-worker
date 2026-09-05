import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const migrationDirectory = path.join(root, "migrations");
const migrationFiles = fs.readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));

function fail(message) {
  console.error(`D1 migration audit failed: ${message}`);
  process.exitCode = 1;
}

function applySql(database, sql, source) {
  try { database.exec(sql); }
  catch (error) { throw new Error(`${source}: ${error.message}`); }
}

function normalizedSql(value) {
  return String(value || "").replace(/[\s`"']/g, "").toLowerCase();
}

function schema(database) {
  const objects = database.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name LIKE 'research_%' AND type IN ('table', 'index') AND sql IS NOT NULL ORDER BY type, name`).all();
  return new Map(objects.map((item) => [`${item.type}:${item.name}`, { table: item.tbl_name, sql: normalizedSql(item.sql) }]));
}

function compare(expected, actual) {
  const missing = []; const extra = []; const different = [];
  for (const [name, definition] of expected) {
    if (!actual.has(name)) missing.push(name);
    else if (actual.get(name).sql !== definition.sql) different.push(name);
  }
  for (const name of actual.keys()) if (!expected.has(name)) extra.push(name);
  return { missing, extra, different };
}

try {
  migrationFiles.forEach((name, index) => {
    const expectedPrefix = String(index + 1).padStart(4, "0");
    if (!name.startsWith(`${expectedPrefix}_`)) throw new Error(`migration sequence is not contiguous at ${name}; expected ${expectedPrefix}_*.sql`);
  });
  const expectedDatabase = new DatabaseSync(":memory:");
  expectedDatabase.exec("PRAGMA foreign_keys = ON");
  const prefixSchemas = new Map();
  for (const name of migrationFiles) {
    applySql(expectedDatabase, fs.readFileSync(path.join(migrationDirectory, name), "utf8"), name);
    prefixSchemas.set(name, schema(expectedDatabase));
  }
  const expectedSchema = schema(expectedDatabase);
  console.log(`Local migration chain OK: ${migrationFiles[0]} -> ${migrationFiles.at(-1)} (${migrationFiles.length} files, ${expectedSchema.size} research schema objects).`);

  const remoteSchemaPath = process.argv[2];
  if (!remoteSchemaPath) {
    console.log("No remote schema dump supplied; audit was local and read-only.");
    console.log("To compare production safely: wrangler d1 export surveykit-research --remote --env production --no-data --output <path>, then pass that SQL file to this script.");
  } else {
    const resolved = path.resolve(remoteSchemaPath);
    if (!fs.existsSync(resolved)) throw new Error(`remote schema dump does not exist: ${resolved}`);
    const actualDatabase = new DatabaseSync(":memory:");
    applySql(actualDatabase, fs.readFileSync(resolved, "utf8"), resolved);
    const actualSchema = schema(actualDatabase);
    const differences = compare(expectedSchema, actualSchema);
    if (differences.missing.length || differences.extra.length || differences.different.length) {
      const matchingPrefixes = [...prefixSchemas.entries()].filter(([, prefixSchema]) => {
        const prefixDifferences = compare(prefixSchema, actualSchema);
        return !prefixDifferences.missing.length && !prefixDifferences.extra.length && !prefixDifferences.different.length;
      }).map(([name]) => name);
      console.error(JSON.stringify(differences, null, 2));
      if (matchingPrefixes.length) {
        const matched = matchingPrefixes.at(-1);
        const next = migrationFiles[migrationFiles.indexOf(matched) + 1] || "none";
        throw new Error(`remote research schema exactly matches the local chain through ${matched}; next schema migration is ${next}. Reconcile only missing ledger entries at or below that verified prefix before applying later migrations`);
      }
      throw new Error("remote research schema does not match any local migration prefix; do not repair the ledger or deploy new migrations yet");
    }
    console.log("Remote schema dump matches the local research schema. This command did not modify D1 or its migration ledger.");
  }
} catch (error) {
  fail(error.message);
}
