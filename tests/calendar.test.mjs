import assert from 'node:assert/strict';
import test from 'node:test';
import {buildResetCalendar,calendarCoverage,monthAt,moveMonth} from '../extension/calendar.js';

const post=(id,day,status,text)=>({id:String(id),kind:'reset',status,text,publishedAt:`2026-09-${String(day).padStart(2,'0')}T04:00:00.000Z`,url:`https://x.com/thsottiaux/status/${id}`});

test('RESET calendar marks confirmed, banked, planned and latest dates',()=>{
  const state={
    history:[post(4,4,'completed','All reset for everyone.'),post(5,5,'related','Banked resets were affected. Everyone is getting another one.'),post(7,7,'planned','We will reset Codex tomorrow.'),post(8,8,'completed','Codex reset done.')],
    recent:[post(4,4,'completed','duplicate')],
    lastReset:post(8,8,'completed','Codex reset done.')
  };
  const view=buildResetCalendar(state,{year:2026,month:9},Date.parse('2026-09-09T04:00:00Z'));
  const day=n=>view.cells.find(cell=>cell?.day===n);
  assert.equal(view.confirmed,3);assert.equal(view.planned,1);
  assert.equal(day(4).events.length,1);assert.equal(day(4).events[0].type,'reset');
  assert.equal(day(5).events[0].type,'banked');assert.equal(day(7).events[0].type,'planned');
  assert.equal(day(8).isLatest,true);assert.equal(day(9).isToday,true);
});

test('calendar month helpers use Shanghai dates and cross year boundaries',()=>{
  assert.deepEqual(monthAt('2026-09-30T16:30:00.000Z'),{year:2026,month:10});
  assert.deepEqual(moveMonth({year:2026,month:12},1),{year:2027,month:1});
  assert.deepEqual(moveMonth({year:2026,month:1},-1),{year:2025,month:12});
});

test('calendar coverage distinguishes local observations from a full monthly backfill',()=>{
  const cursor={year:2026,month:9},partial={sources:{posts:{calendarMonth:'2026-09',calendarReachedStart:false,calendarEarliestAt:Date.parse('2026-09-08T00:00:00Z')},replies:{calendarMonth:null}}};
  assert.deepEqual(calendarCoverage(partial,cursor),{month:'2026-09',complete:false,started:true,earliest:Date.parse('2026-09-08T00:00:00Z')});
  partial.sources.replies={calendarMonth:'2026-09',calendarReachedStart:false,calendarEarliestAt:Date.parse('2026-09-10T00:00:00Z')};
  assert.equal(calendarCoverage(partial,cursor).earliest,Date.parse('2026-09-10T00:00:00Z'),'双来源共同覆盖日期应采用较晚的边界');
  partial.sources.posts.calendarReachedStart=true;partial.sources.replies={calendarMonth:'2026-09',calendarReachedStart:true,calendarEarliestAt:Date.parse('2026-08-31T00:00:00Z')};
  assert.equal(calendarCoverage(partial,cursor).complete,true);
});
