(() => {
  let scanning=false;
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const errorCode=message=>/限流|429|too many requests/i.test(message)?'RATE_LIMITED':/登录|log in|sign in/i.test(message)?'LOGIN_REQUIRED':/路径不正确/i.test(message)?'PAGE_MOVED':/加载失败|网络|出错了/i.test(message)?'NETWORK_BLOCKED':/解析到|结构变化/i.test(message)?'DOM_CHANGED':/没有显示/i.test(message)?'EMPTY_TIMELINE':'UNKNOWN';
  chrome.runtime.onMessage.addListener((message,sender,reply)=> {
    if (sender.id !== chrome.runtime.id || message.type !== 'scan') return;
    if (scanning) { reply({ok:false,error:'上一次页面扫描尚未结束'}); return; }
    scanning=true;
    scan(message.source,message.boundary).then(reply).catch(e=>reply({ok:false,error:e.message,code:errorCode(e.message)})).finally(()=>scanning=false);
    return true;
  });
  async function scan(source,boundary) {
    const key=source==='replies'?'replies':'posts';
    const label=key==='replies'?'回复':'帖子';
    const expected=key==='replies'?'/thsottiaux/with_replies':'/thsottiaux';
    const path=location.pathname.replace(/\/$/,'');
    if(path!==expected)throw new Error(`${label}监控页路径不正确，当前为 ${path||'/'}`);
    const gathered=new Map();
    let reached=false, stagnant=0, previous=0;
    for(let pass=0;pass<18;pass++) {
      const posts=TiboParser.parseDocument(document).filter(p=>p.author==='thsottiaux');
      for(const p of posts) gathered.set(p.id,p);
      // One old pinned post is not evidence that the intervening timeline was covered.
      const old = posts.filter(p=>boundary && BigInt(p.id)<=BigInt(boundary));
      if (boundary && (gathered.has(boundary) || old.length>=2)) {
        reached=true;
        // Read overlapping rows to catch posts arriving out of order.
        if(gathered.size>=8 || pass>=4) break;
      }
      if (!boundary && gathered.size>=8) break;
      if (gathered.size===previous) stagnant++; else stagnant=0;
      previous=gathered.size;
      if(stagnant>=3 && gathered.size) break;
      if(gathered.size) window.scrollBy(0,Math.max(700,innerHeight*0.85));
      await delay(900);
    }
    if(!gathered.size) {
      const txt=document.body.innerText;
      if(/rate limit|too many requests|请求过于频繁|超出.*限制/i.test(txt))throw new Error(`${label}来源被 X 限流（429），稍后重试`);
      if(document.querySelector('input[autocomplete="username"]')||/log in to x|sign in to x|登录 X/i.test(txt))throw new Error(`X 的${label}页当前只显示登录提示`);
      if(/出错了[\s\S]{0,30}(?:重新加载|重试)|something went wrong[\s\S]{0,40}(?:reload|try again)/i.test(txt))throw new Error(`X 的${label}页加载失败，请稍后重试`);
      if(document.querySelector('article[data-testid="tweet"]'))throw new Error(`X 的${label}页面结构变化，无法解析可见内容`);
      throw new Error(`X 的${label}页没有显示可验证内容`);
    }
    window.scrollTo(0,0);
    return {ok:true,posts:[...gathered.values()],reachedBoundary:reached,observedAt:Date.now()};
  }
})();
