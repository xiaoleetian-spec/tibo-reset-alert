import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeState,normalizeRepeatInterval,REPEAT_INTERVAL_OPTIONS} from '../extension/core.js';

test('重复提醒间隔由用户设置，未设置时沿用 1 分钟',()=>{
  assert.deepEqual(REPEAT_INTERVAL_OPTIONS,[1,2,5,10,15,30,60]);
  assert.equal(initialState(0).repeatIntervalMinutes,1);
  assert.equal(normalizeState({}).repeatIntervalMinutes,1);
  assert.equal(normalizeState({repeatIntervalMinutes:5}).repeatIntervalMinutes,1,'0.4.1 自动写入的 5 分钟不应继续作为默认值');
  assert.equal(normalizeState({repeatIntervalMinutes:15,repeatIntervalUserSet:true}).repeatIntervalMinutes,15);
  assert.equal(normalizeRepeatInterval(3),1);
});
