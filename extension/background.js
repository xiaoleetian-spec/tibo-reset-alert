import {
  initialState,normalizeState,SOURCE_DEFS,ingest,recordFailure,recordSuccess,acknowledge,
  INTERVAL_MS,recordSourceFailure,recordSourceSuccess,sourceIsReady,appendCheckLog,
  classifySourceError,ERROR_CODES,PARSER_VERSION,summarizeChecks,validPost,shouldBackfillSource,
  normalizeRepeatInterval,REPEAT_INTERVAL_OPTIONS
} from './core.js';
import {provisionMonitorWorkspace,revealMonitorWorkspace} from './workspace.js';

const SOURCE_KEYS=Object.keys(SOURCE_DEFS),LOOKBACK_MS=86_400_000;
const appVersion=()=>chrome.runtime.getManifest?.().version||'unknown';
const runId=started=>`${started}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function calendarWindow(now=Date.now()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  return {month:`${p.year}-${p.month}`,since:Date.UTC(Number(p.year),Number(p.month)-1,1)-28_800_000};
}
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}}
let mutations=Promise.resolve(),activeScan=null,creatingOffscreen=null,creatingMonitorWorkspace=null;
const read=async()=>normalizeState((await chrome.storage.local.get('state')).state||initialState());
function mutate(fn){const task=mutations.then(async()=>{const s=await read();const result=await fn(s);await chrome.storage.local.set({state:s});return result;});mutations=task.catch(()=>{});return task;}

async function schedule(){
  if(!await chrome.alarms.get('check'))await chrome.alarms.create('check',{periodInMinutes:2});
  const minutes=(await read()).repeatIntervalMinutes,current=await chrome.alarms.get('repeat');
  if(!current||current.periodInMinutes!==minutes){if(current)await chrome.alarms.clear('repeat');await chrome.alarms.create('repeat',{periodInMinutes:minutes});}
}
const sourceHasIssue=(source,now=Date.now())=>!!(source.error||(source.backoffUntil&&source.backoffUntil>now));
async function badge(){const s=await read(),partial=SOURCE_KEYS.some(key=>sourceHasIssue(s.sources[key]));const text=s.paused?'停':s.health.failures?'!':s.pending.length?String(s.pending.length):partial?'半':s.initialized?'✓':'…';const color=s.health.failures?'#be3444':s.pending.length?'#b45f08':partial?'#ad6b24':'#216a64';await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color});}
async function ensureMonitorWorkspace(){
  if(!creatingMonitorWorkspace)creatingMonitorWorkspace=(async()=>{
    const snapshot=await read(),workspace=await provisionMonitorWorkspace(chrome,SOURCE_DEFS,snapshot);
    await mutate(s=>{s.monitorWindowId=workspace.windowId;s.sourceTabs={...workspace.tabs};s.monitorTabId=workspace.tabs.posts??null;});
    return workspace;
  })().finally(()=>creatingMonitorWorkspace=null);
  return creatingMonitorWorkspace;
}
async function monitorTab(key){
  const def=SOURCE_DEFS[key];if(!def)throw new Error('未知监控来源');
  const workspace=await ensureMonitorWorkspace(),id=workspace.tabs[key];
  let tab=await chrome.tabs.get(id);if((tab.url||'').replace(/\/$/,'')!==def.url)tab=await chrome.tabs.update(id,{url:def.url,active:false});return tab;
}
async function showMonitorWorkspace(key='posts'){const workspace=await ensureMonitorWorkspace();await revealMonitorWorkspace(chrome,workspace,key);return workspace;}
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

async function scanSource(key,before,started,forceBackfill=false){
  const source=before.sources[key];
  if(!sourceIsReady(before,key,started))return {key,status:'backoff',backoffUntil:source.backoffUntil,error:source.error,code:source.errorCode,retryable:source.retryable,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:0,count:0};
  const began=Date.now(),calendar=calendarWindow(started),needsBackfill=shouldBackfillSource(source,calendar.month,started,forceBackfill);
  try{
    const tab=await monitorTab(key);await chrome.tabs.reload(tab.id);let result,lastError;
    for(let i=0;i<49;i++){try{result=await bounded(chrome.tabs.sendMessage(tab.id,{type:'scan',source:key,boundary:source.initialized?source.boundaryId:null,...(needsBackfill?{since:calendar.since}:{})}),needsBackfill?55_000:25_000,`${SOURCE_DEFS[key].label}页面扫描超时`);break;}catch(e){lastError=e;if(/扫描超时/.test(e.message))throw e;if(i<48)await delay(250);}}
    if(!result){const e=new Error(`${SOURCE_DEFS[key].label}监控页无法连接：${lastError?.message||'页面脚本未响应'}`);e.code=ERROR_CODES.NETWORK_BLOCKED;throw e;}
    if(!result.ok){const e=new Error(result.error||`${SOURCE_DEFS[key].label}页面没有返回可验证结果`);e.code=result.code;throw e;}
    if(!Array.isArray(result.posts)||!result.posts.length){const e=new Error(`${SOURCE_DEFS[key].label}页面没有返回可验证帖文`);e.code=ERROR_CODES.EMPTY_TIMELINE;throw e;}
    return {key,status:'success',posts:result.posts.map(p=>({...p,source:key})),count:result.posts.length,reachedBoundary:!!result.reachedBoundary,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:Date.now()-began,...(needsBackfill?{backfillMonth:calendar.month,reachedSince:!!result.reachedSince,earliestObservedAt:result.earliestObservedAt||null}:{})};
  }catch(e){const info=classifySourceError(e.message,e.code);return {key,status:'failed',error:e.message,code:info.code,retryable:info.retryable,boundaryBefore:source.boundaryId,boundaryAfter:source.boundaryId,durationMs:Date.now()-began,count:0};}
}
function sourceSummary(result,state){const label=SOURCE_DEFS[result.key].label;if(result.status==='success')return `${label}正常（${result.count} 条）${result.reachedBoundary?'':'，未抵达上次边界'}`;if(result.status==='backoff')return `${label}退避至 ${new Date(result.backoffUntil).toLocaleString('zh-CN',{hour12:false})}`;const source=state.sources[result.key],code=source.errorCode?`[${source.errorCode}] `:'';return source.backoffUntil?`${label}异常 ${code}退避至 ${new Date(source.backoffUntil).toLocaleString('zh-CN',{hour12:false})}`:`${label}异常：${code}${result.error}`;}
async function check(trigger='manual'){if(activeScan)return activeScan;activeScan=scan(trigger).finally(()=>activeScan=null);return activeScan;}
async function scan(trigger){
  const before=await read();if(before.paused)return {paused:true};const started=Date.now(),currentRunId=runId(started);await mutate(s=>{s.metrics.attempts++;s.health.lastAttempt=started;s.checkingSince=started;s.checkingRunId=currentRunId;});
  let finalResults=[];
  try{
    const results=[];for(const key of SOURCE_KEYS){results.push(await scanSource(key,before,started,trigger==='manual'));if(key!==SOURCE_KEYS.at(-1))await delay(500);}let alerts=[];
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
chrome.windows.onRemoved.addListener(id=>{mutate(s=>{if(s.alertWindowId===id)s.alertWindowId=null;if(s.monitorWindowId===id){s.monitorWindowId=null;s.sourceTabs={posts:null,replies:null};s.monitorTabId=null;}}).catch(console.error);});
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
async function exportBackup(){const s=await read();return {ok:true,data:{schemaVersion:1,kind:'tibo-reset-history-backup',exportedAt:new Date().toISOString(),appVersion:appVersion(),baselineId:s.baselineId,seen:s.seen,history:s.history,recent:s.recent,calendarEvents:s.calendarEvents,lastReset:s.lastReset}};}
function validResetEntry(entry){return validPost(entry)&&String(entry.id).length<=30;}
async function importBackup(message){
  const backup=message.backup;if(!backup||backup.schemaVersion!==1||backup.kind!=='tibo-reset-history-backup')throw new Error('不是有效的 Tibo RESET 历史备份');
  const valid=items=>(Array.isArray(items)?items:[]).filter(validResetEntry);let imported=0;
  await mutate(s=>{
    const incoming=[...new Map([...valid(backup.history),...valid(backup.recent),...valid(backup.calendarEvents)].map(entry=>[String(entry.id),entry])).values()],calendar=new Map((s.calendarEvents||[]).map(entry=>[String(entry.id),entry])),history=new Map(s.history.filter(entry=>entry?.kind!=='reset'||validPost(entry)).map(entry=>[entry.key||`${entry.kind}:${entry.id||entry.createdAt}`,entry]));
    for(const entry of incoming){calendar.set(String(entry.id),entry);if(entry.kind==='reset')history.set(entry.key||`post:${entry.id}`,entry);}
    s.calendarEvents=[...calendar.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,500);s.history=[...history.values()].sort((a,b)=>Date.parse(b.publishedAt||b.createdAt)-Date.parse(a.publishedAt||a.createdAt)).slice(0,300);
    const ids=new Set([...(s.seen||[]),...(Array.isArray(backup.seen)?backup.seen:[]),...incoming.map(entry=>entry.id)].filter(id=>/^\d{1,30}$/.test(String(id))).map(String));s.seen=[...ids];
    const baseline=[s.baselineId,backup.baselineId,...ids].filter(id=>/^\d{1,30}$/.test(String(id))).reduce((a,b)=>BigInt(a)>BigInt(b)?a:b,'0');s.baselineId=baseline;s.initialized=s.initialized||ids.size>0;
    const candidates=[s.lastReset,backup.lastReset,...incoming.filter(entry=>(entry.status||entry.match?.status)==='completed')].filter(validResetEntry).sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt));if(candidates.length)s.lastReset=candidates.at(-1);
    imported=incoming.length;
  });await badge();return {ok:true,imported};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message.target==='offscreen')return false;const allowed=['panel.html','alarm.html'].map(p=>chrome.runtime.getURL(p));if(sender.id!==chrome.runtime.id||!allowed.includes(sender.url?.split('?')[0]))return false;
  const run=async()=>{switch(message.type){case 'state':return {ok:true,state:await read()};case 'check':return check('manual');case 'ack':await ack(message.key);return {ok:true};case 'pause':await mutate(s=>{s.paused=!!message.value;});await badge();if(!message.value)check('resume').catch(console.error);return {ok:true};case 'mute':await mutate(s=>{s.muted=!!message.value;});return {ok:true};case 'repeatInterval':{const value=Number(message.value);if(!REPEAT_INTERVAL_OPTIONS.includes(value))throw new Error('不支持的重复提醒间隔');await mutate(s=>{s.repeatIntervalMinutes=normalizeRepeatInterval(value);});await schedule();return {ok:true,value};}case 'test':return testAlert();case 'feedback':return recordFeedback(message);case 'diagnostics':return diagnostics();case 'exportBackup':return exportBackup();case 'importBackup':return importBackup(message);case 'source':{const key=SOURCE_DEFS[message.key]?message.key:'posts';await showMonitorWorkspace(key);return {ok:true};}case 'sourceAll':await showMonitorWorkspace('posts');return {ok:true};default:throw new Error('未知操作');}};
  run().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;
});
init().catch(console.error);
