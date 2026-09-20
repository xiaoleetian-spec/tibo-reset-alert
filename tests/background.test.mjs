import test from 'node:test';
import assert from 'node:assert/strict';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){for(const fn of this.listeners)fn(...args);}});
const post=(id,text,publishedAt='2026-09-08T06:00:00.000Z',context='')=>({
  id:String(id),author:'thsottiaux',text,publishedAt,context,
  url:`https://x.com/thsottiaux/status/${id}`
});

test('公开后台行为门槛：双来源、去重、强提醒、部分成功、退避、确认与空采集',async t=>{
  const RealDate=globalThis.Date,fixedNow=RealDate.parse('2026-09-08T07:00:00.000Z');
  class FrozenDate extends RealDate {
    constructor(...args){super(...(args.length?args:[fixedNow]));}
    static now(){return fixedNow;}
  }
  globalThis.Date=FrozenDate;
  t.after(()=>{globalThis.Date=RealDate;delete globalThis.chrome;});

  let state,nextTab=40,nextWindow=8;
  const planned=post(100,'We will reset Codex limits tomorrow.');
  const contextual=post(105,'Tomorrow!','2026-09-08T06:05:00.000Z','Will you reset Codex limits?');
  const payloads={posts:[planned,contextual],replies:[planned,contextual]};
  const failures={posts:null,replies:null},sourceCalls={posts:0,replies:0};
  const tabs=new Map(),windowIds=new Set(),windowCreates=[],notifications=[],audio=[],alarms=new Map();
  const onMessage=event(),onAlarm=event(),onRemoved=event();

  const chrome={
    storage:{local:{get:async()=>({state:structuredClone(state)}),set:async data=>{state=structuredClone(data.state);}}},
    runtime:{
      id:'public-test-extension',getURL:path=>`chrome-extension://public-test-extension/${path}`,
      getManifest:()=>({version:'0.3.8'}),getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
      onMessage,onInstalled:event(),onStartup:event(),
      sendMessage:async message=>{audio.push(message);return {ok:true};}
    },
    alarms:{get:async name=>alarms.get(name),create:async(name,value)=>alarms.set(name,value),onAlarm},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{
      create:async options=>{const tab={id:++nextTab,url:options.url,windowId:options.windowId};tabs.set(tab.id,tab);return tab;},
      get:async id=>{if(!tabs.has(id))throw new Error('missing tab');return tabs.get(id);},
      reload:async()=>{},move:async(id,options)=>{const tab=tabs.get(id);tab.windowId=options.windowId;return tab;},
      query:async({windowId})=>[...tabs.values()].filter(tab=>tab.windowId===windowId),
      update:async(id,options)=>{const tab={...(tabs.get(id)||{id}),...options};tabs.set(id,tab);return tab;},
      sendMessage:async(id,message)=>{
        sourceCalls[message.source]++;
        if(failures[message.source])return {ok:false,error:failures[message.source]};
        const posts=structuredClone(payloads[message.source]);
        return {ok:true,posts,reachedBoundary:true,reachedSince:true,earliestObservedAt:posts.length?Math.min(...posts.map(item=>Date.parse(item.publishedAt))):null};
      }
    },
    windows:{
      get:async id=>{if(!windowIds.has(id))throw new Error('missing window');return {id};},
      create:async options=>{
        const id=nextWindow++;windowIds.add(id);windowCreates.push(options);
        if(Array.isArray(options.url)){
          const created=options.url.map(url=>{const tab={id:++nextTab,url,windowId:id};tabs.set(tab.id,tab);return tab;});
          return {id,tabs:created};
        }
        return {id};
      },
      update:async(id,options)=>({id,...options}),onRemoved
    },
    notifications:{
      getPermissionLevel:async()=>'granted',clear:async()=>true,
      create:async(id,options)=>{notifications.push({id,...options});},
      onClicked:event(),onButtonClicked:event()
    },
    offscreen:{createDocument:async()=>{}}
  };

  globalThis.chrome=chrome;
  await import('../extension/background.js?public-p0-gate');
  for(let i=0;i<100&&alarms.size<2;i++)await sleep(10);
  assert.equal(alarms.size,2,'后台必须创建检查和重复提醒两个定时器');
  const ui=(type,extra={})=>new Promise(resolve=>{
    const handled=onMessage.listeners[0]({type,...extra},{id:chrome.runtime.id,url:chrome.runtime.getURL('panel.html')},resolve);
    assert.equal(handled,true);
  });

  let result=await ui('check');
  assert.equal(result.ok,true);assert.equal(result.partial,false);
  assert.equal(sourceCalls.posts,1);assert.equal(sourceCalls.replies,1);
  assert.equal(state.pending.length,2);assert.equal(new Set(state.pending.map(item=>item.id)).size,2,'跨来源不能重复提醒');
  assert.deepEqual(state.pending.map(item=>item.severity).sort(),['low','medium']);
  assert.equal(windowCreates.filter(options=>options.state==='minimized').length,1,'监控来源必须进入一个最小化窗口');

  await ui('ack',{key:'*'});assert.equal(state.pending.length,0);
  const completed=post(150,'All reset for everyone. Enjoy the week with Astra.','2026-09-08T06:30:00.000Z');
  payloads.posts=[completed];payloads.replies=[completed];
  const notificationCount=notifications.length,audioCount=audio.length,popupCount=windowCreates.filter(options=>options.type==='popup').length;
  result=await ui('check');
  assert.equal(result.ok,true);assert.equal(state.pending.length,1);assert.equal(state.pending[0].severity,'critical');
  assert.equal(notifications.length,notificationCount+1);assert.equal(audio.length,audioCount+1);
  assert.equal(windowCreates.filter(options=>options.type==='popup').length,popupCount+1);

  await ui('ack',{key:'*'});const afterAck=notifications.length;
  onAlarm.fire({name:'repeat'});await sleep(30);assert.equal(notifications.length,afterAck,'确认后不得重复提醒');

  const next=post(200,'We will reset Codex limits tomorrow.','2026-09-08T06:40:00.000Z');
  payloads.posts=[next];payloads.replies=[next];failures.replies='X rate limit 429';
  result=await ui('check');
  assert.equal(result.ok,true);assert.equal(result.partial,true);
  assert.ok(state.sources.replies.backoffUntil>Date.now());assert.equal(state.sources.replies.errorCode,'RATE_LIMITED');

  await ui('ack',{key:'*'});failures.replies=null;state.sources.replies.backoffUntil=null;
  payloads.posts=[];payloads.replies=[];
  result=await ui('check');
  assert.equal(result.ok,false,'双来源空采集必须判为失败');
  assert.ok(result.sources.every(source=>source.status==='failed'&&source.code==='EMPTY_TIMELINE'));
});

