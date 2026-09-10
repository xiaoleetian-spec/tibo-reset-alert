# 隐私政策 / Privacy Policy

更新日期：2026-09-11

Tibo RESET 提醒只读取 Tibo（`@thsottiaux`）在 X 上公开显示的帖子和回复，用于识别与 Codex RESET 相关的消息。

插件会在用户本机浏览器中保存上次检查位置、提醒状态、设置、检查日志以及用户主动记录的误报或漏报。插件不收集密码、Cookie、访问令牌或浏览器历史，也不会将这些数据发送给开发者或第三方服务器。

用户点击“导出诊断”时，插件会在本机生成 JSON 文件。文件可能包含来源健康状态、检查时间、公开帖子链接、提醒记录及用户主动记录的反馈。是否通过 GitHub Issue 等渠道分享该文件，完全由用户决定。

用户主动导出历史备份时，插件会在本机生成包含公开帖子记录和上次 RESET 的 JSON 文件。插件只在用户主动选择备份文件后导入，并且会校验账号、X 原文链接、帖子编号和日期；文件不会自动上传。

权限用途：

- `x.com`：读取指定账号公开显示的帖子与回复。
- `storage`：在本机保存检查位置、提醒状态和设置。
- `alarms`：安排周期检查与未确认提醒。
- `notifications`：显示桌面提醒。
- `offscreen`：在重要提醒出现时播放提示音。

卸载插件会清除由浏览器保存的插件本地数据。如有隐私问题，请通过本仓库 GitHub Issues 联系维护者。

本工具为独立产品，与 OpenAI、X 或 Tibo 无隶属或官方合作关系。

---

Tibo RESET Alert reads only the publicly displayed posts and replies of `@thsottiaux` on X to identify Codex RESET updates. Monitoring state, settings, logs, and user-submitted feedback remain in the user's local browser. The extension does not collect passwords, cookies, access tokens, or browser history, and does not transmit data to the developer or third-party servers. Diagnostic and history-backup JSON files are created only when the user explicitly exports them; a backup is imported only after the user selects it.
