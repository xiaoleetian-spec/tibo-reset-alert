const CJK=/[\u3400-\u9fff]/;
const LATIN_WORD=/\b[A-Za-z][A-Za-z'’.-]{1,}\b/g;
const CODEX_WORD=/\bcodex\b/gi;

async function translatePreservingCodex(session,text){
  const brands=[];
  const protectedText=text.replace(CODEX_WORD,word=>{
    const token=`QXJZ${brands.length}ZJXQ`;
    brands.push({token,word});
    return token;
  });
  const translated=String(await session.translate(protectedText)).trim();
  if(!brands.length)return translated;
  if(brands.every(({token})=>translated.split(token).length===2)){
    return brands.reduce((result,{token,word})=>result.replace(token,word),translated);
  }
  // Some local translators rewrite placeholders. Translate the surrounding text
  // separately so the original product name never reaches the translator.
  const parts=text.split(/(\bcodex\b)/gi),result=[];
  for(const part of parts){
    if(!part.trim())continue;
    result.push(/^codex$/i.test(part)?part:String(await session.translate(part)).trim());
  }
  return result.join(' ').trim();
}

export function needsChineseTranslation(text){
  return typeof text==='string'&&!CJK.test(text)&&(text.match(LATIN_WORD)||[]).length>=3;
}

export function chineseHint(entry={}){
  const hints={
    completed:'Tibo 表示 RESET 已经完成。',
    planned:'Tibo 提到将会进行 RESET。',
    delayed:'Tibo 表示 RESET 将延后进行。',
    denied:'Tibo 否认或取消了 RESET。',
    related:'这条消息提到了 RESET，但没有明确表示已经完成。',
    suspected:'这条消息可能与 RESET 有关，但缺少足够上下文，请结合原文确认。'
  };
  return hints[entry.status||entry.match?.status]||'这是一条与 RESET 相关的消息，请结合英文原文确认。';
}

export async function translateEntryText(entry,translatorApi=globalThis.Translator){
  if(!needsChineseTranslation(entry?.text))return {kind:'skipped',text:null};
  if(!translatorApi||typeof translatorApi.availability!=='function'||typeof translatorApi.create!=='function')return {kind:'hint',text:chineseHint(entry)};
  try{
    const options={sourceLanguage:'en',targetLanguage:'zh'},availability=await translatorApi.availability(options);
    if(availability==='unavailable')return {kind:'hint',text:chineseHint(entry)};
    const session=await translatorApi.create(options);
    try{
      const translated=await translatePreservingCodex(session,entry.text);
      if(!translated||translated===entry.text)return {kind:'hint',text:chineseHint(entry)};
      return {kind:'translation',text:translated};
    }finally{session.destroy?.();}
  }catch{return {kind:'hint',text:chineseHint(entry)};}
}
