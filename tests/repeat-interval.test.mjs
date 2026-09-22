import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeState,normalizeRepeatInterval,REPEAT_INTERVAL_OPTIONS} from '../extension/core.js';

test('重复提醒间隔默认 5 分钟并兼容旧状态',()=>{
  assert.deepEqual(REPEAT_INTERVAL_OPTIONS,[1,5,10,15,30,60]);
  assert.equal(initialState(0).repeatIntervalMinutes,5);
  assert.equal(normalizeState({}).repeatIntervalMinutes,5);
  assert.equal(normalizeState({repeatIntervalMinutes:15}).repeatIntervalMinutes,15);
  assert.equal(normalizeRepeatInterval(3),5);
});
