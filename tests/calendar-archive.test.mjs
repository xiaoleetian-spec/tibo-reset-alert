import assert from 'node:assert/strict';
import test from 'node:test';
import {ingest,initialState} from '../extension/core.js';

const post=(id,text,date)=>({id:String(id),author:'thsottiaux',text,publishedAt:date,url:`https://x.com/thsottiaux/status/${id}`,source:'posts'});

test('backfilled RESET matches are archived for the calendar without creating old alerts',()=>{
  const state=initialState(Date.parse('2026-09-11T00:00:00Z')),items=[post(10,'All reset for everyone. Enjoy Codex.','2026-09-04T04:00:00Z'),post(11,'We will reset Codex tomorrow.','2026-09-05T04:00:00Z')];
  ingest(state,items,Date.parse('2026-09-11T00:00:00Z'),{alertRecentOnBaseline:true,baselineLookbackMs:86_400_000});
  assert.equal(state.pending.length,0);assert.equal(state.calendarEvents.length,2);assert.deepEqual(state.calendarEvents.map(x=>x.id),['11','10']);assert.equal(state.lastReset.id,'10');
});
