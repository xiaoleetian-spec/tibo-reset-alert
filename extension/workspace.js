const normalized=url=>String(url||'').replace(/\/$/,'');

async function validTab(api,id,url,windowId=null){
  if(id===null||id===undefined)return null;
  try{
    const tab=await api.tabs.get(id);
    if(normalized(tab.url)!==normalized(url))return null;
    if(windowId!==null&&tab.windowId!==undefined&&tab.windowId!==windowId)return null;
    return tab;
  }catch{return null;}
}

export async function provisionMonitorWorkspace(api,sourceDefs,snapshot={}){
  const keys=Object.keys(sourceDefs),savedTabs=snapshot.sourceTabs||{};
  if(snapshot.monitorWindowId!==null&&snapshot.monitorWindowId!==undefined){
    try{
      const window=await api.windows.get(snapshot.monitorWindowId),tabs={};
      for(const key of keys){
        const current=await validTab(api,savedTabs[key],sourceDefs[key].url,window.id);
        tabs[key]=current||await api.tabs.create({windowId:window.id,url:sourceDefs[key].url,active:false});
      }
      return {windowId:window.id,tabs:Object.fromEntries(keys.map(key=>[key,tabs[key].id])),created:false,migrated:false};
    }catch{}
  }

  const reusable={};
  for(const key of keys)reusable[key]=await validTab(api,savedTabs[key],sourceDefs[key].url);
  const firstKey=keys.find(key=>reusable[key]);
  let window,tabs={};
  if(firstKey){
    window=await api.windows.create({tabId:reusable[firstKey].id,type:'normal',state:'minimized',focused:false});
    tabs[firstKey]=reusable[firstKey].id;
    for(const key of keys){
      if(key===firstKey)continue;
      if(reusable[key]){await api.tabs.move(reusable[key].id,{windowId:window.id,index:-1});tabs[key]=reusable[key].id;}
      else tabs[key]=(await api.tabs.create({windowId:window.id,url:sourceDefs[key].url,active:false})).id;
    }
    return {windowId:window.id,tabs,created:true,migrated:true};
  }

  window=await api.windows.create({url:keys.map(key=>sourceDefs[key].url),type:'normal',state:'minimized',focused:false});
  const createdTabs=Array.isArray(window.tabs)&&window.tabs.length?window.tabs:await api.tabs.query({windowId:window.id});
  if(createdTabs.length===keys.length)tabs=Object.fromEntries(keys.map((key,index)=>[key,createdTabs[index].id]));
  else for(const key of keys)tabs[key]=(await api.tabs.create({windowId:window.id,url:sourceDefs[key].url,active:false})).id;
  return {windowId:window.id,tabs,created:true,migrated:false};
}

export async function revealMonitorWorkspace(api,workspace,sourceKey='posts'){
  const tabId=workspace.tabs[sourceKey]??Object.values(workspace.tabs)[0];
  if(tabId!==undefined)await api.tabs.update(tabId,{active:true});
  await api.windows.update(workspace.windowId,{state:'normal'});
  await api.windows.update(workspace.windowId,{focused:true});
  return workspace;
}
