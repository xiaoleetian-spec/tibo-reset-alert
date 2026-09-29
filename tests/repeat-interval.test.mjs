import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeState,normalizeRepeatInterval,REPEAT_INTERVAL_OPTIONS,normalizeRepeatMax,REPEAT_MAX_OPTIONS,mayRepeat} from '../extension/core.js';

test('重复提醒间隔由用户设置，未设置时沿用 1 分钟',()=>{
  assert.deepEqual(REPEAT_INTERVAL_OPTIONS,[1,2,5,10,15,30,60]);
  assert.equal(initialState(0).repeatIntervalMinutes,1);
  assert.equal(normalizeState({}).repeatIntervalMinutes,1);
  assert.equal(normalizeState({repeatIntervalMinutes:5}).repeatIntervalMinutes,1,'0.4.1 自动写入的 5 分钟不应继续作为默认值');
  assert.equal(normalizeState({repeatIntervalMinutes:15,repeatIntervalUserSet:true}).repeatIntervalMinutes,15);
  assert.equal(normalizeRepeatInterval(3),1);
});

test('最长提醒时间默认不限，5/10/30 分钟从首次提醒起计算',()=>{
  assert.deepEqual(REPEAT_MAX_OPTIONS,[0,5,10,30]);
  assert.equal(initialState(0).repeatMaxMinutes,0);
  assert.equal(normalizeState({}).repeatMaxMinutes,0);
  assert.equal(normalizeState({repeatMaxMinutes:10}).repeatMaxMinutes,10);
  assert.equal(normalizeRepeatMax(7),0);
  const entry={createdAt:100_000};
  assert.equal(mayRepeat(entry,0,100_000+60*60_000),true,'不限时仍会重复提醒');
  assert.equal(mayRepeat(entry,5,100_000+5*60_000-1),true);
  assert.equal(mayRepeat(entry,5,100_000+5*60_000),false,'到达上限时停止新提醒');
  assert.equal(mayRepeat(entry,10,100_000+5*60_000),true,'更长的用户上限仍允许提醒');
  assert.equal(mayRepeat({...entry,firstRemindedAt:160_000},5,100_000+5*60_000),true,'新记录应从首次提醒而非识别时开始计时');
  assert.equal(normalizeState({pending:[{key:'old'}]},100_000).pending[0].createdAt,100_000,'旧记录缺少起始时间时只迁移一次');
});
