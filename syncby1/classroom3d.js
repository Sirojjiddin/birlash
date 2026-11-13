
'use strict';
// Ephemeral classroom state; never writes chat or seating to disk.
const MIN_CAP = 40, COLS = 8;
function init({send,broadcast}) {
  const state = room => room.classroom || (room.classroom = {seats:new Map(),hands:new Set(),blocks:new Set(),last:new Map()});
  const receivers = room => [...room.clients].filter(w => w.ctx && w !== room.host && w.ctx.role !== 'host');
  const capacity = (all, seats) => {
    let highest = 0;
    for (const seat of seats.values()) highest = Math.max(highest, seat + 1);
    return Math.max(MIN_CAP, Math.ceil(Math.max(all.length, highest) / COLS) * COLS);
  };
  const find = (room,id) => receivers(room).find(w => w.ctx.id === id);
  function sync(room) {
    if (!room.cfg.class3d) return;
    const q=state(room);
    const all=receivers(room);
    // Remove disconnected identities and make seats available.
    const ids=new Set(all.map(w=>w.ctx.id));
    for(const [id] of q.seats) if(!ids.has(id)) q.seats.delete(id);
    for(const id of q.hands) if(!ids.has(id)) q.hands.delete(id);
    for(const id of q.blocks) if(!ids.has(id)) q.blocks.delete(id);
    const seats=all.filter(w=>q.seats.has(w.ctx.id)).map(w=>({id:w.ctx.id,n:w.ctx.name,a:w.ctx.av||'',s:q.seats.get(w.ctx.id),h:q.hands.has(w.ctx.id),b:q.blocks.has(w.ctx.id),o:false})).sort((a,b)=>a.s-b.s);
    broadcast(room,{type:'cls-state',cols:COLS,cap:capacity(all,q.seats),seats,host:{id:room.host&&room.host.ctx&&room.host.ctx.id,n:room.host&&room.host.ctx?room.host.ctx.name:'Transmitter',on:!!room.host}});
  }
  function on(room,ws,m) {
    if(!m || typeof m.type!=='string' || !m.type.startsWith('cls-')) return false;
    const deny=reason=>send(ws,{type:'cls-denied',reason});
    if(!room.cfg.class3d) {deny('off');return true;}
    const q=state(room),host=ws.ctx.role==='host',id=ws.ctx.id;
    const seat=n=>Number.isInteger(n)&&n>=0&&n<capacity(receivers(room),q.seats);
    const occupied=n=>[...q.seats.values()].includes(n);
    switch(m.type) {
      case 'cls-sync': sync(room); break;
      case 'cls-sit': if(host||room.cfg.seatLock) deny('locked'); else if(!seat(m.s)||occupied(m.s)) deny('taken'); else {q.seats.set(id,m.s);sync(room);} break;
      case 'cls-move': if(host){const w=find(room,String(m.id));if(!w||!seat(m.s)) break;const other=[...q.seats].find(([key,n])=>n===m.s&&key!==w.ctx.id);if(other) q.seats.set(other[0],q.seats.get(w.ctx.id));q.seats.set(w.ctx.id,m.s);sync(room);} break;
      case 'cls-hand': if(!host){if(m.up)q.hands.add(id);else q.hands.delete(id);sync(room);} break;
      case 'cls-hand-clear': if(host){q.hands.delete(String(m.id));sync(room);} break;
      case 'cls-block': if(host){if(m.on)q.blocks.add(String(m.id));else q.blocks.delete(String(m.id));sync(room);} break;
      case 'cls-shuffle': if(host){const all=receivers(room).sort((x,y)=>m.mode==='front'?x.ctx.name.localeCompare(y.ctx.name):Math.random()-.5);all.forEach((w,i)=>q.seats.set(w.ctx.id,i));sync(room);} break;
      case 'cls-whisper': {
        if(!host&&(room.cfg.whisper===false||q.blocks.has(id))) {deny('blocked');break;}
        const now=Date.now();if(now-(q.last.get(id)||0)<650){deny('rate');break;}
        const target=m.to==='host'?room.host:find(room,String(m.to));
        if(!target||!target.ctx){deny('gone');break;}
        const text=String(m.text||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,300);if(!text)break;
        q.last.set(id,now);const msg={type:'cls-whisper',from:id,to:target.ctx.id,fn:ws.ctx.name,fh:host,text,t:now};
        send(target,msg);if(target!==ws)send(ws,msg);break;
      }
    }
    return true;
  }
  return {on,sync};
}
module.exports={init};
