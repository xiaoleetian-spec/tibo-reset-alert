import assert from 'node:assert/strict';
import test from 'node:test';
import {classify,ingest,initialState,severityFor} from '../extension/core.js';

const post={id:'2098685367058612394',author:'thsottiaux',text:'Reset all propagated. Sweet dreams.',publishedAt:'2026-09-12T08:09:17.852Z',url:'https://x.com/thsottiaux/status/2098685367058612394'};
const promised={id:'2102254445082116335',author:'thsottiaux',text:'Ladies and gentlemen... start... your... ENGINES. We are almost Tuesday and I promised a reset for Tuesday. Among some other things. See you soon.',publishedAt:'2026-09-22T04:31:32.000Z',url:'https://x.com/thsottiaux/status/2102254445082116335'};

test('known Sep 12 propagated reset is a completed critical alert',()=>{
  const match=classify(post);assert.equal(match.status,'completed');assert.equal(severityFor(match.status),'critical');assert.match(match.reason,/全部传播/);
  const state=initialState(Date.parse('2026-09-12T08:30:00Z')),alerts=ingest(state,[post],Date.parse('2026-09-12T08:30:00Z'),{alertRecentOnBaseline:true,baselineLookbackMs:86_400_000});
  assert.equal(alerts.length,1);assert.equal(alerts[0].severity,'critical');assert.equal(state.lastReset.id,post.id);assert.equal(state.calendarEvents[0].status,'completed');
});

test('future propagation wording is not treated as already completed',()=>{
  const future={...post,id:'2098685367058612395',url:'https://x.com/thsottiaux/status/2098685367058612395',text:'A reset will be propagated tomorrow.'};
  assert.equal(classify(future).status,'planned');
});

test('known Sep 22 promised reset is a planned medium alert without repeating Codex',()=>{
  const match=classify(promised);assert.equal(match.status,'planned');assert.equal(severityFor(match.status),'medium');assert.match(match.reason,/未来安排/);
  const state=initialState(Date.parse('2026-09-22T05:00:00Z')),alerts=ingest(state,[promised],Date.parse('2026-09-22T05:00:00Z'),{alertRecentOnBaseline:true,baselineLookbackMs:86_400_000});
  assert.equal(alerts.length,1);assert.equal(alerts[0].severity,'medium');assert.equal(state.lastReset,null);
});

test('unrelated scheduled resets stay excluded',()=>{
  assert.equal(classify({...promised,id:'2102254445082116336',url:'https://x.com/thsottiaux/status/2102254445082116336',text:'A password reset is scheduled for Tuesday.'}),null);
  assert.equal(classify({...promised,id:'2102254445082116337',url:'https://x.com/thsottiaux/status/2102254445082116337',text:'The database reset will happen tomorrow.'}),null);
});
