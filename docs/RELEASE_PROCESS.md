# SurveyKit 发布与回滚流程

## 发布原则

- 只从已同步 `origin/main` 的干净分支发布。
- 前端与后端使用同一个发布编号和 Git revision。
- 发布前运行完整 Node、Python 和构建测试。
- 生产检查必须同时覆盖 Web、PPTX 完整链路和 AI 代理。
- 后端升级前自动保留最近 5 个可回滚备份。

## 发布前检查

```powershell
git status --short --branch
npm ci
npm test
npm run test:python
python -m pytest tests/unit -q
npm run build
```

工作区必须干净，所有命令必须成功。不要从包含未提交改动的 `main` 直接发布。

## 前端发布

Cloudflare Pages 从 `main` 构建。生产环境至少配置：

- `PPTX_BACKEND_URL=https://ppt-api.surveykit.cc`
- `SURVEYKIT_RELEASE=<release-id>`
- `SURVEYKIT_COMMIT=<git-sha>`

`PPTX_BACKEND_URL` 应直接使用最终 HTTPS 地址，不要依赖 HTTP 重定向。

提交完成后，将该提交的完整 SHA 通过 `wrangler pages secret put SURVEYKIT_COMMIT --project-name survey-worker` 的标准输入注入 Pages。该值虽非凭据，但使用独立绑定避免把提交自己的 SHA 写回同一提交。不要在 wrangler.toml 重复定义它。后端安装使用相同 SHA。发布后同时验证两个服务返回的 revision，不能只检查版本号。

生产数据任务使用现有阿里云执行器，**不要求 Workers Paid，不部署 wrangler.data-jobs.jsonc 的生产 Cron**。在服务端以 root-only 的 `/etc/surveykit-data.env` 配置 `DATA_STORAGE_BASE=https://surveykit.cc` 与随机 256 位以上 `DATA_EXECUTOR_SECRET`；通过 Pages secret put 将同一专用密钥配置到 Pages，不能复用用户凭据或交互式 Wrangler OAuth。Pages 配置 `DATA_EXECUTOR_URL=https://ppt-api.surveykit.cc/internal/data/execute`。

从完整发布包运行 `SURVEYKIT_COMMIT=<sha> bash deploy/install_data_executor.sh`，再执行后端安装。完整发布包需包含 deploy、pptx_report、lib、src/shared、package.json 和 package-lock.json。安装器校验固定 Node 24.17.0 官方 SHA-256，服务限制 512MB / 0.8 核，与 PPT 共用 `/tmp/surveykit-heavy.lock`。任务每 30 秒扫描，租约心跳 15 秒，计算保留 10 分钟截止；HTTP 断开不结束持久任务。

先核验备份、安装服务，再在 Pages 切换窗口补齐 D1 迁移。2026-09-05 曾回滚 0020，保留了兼容性 0021；以 migrations list 实际结果为准，不重复手工执行 0021。上线后必须真实 HTTP 入队并等待服务器消费，同时验证原始文件解析、来源检查、幂等和下载。Worker 配置仅保留作可选实验，不是生产依赖。

若需要回滚整个版本，先 `systemctl stop surveykit-data`，避免消费者访问不兼容旧 schema，再恢复后端与 Pages。数据执行器的上一安装目录记录在 `/opt/surveykit-data/previous-release`，切换 current 链接后重启服务；数据库迁移独立核验，不自动倒灌备份。

## 后端发布

将仓库中的 `deploy/`、`pptx_report/` 和安装脚本放在同一发布目录，在服务器执行：

```bash
sudo SURVEYKIT_RELEASE=<release-id> \
  SURVEYKIT_COMMIT=<git-sha> \
  bash deploy/install_seoul.sh
```

脚本会在 `/opt/surveykit-ppt-backups` 创建升级前备份，写入 `RELEASE.json`，重启服务并检查本机健康接口。

## 生产验证

```powershell
npm run verify:production -- --release=<release-id>
```

检查结果必须满足：

- `/healthz` 返回 `surveykit-web`；
- `/pptx-api/healthz` 同时包含 `pptx-report` 和 `surveykit-pptx-proxy`；
- `/api/ai` 返回可用渠道信息；
- 前后端发布编号与本次发布一致。

## 回滚

回滚到最近一次后端备份：

```bash
sudo bash deploy/rollback_seoul.sh
```

指定备份回滚：

```bash
sudo bash deploy/rollback_seoul.sh /opt/surveykit-ppt-backups/<backup>.tar.gz
```

前端通过 Git 回退对应发布提交后重新触发 Cloudflare Pages 部署。回滚完成后再次运行生产验证命令。

## 第一轮候选的隔离重建

正式发布前可先验证工作区候选，详情见 [第一轮候选](R1_RELEASE_CANDIDATE.md)：

```powershell
node scripts/prepare-r1-candidate.mjs
npm run acceptance:r1:rebuild
```

重建器校验快照 SHA-256，将源文件放入独立的本地 Git 仓库并生成候选提交；以空 node_modules 和新 venv 安装依赖，执行全套验证，再检查源码哈希与 Git 清洁状态。原工作区和索引保留。此提交用于验收追溯，不代表已合并 main 或可以绕过前述发布原则。

当前可复现依赖基准为 Node 24.17.0、Windows/Python 3.12，以及 tests/requirements-r1-win-py312.lock。它不代替 Linux 服务器、LibreOffice/OfficeCLI/字体和实际服务配置的部署验收。外部验证日志通过 --output-dir 保存到候选之外。

真实云端人工验收使用 `npm run acceptance:r1:cloud`，创建唯一命名的临时资源，完成后清理；支持 `-- --api-transport` 通过 Cloudflare API 执行真实 D1/R2 存储验收。API 模式不代表 Workers 运行时或生产 HTTP 链路通过。Wrangler 路径通过 R1_WRANGLER_JS 指定；使用代理时由 Node 的 --use-env-proxy 或 NODE_USE_ENV_PROXY=1 启用。访问凭据仅在进程内使用，不保存到证据。
## 云端恢复演练发现与修正

2026-09-05 的真实 D1 人工恢复中，直接向空库导入完整 SQL 备份报错 `no such table: main.research_project_files`：文件表在历史迁移中被重建，导出顺序使子表 INSERT 早于父表 CREATE。不能将“导出成功”当作“备份可恢复”。

恢复流程改为：停止写入后导出完整备份和全部文件/对象，记录 SHA-256。执行 `python scripts/prepare-d1-restore.py source.sql schema.sql data.sql` 从同一份完整备份生成恢复文件：schema 全部先建；数据按父表、父记录到子记录排序。仅拆分 schema/data 而保留原始数据顺序仍可能在 D1 的分批导入中违反外键。准备程序在本地开启外键、逐条提交验证，并比较所有记录及自增序列；遇到循环依赖、损坏引用或触发器时明确拒绝生成恢复文件，不能静默禁用约束。

向新的空恢复库依次导入 schema.sql 和 data.sql；不要预先 migrations apply 填充 ledger，也不要将本步骤当作覆盖现有生产库的指令。恢复后重新导出完整数据库，执行 `node scripts/verify-r1-restored-data.mjs source.sql restored.sql`：检查完整性、外键、所有 research_* 表、d1_migrations 和 sqlite_sequence 的每行内容，而非仅比较行数。再比较所有原始、派生及交叉表导出对象的字节，并读取数据重算人工基准。验证器已验证会拒绝“行数相同、项目内容被修改”的备份。
