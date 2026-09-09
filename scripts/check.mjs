import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root='extension';
const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,'0.3.0');
assert.deepEqual(manifest.host_permissions,['https://x.com/*']);
assert.deepEqual([...manifest.permissions].sort(),['alarms','notifications','offscreen','storage']);

for(const file of ['manifest.json','background.js','panel.html','alarm.html','privacy.html','offscreen.html','offscreen.js','ui.js','ui.css','icon.png','content.js','parser.js','core.js']) {
  assert.ok(existsSync(`${root}/${file}`),`缺少文件：${file}`);
}
for(const file of readdirSync(root).filter(file=>file.endsWith('.js'))) {
  const result=spawnSync(process.execPath,['--check',`${root}/${file}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
for(const file of readdirSync(root).filter(file=>file.endsWith('.html'))) {
  const html=readFileSync(`${root}/${file}`,'utf8');
  assert.ok(!/\son\w+\s*=/i.test(html),`${file} 不能包含内联事件脚本`);
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html),`${file} 不能引用远程脚本`);
}
console.log('PASS: manifest、权限、公开版文件、脚本语法和远程脚本检查');
