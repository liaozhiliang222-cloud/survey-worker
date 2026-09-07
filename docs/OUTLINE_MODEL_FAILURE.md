# 报告大纲模型调用故障检查（2026-09-07）

用户项目 09:28 的报告大纲及后续重试记录为 harness_unavailable。旧错误处理将 HARNESS_UPSTREAM、HARNESS_BAD_RESPONSE 等合并为同一提示，未记录具体上游状态；无法追溯确认历史错误究竟是上游 5xx、空响应或连接故障。不能据此归因于数据执行器或 PPT 服务隔离。

本次改进：保留受限的 cause_code 与 HTTP upstream_status，区分空/无效响应与 HTTP 请求失败。不会向用户透出上游正文、密钥或地址。已用模拟 503 的真实 HTTP handler 回归验证状态与脱敏；现有 Cloudflare harness 和 report-storyline 测试通过。

真实项目重跑已完成并保存报告大纲 cbf5106f-932c-47c8-a849-cfdd25187391：6 条核心结论，6 条可追溯，4 章、8 页，5 页证据充分、2 页证据一般、1 页需要补充。quality.passed=true 表示结构及来源关联检查通过，不等于所有研究结论已人工验收。保留了 2 项冲突和 4 项证据缺口。

本轮未修改模型供应商、订阅、PPT 解析或数据执行器配置。私有复现回复位于本机 .data/outline-live.private.json，不提交原始研究内容。
