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
  const result=await new Promise(resolve=>{
    listener({type:'scan',source:'replies',boundary:null},{id:'extension-id'},resolve);
  });
  assert.ok(scrolls>0);
  assert.equal(result.ok,true);
  assert.equal(result.posts[0].id,post.id);
});
