# Tibo RESET 提醒

一个轻量、开源的 Chromium 浏览器扩展：监控 Tibo（[@thsottiaux](https://x.com/thsottiaux)）公开显示的帖子和回复，在发现与 Codex 额度 RESET 相关的消息时及时提醒。

> 本项目是独立工具，与 OpenAI、X 或 Tibo 无隶属或官方合作关系。

## 主要功能

- 同时检查 Tibo 的帖子与回复，两条来源互不影响。
- 明确表示“已经 RESET”的消息使用弹窗、声音和每分钟重复提醒，直到用户确认。
- RESET 预告、延期和一般相关消息使用较轻的单次通知。
- 显示上次 RESET 日期、最近成功检查和待确认提醒。
- X 限流或临时错误时自动退避，避免反复刷新。
- 高级诊断提供 24 小时覆盖情况、来源状态、检查日志和本地诊断导出。
- 所有状态保存在本机浏览器，不上传密码、Cookie、令牌或浏览历史。

## 使用条件

- Microsoft Edge 或 Google Chrome 116 及以上版本。
- 浏览器能够正常访问 X 上的 Tibo 页面。
- 浏览器需要保持运行；浏览器退出或系统休眠期间无法检查。

## 安装

### GitHub Release 手动安装

1. 在仓库右侧 **Releases** 下载最新 ZIP。
2. 解压 ZIP。
3. 打开 `edge://extensions` 或 `chrome://extensions`。
4. 开启“开发人员模式”。
5. 点击“加载解压缩的扩展”，选择解压后包含 `manifest.json` 的目录。

公开商店版本准备完成后，建议普通用户改用商店安装，以便自动更新。

## 首次使用

1. 点击插件图标，按三步引导打开帖子和回复监控页面。
2. 确认两个 X 页面均可正常显示。
3. 点击“测试提醒”，检查系统通知、弹窗和提示音。
4. 关闭提醒弹窗前点击“已知晓”，否则重要提醒会再次出现。

## 隐私

插件只读取指定账号在 X 上公开显示的内容。检查位置、提醒状态、日志和用户主动记录的反馈只保存在浏览器本机。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 已知限制

- 当前监控账号固定为 `@thsottiaux`，暂不支持自定义账号或关键词。
- X 登录状态、限流、网络拦截或页面结构调整可能影响检查。
- 首次成功读取只回看最近 24 小时，避免集中提醒大量旧消息。
- 网页上已经删除或当前不可见的内容无法恢复。

## 反馈问题

请使用 GitHub Issues。漏报问题请附上 Tibo 原文链接；诊断文件只在你主动导出并上传时才会离开本机。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 开发检查

```bash
npm run check
```

## English

Tibo RESET Alert is a lightweight Chromium extension that watches Tibo's public X posts and replies for Codex RESET updates. Confirmed resets trigger a persistent popup and sound until acknowledged. All monitoring state stays in the local browser. X access is required.

## License

[MIT](LICENSE)
