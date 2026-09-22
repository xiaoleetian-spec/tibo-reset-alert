import {ACCOUNT,classify,severityFor} from '../extension/core.js';

const API_ROOT='https://api.x.com/2';
const DAY_MS=86_400_000;
const MAX_PAGES=20;

export function initialCloudState(){
  return {schemaVersion:1,username:ACCOUNT,userId:null,lastSeenId:null,processedAlertIds:[],archivedIds:[],lastHeartbeatAt:null};
}

export function normalizeCloudState(value){
  const source=value&&typeof value==='object'?structuredClone(value):{};
  const state={...initialCloudState(),...source};
  state.schemaVersion=1;
  state.username=ACCOUNT;
  state.userId=/^\d+$/.test(String(state.userId||''))?String(state.userId):null;
  state.lastSeenId=/^\d+$/.test(String(state.lastSeenId||''))?String(state.lastSeenId):null;
  state.processedAlertIds=[...new Set((Array.isArray(state.processedAlertIds)?state.processedAlertIds:[]).filter(id=>/^\d+$/.test(String(id))).map(String))].slice(-2000);
  state.archivedIds=[...new Set((Array.isArray(state.archivedIds)?state.archivedIds:[]).filter(id=>/^\d+$/.test(String(id))).map(String))].slice(-5000);
  state.lastHeartbeatAt=Number.isFinite(Date.parse(state.lastHeartbeatAt))?new Date(state.lastHeartbeatAt).toISOString():null;
  return state;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function requestJson(url,{token,fetchImpl=fetch,sleep=wait,attempts=3}={}){
  if(!token)throw new Error('缺少 X_BEARER_TOKEN');
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'tibo-reset-alert-cloud-monitor/0.4'}});
      if(response.ok)return response.json();
      const detail=(await response.text()).slice(0,500);
      if(response.status!==429&&response.status<500)throw new Error(`X API ${response.status}: ${detail||response.statusText}`);
      const retryAfter=Number(response.headers?.get?.('retry-after'));
      lastError=new Error(`X API ${response.status}: ${detail||response.statusText}`);
      if(attempt<attempts)await sleep(Number.isFinite(retryAfter)&&retryAfter>=0?Math.min(retryAfter*1000,30_000):Math.min(1000*2**(attempt-1),10_000));
    }catch(error){
      lastError=error;
      if(attempt<attempts)await sleep(Math.min(1000*2**(attempt-1),10_000));
    }
  }
  throw lastError||new Error('X API 请求失败');
}

function textOf(item){return item?.note_tweet?.text||item?.text||'';}

function convertPage(page){
  const references=new Map((page?.includes?.tweets||[]).map(item=>[String(item.id),item]));
  return (page?.data||[]).map(item=>{
    const relation=(item.referenced_tweets||[]).find(ref=>ref.type==='replied_to')||(item.referenced_tweets||[]).find(ref=>ref.type==='quoted');
    const context=relation?textOf(references.get(String(relation.id))):'';
    return {id:String(item.id),author:ACCOUNT,text:textOf(item),publishedAt:item.created_at,url:`https://x.com/${ACCOUNT}/status/${item.id}`,source:relation?.type==='replied_to'?'replies':'posts',context,contextSource:context?`x-api-${relation.type}`:null};
  });
}

export async function fetchXTimeline({token,state,now=Date.now(),fetchImpl=fetch,sleep=wait,lookbackMs=DAY_MS}){
  const current=normalizeCloudState(state);
  let userId=current.userId;
  if(!userId){
    const user=await requestJson(`${API_ROOT}/users/by/username/${ACCOUNT}?user.fields=id,username`,{token,fetchImpl,sleep});
    userId=String(user?.data?.id||'');
    if(!/^\d+$/.test(userId))throw new Error('X API 未返回有效的 Tibo 用户 ID');
  }
  const posts=[];let nextToken=null,pages=0;
  do{
    const query=new URLSearchParams({max_results:'100',exclude:'retweets',
      'tweet.fields':'id,text,created_at,author_id,referenced_tweets,note_tweet',
      expansions:'referenced_tweets.id'});
    if(current.lastSeenId)query.set('since_id',current.lastSeenId);
    else query.set('start_time',new Date(now-lookbackMs).toISOString());
    if(nextToken)query.set('pagination_token',nextToken);
    const page=await requestJson(`${API_ROOT}/users/${userId}/tweets?${query}`,{token,fetchImpl,sleep});
    posts.push(...convertPage(page));pages++;
    nextToken=page?.meta?.next_token||null;
  }while(nextToken&&pages<MAX_PAGES);
  if(nextToken)throw new Error(`X API 分页超过 ${MAX_PAGES} 页，拒绝提前推进游标`);
  const unique=[...new Map(posts.map(post=>[post.id,post])).values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
  return {userId,posts:unique,pages};
}

export function timelineFromFixture(fixture){
  const userId=String(fixture?.user?.data?.id||fixture?.userId||'1953337039510003712');
  const posts=(fixture?.pages||[]).flatMap(convertPage);
  return {userId,posts:[...new Map(posts.map(post=>[post.id,post])).values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1),pages:(fixture?.pages||[]).length};
}

export async function runCloudMonitor({state,timeline,notify=async()=>{},now=Date.now()}){
  const next=normalizeCloudState(state),before=JSON.stringify(next),processed=new Set(next.processedAlertIds),archived=new Set(next.archivedIds),archiveRecords=[],alerts=[];
  next.userId=String(timeline.userId);
  for(const post of timeline.posts){
    const match=classify(post),severity=match?severityFor(match.status):null;
    if(!archived.has(post.id)){
      archiveRecords.push({...post,match,severity,observedAt:new Date(now).toISOString()});
      archived.add(post.id);
    }
    if(match&&severity!=='low'&&!processed.has(post.id)){
      await notify({...post,...match,severity});
      processed.add(post.id);alerts.push({...post,...match,severity});
    }
    if(!next.lastSeenId||BigInt(post.id)>BigInt(next.lastSeenId))next.lastSeenId=post.id;
  }
  next.processedAlertIds=[...processed].slice(-2000);
  next.archivedIds=[...archived].slice(-5000);
  const heartbeatDue=!next.lastHeartbeatAt||now-Date.parse(next.lastHeartbeatAt)>=30*DAY_MS;
  if(heartbeatDue)next.lastHeartbeatAt=new Date(now).toISOString();
  return {state:next,archiveRecords,alerts,fetched:timeline.posts.length,changed:JSON.stringify(next)!==before};
}

export function issuePayload(alert){
  const marker=`<!-- tibo-reset-post:${alert.id} -->`;
  const title=`[Tibo RESET] ${alert.label} · ${alert.id}`;
  const safeText=String(alert.text||'').replaceAll('```','` ` `').replaceAll('@','＠');
  const body=[marker,`**${alert.label}**（${alert.severity}）`,``,`原文：`,`\`\`\`text`,safeText,`\`\`\``,``,`- 发布时间：${alert.publishedAt}` ,`- 判断依据：${alert.reason}`,`- 来源：${alert.source==='replies'?'回复':'帖子'}`,`- 原文链接：${alert.url}`,``,`由 GitHub Actions 离线监控自动创建。`].join('\n');
  return {marker,title,body};
}

export function createGitHubIssueNotifier({token,repository,fetchImpl=fetch}){
  if(!token)throw new Error('缺少 GH_TOKEN');
  if(!/^[^/]+\/[^/]+$/.test(repository||''))throw new Error('GH_REPOSITORY 格式无效');
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'tibo-reset-alert-cloud-monitor/0.4'};
  return async alert=>{
    const payload=issuePayload(alert);
    for(let page=1;page<=10;page++){
      const response=await fetchImpl(`https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}`,{headers});
      if(!response.ok)throw new Error(`GitHub Issues 查询失败：${response.status}`);
      const issues=await response.json();
      if(issues.some(issue=>String(issue.body||'').includes(payload.marker)))return {created:false,number:issues.find(issue=>String(issue.body||'').includes(payload.marker))?.number};
      if(issues.length<100)break;
    }
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/issues`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({title:payload.title,body:payload.body})});
    if(!response.ok)throw new Error(`GitHub Issue 创建失败：${response.status} ${(await response.text()).slice(0,300)}`);
    const issue=await response.json();return {created:true,number:issue.number,url:issue.html_url};
  };
}
