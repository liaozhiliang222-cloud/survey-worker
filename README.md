# 调研工具

面向市场调研项目的本地 Web 工具，覆盖问卷设计、数据清洗、交叉表分析、AI 报告和 PPTX 报告生成。

## 本地启动

要求 Node.js 18+：

```powershell
npm run dev
```

默认访问 `http://localhost:4281`。常用环境变量：

- `PORT`：本地 Web 端口。
- `PPTX_BACKEND_URL`：PPTX Python 服务地址，默认 `http://127.0.0.1:8000`。
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

`.env.example` 仅提供变量名称和本地默认值，不应写入真实密钥。
