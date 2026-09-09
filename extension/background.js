import {
  initialState,normalizeState,SOURCE_DEFS,ingest,recordFailure,recordSuccess,acknowledge,
  INTERVAL_MS,recordSourceFailure,recordSourceSuccess,sourceIsReady,appendCheckLog,
  classifySourceError,ERROR_CODES,PARSER_VERSION,summarizeChecks
} from './core.js';

const SOURCE_KEYS=Object.keys(SOURCE_DEFS),LOOKBACK_MS=86_400_000;
const appVersion=()=>chrome.runtime.getManifest?.().version||'unknown';
const runId=started=>`${started}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}}
let mutations=Promise.resolve(),activeScan=null,creatingOffscreen=null;
const read=async()=>normalizeState((await chrome.storage.local.get('state')).state||initialState());
function mutate(fn){const task=mutations.then(async()=>{const s=await read();const result=await fn(s);await chrome.storage.local.set({state:s});return result;});mutations=task.catch(()=>{});return task;}

async function schedule(){if(!await chrome.alarms.get('check'))await chrome.alarms.create('check',{periodInMinutes:2});if(!await chrome.alarms.get('repeat'))await chrome.alarms.create('repeat',{periodInMinutes:1});}
const sourceHasIssue=(source,now=Date.now())=>!!(source.error||(source.backoffUntil&&source.backoffUntil>now));
async function badge(){const s=await read(),partial=SOURCE_KEYS.some(key=>sourceHasIssue(s.sources[key]));const text=s.paused?'停':s.health.failures?'!':s.pending.length?String(s.pending.length):partial?'半':s.initialized?'✓':'…';const color=s.health.failures?'#be3444':s.pending.length?'#b45f08':partial?'#ad6b24':'#216a64';await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color});}
async function monitorTab(key){
  const def=SOURCE_DEFS[key];if(!def)throw new Error('未知监控来源');
  const s=await read(),id=s.sourceTabs[key];
  if(id!==null){try{let tab=await chrome.tabs.get(id);if((tab.url||'').replace(/\/$/,'')!==def.url)tab=await chrome.tabs.update(id,{url:def.url,active:false});return tab;}catch{}}
  const tab=await chrome.tabs.create({url:def.url,active:false});await mutate(s=>{s.sourceTabs[key]=tab.id;if(key==='posts')s.monitorTabId=tab.id;});return tab;
}
async function ensureAudio(){const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});if(contexts.length)return;if(!creatingOffscreen)creatingOffscreen=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'为用户请求的 RESET 强提醒播放短提示音'}).finally(()=>creatingOffscreen=null);await creatingOffscreen;}
async function playSound(){await ensureAudio();const r=await bounded(chrome.runtime.sendMessage({type:'play-audio',target:'offscreen'}),5000,'提示音启动超时，请检查浏览器声音设置');if(!r?.ok)throw new Error(r?.error||'音频页面无响应');}
async function showWindow(){const s=await read();if(s.alertWindowId!==null){try{await chrome.windows.get(s.alertWindowId);return;}catch{}}const w=await chrome.windows.create({url:chrome.runtime.getURL('alarm.html'),type:'popup',width:520,height:650,focused:true});await mutate(s=>{s.alertWindowId=w.id;});}
async function notify(entry,{repeat=false}={}){
  const s=await read();if(s.paused)return;const severity=entry.test||entry.kind==='fault'?'critical':entry.kind==='recovery'?'medium':entry.severity||'critical';
  const errors={notification:null,audio:null,window:null},id=entry.kind==='recovery'?'tibo-recovery':'tibo-alert';
  if(severity!=='low'){
    try{const permission=await chrome.notifications.getPermissionLevel();if(permission!=='granted')throw new Error('浏览器通知权限未启用');await chrome.notifications.clear(id);await chrome.notifications.create(id,{type:'basic',iconUrl:'icon.png',title:`${entry.test?'【测试】':''}${entry.label}`,message:entry.text.slice(0,220),requireInteraction:severity==='critical',silent:true,buttons:entry.kind==='recovery'?[]:[{title:'查看提醒'},{title:'全部已知晓'}]});}catch(e){errors.notification=e.message;}
  }
  if(severity==='critical'){try{await showWindow();}catch(e){errors.window=e.message;}if(!s.muted){try{await playSound();}catch(e){errors.audio=e.message;}}}
  const finished=Date.now();await mutate(s=>{s.delivery={...errors,lastAttempt:finished,repeat,muted:s.muted,severity,entryKey:entry.key};s.deliveryLog.unshift({id:`delivery:${finished}:${entry.key}`,entryKey:entry.key,severity,repeat,attemptedAt:finished,panelOnly:severity==='low',success:severity==='low'||Object.values(errors).every(x=>!x),errors});s.deliveryLog=s.deliveryLog.slice(0,100);});await badge();
}

async function scanSource(key,before,started){
  const source=before.sources[key];
  if(!sourceIsReady(before,key,started))return {key,status:'backoff',backoffUntil:source.backoffUntil,error:source.error,code:source.errorCode,retryable:source.retryable,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:0,count:0};
  const began=Date.now();
  try{
    const tab=await monitorTab(key);await chrome.tabs.reload(tab.id);let result,lastError;
    for(let i=0;i<49;i++){try{result=await bounded(chrome.tabs.sendMessage(tab.id,{type:'scan',source:key,boundary:source.initialized?source.boundaryId:null}),25_000,`${SOURCE_DEFS[key].label}页面扫描超时`);break;}catch(e){lastError=e;if(/扫描超时/.test(e.message))throw e;if(i<48)await delay(250);}}
    if(!result){const e=new Error(`${SOURCE_DEFS[key].label}监控页无法连接：${lastError?.message||'页面脚本未响应'}`);e.code=ERROR_CODES.NETWORK_BLOCKED;throw e;}
    if(!result.ok){const e=new Error(result.error||`${SOURCE_DEFS[key].label}页面没有返回可验证结果`);e.code=result.code;throw e;}
    if(!Array.isArray(result.posts)||!result.posts.length){const e=new Error(`${SOURCE_DEFS[key].label}页面没有返回可验证帖文`);e.code=ERROR_CODES.EMPTY_TIMELINE;throw e;}
    return {key,status:'success',posts:result.posts.map(p=>({...p,source:key})),count:result.posts.length,reachedBoundary:!!result.reachedBoundary,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:Date.now()-began};
  }catch(e){const info=classifySourceError(e.message,e.code);return {key,status:'failed',error:e.message,code:info.code,retryable:info.retryable,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:Date.now()-began,count:0};}
}
function sourceSummary(result,state){const label=SOURCE_DEFS[result.key].label;if(result.status==='success')return `${label}正常（${result.count} 条）${result.reachedBoundary?'':'，未抵达上次边界'}`;if(result.status==='backoff')return `${label}退避至 ${new Date(result.backoffUntil).toLocaleString('zh-CN',{hour12:false})}`;const source=state.sources[result.key],code=source.errorCode?`[${source.errorCode}] `:'';return source.backoffUntil?`${label}异常 ${code}退避至 ${new Date(source.backoffUntil).toLocaleString('zh-CN',{hour12:false})}`:`${label}异常：${code}${result.error}`;}
async function check(trigger='manual'){if(activeScan)return activeScan;activeScan=scan(trigger).finally(()=>activeScan=null);return activeScan;}
async function scan(trigger){
  const before=await read();if(before.paused)return {paused:true};const started=Date.now(),currentRunId=runId(started);await mutate(s=>{s.metrics.attempts++;s.health.lastAttempt=started;s.checkingSince=started;s.checkingRunId=currentRunId;});
  let finalResults=[];
  try{
    const results=await Promise.all(SOURCE_KEYS.map(key=>scanSource(key,before,started)));let alerts=[];
    const summary=await mutate(s=>{
      if(s.paused)return {paused:true,alerts:[],results};const working=[],failed=[],backoff=[];
      for(const result of results){
        if(result.status==='success'){
          const firstForSource=!s.sources[result.key].initialized;
          try{recordSourceSuccess(s,result.key,result,Date.now());result.boundaryAfter=s.sources[result.key].boundaryId;alerts.push(...ingest(s,result.posts,Date.now(),{alertRecentOnBaseline:true,allowOlderUnseen:firstForSource&&s.initialized,baselineLookbackMs:LOOKBACK_MS}));working.push(result);}
          catch(e){const info=classifySourceError(e.message);result.status='failed';result.error=e.message;result.code=info.code;result.retryable=info.retryable;result.count=0;recordSourceFailure(s,result.key,e.message,Date.now(),info);failed.push(result);}
        }else if(result.status==='failed'){recordSourceFailure(s,result.key,result.error,Date.now(),{code:result.code,retryable:result.retryable});failed.push(result);}else backoff.push(result);
      }
      const finishedAt=Date.now(),effective=[...working,...failed,...backoff],coverage=effective.map(r=>sourceSummary(r,s)).join('；');let outcome;
      if(working.length){outcome=failed.length||backoff.length?'partial':'success';const gap=s.health.lastSuccess&&started-s.health.lastSuccess>INTERVAL_MS*2.5;alerts.push(...recordSuccess(s,finishedAt,coverage+(gap?'；离线期间已删除或不可见的内容仍可能漏报':'')));s.metrics.successes++;}
      else if(failed.length){outcome='failed';alerts.push(...recordFailure(s,failed.map(r=>`${SOURCE_DEFS[r.key].label}：${r.error}`).join('；'),finishedAt));s.health.coverage=coverage;}
      else{outcome='backoff';s.health.coverage=coverage;s.health.lastAttempt=finishedAt;}
      const uniqueCount=new Set(working.flatMap(r=>r.posts.map(p=>p.id))).size;
      const sourceRecords=Object.fromEntries(effective.map(r=>[r.key,{status:r.status,count:r.count,durationMs:r.durationMs,error:r.error||null,errorCode:r.code||s.sources[r.key].errorCode||null,retryable:r.retryable??s.sources[r.key].retryable,boundaryBefore:r.boundaryBefore||'0',boundaryAfter:r.boundaryAfter||s.sources[r.key].boundaryId||'0',reachedBoundary:!!r.reachedBoundary,backoffUntil:s.sources[r.key].backoffUntil,backoffReason:s.sources[r.key].backoffReason}]));
      s.lastScan={runId:currentRunId,appVersion:appVersion(),parserVersion:PARSER_VERSION,trigger,startedAt:started,finishedAt,count:uniqueCount,reachedBoundary:working.every(r=>r.reachedBoundary),sources:sourceRecords};
      appendCheckLog(s,{id:currentRunId,runId:currentRunId,appVersion:appVersion(),parserVersion:PARSER_VERSION,trigger,startedAt:started,finishedAt,outcome,alerts:alerts.filter(a=>a.kind==='reset').length,sources:sourceRecords});finalResults=effective;
      return {paused:false,alerts,working,failed,backoff,outcome,count:uniqueCount,coverage};
    });
    if(summary.paused)return {paused:true};for(const a of summary.alerts)await notify(a);
    if(summary.working.length)return {ok:true,partial:summary.outcome==='partial',count:summary.count,sources:finalResults};
    return {ok:false,backoff:summary.outcome==='backoff',error:summary.coverage,sources:finalResults};
  }finally{await mutate(s=>{if(s.checkingRunId===currentRunId){s.checkingSince=null;s.checkingRunId=null;}});await badge();}
}
async function repeat(){const s=await read();if(s.paused)return;const entry=[...s.pending].reverse().find(x=>x.test||x.kind==='fault'||!x.severity||x.severity==='critical');if(entry)await notify(entry,{repeat:true});await badge();}
async function init(){
  let alerts=[];await mutate(s=>{const currentVersion=appVersion();if(currentVersion&&s.appVersion!==currentVersion){s.appVersion=currentVersion;s.checkingSince=null;s.checkingRunId=null;s.health={...s.health,failures:0,error:null,coverage:null};}if(s.checkingSince&&Date.now()-s.checkingSince>90_000){s.checkingSince=null;s.checkingRunId=null;if(!s.paused)alerts=recordFailure(s,'上次读取被中断，尚未取得完整结果');}});
  await schedule();await badge();for(const alert of alerts)await notify(alert);
}
chrome.runtime.onInstalled.addListener(()=>{init().then(()=>check('install')).catch(console.error);});
chrome.runtime.onStartup.addListener(()=>{init().then(()=>check('startup')).catch(console.error);});
chrome.alarms.onAlarm.addListener(alarm=>{(alarm.name==='check'?check('alarm'):alarm.name==='repeat'?repeat():Promise.resolve()).catch(console.error);});
chrome.windows.onRemoved.addListener(id=>{mutate(s=>{if(s.alertWindowId===id)s.alertWindowId=null;}).catch(console.error);});
chrome.notifications.onClicked.addListener(()=>{showWindow().catch(console.error);});
chrome.notifications.onButtonClicked.addListener((id,index)=>{if(index===1)ack('*').catch(console.error);else showWindow().catch(console.error);});
async function ack(key){await mutate(s=>acknowledge(s,key));if(!(await read()).pending.length)await chrome.notifications.clear('tibo-alert');await badge();}
async function testAlert(){const isolated=initialState();isolated.initialized=true;const id=String(Date.now()),post={id,author:'thsottiaux',text:'【测试数据，不是真实推文】We have just reset Codex usage limits.',publishedAt:new Date().toISOString(),url:`https://x.com/thsottiaux/status/${id}`};const alert=ingest(isolated,[post])[0];alert.test=true;alert.severity='critical';alert.key=`test:${id}`;alert.url=null;await mutate(s=>{s.pending.push(alert);s.history.unshift(alert);s.history=s.history.slice(0,300);});await notify(alert);return {ok:true};}

async function recordFeedback(message){
  const now=Date.now();let saved;
  await mutate(s=>{
    if(message.kind==='false_positive'){
      const entry=s.history.find(x=>x.key===message.key);if(!entry||entry.kind!=='reset')throw new Error('找不到要标记的提醒');
      saved=s.feedback.find(x=>x.kind==='false_positive'&&x.postId===entry.id)||{id:`feedback:false_positive:${entry.id}`,kind:'false_positive',postId:entry.id,url:entry.url||null,text:entry.text,label:entry.label,status:entry.status,source:entry.source||null,parserVersion:PARSER_VERSION,appVersion:appVersion(),createdAt:now};acknowledge(s,message.key,now);
    }else if(message.kind==='missed'){
      const match=/^https:\/\/x\.com\/thsottiaux\/status\/(\d+)$/.exec(String(message.url||'').trim());if(!match)throw new Error('请输入 Tibo 帖子的完整 X 原文链接');
      saved=s.feedback.find(x=>x.kind==='missed'&&x.postId===match[1])||{id:`feedback:missed:${match[1]}`,kind:'missed',postId:match[1],url:String(message.url).trim(),expected:'should_alert',parserVersion:PARSER_VERSION,appVersion:appVersion(),createdAt:now};
    }else throw new Error('未知反馈类型');
    if(!s.feedback.some(x=>x.id===saved.id))s.feedback.unshift(saved);s.feedback=s.feedback.slice(0,200);
  });
  if(message.kind==='false_positive'&&!(await read()).pending.length)await chrome.notifications.clear('tibo-alert');await badge();return {ok:true,feedback:saved};
}
async function diagnostics(){const s=await read(),now=Date.now();return {ok:true,data:{schemaVersion:1,generatedAt:new Date(now).toISOString(),appVersion:appVersion(),parserVersion:PARSER_VERSION,health:s.health,sources:s.sources,lastReset:s.lastReset,metrics:s.metrics,metrics24h:summarizeChecks(s.checkStats,now),lastScan:s.lastScan||null,checkLog:s.checkLog,deliveryLog:s.deliveryLog,feedback:s.feedback}};}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message.target==='offscreen')return false;const allowed=['panel.html','alarm.html'].map(p=>chrome.runtime.getURL(p));if(sender.id!==chrome.runtime.id||!allowed.includes(sender.url?.split('?')[0]))return false;
  const run=async()=>{switch(message.type){case 'state':return {ok:true,state:await read()};case 'check':return check('manual');case 'ack':await ack(message.key);return {ok:true};case 'pause':await mutate(s=>{s.paused=!!message.value;});await badge();if(!message.value)check('resume').catch(console.error);return {ok:true};case 'mute':await mutate(s=>{s.muted=!!message.value;});return {ok:true};case 'test':return testAlert();case 'feedback':return recordFeedback(message);case 'diagnostics':return diagnostics();case 'source':{const key=SOURCE_DEFS[message.key]?message.key:'posts',tab=await monitorTab(key);await chrome.tabs.update(tab.id,{active:true});return {ok:true};}case 'sourceAll':{const tabs=[];for(const key of SOURCE_KEYS)tabs.push(await monitorTab(key));if(tabs[0]?.id!==undefined)await chrome.tabs.update(tabs[0].id,{active:true});return {ok:true};}default:throw new Error('未知操作');}};
  run().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;
});
init().catch(console.error);
