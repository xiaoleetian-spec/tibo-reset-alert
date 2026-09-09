/* Shared between the real X content script and HTML fixture tests. */
(function(root) {
  function identity(article) {
    const time = [...article.querySelectorAll('time[datetime]')].find(t=> {
      const a=t.closest('a[href]');
      return a && /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(new URL(a.getAttribute('href'),'https://x.com').pathname);
    });
    if (!time) return null;
    const url = new URL(time.closest('a[href]').getAttribute('href'), 'https://x.com');
    const m = /^\/([A-Za-z0-9_]+)\/status\/(\d+)$/.exec(url.pathname);
    const header = article.querySelector('[data-testid="User-Name"]');
    if (!header || ![...header.querySelectorAll('a[href]')].some(a=> {
      const u=new URL(a.getAttribute('href'),'https://x.com');
      return u.origin==='https://x.com' && u.pathname.toLowerCase()===`/${m[1].toLowerCase()}`;
    })) return null;
    if (url.origin !== 'https://x.com') return null;
    return {author:m[1].toLowerCase(),id:m[2],url:`https://x.com/${m[1].toLowerCase()}/status/${m[2]}`,publishedAt:time.getAttribute('datetime')};
  }
  function parseArticle(article) {
    const who=identity(article);
    if (!who) return null;
    const texts=[...article.querySelectorAll('[data-testid="tweetText"]')];
    // A quoted tweet may be the only tweetText. Do not attribute it to the outer author.
    const own=texts.filter(e=> !e.closest('[role="link"]') && e.closest('article') === article);
    if (!own.length) return null;
    const text=own[0].textContent.trim();
    const quote=texts.filter(e=>!own.includes(e)).map(e=>e.textContent.trim()).join('\n');
    return {...who,text,context:quote,contextSource:quote?'visible-quote':null};
  }
  function parseDocument(doc) {
    return [...doc.querySelectorAll('article[data-testid="tweet"]')].map(parseArticle).filter(Boolean);
  }
  root.TiboParser={parseArticle,parseDocument};
})(globalThis);
