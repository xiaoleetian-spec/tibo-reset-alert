import assert from 'node:assert/strict';
import test from 'node:test';
import {chineseHint,needsChineseTranslation,translateEntryText} from '../extension/translation.js';

test('only English reminder text is sent to the local translator',()=>{
  assert.equal(needsChineseTranslation('When I say excellent service, that includes the occasional reset.'),true);
  assert.equal(needsChineseTranslation('已为所有人完成额度重置。'),false);
  assert.equal(needsChineseTranslation('RESET'),false);
});

test('browser translator produces a Chinese line and releases its session',async()=>{
  let destroyed=false;const api={availability:async()=> 'available',create:async()=>({translate:async()=> '当我说为现有用户提供优质服务时，其中也包括偶尔的额度重置。',destroy(){destroyed=true;}})};
  const result=await translateEntryText({text:'When I say excellent service for existing users, that includes the occasional reset.',status:'suspected'},api);
  assert.deepEqual(result,{kind:'translation',text:'当我说为现有用户提供优质服务时，其中也包括偶尔的额度重置。'});assert.equal(destroyed,true);
});

test('Codex keeps its original spelling and case in Chinese translation',async()=>{
  const seen=[];
  const api={availability:async()=> 'available',create:async()=>({
    translate:async text=>{seen.push(text);return 'QXJZ0ZJXQ 的额度已重置，QXJZ1ZJXQ 也可使用。';},
    destroy(){}
  })};
  const result=await translateEntryText({text:'Codex usage was reset. You can use codex again.'},api);
  assert.deepEqual(result,{kind:'translation',text:'Codex 的额度已重置，codex 也可使用。'});
  assert.equal(seen.length,1);
  assert.doesNotMatch(seen[0],/\bcodex\b/i);
  assert.doesNotMatch(result.text,/法典/);
});

test('Codex stays unchanged even if the translator removes its placeholder',async()=>{
  const seen=[];
  const api={availability:async()=> 'available',create:async()=>({
    translate:async text=>{
      seen.push(text);
      if(text.includes('QXJZ0ZJXQ'))return '我们有一个备用法典来应对故障。';
      if(text.includes('spare'))return '我们有一个备用';
      return '来应对故障';
    },destroy(){}
  })};
  const result=await translateEntryText({text:'We have a special spare codex when things are down.'},api);
  assert.deepEqual(result,{kind:'translation',text:'我们有一个备用 codex 来应对故障'});
  assert.ok(seen.every(text=>!/\bcodex\b/i.test(text)));
  assert.doesNotMatch(result.text,/法典/);
});

test('unsupported browsers show a status-aware Chinese hint',async()=>{
  const entry={text:'All reset for everyone. Enjoy the week with Astra.',status:'completed'};
  assert.deepEqual(await translateEntryText(entry,null),{kind:'hint',text:'Tibo 表示 RESET 已经完成。'});
  assert.match(chineseHint({status:'suspected'}),/缺少足够上下文/);
});
