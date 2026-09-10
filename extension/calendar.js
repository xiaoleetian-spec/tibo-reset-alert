const ZONE='Asia/Shanghai';
const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
const statusOf=entry=>entry?.status||entry?.match?.status||null;
const dateOf=entry=>entry?.publishedAt||entry?.createdAt||null;
const bankedText=/\bbanked?\s+resets?\b|\breset\s+credits?\b|存入型?重置|储存型?重置/i;

export function monthAt(value=Date.now()){
  const p=parts(value);return {year:Number(p.year),month:Number(p.month)};
}

export function moveMonth(cursor,amount){
  const date=new Date(Date.UTC(cursor.year,cursor.month-1+amount,1));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1};
}

export function buildResetCalendar(state,cursor=monthAt(),now=Date.now()){
  const entries=new Map();
  for(const entry of [...(state?.history||[]),...(state?.recent||[])]){
    if(entry?.test||!dateOf(entry))continue;
    const status=statusOf(entry);
    if(!['completed','planned'].includes(status))continue;
    entries.set(String(entry.id||entry.url||dateOf(entry)),{...entry,status});
  }
  if(state?.lastReset?.publishedAt){
    const key=String(state.lastReset.id||state.lastReset.url||state.lastReset.publishedAt);
    entries.set(key,{...(entries.get(key)||{}),...state.lastReset,status:'completed'});
  }
  const events=[...entries.values()].map(entry=>{
    const p=parts(dateOf(entry));
    return {...entry,dateKey:`${p.year}-${p.month}-${p.day}`,type:entry.status==='planned'?'planned':bankedText.test(`${entry.text||''} ${entry.label||''}`)?'banked':'reset'};
  });
  const confirmed=events.filter(event=>event.status==='completed').sort((a,b)=>Date.parse(dateOf(a))-Date.parse(dateOf(b)));
  const latestId=String(state?.lastReset?.id||confirmed.at(-1)?.id||'');
  const first=new Date(Date.UTC(cursor.year,cursor.month-1,1));
  const daysInMonth=new Date(Date.UTC(cursor.year,cursor.month,0)).getUTCDate();
  const leading=(first.getUTCDay()+6)%7;
  const today=parts(now),cells=[];
  for(let i=0;i<leading;i++)cells.push(null);
  for(let day=1;day<=daysInMonth;day++){
    const dateKey=`${cursor.year}-${String(cursor.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayEvents=events.filter(event=>event.dateKey===dateKey);
    cells.push({day,dateKey,events:dayEvents,isToday:Number(today.year)===cursor.year&&Number(today.month)===cursor.month&&Number(today.day)===day,isLatest:dayEvents.some(event=>event.status==='completed'&&String(event.id)===latestId)});
  }
  while(cells.length%7)cells.push(null);
  const visible=events.filter(event=>event.dateKey.startsWith(`${cursor.year}-${String(cursor.month).padStart(2,'0')}-`));
  return {year:cursor.year,month:cursor.month,cells,confirmed:visible.filter(event=>event.status==='completed').length,planned:visible.filter(event=>event.status==='planned').length};
}
