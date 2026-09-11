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

test('unsupported browsers show a status-aware Chinese hint',async()=>{
  const entry={text:'All reset for everyone. Enjoy the week with Astra.',status:'completed'};
  assert.deepEqual(await translateEntryText(entry,null),{kind:'hint',text:'Tibo 表示 RESET 已经完成。'});
  assert.match(chineseHint({status:'suspected'}),/缺少足够上下文/);
});
