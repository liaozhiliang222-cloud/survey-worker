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
