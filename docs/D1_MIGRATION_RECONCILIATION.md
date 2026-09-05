# D1 migration reconciliation

Production had a migration-ledger anomaly. A read-only audit on 2026-08-30 found that the schema exactly matched local migrations through `0007_qualitative_summary_artifacts.sql`, while `d1_migrations` contained only `0001_ai_researcher.sql` and `0007_qualitative_summary_artifacts.sql`. Migrations `0002` through `0006` were present in the schema but missing from the ledger; later migrations were genuinely absent. The ledger was reconciled only after an exact prefix match, and production was then advanced through `0012_dataset_csv_files.sql`. Keep this procedure for recovery or another environment; do not insert ledger rows based only on table names.

Use this read-only sequence before the next deployment:

1. Export a no-data schema backup outside the repository:

   ```powershell
   npx wrangler d1 export surveykit-research --remote --env production --no-data --output D:\safe-backups\surveykit-research-schema.sql
   ```

2. Validate the complete local chain and compare the exported production schema:

   ```powershell
   npm run audit:d1-schema -- D:\safe-backups\surveykit-research-schema.sql
   ```

3. The audit reports either an exact latest-schema match, an exact historical migration prefix, or a mismatch with every known prefix. If it does not identify the same exact prefix described above, stop and investigate the drift.
4. For the historical production state described above, only ledger entries `0002` through `0006` were eligible for reconciliation after a full backup and exact-prefix proof. Never generalize that list to another database. Record the database ID, export checksum, ledger before/after state and operator timestamp.
5. Run `wrangler d1 migrations list surveykit-research --remote --env production` again. Apply only migrations that are genuinely absent, then export and run the schema audit once more; only an exact latest-schema match is complete.

The audit script never connects to Cloudflare and never writes a database. The `wrangler d1 export` command is the only remote step above and is read-only. Ledger repair and migration application remain manual production changes by design.
