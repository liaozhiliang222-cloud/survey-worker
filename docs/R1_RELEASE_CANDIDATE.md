# 第一轮发布候选与验收

第一轮开发与候选验收已完成，生产尚未放行或部署。原工作区及索引保留；验收提交位于独立本地仓库，不代表已经合并 main。

## R1-1 发布范围与版本

采用现有工作区整体候选，基准提交 `7e6960ef70ee0a4f42131bc4127c489582f3a4e8`。包含原有 AI/Harness、工具网关、数据集/加权/任务、定性/校正、大纲/PPT Script、渲染器、前端、共享模块与测试；B1–B7 不作为可脱离这些依赖发布的补丁。

[文件清单](validation/r1/candidate.json)记录每个源文件 SHA-256 和快照位置；[最终验收索引](validation/r1/acceptance.json)记录最终候选提交、完整验证基线、后续差异及针对性验证。临时数据、缓存、依赖目录、环境密钥、验证输出和根目录 kano QA 产物不进入候选。全部原有未提交功能的代码与必需资源随候选保留。

Node 固定为 `.node-version` 的 24.17.0，CI 同步使用该版本，Vitest 调用正式 `test:unit` 脚本。Node 依赖由 package-lock.json 锁定，包含 datareader-spss 0.2.1 和测试用 savfilewriter 1.0.0；嵌套 functions、deploy/harness 的包声明也纳入候选。Python 的 Windows/3.12 验收锁为 `tests/requirements-r1-win-py312.lock`，在全新 venv 中安装验证，不依赖全局环境。

完整保留迁移 0001–0019，新增范围为 0005–0019；涉及工具结果、数据集/任务、CSV/SAV、定性/校正及报告成果。生产配置仍按 .env.example、wrangler.toml 和 deploy/install_seoul.sh 单独核对。Windows 依赖锁不代替 Linux 服务器、OfficeCLI、LibreOffice、字体和服务配置验收。

## R1-2 统计与适配器

CSV/XLSX/SAV 共用人工样本：13 个有效数值 0–12；NPS 一个 0、十二个 10；另含空白、纯空格和缺失分组。预期 NPS=84.6、均值=6、有效 base=13，B 组 yes=100%。分组值、分类百分比、普通/等权统计一致。截尾样例以 9:1 样本、50:50 目标、最终权重上限 2 验证 80:20、残差 0.3、非收敛。

`npm run test:r1` 覆盖本地 JSON/文件存储和 SQLite D1/内存 R2 模拟。真实 D1/R2 测试使用生产 store/数据 adapter，经 Cloudflare REST API 传输，同样通过三格式×普通/等权六组统计和截尾验收。原始文件、派生 JSON 和交叉表 Excel 全部纳入备份。

新增修复：XLSX 导出不再将纯空格写成真实 0。新增测试修复：AI 任务冒烟用事件确保任务保持运行，再验证运行中去重；退出时等待线程结束，消除任务提前完成和清理目录的竞争。

## R1-3 重建、真实 schema 与恢复

完整隔离重建已通过，基线候选提交 `72554b6a0044609ef9114ca77aed3c90956b8847`。从空 node_modules 和新 venv 安装依赖，Node 85 项单元测试及完整冒烟链、Python 全链、25 项 pytest、构建、浏览器 20 通过/1 跳过、迁移审计和 diff 检查均通过；测试后源码哈希不变、Git 干净。随后新增的恢复准备程序、验收脚本及文档以明确差异清单和针对性测试验收，未重复运行未变更的完整应用链。

生产 D1 已做只读核验：[schema/ledger](validation/r1/production-audit.json)与 0001–0019 一致，未执行生产迁移。

真实云端恢复发现完整 SQL 导出顺序可能导致子表数据先于父表；仅拆分 schema/data 仍可能因分批提交产生外键错误。新增 `prepare-d1-restore.py` 按外键关系排序表和自引用记录，在本地逐条提交验证后输出；外键损坏、循环或触发器均明确拒绝。

复用已校验哈希的人工备份，在新的临时 D1/R2 恢复后通过：schema、ledger、外键、全部 65 条业务及迁移记录、1 条自增序列、12 个对象字节、来源关系、有效 base 和统计值。全表比较还验证了“行数相同但内容变化”会被拒绝。恢复排序新增 4 项 pytest，覆盖原始导出顺序、自引用、特殊文本/二进制、坏引用、循环和源文件保护。

证据：

- [完整重建](validation/r1/rebuild/r1-fb96c978f684c947-37fe3b54/rebuild.json)
- [真实统计与备份](validation/r1/cloud/surveykit-r1-1788596035412-e9b6a3/result.json)（此轮原始顺序恢复失败，不能当作恢复通过）
- [修正后的真实恢复](validation/r1/cloud/surveykit-r1-1788596386028-6247d5/result.json)
- [全表及自增序列对比](validation/r1/cloud/surveykit-r1-1788596386028-6247d5/restored-rows-with-sequence.json)
- [资源清理核对](validation/r1/cloud-cleanup.json)

Workers 远程绑定/预览曾受通道内部错误和网络超时阻断，API 存储验收不代表该运行时或生产 HTTP 链路通过。相关失败日志保留，不归类为统计通过。正式发布仍按 RELEASE_PROCESS.md 执行 main 同步、生产版本/config 校验、目标服务器及真实链路验证；这些属于生产放行，不以内部候选验收替代。

## R1-4 历史结果

[旧结果处理指引](R1_HISTORICAL_RESULTS.md)提供缺失值、截尾、加权清洗和旧 XLSX 空白转换的筛查规则。重算保留旧结果、源字节哈希和新旧 ID 映射；缺乏运行版本或参数时只能标记需复核。未修改用户历史数据。
