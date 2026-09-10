import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('empty first viewport is scrolled until the lazy timeline becomes visible', async()=>{
  let listener,scrolls=0;
  const post={
    author:'thsottiaux',id:'1999999999999999999',
    text:'A visible reply',publishedAt:'2026-09-10T00:00:00.000Z',
    url:'https://x.com/thsottiaux/status/1999999999999999999'
  };
  const context={
    chrome:{runtime:{id:'extension-id',onMessage:{addListener(fn){listener=fn;}}}},
    TiboParser:{parseDocument(){return scrolls?[post]:[];}},
    document:{body:{innerText:''},querySelector(){return null;}},
    location:{pathname:'/thsottiaux/with_replies'},
    window:{scrollBy(){scrolls++;},scrollTo(){}},
    innerHeight:600,
    setTimeout(fn){fn();},
    clearTimeout,
    URL,BigInt,Map,Promise
  };
  vm.runInNewContext(readFileSync('extension/content.js','utf8'),context);
  assert.equal(typeof listener,'function');
  const result=await new Promise(resolve=>{
    assert.equal(listener({type:'scan',source:'replies',boundary:null},{id:'extension-id'},resolve),true);
  });
  assert.ok(scrolls>0,'scanner should move beyond an empty profile header');
  assert.equal(result.ok,true);
  assert.equal(result.posts.length,1);
  assert.equal(result.posts[0].id,post.id);
});

test('monthly backfill keeps scrolling past eight posts until reaching the month boundary',async()=>{
  let listener,scrolls=0;const make=(id,date)=>({author:'thsottiaux',id:String(id),text:'Codex reset update',publishedAt:date,url:`https://x.com/thsottiaux/status/${id}`});
  const batches=[
    Array.from({length:8},(_,i)=>make(300-i,`2026-09-${String(10-i).padStart(2,'0')}T04:00:00.000Z`)),
    [make(291,'2026-09-02T04:00:00.000Z')],
    [make(290,'2026-08-31T04:00:00.000Z'),make(289,'2026-08-30T04:00:00.000Z')]
  ];
  const context={chrome:{runtime:{id:'extension-id',onMessage:{addListener(fn){listener=fn;}}}},TiboParser:{parseDocument(){return batches[Math.min(scrolls,batches.length-1)];}},document:{body:{innerText:''},querySelector(){return null;}},location:{pathname:'/thsottiaux'},window:{scrollBy(){scrolls++;},scrollTo(){}},innerHeight:600,setTimeout(fn){fn();},clearTimeout,URL,BigInt,Map,Promise};
  vm.runInNewContext(readFileSync('extension/content.js','utf8'),context);
  const since=Date.parse('2026-08-31T16:00:00.000Z'),result=await new Promise(resolve=>listener({type:'scan',source:'posts',boundary:null,since},{id:'extension-id'},resolve));
  assert.equal(result.ok,true);assert.equal(result.reachedSince,true);assert.ok(result.posts.length>8);assert.ok(scrolls>=2);
});
