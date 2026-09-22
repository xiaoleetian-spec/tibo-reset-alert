import assert from 'node:assert/strict';
import test from 'node:test';
import {createGitHubIssueNotifier,fetchXTimeline,initialCloudState,issuePayload,requestJson,runCloudMonitor,timelineFromFixture} from '../scripts/cloud-monitor-lib.mjs';
import {readFile} from 'node:fs/promises';

const fixture=JSON.parse(await readFile(new URL('./fixtures/cloud-timeline.json',import.meta.url),'utf8'));

test('fixture run archives every post but alerts only the real RESET promise',async()=>{
  const timeline=timelineFromFixture(fixture),notified=[];
  const result=await runCloudMonitor({state:initialCloudState(),timeline,notify:async alert=>notified.push(alert),now:Date.parse('2026-09-22T05:00:00Z')});
  assert.equal(result.fetched,2);assert.equal(result.archiveRecords.length,2);assert.equal(result.alerts.length,1);assert.equal(notified.length,1);
  assert.equal(notified[0].id,'2102254445082116335');assert.equal(notified[0].status,'planned');assert.equal(notified[0].severity,'medium');
  assert.equal(result.state.lastSeenId,'2102254445082116336');assert.deepEqual(result.state.processedAlertIds,['2102254445082116335']);
});

test('rerun is idempotent for archive and notification',async()=>{
  const first=await runCloudMonitor({state:initialCloudState(),timeline:timelineFromFixture(fixture),now:Date.parse('2026-09-22T05:00:00Z')});let calls=0;
  const second=await runCloudMonitor({state:first.state,timeline:timelineFromFixture(fixture),notify:async()=>{calls++;},now:Date.parse('2026-09-22T05:05:00Z')});
  assert.equal(calls,0);assert.equal(second.archiveRecords.length,0);assert.equal(second.alerts.length,0);assert.equal(second.changed,false);
});

test('heartbeat changes persistent state at most once per 30 days',async()=>{
  const first=await runCloudMonitor({state:initialCloudState(),timeline:{userId:'1953337039510003712',posts:[]},now:Date.parse('2026-09-01T00:00:00Z')});
  const early=await runCloudMonitor({state:first.state,timeline:{userId:'1953337039510003712',posts:[]},now:Date.parse('2026-09-20T00:00:00Z')});
  const due=await runCloudMonitor({state:early.state,timeline:{userId:'1953337039510003712',posts:[]},now:Date.parse('2026-10-02T00:00:00Z')});
  assert.equal(early.changed,false);assert.equal(due.changed,true);assert.equal(due.state.lastHeartbeatAt,'2026-10-02T00:00:00.000Z');
});

test('notification failure does not mutate the caller state or advance its cursor',async()=>{
  const state=initialCloudState();
  await assert.rejects(()=>runCloudMonitor({state,timeline:timelineFromFixture(fixture),notify:async()=>{throw new Error('forced issue failure');}}),/forced issue failure/);
  assert.equal(state.lastSeenId,null);assert.deepEqual(state.processedAlertIds,[]);
});

test('X API reader resolves user, follows pagination and uses since_id',async()=>{
  const urls=[];let timelineCall=0;
  const fetchImpl=async url=>{
    urls.push(String(url));
    if(String(url).includes('/users/by/username/'))return new Response(JSON.stringify({data:{id:'1953337039510003712'}}),{status:200});
    timelineCall++;
    if(timelineCall===1)return new Response(JSON.stringify({data:[{id:'2102254445082116335',text:'I promised a reset for Tuesday.',created_at:'2026-09-22T04:31:32.000Z'}],meta:{next_token:'next-page'}}),{status:200});
    return new Response(JSON.stringify({data:[{id:'2102254445082116336',text:'Ordinary update.',created_at:'2026-09-22T04:32:32.000Z'}],meta:{}}),{status:200});
  };
  const state={...initialCloudState(),lastSeenId:'2102254445082116300'},result=await fetchXTimeline({token:'test-token',state,fetchImpl,sleep:async()=>{}});
  assert.equal(result.pages,2);assert.equal(result.posts.length,2);assert.match(urls[1],/since_id=2102254445082116300/);assert.match(urls[2],/pagination_token=next-page/);
});

test('X API request retries a rate limit response',async()=>{
  let calls=0,sleeps=0;
  const fetchImpl=async()=>++calls===1?new Response('rate limited',{status:429,headers:{'retry-after':'0'}}):new Response(JSON.stringify({ok:true}),{status:200});
  const value=await requestJson('https://api.x.com/test',{token:'token',fetchImpl,sleep:async()=>{sleeps++;}});
  assert.deepEqual(value,{ok:true});assert.equal(calls,2);assert.equal(sleeps,1);
});

test('GitHub Issue notifier detects its marker before creating a duplicate',async()=>{
  const alert={id:'2102254445082116335',label:'重置预告',severity:'medium',text:'I promised a reset for Tuesday.',publishedAt:'2026-09-22T04:31:32.000Z',reason:'未来安排',source:'posts',url:'https://x.com/thsottiaux/status/2102254445082116335'},payload=issuePayload(alert);let posts=0;
  const fetchImpl=async(url,options={})=>{
    if(options.method==='POST'){posts++;return new Response(JSON.stringify({number:2,html_url:'https://github.test/issues/2'}),{status:201});}
    return new Response(JSON.stringify([{number:1,body:payload.marker}]),{status:200});
  };
  const notify=createGitHubIssueNotifier({token:'token',repository:'owner/repo',fetchImpl}),result=await notify(alert);
  assert.equal(result.created,false);assert.equal(result.number,1);assert.equal(posts,0);
});

test('Issue body renders untrusted post text as inert code without live mentions',()=>{
  const payload=issuePayload({id:'1',label:'重置预告',severity:'medium',text:'@someone ``` reset',publishedAt:'2026-09-22T00:00:00Z',reason:'未来安排',source:'posts',url:'https://x.com/thsottiaux/status/1'});
  assert.doesNotMatch(payload.body,/@someone/);assert.match(payload.body,/＠someone/);assert.match(payload.body,/```text/);
});

test('GitHub Issue notifier creates one issue when no marker exists',async()=>{
  const alert={id:'2102254445082116335',label:'重置预告',severity:'medium',text:'I promised a reset for Tuesday.',publishedAt:'2026-09-22T04:31:32.000Z',reason:'未来安排',source:'posts',url:'https://x.com/thsottiaux/status/2102254445082116335'};let submitted=null;
  const fetchImpl=async(url,options={})=>{
    if(options.method==='POST'){submitted=JSON.parse(options.body);return new Response(JSON.stringify({number:7,html_url:'https://github.test/issues/7'}),{status:201});}
    return new Response('[]',{status:200});
  };
  const result=await createGitHubIssueNotifier({token:'token',repository:'owner/repo',fetchImpl})(alert);
  assert.equal(result.created,true);assert.equal(result.number,7);assert.match(submitted.title,/重置预告/);assert.match(submitted.body,/tibo-reset-post:2102254445082116335/);
});
