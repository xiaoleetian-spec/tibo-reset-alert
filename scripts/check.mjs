import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root='extension';
const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,'utf8'));
const packageJson=JSON.parse(readFileSync('package.json','utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,packageJson.version,'manifest 与 package 版本必须一致');
assert.deepEqual(manifest.host_permissions,['https://x.com/*']);
assert.deepEqual([...manifest.permissions].sort(),['alarms','notifications','offscreen','storage']);

for(const file of ['manifest.json','background.js','workspace.js','calendar.js','translation.js','panel.html','alarm.html','privacy.html','offscreen.html','offscreen.js','ui.js','ui.css','icon.png','content.js','parser.js','core.js']) {
  assert.ok(existsSync(`${root}/${file}`),`缺少文件：${file}`);
}
for(const file of readdirSync(root).filter(file=>file.endsWith('.js'))) {
  const result=spawnSync(process.execPath,['--check',`${root}/${file}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
for(const file of ['scripts/cloud-monitor.mjs','scripts/cloud-monitor-lib.mjs']) {
  assert.ok(existsSync(file),`缺少文件：${file}`);
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
for(const file of ['.github/workflows/cloud-monitor.yml','docs/CLOUD_MONITOR.md','monitor-data/state.json','monitor-data/archive.jsonl','tests/fixtures/cloud-timeline.json'])assert.ok(existsSync(file),`缺少文件：${file}`);
const cloudWorkflow=readFileSync('.github/workflows/cloud-monitor.yml','utf8');
assert.ok(cloudWorkflow.includes('cron: "3/5 * * * *"'),'云端监控必须配置 5 分钟计划任务');
assert.ok(cloudWorkflow.includes("vars.ENABLE_CLOUD_MONITOR == 'true'"),'真实计划任务必须受显式变量控制');
assert.ok(cloudWorkflow.includes('X_BEARER_TOKEN: ${{ secrets.X_BEARER_TOKEN }}'),'X Token 必须来自 GitHub Secret');
for(const file of readdirSync(root).filter(file=>file.endsWith('.html'))) {
  const html=readFileSync(`${root}/${file}`,'utf8');
  assert.ok(!/\son\w+\s*=/i.test(html),`${file} 不能包含内联事件脚本`);
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html),`${file} 不能引用远程脚本`);
}
const workspace=readFileSync(`${root}/workspace.js`,'utf8');
assert.ok(workspace.includes("state:'minimized'"),'监控窗口应默认最小化');
assert.ok(readFileSync(`${root}/panel.html`,'utf8').includes('id="resetCalendar"'),'缺少 RESET 日历');
assert.ok(readFileSync(`${root}/panel.html`,'utf8').includes('id="exportBackup"'),'缺少历史备份导出入口');
assert.ok(readFileSync(`${root}/panel.html`,'utf8').includes('id="importBackup"'),'缺少历史备份导入入口');
assert.ok(readFileSync(`${root}/background.js`,'utf8').includes("scanSource(key,before,started,trigger==='manual')"),'手动检查应强制继续未完成的月度回填');
assert.ok(readFileSync(`${root}/ui.js`,'utf8').includes("from './translation.js'")&&readFileSync(`${root}/ui.js`,'utf8').includes('appendChinese'),'待确认提醒应加载中文翻译');
assert.ok(workspace.includes('focused:false'),'监控窗口不应抢占焦点');
console.log('PASS: manifest、权限、公开版文件、脚本语法和远程脚本检查');
