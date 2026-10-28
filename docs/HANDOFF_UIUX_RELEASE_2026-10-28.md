# 交接：首屏加载优化 + UI/UX 阶段 1–5 上线

日期：2026-10-28 · 交给：Codex · 目标：把本次前端改动发布到 `https://surveykit.cc`

## 1. 一句话

发布分支 `codex/uiux-release` 已经在本地合并好：以 `origin/main`（`63786ef`，含 AI 研究员登录）为基础，合入了首屏加载优化和 UI/UX 阶段 1–5，没有冲突。本次**只改 Web 前端**，没有数据库迁移，也没有 Python、PPT 后端或数据执行器的代码改动。

## 2. 基本信息

| 项 | 值 |
|---|---|
| 仓库 | `liaozhiliang222-cloud/survey-worker` |
| 发布分支 | `codex/uiux-release`，最新提交是加入本交接文档的那一次（在 `ae50ab4` 之后） |
| 分支所在目录 | `D:/调研工具/codex-temp/first-load-20261028`（git worktree）。与你的 `release-driver-20261017` 共用同一个仓库，分支可直接 `git switch codex/uiux-release` 使用，**未推送到远端** |
| 合并基础 | `origin/main` = `63786ef fix: keep standalone tools public with research Access enabled`（2026-10-28 18:36）。本地抓取远端时网络失败，未确认远端此后是否有新提交 |
| 包含的提交 | `f5d9baf` 首屏加载与地址栏路由 → `c145599` UI/UX 阶段 1–2 → `b8dcbcd` 阶段 3–5 → `60a274d` 合并 → `ae50ab4` 登录样式改用设计变量 |
| 建议发布编号 | `v0.15.0-20261028.uiux` |
| 上一版本（回滚目标） | 以发布前 `/healthz` 返回为准。若登录版已上线，应为 `v0.14.1-20261028.research-login`；否则为 `v0.14.0-20261017.driver-analysis` |

本地已在 `codex/uiux-release` 上验证（2026-10-28）：

- `npm test`：通过，其中包含 `lint:css` 和真实 Chrome 的回访缓存检查。
- `npx playwright test`：96 个通过，6 个跳过，1 个失败（已知失败，见第 4 节）。
- `npm run build`：通过，`dist/` 中没有 `dev/` 目录。
- 未运行：`npm run test:python` 和 `pytest`。本次没有 Python 改动，但发布前仍要按流程运行。

## 3. 改了什么（用户可见）

完整说明见 `docs/UIUX_PLAN_2026-10-28.md` 第 8–12 节。

- **首屏加载**：构建时给脚本加内容哈希，Service Worker 对哈希资源缓存优先。实测回访从 20 个脚本请求降到 0 个（每个请求加 300ms 延迟时，DOMContentLoaded 从 1.58s 降到 0.45–0.75s）。地址栏 `#页面` 可直接打开、支持后退，未知页面提示后回到项目页。`CACHE_NAME` 升到 `research-toolbox-v106`。
- **阶段 1–2**：
  - 修复手机导航抽屉文字竖排；
  - 生成交叉表后有结果卡和提示消息；
  - 不可用的按钮旁写明原因；
  - 引导缩减为 3 步；
  - 交叉表改为拖拽上传区，数据清洗加步骤条；
  - 长页面底部浮出主按钮，帮助说明改在右侧抽屉打开；
  - 空项目时项目页只显示“开始”区。
- **阶段 3**：
  - 侧栏改为：项目、AI 研究员、可搜索的工具库、设置 / 常见问题；
  - 当前项目名显示在侧栏、面包屑和手机顶栏；
  - AI 方案 / 问卷设计页注明与 AI 研究员的分工；
  - 手机抽屉加关闭按钮，只展开当前所在分组。
- **阶段 4**：
  - 新增设计变量，约 1200 处写死的颜色、字号、圆角改用变量；
  - 界面文字最小 12px；
  - 键盘焦点框改为 2px 不透明品牌蓝；
  - 修复 4 个被引用但未定义的 CSS 变量（交叉表 NET 分组中选中的选项原来是白底白字）；
  - 新增 `npm run lint:css`，已加入 `npm test`。
- **阶段 5**：
  - 新增可用性测试材料包；
  - 修复空项目时导入问卷看不到预览和确认按钮（此问题是阶段 2 引入的，从未上线）；
  - 修复导入预览选项数显示为 0；
  - PPT 报告服务连不上时给出明确提示。
- **合并时的调整**：登录功能新增的两处字号改用设计变量，登录卡片标题由 18px 变为 20px。

## 4. 发布步骤

严格按 `docs/RELEASE_PROCESS.md` 执行。

1. **同步并确认**
   ```powershell
   git fetch origin
   git switch codex/uiux-release
   git log --oneline origin/main..HEAD     # 应只有第 2 节列出的提交
   git log --oneline HEAD..origin/main     # 应为空；不为空就先 git merge origin/main，再从第 2 步重跑
   ```
2. **写入发布编号**：把 `wrangler.toml` 中 `[env.production.vars]` 的 `SURVEYKIT_RELEASE` 改为 `v0.15.0-20261028.uiux`，单独提交。
3. **发布前检查**（工作区必须干净，全部通过）
   ```powershell
   npm ci
   npm test
   npm run test:python
   python -m pytest tests/unit -q
   npm run build
   npx playwright test
   ```
   - `npx playwright test` 有 1 个已知失败：`document-import.spec.js` 的 “legacy binary data never becomes CSV text”。它调用的 `handleAiReportImport` 已在 `d0642f9` 随旧 AI 报告下线删除，与本次改动无关。除这一个以外必须全部通过。
   - 构建后确认 `dist/` 中**没有** `dev/` 目录（组件样例页只在开发环境使用）。
4. **合入 main 并推送**：`codex/uiux-release` 快进或合并到 `main`，推送 `origin/main`，Cloudflare Pages 从 `main` 构建。
5. **注入提交号**：把发布提交的完整 SHA 写入 Pages。
   ```powershell
   wrangler pages secret put SURVEYKIT_COMMIT --project-name survey-worker
   ```
6. **后端**：PPT 后端和数据执行器没有代码改动，**不需要重装**。按 `RELEASE_PROCESS.md` 的要求，前后端发布编号和 revision 要一致；参照上次 `v0.14.0` 的做法，保留版本元数据备份后，只同步后端的发布编号和 revision。
7. **生产验证**
   ```powershell
   npm run verify:production -- --release=v0.15.0-20261028.uiux --revision=<完整 SHA>
   ```

## 5. 上线后人工验收

用**无痕窗口**、桌面宽度 ≥ 1280px 检查，不要使用任何客户项目数据，只用 `docs/usability/` 下的合成材料。

- [ ] 首次打开出现 3 步引导；项目页空状态只显示“开始”区（导入问卷 / 新建项目 / 导入数据）
- [ ] 点“导入问卷”，选择 `docs/usability/示例问卷-宠物饮水机.txt`：自动展开项目档案，预览显示“识别题量：6；选项：22 个”；点“确认导入”后问卷稿有内容
- [ ] 在侧栏工具库搜“交叉表”并回车，进入交叉表分析；上传 `docs/usability/示例数据-宠物饮水机.xlsx`，显示“200 行 × 12 列”；点“生成并下载全部题目表”，下载 Excel，并提示“已生成 11 题交叉表”
- [ ] **PPT 报告**：上传上一步下载的交叉表 → 解析维度 → 预览 → 生成并下载 .pptx。这条链路本地没有报告服务，**从未在新前端上真实跑通，是本次最需要确认的一项**
- [ ] 侧栏搜“KANO”只显示“研究模型”；打开 `/#kano` 时侧栏高亮“研究模型”
- [ ] 按 Tab 键时，按钮和输入框有明显的蓝色焦点框
- [ ] 交叉表页展开“NET 分组配置”并选中一个选项：显示蓝底白字，不是白底白字
- [ ] AI 研究员：无痕窗口打开 `/#research` 显示登录卡片，登录后正常；其他工具不需要登录
- [ ] 手机宽度（375px，可用浏览器开发者工具）：菜单抽屉有关闭按钮，只展开当前分组，无竖排文字和横向溢出
- [ ] 回访缓存：关闭标签页后重新打开，开发者工具 Network 中 `.js` 均来自 Service Worker，页面无报错
- [ ] 访问 `/#no-such-page`：提示找不到页面并回到项目页
- [ ] `https://surveykit.cc/dev/components.html` 不存在（404 或回到首页均可）

## 6. 风险与回滚

| 风险 | 说明 / 处理 |
|---|---|
| Service Worker 升级 | 老用户首次访问由旧 SW 提供页面，新 SW 在下一次访问生效，属于正常现象。若发现回访加载到旧脚本或页面空白，先回滚 Pages |
| 字号变大导致局部挤压 | AI 研究员工作区、PPT 编辑器里的小标签从 9–11px 提到 12px。这些区域需要真实项目数据才会显示，上线前无法截图检查。只影响观感，不影响功能，发现后记下页面和截图，作为后续修复 |
| PPT 报告链路 | 见第 5 节，前端只改了错误提示和上传区样式，接口调用没有改动 |

回滚：Cloudflare Pages 回滚到上一个生产部署（第 2 节的回滚目标），再运行一次 `npm run verify:production`。本次没有数据库或后端改动，不需要回滚它们。若已同步后端版本元数据，用备份恢复即可。

## 7. 约束

- 只从 `codex/uiux-release`（或合并后的 `main`）发布，不要从外层 `D:/调研工具` 或 `codex-temp/` 下的其他副本发布。
- 不要打开、下载或输出共享工作区及 AI 研究员中任何客户项目的文件、对话或成果。验收只用 `docs/usability/` 下的合成材料。
- 不要改动 Access 白名单和登录策略，这些不在本次范围内。
- 发现第 4 节的检查失败、或第 5 节的 PPT 链路不通时，先停止发布并告知负责人，不要为了通过检查而修改测试。
