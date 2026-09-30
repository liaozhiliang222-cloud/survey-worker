# 调研工具

面向市场调研项目的本地 Web 工具，覆盖问卷设计、数据清洗、交叉表分析、AI 报告和 PPTX 报告生成。

## 当前开发基线

正式工作目录为 `D:/调研工具/codex-temp/opencode-go-release-source`。2026-09-30 核验的 Web 线上提交为 `3bb99455b83873e23568c951ea60d8d48c507c61`，本轮 S0/S1/S2/S3/S4 的发布候选为 `v0.13.0-20260930.research-s4`，从 `codex/s0-data-baseline` 汇入 main。实际上线状态以健康接口的 release/revision 为准。外层仓库和阶段副本不作为本轮发布输入。

产品规划与 S0/S1/S2/S3/S4 验收记录见 [产品迭代计划](docs/PRODUCT_ROADMAP_2026-09-30.md)。启动及发布命令均从本仓库根目录执行；部署继续遵循现有发布文档。

## 分析简报

原始样本在 AI 研究员中选择数据版本，点击“生成分析简报”；可勾选题目并计算，或复用已有结果。成果保存到项目，支持 Word/Markdown 导出。外部汇总交叉表在 PPT 报告的结构预览中生成文字简报。旧报告文本可通过 `/#ai-report` 打开和导出。

针对本轮修改运行 `npm run test:s1`、`npx playwright test tests/e2e/s1-analysis-brief.spec.js` 和 `python -m unittest discover -s tests -p s1_brief_context_test.py`。后续发布需要同时包含 Python 证据接口的数值单位修正。

## 分析配方与串行批次（S4）

AI 研究员的数据区支持“保存分析配方”“复用配方 / 串行批量”以及“追加工作表”。配方可下载 JSON 后导入其他项目；可按问卷定义填写完整数值量表或类别列表，并逐字段查看校验结果。映射和量表核验通过后，依次重新计算所选数据集并生成各自的交叉表 Excel。批次状态保存在后端，失败项在任务列表重试。

运行 `npm run test:s4` 和 `npx playwright test tests/e2e/s4-analysis-recipes.spec.js` 验证。发布前须应用 `0023_analysis_recipes_sheets.sql`，同步更新 Web/研究接口与外部数据执行器；发布候选为 `v0.13.0-20260930.research-s4`。详细边界见产品计划第 15–16 节。

## 本地启动

开发与测试使用 `.node-version` 固定的 Node.js 24.17.0（测试脚本包含 `node:sqlite`，CI 使用相同版本）：

```powershell
npm run dev
```

该命令启动 Vite，并直接提供 `/api/ai`、`/api/research` 和 `/api/tools` 的本地处理接口，无需另开 `server.js`。内置 AI 未配置密钥时，`POST /api/ai` 返回明确的 503；`GET /api/ai` 可检查服务状态。PPT 导出仍需要单独启动 Python 后端。仅使用传统静态服务时可运行 `npm run dev:legacy`。

默认访问 `http://localhost:4281`。常用环境变量：

- `PORT`：本地 Web 端口。
- `PPTX_BACKEND_URL`：PPTX Python 服务地址，默认 `http://127.0.0.1:8000`。
- `SURVEYKIT_RELEASE` / `SURVEYKIT_COMMIT`：发布编号与 Git revision，会暴露在健康接口中。
- `PPTX_PROXY_TIMEOUT_MS`：PPTX 代理超时毫秒数，默认 120000，可配置范围 1000–300000。
- `PPTX_PROXY_MAX_BODY_BYTES`：本地 PPTX 代理请求体上限，默认 30 MiB。
- `AI_PROXY_MAX_BODY_BYTES`：本地 AI 代理请求体上限，默认 1 MiB。
- `DASHSCOPE_API_KEY` / `BAILIAN_API_KEY`：内置 AI 服务密钥。
- `BAILIAN_MODELS`：逗号分隔的模型回退顺序；未配置时默认使用 `deepseek-v4-pro → deepseek-v4-flash → qwen3.7-max → qwen3.7-plus → glm-5.2 → kimi-k2.6 → qwen3.6-plus → qwen3-max → deepseek-v3.2 → glm-5.1 → qwen3.5-plus`。

## 接口约定

- `GET /healthz`：本地 Web 服务健康检查。
- `/pptx-api/*`：前端统一入口；本地和 Cloudflare 均转发到 Python 后端的 `/api/pptx-report/*`。
- `/pptx-api/healthz`：转发到 Python 后端的 `/healthz`。
- `POST /api/ai`：AI 模型代理。

## 测试

运行全部 Node.js 冒烟测试：

```powershell
npm test
```

Python 报告回归测试需要先安装 `tests/requirements.txt`（其中会复用生产依赖）：

```powershell
python -m pip install -r tests/requirements.txt
npm run test:python
```

Python 测试生成物位于 `tests/output/`，并已排除在版本控制之外。

## 主要目录

- `lib/`：Node 服务共享模块。
- `pptx_report/`：PPTX 解析、页面规划和渲染。
- `deploy/`：Python API 与部署配置。
- `functions/`：Cloudflare Pages Functions 代理。
- `tests/`：Node.js 与 Python 冒烟/回归测试。

## 部署配置

Cloudflare Pages 必须显式配置 `PPTX_BACKEND_URL`，未配置时代理返回 503，不再回退到代码内置生产地址。生产环境建议使用 HTTPS 后端域名，并通过 `/pptx-api/healthz` 验证代理与 Python 服务的完整链路。

正式发布、生产验证与后端回滚步骤见 [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md)。

`.env.example` 仅提供变量名称和本地默认值，不应写入真实密钥。

问卷支持按项目自动保存需求、版本及试访记录，刷新后恢复；可下载和导入 JSON 档案。数据保存在当前浏览器，迁移设备或清理浏览器前请下载备份。

AI 研究员的 PPT 脚本新增“报告交付检查”：定位数值/原声来源、保护锁定与人工编辑页，复核后下载包含可编辑混合 PPT、Excel、统计口径及覆盖/来源清单的交付包。首批支持横向定量对比、原声与综合结论；运行 `npm run test:s3` 验证新链路。
