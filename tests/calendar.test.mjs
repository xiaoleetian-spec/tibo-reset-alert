import assert from 'node:assert/strict';
import test from 'node:test';
import {buildResetCalendar,monthAt,moveMonth} from '../extension/calendar.js';

const post=(id,day,status,text)=>({id:String(id),kind:'reset',status,text,publishedAt:`2026-09-${String(day).padStart(2,'0')}T04:00:00.000Z`,url:`https://x.com/thsottiaux/status/${id}`});

test('RESET calendar marks confirmed, banked, planned and latest dates',()=>{
  const state={history:[post(4,4,'completed','All reset for everyone.'),post(5,5,'completed','Banked resets are restored.'),post(7,7,'planned','We will reset Codex tomorrow.'),post(8,8,'completed','Codex reset done.')],recent:[post(4,4,'completed','duplicate')],lastReset:post(8,8,'completed','Codex reset done.')};
  const view=buildResetCalendar(state,{year:2026,month:9},Date.parse('2026-09-09T04:00:00Z')),day=n=>view.cells.find(cell=>cell?.day===n);
  assert.equal(view.confirmed,3);assert.equal(view.planned,1);assert.equal(day(4).events.length,1);assert.equal(day(5).events[0].type,'banked');assert.equal(day(7).events[0].type,'planned');assert.equal(day(8).isLatest,true);assert.equal(day(9).isToday,true);
});

test('calendar month helpers cross year boundaries',()=>{
  assert.deepEqual(monthAt('2026-09-30T16:30:00.000Z'),{year:2026,month:10});assert.deepEqual(moveMonth({year:2026,month:12},1),{year:2027,month:1});
});
