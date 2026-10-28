# 交接：AI 研究员单独登录上线（2026-10-28）

## 0. 背景与目标

- 生产 https://surveykit.cc 的 AI 研究员接口 `/api/research/*` 运行在 `RESEARCH_AUTH_MODE = "anonymous"`。所有访客共用 `anonymous:shared-workspace`，无 Cookie 访问 `GET /api/research/projects` 即可看到已有客户项目。这是 **P0 数据暴露**。
- 决定：**只给 AI 研究员加登录**（Cloudflare Access 邮箱验证码），其他工具保持免登录，避免影响留存。
- 代码已完成并提交，尚未推送、尚未部署，Cloudflare 尚未配置。

## 1. 代码现状

| 项 | 值 |
|---|---|
| 仓库目录 | `D:/调研工具/codex-temp/release-driver-20261017`（git worktree；远端 `liaozhiliang222-cloud/survey-worker`） |
| 分支 | `codex/research-login`，提交 `10455b7` |
| 基线 | `d0642f9`，即当前生产版本 `v0.14.0-20261017.driver-analysis`，与 `origin/main` 相同 |
| 注意 | 外层 `D:/调研工具`（main 停在 9/17）和 `codex-temp/` 下其他副本均已过时，**不要从那里开发或发布** |

### 已完成的改动（`10455b7`）

- `functions/api/research/[[path]].js`
  - 拆出 `verifyAccessClaims()`；`verifyAccessIdentity()` 行为不变。
  - 新增 `GET /api/research/login?return=%23research`：Access 登录完成后 302 回站内 hash（只接受 `#name`，防开放重定向）。
  - 新增 `GET /api/research/session`：返回 `{ auth_mode, user_id, email, logout_url }`。邮箱取自已验签的 JWT，不信任请求头。
  - 两个路由都在 `RESEARCH_DB` 检查之前，不依赖数据库。
- `lib/research-handler.js`：本地开发服务器同样支持 `/session`、`/login`。
- `src/modules/ai-researcher/index.js`、`index.html`、`styles.css`
  - 所有研究员请求（`api()` 和 3 个流式 fetch）使用 `redirect: "manual"`。收到 `opaqueredirect` 或 401 视为未登录。
  - 项目列表页显示“登录后使用 AI 研究员 / 邮箱登录”卡片，并隐藏新建、刷新按钮。
  - 在项目工作台内登录失效时，停留原页面，提示“重新登录”，已输入内容不丢。
  - 登录后在项目列表标题下显示“已登录：邮箱 · 退出登录”（`/cdn-cgi/access/logout`）。
- `scripts/migrate-research-owner.mjs`：生成把共享工作区数据迁到指定账号的 D1 SQL。覆盖 6 张带 `user_id` 的表；R2 按项目存储，不需要迁移。
- `tests/research-login-smoke.mjs`：已加入 `npm run test:research-access-auth`，因此包含在 `npm test` 中。
- `docs/AI_RESEARCHER_BACKEND.md`：新增 “Login for AI Researcher only” 一节。`docs/PRODUCT_REVIEW_2026-10-28.md` 为产品审视与迭代计划。

### 已验证

- `npm test` 全部通过，`vite build` 通过。
- 本地浏览器模拟未登录：项目列表显示登录卡片；工作台内失效时显示“重新登录”提示；`/api/research/login` 正确 302 回 `/#research`。
- **未验证**：真实 Cloudflare Access 登录流程，需上线后验证。

## 2. 待执行步骤（按顺序）

> 第 1 步做完后，研究员数据立即不再公开。此时旧前端在研究员页会显示“无法连接”，这是可接受的过渡状态，直到第 4 步部署新前端。

### 步骤 1：Cloudflare Zero Trust（控制台操作）

1. Zero Trust → Settings → Authentication → Login methods：添加 **One-time PIN**。
2. Zero Trust → Access → Applications → Add an application → **Self-hosted**：
   - Application name：`SurveyKit AI Researcher`
   - Domain：`surveykit.cc`，Path：`api/research`（**只保护这个路径，不要保护整站**）
   - Session duration：建议 `1 month`，减少重复登录
   - Identity providers：One-time PIN
3. Policy：Action **Allow**，Include → Emails：`<由项目负责人提供的白名单邮箱>`。内测阶段只放负责人自己的邮箱。
4. 保存后记录：
   - **Application Audience (AUD) Tag**
   - **团队域名**：`<team>.cloudflareaccess.com`（Zero Trust → Settings → Custom Pages / General 中可见）
5. 立即验证（未登录、无 Cookie）：

   ```bash
   curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://surveykit.cc/api/research/projects
   ```

   期望 `302` 跳到 `*.cloudflareaccess.com`，不再返回 200 与项目 JSON。其他路径（`/`、`/api/ai`、`/healthz`、`/pptx-api/healthz`）仍返回 200。

### 步骤 2：修正生产检查脚本（代码，开启 Access 后必需）

`scripts/release-check.mjs:57` 用匿名请求检查 `/api/research/projects` 并要求返回 `projects` 数组，开启 Access 后会失败。修改为：

- 默认：请求时 `redirect: "manual"`，把“302 到 `*.cloudflareaccess.com`”判为通过，说明接口已受保护。返回 200 且带项目数据时判为**失败**，说明数据暴露。
- 若设置了 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` 环境变量，则带上 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 请求头，按原逻辑检查 `projects` 数组。
- 补对应测试（参照 `tests/release-process-smoke.mjs`）。

`scripts/production-*-smoke.mjs` 也直接调用研究员接口，同样改为支持上述两个环境变量。如需使用，在 Access 中创建 Service Token，并给应用加一条 **Service Auth** 策略。

### 步骤 3：切换到 access 模式（代码）

在 `wrangler.toml` 的 `[env.production.vars]` 中：

```toml
RESEARCH_AUTH_MODE = "access"
CLOUDFLARE_ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
CLOUDFLARE_ACCESS_AUD = "<AUD tag>"
SURVEYKIT_RELEASE = "v0.14.1-20261028.research-login"
```

保留 `RESEARCH_ANONYMOUS_USER_ID`，它只在 anonymous 模式生效，留着便于回滚。若 Access 两个值缺失，access 模式返回 503，不会退回共享工作区。

### 步骤 4：发布

严格按 `docs/RELEASE_PROCESS.md`：

1. 把 `codex/research-login`（含步骤 2、3 的提交）合入 `main` 并推送 `origin/main`。
2. 发布前检查：`npm ci`、`npm test`、`npm run test:python`、`python -m pytest tests/unit -q`、`npm run build`。
3. Pages 从 `main` 构建；用新提交的完整 SHA 更新 `SURVEYKIT_COMMIT`（`wrangler pages secret put SURVEYKIT_COMMIT --project-name survey-worker`）。
4. 本次**只改 Web**，PPT 后端和数据执行器无需重装。但 `RELEASE_PROCESS.md` 要求前后端 revision 一致，按文档判断是否需要同步后端 revision 元数据。
5. `npm run verify:production -- --release=v0.14.1-20261028.research-login`

### 步骤 5：迁移旧共享数据（D1）

1. 负责人在浏览器登录 `https://surveykit.cc/#research`，再打开 `https://surveykit.cc/api/research/session`，复制 `user_id`（Access 的 `sub`）。
2. 备份：

   ```bash
   wrangler d1 export surveykit-research --remote --output backup-before-owner-migration.sql
   ```

3. 生成并执行迁移：

   ```bash
   node scripts/migrate-research-owner.mjs --to <user_id> --out migrate-owner.sql
   wrangler d1 execute surveykit-research --remote --file migrate-owner.sql
   ```

   如只迁部分项目，加 `--project id1,id2`。脚本最后一条 `SELECT` 会输出迁移后的项目数。

### 步骤 6：AI 代理限流（Cloudflare 控制台，独立于登录）

`/api/ai` 使用服务端共享 OpenCode Go Key，任何人可调用。在 Security → WAF → Rate limiting rules 新建规则：

- 匹配：URI Path equals `/api/ai`，Method `POST`
- 阈值：同一 IP 每 1 分钟 20 次（按实际使用调整）
- 动作：Block 1 分钟。前端已能识别 429 并提示“请求过于频繁”。

同时在 OpenCode Go 控制台设置额度告警。

## 3. 验收清单

- [ ] 无痕窗口访问 `/api/research/projects`：302 到 Access 登录页，无项目数据
- [ ] 无痕窗口打开 `/#research`：显示“登录后使用 AI 研究员”卡片，不是“无法连接”
- [ ] 点击“邮箱登录”→ 收验证码 → 回到 `/#research`，标题下显示“已登录：邮箱 · 退出登录”
- [ ] 迁移后能看到原有项目（如“荣耀年轻用户NPS研究”），可正常对话、上传、导出
- [ ] 非白名单邮箱无法登录
- [ ] 其他工具（交叉表、清洗、PPT 生成、AI 方案/问卷设计）无需登录，功能正常
- [ ] `npm run verify:production` 通过
- [ ] `/api/ai` 超频返回 429

## 4. 回滚

- 只回滚登录：把 `RESEARCH_AUTH_MODE` 改回 `"anonymous"` 并重新部署，在 Access 中删除或停用该应用。注意：迁移后的数据归属新账号，匿名模式下看不到，需要用相同脚本反向迁移（`--from <user_id> --to anonymous:shared-workspace`），或用备份恢复。
- 代码回滚：Pages 回滚到上一个部署（`v0.14.0-20261017.driver-analysis`）。

## 5. 约束

- 不要打开、下载或输出共享工作区中任何项目的文件、对话或成果内容。这些是客户数据，迁移只改归属字段。
- 不要从外层 `D:/调研工具` 或 `codex-temp/` 的其他副本发布。
- 未经负责人确认，不要扩大白名单，也不要把策略改为 Everyone。
