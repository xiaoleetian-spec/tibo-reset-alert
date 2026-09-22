# GitHub Actions 离线监控（实验功能）

这个功能让 GitHub 每 5 分钟检查一次 Tibo 的公开帖子和回复。浏览器和电脑关闭时，云端仍可归档新内容；识别到中、高等级 RESET 消息后，会在本仓库创建一个 GitHub Issue。

## 工作方式

1. `cloud-monitor.yml` 定时启动临时 GitHub Runner。
2. Runner 使用 X 官方 API 读取 `@thsottiaux` 在上次游标之后发布的内容，并自动处理分页。
3. 所有新增内容先写入 `monitor-data/archive.jsonl`，再复用浏览器插件的 `extension/core.js` 进行分类。
4. 中、高等级命中会创建带帖子 ID 标记的 Issue；重复执行会检查标记，避免重复 Issue。
5. 成功完成后才更新 `monitor-data/state.json`。接口或通知失败时不会提前推进游标，下次运行会重试。
6. 没有新内容时不会产生提交；每 30 天写入一次心跳，避免公开仓库因 60 天无活动而停用计划任务。

## 启用步骤

### 1. 准备 X API Token

在 X Developer Console 创建只读 App，取得 Bearer Token。不要把 Token 写入源码或 Issue。

### 2. 保存 Secret

仓库进入 **Settings → Secrets and variables → Actions → Secrets**，创建：

- 名称：`X_BEARER_TOKEN`
- 内容：X Developer Console 提供的 Bearer Token

### 3. 先做模拟检查

进入 **Actions → Cloud monitor experiment → Run workflow**，保持 `dry_run` 为 `true`。模拟检查使用仓库内固定样例，不读取 X，也不会创建 Issue 或修改游标。

### 4. 做一次真实手动检查

再次运行工作流，把 `dry_run` 改为 `false`。检查成功后确认：

- Action 运行结果为绿色；
- `monitor-data/state.json` 保存了用户 ID 和最新帖子 ID；
- 命中 RESET 时出现对应 Issue；
- `monitor-data/archive.jsonl` 包含读取到的原文。

### 5. 开启定时运行

在 **Settings → Secrets and variables → Actions → Variables** 创建：

- 名称：`ENABLE_CLOUD_MONITOR`
- 值：`true`

只有变量严格等于 `true` 时，每 5 分钟的定时任务才会执行真实检查。删除变量或改为其他值即可停止，不需要删除工作流。

## 权限与数据

- `contents: write`：只用于提交云端游标、公开原文归档和每 30 天心跳。
- `issues: write`：只用于创建 RESET 提醒 Issue。
- X Bearer Token 只通过 GitHub Secret 注入，不会写入仓库。
- 帖子原文本来就是公开内容，但启用后会被长期归档在公开仓库。如不希望公开归档，应把监控移到私有仓库。

## 局限

- GitHub 的最短计划间隔是 5 分钟，实际运行可能延迟。
- 5 分钟内发布又删除的内容仍可能无法读取。
- X API 权限、费用、速率限制和接口变化可能中断检查。
- GitHub Issue 是离线通知载体；若要手机及时收到，请在 GitHub Mobile 中关注仓库 Issues。
- 这是可选实验功能，不影响浏览器插件原有的本地双来源监控。

## 本地模拟

```bash
node --test tests/cloud-monitor.test.mjs
node scripts/cloud-monitor.mjs --dry-run --fixture=tests/fixtures/cloud-timeline.json
```
