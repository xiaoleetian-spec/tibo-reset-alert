import assert from 'node:assert/strict';
import test from 'node:test';
import {classify,ingest,initialState,severityFor} from '../extension/core.js';

const post={id:'2098685367058612394',author:'thsottiaux',text:'Reset all propagated. Sweet dreams.',publishedAt:'2026-09-12T08:09:17.852Z',url:'https://x.com/thsottiaux/status/2098685367058612394'};

test('known Sep 12 propagated reset is a completed critical alert',()=>{
  const match=classify(post);assert.equal(match.status,'completed');assert.equal(severityFor(match.status),'critical');assert.match(match.reason,/全部传播/);
  const state=initialState(Date.parse('2026-09-12T08:30:00Z')),alerts=ingest(state,[post],Date.parse('2026-09-12T08:30:00Z'),{alertRecentOnBaseline:true,baselineLookbackMs:86_400_000});
  assert.equal(alerts.length,1);assert.equal(alerts[0].severity,'critical');assert.equal(state.lastReset.id,post.id);assert.equal(state.calendarEvents[0].status,'completed');
});

test('future propagation wording is not treated as already completed',()=>{
  const future={...post,id:'2098685367058612395',url:'https://x.com/thsottiaux/status/2098685367058612395',text:'A reset will be propagated tomorrow.'};
  assert.equal(classify(future).status,'suspected');
});
