/* War Zone server for Render (or any Node 18+ host). No dependencies.
   - serves public/index.html (gzipped)
   - /ws: one WebSocket per player: live rooms (lobby + matches), a small document store (accounts, ranked, bans, skins),
     and player identity, the same services the game uses on Claude
   - data is saved to DATA_DIR/db.json (default ./data). On Render's free plan the disk is wiped on every restart or deploy;
     attach a Render Disk at /var/data and set DATA_DIR=/var/data to keep accounts, skins, bans and ranked scores.
   - OWNER_KEY: open https://<your-app>/?owner=<OWNER_KEY> once in your browser to be the game's owner (can reset passwords). */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const PORT=+process.env.PORT||10000,DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data'),OWNER_KEY=process.env.OWNER_KEY||'';
const PUB=path.join(__dirname,'public');

/* ---------------- static files ---------------- */
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.txt':'text/plain'};
const cache=new Map();
function fileEntry(p){let e=cache.get(p);const st=fs.statSync(p);if(e&&e.mtime===st.mtimeMs)return e;const raw=fs.readFileSync(p);
  e={raw,gz:raw.length>1024?zlib.gzipSync(raw,{level:9}):null,mtime:st.mtimeMs,etag:'"'+crypto.createHash('sha1').update(raw).digest('hex').slice(0,16)+'"',type:TYPES[path.extname(p).toLowerCase()]||'application/octet-stream'};cache.set(p,e);return e}
const server=http.createServer((req,res)=>{
  let u;try{u=new URL(req.url,'http://x')}catch(e){res.writeHead(400);return res.end()}
  if(u.pathname==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});return res.end('ok')}
  let p;try{p=decodeURIComponent(u.pathname)}catch(e){res.writeHead(400);return res.end()}if(p.includes('\0')){res.writeHead(400);return res.end()}if(p.endsWith('/'))p+='index.html';const f=path.normalize(path.join(PUB,p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found')}
  const e=fileEntry(f),h={'content-type':e.type,'etag':e.etag,'cache-control':e.type.startsWith('text/html')?'no-cache':'public, max-age=3600','x-content-type-options':'nosniff'};
  if(req.headers['if-none-match']===e.etag){res.writeHead(304,h);return res.end()}
  if(e.gz&&/\bgzip\b/.test(req.headers['accept-encoding']||'')){h['content-encoding']='gzip';h['vary']='Accept-Encoding';res.writeHead(200,h);return res.end(req.method==='HEAD'?undefined:e.gz)}
  res.writeHead(200,h);res.end(req.method==='HEAD'?undefined:e.raw);
});

/* ---------------- document store ---------------- */
fs.mkdirSync(DATA_DIR,{recursive:true});const DBF=path.join(DATA_DIR,'db.json');
let DB={docs:{},users:{}};try{DB=Object.assign({docs:{},users:{}},JSON.parse(fs.readFileSync(DBF,'utf8')))}catch(e){}
let saveT=null;function saveSoon(){if(saveT)return;saveT=setTimeout(()=>{saveT=null;try{const t=DBF+'.tmp';fs.writeFileSync(t,JSON.stringify(DB));fs.renameSync(t,DBF)}catch(e){console.error('save failed',e.message)}},1500)}
const SEG=/^[A-Za-z0-9_\-.~:@+]{1,200}$/,COLLS=new Set(['accounts','ranked','bans','skins']);
const okPath=(p,doc)=>{if(typeof p!=='string'||p.length>1000)return false;const s=p.split('/');if(s.length>16||s.some(x=>!SEG.test(x)||x==='.'||x==='..'))return false;return doc?s.length%2===0:s.length%2===1};
const err=(code,message)=>({code,message});
function canWrite(c,p){if(c.owner)return true;const s=p.split('/');if(!COLLS.has(s[0]))return false;
  if((s[0]==='accounts'||s[0]==='ranked')&&s[1]!==c.uid)return false;   // only your own account / ranked row
  return true}
function merge(a,b){for(const k in b){const v=b[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))merge(a[k],v);else a[k]=v}return a}
function cmp(a,op,b){switch(op){case'==':return a===b;case'!=':return a!==b;case'<':return a<b;case'<=':return a<=b;case'>':return a>b;case'>=':return a>=b;
  case'in':return Array.isArray(b)&&b.includes(a);case'not-in':return Array.isArray(b)&&!b.includes(a);case'array-contains':return Array.isArray(a)&&a.includes(b);default:return false}}
function dbOp(c,m){
  const p=m.path;
  if(m.op==='get'){if(!okPath(p,true))throw err('invalid_argument','bad path');const d=DB.docs[p];return d===undefined?null:d}
  if(m.op==='query'){if(!okPath(p,false))throw err('invalid_argument','bad path');const pre=p+'/',n=p.split('/').length+1;let rows=[];
    for(const k in DB.docs){if(!k.startsWith(pre)||k.split('/').length!==n)continue;const d=DB.docs[k];if((m.w||[]).every(([f,op,v])=>cmp(d[f],op,v)))rows.push({id:k.slice(pre.length),data:d})}
    if(m.o){const [f,dir]=m.o,s=dir==='desc'?-1:1;rows.sort((a,b)=>{const x=a.data[f],y=b.data[f];if(x===undefined)return 1;if(y===undefined)return -1;return x<y?-s:x>y?s:0})}else rows.sort((a,b)=>a.id<b.id?-1:1);
    return rows.slice(0,Math.max(1,Math.min(1000,m.l|0||1000)))}
  if(!okPath(p,true))throw err('invalid_argument','bad path');if(!canWrite(c,p))throw err('invalid_argument','not allowed');
  if(m.op==='delete'){delete DB.docs[p];saveSoon();return null}
  const d=m.data;if(!d||typeof d!=='object'||Array.isArray(d))throw err('invalid_argument','body must be an object');
  if(JSON.stringify(d).length>256*1024)throw err('invalid_argument','document too large');
  if(m.op==='set'){if(!(p in DB.docs)&&Object.keys(DB.docs).length>=25000)throw err('quota_exceeded','database full');DB.docs[p]=JSON.parse(JSON.stringify(d));saveSoon();return null}
  if(m.op==='update'){if(!(p in DB.docs))throw err('invalid_argument','no such document');merge(DB.docs[p],JSON.parse(JSON.stringify(d)));saveSoon();return null}
  throw err('invalid_argument','unknown op');
}

/* ---------------- rooms ---------------- */
const rooms=new Map();   // name -> {members:Map(peer -> {c,presence,at}), dirty}
function roomOf(n){let r=rooms.get(n);if(!r){r={members:new Map(),dirty:false};rooms.set(n,r)}return r}
function leaveRoom(c,n){const r=rooms.get(n);if(!r)return;r.members.delete(c.peer);c.rooms.delete(n);r.dirty=true;if(!r.members.size)rooms.delete(n)}
setInterval(()=>{for(const [n,r] of rooms){if(!r.dirty)continue;r.dirty=false;
  const list=[...r.members.entries()].map(([peer,v])=>({peer,by:null,kind:'viewer',guest:false,presence:v.presence,updatedAt:v.at}));const msg=JSON.stringify({t:'peers',room:n,list});
  for(const v of r.members.values())wsSend(v.c,msg)}},60);

/* ---------------- WebSocket (RFC 6455, text frames) ---------------- */
const conns=new Set();
function wsSend(c,s){if(c.dead)return;const b=Buffer.from(s);let h;if(b.length<126){h=Buffer.from([0x81,b.length])}else if(b.length<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(b.length,2)}else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(b.length),2)}
  try{c.sock.write(Buffer.concat([h,b]))}catch(e){}}
function wsClose(c){if(c.dead)return;c.dead=true;conns.delete(c);for(const n of [...c.rooms])leaveRoom(c,n);try{c.sock.end(Buffer.from([0x88,0]))}catch(e){}try{c.sock.destroy()}catch(e){}}
server.on('upgrade',(req,sock)=>{
  if(!req.url.startsWith('/ws')||(req.headers.upgrade||'').toLowerCase()!=='websocket'){sock.destroy();return}
  const key=req.headers['sec-websocket-key'];if(!key){sock.destroy();return}
  const acc=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acc+'\r\n\r\n');
  sock.setNoDelay(true);
  const c={sock,peer:'p'+crypto.randomBytes(9).toString('hex'),uid:null,owner:false,rooms:new Set(),buf:Buffer.alloc(0),frag:[],alive:Date.now(),dead:false,rate:{t:Date.now(),n:0}};conns.add(c);
  sock.on('data',d=>{c.alive=Date.now();c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>4*1024*1024){wsClose(c);return}
    while(c.buf.length>=2){const b0=c.buf[0],b1=c.buf[1],fin=b0&0x80,op=b0&0x0f,masked=b1&0x80;let len=b1&0x7f,off=2;
      if(len===126){if(c.buf.length<4)return;len=c.buf.readUInt16BE(2);off=4}else if(len===127){if(c.buf.length<10)return;len=Number(c.buf.readBigUInt64BE(2));off=10}
      if(len>3*1024*1024){wsClose(c);return}const mk=masked?4:0;if(c.buf.length<off+mk+len)return;
      let pl=c.buf.subarray(off+mk,off+mk+len);if(masked){const m=c.buf.subarray(off,off+4);pl=Buffer.from(pl);for(let i=0;i<pl.length;i++)pl[i]^=m[i&3]}
      c.buf=c.buf.subarray(off+mk+len);
      if(op===8){wsClose(c);return}
      if(op===9){try{sock.write(Buffer.concat([Buffer.from([0x8a,pl.length]),pl]))}catch(e){}continue}
      if(op===10)continue;
      if(op===1||op===0){c.frag.push(pl);if(!fin)continue;const txt=Buffer.concat(c.frag).toString('utf8');c.frag=[];try{onMsg(c,txt)}catch(e){console.error('message error',e&&e.message)}}}});
  sock.on('close',()=>wsClose(c));sock.on('error',()=>wsClose(c));
});
setInterval(()=>{const now=Date.now();for(const c of conns){if(now-c.alive>70000){wsClose(c);continue}try{c.sock.write(Buffer.from([0x89,0]))}catch(e){}}},25000);
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function onMsg(c,txt){let m;try{m=JSON.parse(txt)}catch(e){return}if(!m||typeof m!=='object')return;
  const now=Date.now();if(now-c.rate.t>1000){c.rate={t:now,n:0}}if(++c.rate.n>400)return;   // flood guard
  if(m.t==='hello'){const uid=String(m.uid||''),sec=String(m.sec||'');if(!/^u[a-z0-9]{8,40}$/.test(uid)||sec.length<16){wsSend(c,JSON.stringify({t:'auth'}));wsClose(c);return}
    const h=sha(sec),known=DB.users[uid];if(known&&known!==h){wsSend(c,JSON.stringify({t:'auth'}));wsClose(c);return}if(!known){DB.users[uid]=h;saveSoon()}
    c.uid=uid;c.owner=!!OWNER_KEY&&typeof m.owner==='string'&&m.owner.length>0&&crypto.timingSafeEqual(Buffer.from(sha(m.owner)),Buffer.from(sha(OWNER_KEY)));
    wsSend(c,JSON.stringify({t:'welcome',peer:c.peer,owner:c.owner}));return}
  if(!c.uid)return;
  if(m.t==='join'){const n=String(m.room||'').slice(0,80);if(!n||c.rooms.size>8)return;const r=roomOf(n);if(!r.members.has(c.peer)){if(r.members.size>=60)return;r.members.set(c.peer,{c,presence:{},at:now});c.rooms.add(n);r.dirty=true}return}
  if(m.t==='leave'){leaveRoom(c,String(m.room||''));return}
  if(m.t==='pres'){const r=rooms.get(String(m.room||''));const v=r&&r.members.get(c.peer);if(!v||!m.p||typeof m.p!=='object')return;if(m.full)v.presence={};
    for(const k in m.p){if(m.p[k]===null)delete v.presence[k];else v.presence[k]=m.p[k]}if(JSON.stringify(v.presence).length>64*1024)v.presence={};v.at=now;r.dirty=true;return}
  if(m.t==='emit'){const r=rooms.get(String(m.room||''));if(!r||!r.members.has(c.peer))return;const s=JSON.stringify({t:'ev',room:m.room,topic:String(m.topic||''),d:m.d,peer:c.peer});if(s.length>256*1024)return;
    for(const [p,v] of r.members)if(p!==c.peer)wsSend(v.c,s);return}
  if(m.t==='db'){let out;try{out={t:'res',id:m.id,ok:true,data:dbOp(c,m)}}catch(e){out={t:'res',id:m.id,ok:false,err:e&&e.code?e:err('unavailable',String(e&&e.message||e))}}wsSend(c,JSON.stringify(out));return}
}
server.on('clientError',(e,sock)=>{try{sock.end('HTTP/1.1 400 Bad Request\r\n\r\n')}catch(x){}});
process.on('uncaughtException',e=>console.error('uncaught',e&&e.stack||e));
server.listen(PORT,()=>console.log('War Zone running on port '+PORT+(OWNER_KEY?'':' (no OWNER_KEY set: nobody can reset passwords)')));
process.on('SIGTERM',()=>{try{fs.writeFileSync(DBF,JSON.stringify(DB))}catch(e){}process.exit(0)});
