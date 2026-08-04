# 安全策略

## 支持版本

当前仅维护最新 GitHub Release。请先在最新版稳定版 Microsoft Edge 中复现问题。

## 报告安全问题

请不要在公开 Issue 中提交 Token、Cookie、个人文案、生成音频、浏览器配置或其他敏感信息。使用 GitHub 仓库的 Private vulnerability reporting 功能提交：

- 受影响版本；
- 最小复现步骤；
- 预期与实际行为；
- 已去除敏感数据的日志。

## 数据边界

- 文案只存在于当前工作台内存、Edge TTS 请求与处理中间音频中，不写入 `chrome.storage.local`。
- 用户设置写入 `chrome.storage.local`。
- 输出目录句柄写入 IndexedDB；临时音频写入扩展 OPFS，并在任务结束后清理。
- 扩展不读取普通网页内容，也不注入网页脚本。
