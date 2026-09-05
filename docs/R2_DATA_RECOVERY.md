# 第二轮：数据语义与任务恢复

状态：开发及本地验收完成。生产仅做存储只读盘点；尚未应用 0020、部署消费者或发布新前端。

## 已实现

| 项目 | 交付 |
| --- | --- |
| R2-1 元数据 | schema_version=1；完整变量/值标签、用户缺失规则、来源 Sheet、来源文件 SHA-256、父版本、权重状态。派生 JSON 和数据集记录均保留语义；完整字典不再被展示摘要的标签数量上限截断。原始文件字节改变时拒绝按旧版本分析。 |
| R2-2 持久任务 | 项目级幂等键、参数指纹、原子领取、心跳/租约、截止时间、取消和重试。先暂存对象，再一次发布数据集、清洗日志、分析、证据、工具结果和 completed 终态。 |
| R2-3 恢复 | API 列出任务，刷新后显示等待/运行/失败/取消状态；重试复用原任务，取消使旧租约失效；断网后可重新连接。完成时刷新数据集及成果列表。聊天数据工具也使用同一持久任务及发布保护。 |
| R2-4 演练 | 原生 workerd + D1/R2、本地真实进程退出与 HTTP 丢响应、文件缺失/截断、三格式解析测量、本地及生产只读存储盘点。 |

## 执行与发布边界

- 本地：服务启动和每秒扫描持久任务；计算放入工作线程，数据库写入由主进程统一处理。JSON 存储继续按单服务进程运行，不支持多进程同时写同一个 research.json。
- 云端：独立 `workers/data-jobs.mjs` 消费者每分钟扫描 D1，领取一个任务；聊天工具可先尝试执行已经持久化的任务。任务记录就是队列，不需要额外的入队双写。浏览器连接不是执行前提。
- 默认租约 120 秒，心跳间隔不超过 1 秒，总截止时间 10 分钟。租约或截止时间过期，扫描器将任务变为明确的 failed，供用户重试；不会无限自动重试错误输入。
- confirmed 数据变换、显式 async、有幂等键或至少 200 万单元格的 API 请求进入队列；聊天数据工具全部先登记任务。轻量同步 API 保持原有响应方式。
- 上传解析本轮未整体迁移。合成 CSV 200 万单元格、SAV/XLSX 100 万单元格的本机解析均低于 2 秒，保留现有大小限制和重新解析入口。XLSX 测量文件约 29 MB，属于解析器压力测试，超过默认 25 MiB 上传限制，不代表线上可上传范围。
- D1 的 `batch` 在同一事务里先执行带 CHECK 约束的租约保护记录，再写业务结果和终态；取消先落库时整个旧发布事务失败。提交成功但响应丢失时，读取完成状态，保留已发布文件。
- 中断留下的暂存对象可能成为孤立文件；本轮只盘点，不自动删除。旧派生版本中已经丢失的语义不作猜测性修补，按 R1 历史重算流程生成新版本。

## API 契约

- `POST /projects/:project/datasets/:dataset/{profile|clean|weight|crosstab}`：`async: true` 进入任务，返回 `202 {job}`。幂等键使用 `Idempotency-Key` 或 JSON `idempotency_key`，8–128 位字母、数字或 `._:-`。同项目、同键、同参数复用任务；同键不同参数拒绝。未提供键的独立请求会产生新任务。
- `GET /projects/:project/data-jobs` 与 `GET /projects/:project/data-jobs/:job`：返回公开状态、结果以及 retryable/cancellable；不返回用户 ID、输入参数、参数指纹或租约令牌。
- `POST /projects/:project/data-jobs/:job/retry`：只把 failed 重置为 pending。completed 不重复执行；cancelled 不复活，重新操作需新键。
- `POST /projects/:project/data-jobs/:job/cancel`：pending/running 进入 cancelled，撤销租约。若提交已先完成，保持 completed，返回实际状态。

## 验收证据

- `npm test`：85 个单元测试以及完整 JavaScript 烟测通过。
- `npm run test:r2`：本地和 D1/R2 契约、12 路同键重复请求、取消、过期旧执行者、缺失文件、截断写入、重试、工作线程超时、真实进程退出/重启、HTTP 响应丢失全部通过。SAV 包含 Q 编码 NPS、120 个值标签和用户缺失码 99，清洗和等权加权后 NPS=33.3、有效 base=3。
- Playwright 全量：21 通过、1 个已有测试跳过；新增刷新/断网重连/重试/取消用例通过，最后一次修改后定向复测通过。
- `npm run test:r2:native`：原生本地 workerd、D1 事务和 R2 通过；设置 `R2_WRANGLER_JS` 可指定 Wrangler CLI，验收使用 4.129.0。测试启动独立本地状态目录并终止自己的进程。
- `npm run build`、消费者 dry-run、20 个迁移的完整链及外键检查通过。
- [恢复测试](validation/r2/recovery.txt)、[原生运行时](validation/r2/native-worker.json)、[耗时](validation/r2/timings.json)、[本地盘点](validation/r2/storage-audit-local.json)、[生产只读盘点](validation/r2/storage-audit-cloud.json)、[验收索引](validation/r2/acceptance.json)。生产盘点为 23 个引用、23 个对象，无缺失、无孤立对象，未做删除。

验证范围不包含生产 Cron 实际调度、远端完整业务压力或生产网络故障。这些仍是发布环境的验证步骤。Python 服务未改动，本轮未重复 Python 全量验收。

## 上线顺序（本次未执行）

1. 备份目标 D1/R2，核对 0019 基线。先在隔离环境应用 `0020_durable_data_jobs.sql`；旧 running 任务迁移为可重试 failed，完成结果保留。
2. 将 `wrangler.data-jobs.jsonc` 的占位 D1/R2 替换为该隔离环境与 Pages 相同的绑定，部署消费者并确认定时扫描日志。占位配置不能直接用于生产。
3. 发布同版本 Pages，验证真实 HTTP 提交、断开连接、刷新恢复和取消，再执行生产发布流程。需共同上线迁移、消费者和 API，不能只发布前端/API。
4. 监测 pending 等待时间、failed/租约过期数量和孤立对象。当前消费者按低并发设计，每分钟领取一个持久等待任务；积压明显时再扩容或迁移到专用队列。
5. 回滚时先停消费者，暂停新提交，再恢复匹配版本的应用；保留 0020 数据及备份，不执行破坏性的逆迁移。

实现依据：[Cloudflare D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
