# OpenCode Go 后端配置

本地 Node 服务从仓库根目录 `.env` 读取 `OPENCODE_GO_API_KEY`。密钥不写入源码、浏览器或 Git；修改后重启 `npm run dev`。

Cloudflare Pages Functions 使用相同代码，但不会读取本地 `.env`。线上项目需要在 **Settings → Variables and Secrets** 中添加加密 Secret `OPENCODE_GO_API_KEY`，然后重新部署。按实际使用范围分别设置 Production / Preview，避免上传整个工作目录中的本地私密文件。

AI 设置默认供应商为 OpenCode Go，默认模型 `deepseek-v4.1-flash`；可切换为 `mimo-v2.6-flash`。无个人 Key 的旧设置自动迁移，已有个人 Key 的设置保留。

- 不可用、限流、网络失败、空响应或明确的地区授权错误：最多尝试另一个模型一次。
- 401、一般的 403 和参数错误：直接报告失败，不重试其他供应商。
- 已开始返回的流不会中途切换模型；连接测试显示实际模型和备用调用原因。
- 后端固定使用 `https://opencode.ai/zen/go/v1/chat/completions`，共享 Key 仅允许上述两个模型。
- 客户端使用真实身份 `research-toolbox/1.0`，同一浏览器标签页传递稳定会话 ID；不模拟其他编码工具。

OpenCode Go 主要面向编码代理，其他应用的可用性由服务提供方决定。DeepSeek 如果返回 `RegionError`，需账户持有人在 Go 控制台明确确认地区授权。

验证：`node --test tests/*.test.mjs`。测试使用假 Key，不消耗真实模型额度。

接口与模型来源：[OpenCode Go 官方文档](https://opencode.ai/docs/go/)。Secret 配置：[Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#secrets)。

## 生产变量数量

本次发布遇到 Cloudflare Free 的变量数量上限。已移除 19 个与代码默认值完全一致的纯文本绑定；原值保留在 `tests/fixtures/redundant-production-vars.json`，上下文、分块、文件解析的等价行为由 `tests/production-default-bindings-smoke.mjs` 验证。25MB 文件上限、定性分析的独立限额、认证参数和所有 Secret 均保留。
