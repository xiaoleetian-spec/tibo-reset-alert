import assert from 'node:assert/strict';
import test from 'node:test';
import {initialSourceState,shouldBackfillSource} from '../extension/core.js';

test('manual checks continue an incomplete monthly backfill before the automatic retry time',()=>{
  const now=Date.parse('2026-09-11T04:00:00Z'),source={...initialSourceState(),calendarMonth:'2026-09',calendarReachedStart:false,calendarBackfillNextAt:now+1_800_000};
  assert.equal(shouldBackfillSource(source,'2026-09',now,false),false);
  assert.equal(shouldBackfillSource(source,'2026-09',now,true),true);
  source.calendarReachedStart=true;
  assert.equal(shouldBackfillSource(source,'2026-09',now,true),false);
});

test('a new month starts backfill even before an old retry deadline',()=>{
  const now=Date.parse('2026-10-01T04:00:00Z'),source={...initialSourceState(),calendarMonth:'2026-09',calendarReachedStart:true,calendarBackfillNextAt:now+1_800_000};
  assert.equal(shouldBackfillSource(source,'2026-10',now,false),true);
});
