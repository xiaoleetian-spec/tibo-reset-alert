export const ACCOUNT = 'thsottiaux';
export const INTERVAL_MS = 120_000;
export const REPEAT_INTERVAL_OPTIONS = Object.freeze([1,5,10,15,30,60]);
export const DEFAULT_REPEAT_INTERVAL_MINUTES = 5;
export function normalizeRepeatInterval(value) {
  const minutes=Number(value);
  return REPEAT_INTERVAL_OPTIONS.includes(minutes)?minutes:DEFAULT_REPEAT_INTERVAL_MINUTES;
}
export const SOURCE_DEFS = Object.freeze({
  posts:Object.freeze({label:'帖子',url:'https://x.com/thsottiaux'}),
  replies:Object.freeze({label:'回复',url:'https://x.com/thsottiaux/with_replies'})
});
export const RATE_LIMIT_BACKOFF_MS = Object.freeze([120_000,240_000,480_000,900_000]);
export const PARSER_VERSION = '1.0.0';
export const ERROR_CODES = Object.freeze({
  LOGIN_REQUIRED:'LOGIN_REQUIRED',RATE_LIMITED:'RATE_LIMITED',NETWORK_BLOCKED:'NETWORK_BLOCKED',DOM_CHANGED:'DOM_CHANGED',
  EMPTY_TIMELINE:'EMPTY_TIMELINE',SCAN_TIMEOUT:'SCAN_TIMEOUT',PAGE_MOVED:'PAGE_MOVED',DELIVERY_FAILED:'DELIVERY_FAILED',UNKNOWN:'UNKNOWN'
});
const resetWords = /\breset(?:s|ting)?\b|重置|额度(?:恢复|刷新)|(?:usage|rate|codex)[\s\S]{0,40}(?:refill|refresh|replenish)/i;
const codexWords = /\bcodex\b|\bastra\b|代码助手/i;
const denial = /\b(?:not|never|no|won['’]?t|cannot|can['’]?t|isn['’]?t|aren['’]?t|didn['’]?t|don['’]?t|doesn['’]?t)\b[\s\S]{0,55}\breset|\breset[\s\S]{0,35}\b(?:cancelled|canceled)\b|不(?:会|再|能|是|打算)?[\s\S]{0,12}重置|取消[\s\S]{0,12}重置/i;
const delayed = /\b(?:delay(?:ed)?|postpon(?:e|ed)|later than|reschedul)\w*\b|推迟|延期/i;
const planned = /\b(?:will|going to|promis(?:e|ed|ing)|plan(?:ned|ning)?|tomorrow|soon|next|tonight|scheduled|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|即将|明天|今晚|计划|承诺|将会|稍后/i;
const completed = /\b(?:have|has|just|already|we['’]ve)\b[\s\S]{0,45}\breset|\ball\s+reset\b|\breset\b[\s\S]{0,30}\b(?:now|done|across all plans)\b|已(?:经)?[\s\S]{0,15}重置|重置完成/i;
const propagatedCompletion = /\breset(?:s)?\b[\s\S]{0,30}\bpropagat(?:ed|ion)\b|\bpropagat(?:ed|ion)\b[\s\S]{0,30}\breset(?:s)?\b|(?:重置|额度)[\s\S]{0,15}(?:已全部下发|已全部生效|传播完成)/i;

export function validPost(post) {
  if (!post || String(post.author).toLowerCase() !== ACCOUNT || !/^\d+$/.test(post.id)) return false;
  try {
    const url = new URL(post.url);
    return url.origin === 'https://x.com' && url.pathname.toLowerCase() === `/${ACCOUNT}/status/${post.id}` &&
      typeof post.text === 'string' && post.text.length > 0 && Number.isFinite(Date.parse(post.publishedAt));
  } catch { return false; }
}

export function classify(post) {
  if (!validPost(post)) return null;
  const own = post.text;
  const context = typeof post.context === 'string' ? post.context : '';
  const ownReset = resetWords.test(own);
  const contextReset = resetWords.test(context);
  if (!ownReset && !(contextReset && /^(?:yes|yep|yeah|no|nope|tomorrow|today|tonight|soon|done|correct|absolutely|indeed|not yet|是的|明天|今天|稍后|还没|不会)[\s\S]{0,120}$/i.test(own.trim()))) return null;
  const hasCodex = codexWords.test(own + ' ' + context);
  const propagationComplete = propagatedCompletion.test(own)&&!planned.test(own)&&!delayed.test(own);
  const clearlyOther = /\b(?:password|router|phone|factory|database|css|browser settings)\b|密码|路由器|恢复出厂/i.test(own);
  if (!hasCodex && clearlyOther) return null;
  let status = 'suspected';
  if (ownReset) {
    status = denial.test(own) ? 'denied' : delayed.test(own) ? 'delayed' : planned.test(own) ? 'planned' : (hasCodex&&completed.test(own))||propagationComplete ? 'completed' : hasCodex ? 'related' : 'suspected';
  }
  const labels = {suspected:'疑似 RESET 消息', denied:'重置否认 / 取消', delayed:'重置延期', planned:'重置预告', completed:'已重置', related:'重置相关'};
  return { status, label: labels[status], reason: !ownReset ? '短回复关联到重置上下文，需查看原帖' : propagationComplete ? '本人明确表示 RESET 已全部传播或下发生效' : status==='planned' ? '本人明确说明 RESET 的未来安排' : status==='delayed' ? '本人明确说明 RESET 延期' : !hasCodex ? '本人提到 RESET，但缺少 Codex 上下文' : '本人正文提到重置，并有 Codex 上下文' };
}

export function initialState(now = Date.now()) {
  return {version:3, installedAt:now, initialized:false, baselineId:'0', seen:[], pending:[], history:[], recent:[], calendarEvents:[], lastReset:null, paused:false, muted:false, repeatIntervalMinutes:DEFAULT_REPEAT_INTERVAL_MINUTES,
    health:{failures:0, lastSuccess:null, lastAttempt:null, error:null, incident:0, coverage:null},
    metrics:{attempts:0, successes:0}, delivery:{notification:null, audio:null, window:null}, monitorTabId:null, monitorWindowId:null, alertWindowId:null,
    sources:{posts:initialSourceState(),replies:initialSourceState()},sourceTabs:{posts:null,replies:null},checkLog:[],checkStats:[],deliveryLog:[],feedback:[]};
}

export function initialSourceState(initialized=false,boundaryId='0') {
  return {initialized,boundaryId,failures:0,lastAttempt:null,lastSuccess:null,error:null,lastCount:0,reachedBoundary:null,
    errorCode:null,retryable:null,backoffUntil:null,backoffLevel:0,backoffReason:null,calendarMonth:null,calendarEarliestAt:null,calendarReachedStart:false,calendarBackfilledAt:null,calendarBackfillNextAt:null};
}

export function shouldBackfillSource(source,month,now=Date.now(),force=false){
  return source.calendarMonth!==month||(!source.calendarReachedStart&&(force||!source.calendarBackfillNextAt||source.calendarBackfillNextAt<=now));
}

export function normalizeState(value,now=Date.now()) {
  const state=value && typeof value==='object'?value:initialState(now);
  state.version=3;
  state.repeatIntervalMinutes=normalizeRepeatInterval(state.repeatIntervalMinutes);
  state.seen=Array.isArray(state.seen)?state.seen:[];
  state.pending=Array.isArray(state.pending)?state.pending:[];
  state.history=Array.isArray(state.history)?state.history:[];
  state.recent=Array.isArray(state.recent)?state.recent:[];
  state.calendarEvents=Array.isArray(state.calendarEvents)?state.calendarEvents:[];
  state.checkLog=Array.isArray(state.checkLog)?state.checkLog:[];
  state.checkStats=Array.isArray(state.checkStats)?state.checkStats:state.checkLog.slice();
  state.deliveryLog=Array.isArray(state.deliveryLog)?state.deliveryLog:[];
  state.feedback=Array.isArray(state.feedback)?state.feedback:[];
  for(const entry of [...state.pending,...state.history])if(entry?.kind==='reset'&&!entry.severity)entry.severity=severityFor(entry.status||entry.match?.status);
  state.health={failures:0,lastSuccess:null,lastAttempt:null,error:null,incident:0,coverage:null,...state.health};
  state.metrics={attempts:0,successes:0,...state.metrics};
  state.delivery={notification:null,audio:null,window:null,...state.delivery};
  const legacyInitialized=!!state.initialized;
  const legacyBoundary=/^\d+$/.test(String(state.baselineId))?String(state.baselineId):'0';
  state.sources=state.sources&&typeof state.sources==='object'?state.sources:{};
  for(const key of Object.keys(SOURCE_DEFS)) {
    const fallback=key==='posts'?initialSourceState(legacyInitialized,legacyBoundary):initialSourceState();
    state.sources[key]={...fallback,...(state.sources[key]||{})};
  }
  const hadSourceTabs=state.sourceTabs&&typeof state.sourceTabs==='object';
  state.sourceTabs=hadSourceTabs?state.sourceTabs:{};
  if(!Object.hasOwn(state.sourceTabs,'posts'))state.sourceTabs.posts=state.monitorTabId??null;
  if(!Object.hasOwn(state.sourceTabs,'replies'))state.sourceTabs.replies=null;
  state.alertWindowId ??= null;
  state.monitorTabId ??= null;
  state.monitorWindowId ??= null;
  state.lastReset ??= null;
  return state;
}

export function isRateLimitError(error) {
  return /(?:rate\s*limit|too many requests|\b429\b|限流|请求过于频繁|超出[^\n]{0,20}限制)/i.test(String(error));
}

export function classifySourceError(error,explicitCode=null) {
  const message=String(error||'未知错误');
  const known=Object.values(ERROR_CODES).includes(explicitCode)?explicitCode:null;
  const code=known || (isRateLimitError(message)?ERROR_CODES.RATE_LIMITED
    :/登录|log in|sign in/i.test(message)?ERROR_CODES.LOGIN_REQUIRED
    :/超时|timeout/i.test(message)?ERROR_CODES.SCAN_TIMEOUT
    :/路径不正确|离开.*页面/i.test(message)?ERROR_CODES.PAGE_MOVED
    :/403|ERR_|network|offline|无法连接|connection/i.test(message)?ERROR_CODES.NETWORK_BLOCKED
    :/结构变化|解析到/i.test(message)?ERROR_CODES.DOM_CHANGED
    :/空|没有返回可验证|没有显示.*(?:帖子|回复)/i.test(message)?ERROR_CODES.EMPTY_TIMELINE
    :ERROR_CODES.UNKNOWN);
  return {code,retryable:![ERROR_CODES.LOGIN_REQUIRED,ERROR_CODES.DOM_CHANGED,ERROR_CODES.PAGE_MOVED].includes(code)};
}

export function recordSourceFailure(state,key,error,now=Date.now(),details={}) {
  normalizeState(state,now);
  const source=state.sources[key];
  const info=classifySourceError(error,details.code);
  source.lastAttempt=now;source.error=String(error).slice(0,300);source.errorCode=info.code;source.retryable=details.retryable??info.retryable;source.failures++;
  const rateLimited=info.code===ERROR_CODES.RATE_LIMITED;
  if(rateLimited || source.failures>=3) {
    source.backoffLevel=Math.min(source.backoffLevel+1,RATE_LIMIT_BACKOFF_MS.length);
    source.backoffUntil=now+RATE_LIMIT_BACKOFF_MS[source.backoffLevel-1];
    source.backoffReason=rateLimited?'rate-limit':'repeated-failure';
  }
  return source;
}

export function recordSourceSuccess(state,key,result,now=Date.now()) {
  normalizeState(state,now);
  const source=state.sources[key];
  source.initialized=true;source.lastAttempt=now;source.lastSuccess=now;source.error=null;source.errorCode=null;source.retryable=null;source.failures=0;
  source.lastCount=result.posts.length;source.reachedBoundary=!!result.reachedBoundary;
  source.backoffUntil=null;source.backoffLevel=0;source.backoffReason=null;
  if(result.backfillMonth){
    if(source.calendarMonth!==result.backfillMonth){source.calendarMonth=result.backfillMonth;source.calendarEarliestAt=null;source.calendarReachedStart=false;source.calendarBackfilledAt=null;source.calendarBackfillNextAt=null;}
    const earliest=Number(result.earliestObservedAt)||null;
    if(earliest)source.calendarEarliestAt=source.calendarEarliestAt?Math.min(source.calendarEarliestAt,earliest):earliest;
    source.calendarReachedStart=!!result.reachedSince;
    source.calendarBackfilledAt=result.reachedSince?now:null;
    source.calendarBackfillNextAt=result.reachedSince?null:now+1_800_000;
  }
  const newest=result.posts.reduce((value,post)=>BigInt(post.id)>BigInt(value)?post.id:value,source.boundaryId||'0');
  source.boundaryId=newest;
  return source;
}

export function sourceIsReady(state,key,now=Date.now()) {
  normalizeState(state,now);
  return !state.sources[key].backoffUntil || state.sources[key].backoffUntil<=now;
}

export function appendCheckLog(state,entry) {
  normalizeState(state,entry?.finishedAt||Date.now());
  state.checkLog.unshift(entry);
  state.checkLog=state.checkLog.slice(0,100);
  state.checkStats.unshift(entry);
  const cutoff=(entry?.finishedAt||Date.now())-86_400_000;
  state.checkStats=state.checkStats.filter(item=>(item.finishedAt||0)>=cutoff).slice(0,1000);
}

export function summarizeChecks(items,now=Date.now(),windowMs=86_400_000) {
  const all=(Array.isArray(items)?items:[]).filter(x=>Number.isFinite(x?.finishedAt)&&x.finishedAt>=now-windowMs&&x.finishedAt<=now).sort((a,b)=>a.finishedAt-b.finishedAt);
  const total=all.length,full=all.filter(x=>x.outcome==='success'),partial=all.filter(x=>x.outcome==='partial').length,failed=all.filter(x=>x.outcome==='failed').length;
  const sourceRates={};const durations=[];
  for(const key of Object.keys(SOURCE_DEFS)) {
    const records=all.map(x=>x.sources?.[key]).filter(Boolean);
    sourceRates[key]={successes:records.filter(x=>x.status==='success').length,total:records.length,rate:records.length?records.filter(x=>x.status==='success').length/records.length:null};
    records.filter(x=>Number.isFinite(x.durationMs)&&x.durationMs>0).forEach(x=>durations.push(x.durationMs));
  }
  durations.sort((a,b)=>a-b);const p95=durations.length?durations[Math.min(durations.length-1,Math.ceil(durations.length*.95)-1)]:null;
  const start=all.length?Math.max(now-windowMs,all[0].startedAt||all[0].finishedAt):now;let previous=start,longest=0;
  for(const item of full){longest=Math.max(longest,item.finishedAt-previous);previous=item.finishedAt;}longest=Math.max(longest,now-previous);
  return {windowMs,total,full:full.length,partial,failed,fullCoverageRate:total?full.length/total:null,sourceRates,p95DurationMs:p95,longestBlindMs:longest,lastFullCoverage:full.at(-1)?.finishedAt||null};
}

export function severityFor(status) {
  return status==='completed'?'critical':['planned','delayed','related'].includes(status)?'medium':'low';
}

export function ingest(state, posts, now = Date.now(), options = {}) {
  const valid = posts.filter(validPost).sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
  if (!valid.length) throw new Error('未读到可验证的 Tibo 帖文，不能当作“没有新消息”');
  const seen = new Set(state.seen);
  const alerts = [];
  const classified=valid.map(p=>({post:p,match:classify(p)}));
  const calendar=new Map((state.calendarEvents||[]).map(entry=>[String(entry.id),entry]));
  for(const {post,match} of classified)if(match)calendar.set(String(post.id),{...post,...match,source:post.source||calendar.get(String(post.id))?.source||null});
  state.calendarEvents=[...calendar.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,500);
  for(const {post:p,match} of classified) {
    if(match?.status!=='completed') continue;
    if(!state.lastReset || Date.parse(p.publishedAt)>Date.parse(state.lastReset.publishedAt)) {
      state.lastReset={id:p.id,publishedAt:p.publishedAt,url:p.url,text:p.text};
    }
  }
  if (!state.initialized) {
    state.baselineId = valid.at(-1).id;
    state.initialized = true;
    const recentMatches=classified.filter(p=>p.match);
    if(options.alertRecentOnBaseline) {
      const cutoff=now-(options.baselineLookbackMs || 86_400_000);
      const existing=new Set([...state.pending,...state.history].map(p=>p.key));
      for(const {post:p,match} of recentMatches) {
        const key=`post:${p.id}`;
        if(Date.parse(p.publishedAt)<cutoff || existing.has(key)) continue;
        const entry={...p,...match,severity:severityFor(match.status),key,kind:'reset',createdAt:now,acknowledgedAt:null};
        state.pending.push(entry);state.history.unshift(entry);alerts.push(entry);existing.add(key);
      }
      const alerted=new Set(alerts.map(p=>p.id));
      state.recent=recentMatches.filter(({post})=>!alerted.has(post.id)).map(({post,match})=>({...post,match})).reverse().slice(0,20);
    } else {
      state.recent=recentMatches.map(({post,match})=>({...post,match})).reverse().slice(0,20);
    }
  } else {
    for (const p of valid) {
      if (seen.has(p.id)) continue;
      const olderThanBaseline=BigInt(p.id)<=BigInt(state.baselineId);
      const allowOlder=options.allowOlderUnseen && Date.parse(p.publishedAt)>=now-(options.baselineLookbackMs||86_400_000);
      if(olderThanBaseline && !allowOlder)continue;
      seen.add(p.id);
      const match = classify(p);
      if (match) {
        const entry = {...p, ...match, severity:severityFor(match.status), key:`post:${p.id}`, kind:'reset', createdAt:now, acknowledgedAt:null};
        state.pending.push(entry);
        state.history.unshift(entry);
        alerts.push(entry);
      }
    }
  }
  valid.forEach(p=>seen.add(p.id));
  state.seen = [...seen];
  state.history = state.history.slice(0,300);
  return alerts;
}

export function recordFailure(state, error, now=Date.now()) {
  state.health.lastAttempt = now;
  state.health.error = String(error).slice(0,300);
  state.health.failures++;
  if (state.health.failures !== 3) return [];
  state.health.incident++;
  const entry = {key:`fault:${state.health.incident}`, kind:'fault', label:'监控失效', text:state.health.error, createdAt:now, acknowledgedAt:null};
  state.pending.push(entry); state.history.unshift(entry); state.history=state.history.slice(0,300);
  return [entry];
}

export function recordSuccess(state, now=Date.now(), coverage=null) {
  const recovering = state.health.failures >= 3;
  state.health = {...state.health, failures:0, lastAttempt:now, lastSuccess:now, error:null, coverage};
  if (!recovering) return [];
  state.pending = state.pending.filter(p=>p.kind !== 'fault');
  state.history.filter(p=>p.kind === 'fault' && !p.acknowledgedAt).forEach(p=>p.acknowledgedAt=now);
  const entry = {key:`recovery:${state.health.incident}`, kind:'recovery', label:'监控已恢复', text:'已经重新读到 Tibo 帖文。请查看覆盖缺口提示。', createdAt:now, acknowledgedAt:now};
  state.history.unshift(entry); state.history=state.history.slice(0,300);
  return [entry];
}

export function acknowledge(state, key, now=Date.now()) {
  state.pending = state.pending.filter(p=> key !== '*' && p.key !== key);
  state.history.filter(p=>key === '*' || p.key === key).forEach(p=>p.acknowledgedAt ||= now);
}

export function newestSeen(state) {
  return state.seen.reduce((a,b)=>BigInt(a)>BigInt(b)?a:b,state.baselineId);
}
