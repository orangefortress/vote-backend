// api/v1/leaderboard.js
// Fetch zap receipts (kind:9735) for ONE note id (note/nevent/hex).
// 1) Try indexer (nostr.wine). 2) Fallback to a short relay sweep (server-side).
// Returns: { ok, note_id, total_sats, top: [{pubkey, sats}] }

const DEFAULT_RELAYS = [
  'wss://relay.damus.io','wss://relay.snort.social','wss://nos.lol','wss://eden.nostr.land','wss://nostr.wine',
  'wss://relay.nostr.band','wss://relay.current.fyi','wss://relay.primal.net','wss://offchain.pub','wss://nostr.bitcoiner.social',
  'wss://nostr.relayer.se','wss://nostr.oxtr.dev','wss://relay.nsec.app','wss://nostr21.com','wss://nostr.mom'
];

// ---- tiny bech32 decode (note/nevent) ----
const CH='qpzry9x8gf2tvdw0s3jn54khce6mua7l'; const MAP={}; for(let i=0;i<CH.length;i++) MAP[CH[i]]=i;
const hrpExpand = hrp => { const r=[]; for(let i=0;i<hrp.length;i++) r.push(hrp.charCodeAt(i)>>5); r.push(0); for(let i=0;i<hrp.length;i++) r.push(hrp.charCodeAt(i)&31); return r; };
const polymod = v => { let c=1; for(const x of v){ const b=c>>>25; c=((c&0x1ffffff)<<5)^x;
  if(b&1)c^=0x3b6a57b2; if(b&2)c^=0x26508e6d; if(b&4)c^=0x1ea119fa; if(b&8)c^=0x3d4233dd; if(b&16)c^=0x2a1462b3; } return c; };
function bech32Decode(str){ const pos=str.lastIndexOf('1'); if(pos<1) throw new Error('bech32'); const hrp=str.slice(0,pos); const data=str.slice(pos+1);
  const vals=[]; for(const ch of data){ if(!(ch in MAP)) throw new Error('char'); vals.push(MAP[ch]); }
  if(vals.length<6) throw new Error('short'); const check=polymod(hrpExpand(hrp).concat(vals)); if(check!==1) throw new Error('sum'); return {hrp,words:vals.slice(0,-6)};
}
const convertBits=(data,from,to,pad=true)=>{ let acc=0,bits=0,maxv=(1<<to)-1,ret=[]; for(const v of data){ if(v<0||(v>>from)) return null; acc=(acc<<from)|v; bits+=from; while(bits>=to){ bits-=to; ret.push((acc>>bits)&maxv);} }
  if(pad){ if(bits>0) ret.push((acc<<(to-bits))&maxv);} else if(bits>=from||((acc<<(to-bits))&maxv)) return null; return ret; };
const bytesToHex = b => Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
function parseNoteId(input){
  if(!input) return null;
  let s = String(input).trim();
  // accept njump/snort/etc links
  try{ const u=new URL(s); const last=u.pathname.split('/').filter(Boolean).pop()||''; if(last) s=last; }catch{}
  s = s.replace(/^nostr:/i,'').toLowerCase();
  const hex = s.replace(/^0x/,'');
  if(/^[0-9a-f]{64}$/.test(hex)) return hex;
  // bech32 note/nevent
  try{
    const {hrp,words}=bech32Decode(s);
    const data=convertBits(words,5,8,false);
    if(hrp==='note'){ if(data.length!==32) throw 0; return bytesToHex(data); }
    if(hrp==='nevent'){
      let i=0, id=null;
      while(i<data.length){ const t=data[i++], l=data[i++]; const v=data.slice(i,i+l); i+=l; if(t===0x01 && l===32) id=bytesToHex(v); }
      if(!id) throw 0; return id;
    }
  }catch{}
  return null;
}

// ---- indexer: nostr.wine ----
async function fetchFromIndexer(eventHex, signal){
  const base='https://api.nostr.wine/search';
  const tries = [
    `${base}?kind=9735&query=e:${eventHex}`,
    `${base}?kind=9735&query=%23e:${eventHex}`,
    `${base}?kind=9735&query=${eventHex}`,
  ];
  for (const url of tries){
    try{
      const r = await fetch(url, { signal, headers: { 'accept':'application/json' }});
      if(!r.ok) continue;
      const j = await r.json();
      const arr = j?.events || j?.data || [];
      if(Array.isArray(arr) && arr.length) return arr;
    }catch{}
  }
  return [];
}

// ---- fallback: short server-side relay scan via nostr-tools ----
async function fetchFromRelays(eventHex, signal){
  const { SimplePool } = await import('nostr-tools'); // npm dep (must be in package.json)
  const pool = new SimplePool();
  const relays = (process.env.LEADERBOARD_RELAYS || '')
    .split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
  const urls = relays.length ? relays : DEFAULT_RELAYS;

  const events = [];
  const sub = pool.sub(urls, [{ kinds:[9735], '#e':[eventHex], since: 0, limit: 2000 }]);
  return await new Promise(resolve=>{
    const timer = setTimeout(() => { try{sub.unsub();}catch{} try{pool.close(urls);}catch{} resolve(events); }, 5000);
    sub.on('event', (ev)=>{ events.push(ev); });
    sub.on('eose', ()=>{ /* let timer end */ });
    signal?.addEventListener?.('abort', ()=>{ clearTimeout(timer); try{sub.unsub();}catch{} try{pool.close(urls);}catch{} resolve(events); });
  });
}

function msatsFromZap(ev){
  const t = Array.isArray(ev.tags)? ev.tags.find(t=>t[0]==='amount' && t[1]) : null;
  const n = t ? Number(t[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}
function aggregate(events){
  const byPub = new Map();
  let totalMsats = 0;
  for(const ev of events){
    const ms = msatsFromZap(ev);
    if(!ms) continue;
    totalMsats += ms;
    byPub.set(ev.pubkey, (byPub.get(ev.pubkey)||0) + ms);
  }
  const top = [...byPub.entries()]
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10)
    .map(([pubkey,totalMsats])=>({ pubkey, sats: Math.round(totalMsats/1000) }));
  return { total_sats: Math.round(totalMsats/1000), top };
}

export default async function handler(req, res){
  try{
    const { note } = req.query;
    const raw = (note || process.env.LEADERBOARD_NOTE || '').toString();
    const eventHex = parseNoteId(raw);
    if(!eventHex){
      return res.status(400).json({ ok:false, error:'bad_note', message:'Note id (note/nevent/hex) not provided or invalid' });
    }

    const ac = new AbortController();
    const { signal } = ac;
    const timeout = setTimeout(()=>ac.abort(), 12000);

    let events = await fetchFromIndexer(eventHex, signal);
    if(!events || !events.length){
      events = await fetchFromRelays(eventHex, signal);
    }
    clearTimeout(timeout);

    const agg = aggregate(events || []);
    return res.status(200).json({
      ok: true,
      note_id: eventHex,
      source: (events && events.length) ? 'ok' : 'empty',
      total_sats: agg.total_sats,
      top: agg.top
    });
  } catch (e){
    return res.status(500).json({ ok:false, error:'server_error', message:String(e && e.message || e) });
  }
}

export const config = {
  runtime: 'nodejs18.x'
};
