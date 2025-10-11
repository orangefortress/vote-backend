
// api/reconcile-zaps.js
export const config = { runtime: 'nodejs18.x' };

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  YOUR_PROFILE_NPUB,
  NOSTR_RELAYS
} = process.env;

// ---- tiny bech32 decode for npub -> hex (no deps) ----
const CH='qpzry9x8gf2tvdw0s3jn54khce6mua7l', MAP={}; for(let i=0;i<CH.length;i++) MAP[CH[i]]=i;
const hrpExpand=h=>{const r=[];for(let i=0;i<h.length;i++)r.push(h.charCodeAt(i)>>5);r.push(0);for(let i=0;i<h.length;i++)r.push(h.charCodeAt(i)&31);return r;}
const polymod=v=>{let c=1;for(const x of v){const b=c>>>25;c=((c&0x1ffffff)<<5)^x;if(b&1)c^=0x3b6a57b2;if(b&2)c^=0x26508e6d;if(b&4)c^=0x1ea119fa;if(b&8)c^=0x3d4233dd;if(b&16)c^=0x2a1462b3;}return c;}
function bech32Decode(str){const pos=str.lastIndexOf('1');if(pos<1)throw new Error('bech32');const hrp=str.slice(0,pos),data=str.slice(pos+1);
  const vals=[];for(const ch of data){if(!(ch in MAP))throw new Error('char');vals.push(MAP[ch]);}
  if(vals.length<6)throw new Error('short');const check=polymod(hrpExpand(hrp).concat(vals));if(check!==1)throw new Error('sum');return{hrp,words:vals.slice(0,-6)};}
const convertBits=(data,from,to,pad)=>{let acc=0,bits=0,maxv=(1<<to)-1,ret=[];for(const v of data){if(v<0||(v>>from))return null;acc=(acc<<from)|v;bits+=from;while(bits>=to){bits-=to;ret.push((acc>>bits)&maxv);}}
  if(pad){if(bits>0)ret.push((acc<<(to-bits))&maxv);}else if(bits>=from||((acc<<(to-bits))&maxv))return null;return ret;}
const bytesToHex=b=>Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');

function npubToHex(npub){
  const s = npub.toLowerCase().replace(/^nostr:/,'');
  const { hrp, words } = bech32Decode(s);
  if (hrp !== 'npub') throw new Error('not npub');
  const data = convertBits(words, 5, 8, false);
  if (!data || data.length !== 32) throw new Error('bad npub');
  return bytesToHex(Uint8Array.from(data));
}

// ---- Supabase REST helper ----
async function supa(path, { method='GET', params, headers, body } = {}){
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${SUPABASE_URL}/rest/v1/${path}${qs}`;
  const r = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(`${r.status} ${json?.message || json?.error || text}`);
  return json;
}

const DEFAULT_RELAYS = [
  'wss://relay.damus.io','wss://relay.snort.social','wss://relay.primal.net','wss://offchain.pub',
  'wss://nos.lol','wss://nostr.wine','wss://relay.current.fyi','wss://relay.nostr.band',
  'wss://nostr.bitcoiner.social','wss://nostr.mom','wss://eden.nostr.land','wss://nostr.oxtr.dev'
];

export default async function handler(req, res){
  try{
    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !YOUR_PROFILE_NPUB) {
      return res.status(500).json({ ok:false, error:'Missing env' });
    }
    const pHex = npubToHex(YOUR_PROFILE_NPUB);

    // Query window: last 15 minutes (we run every 2m)
    const since = Math.floor(Date.now()/1000) - 15*60;

    const relays = (NOSTR_RELAYS?.split(',').map(s=>s.trim()).filter(Boolean)) || DEFAULT_RELAYS;

    // Fetch zap receipts from relays
    const subId = 'wb'+Math.random().toString(36).slice(2);
    const filter = { kinds:[9735], '#p':[pHex], since };
    const events = await sweepRelays(relays, subId, filter, 6000); // 6s budget

    // Store new receipts (dedup by id), then reconcile
    let saved = 0, confirmed = 0;

    for (const ev of events) {
      const amtTag = Array.isArray(ev.tags) ? ev.tags.find(t=>t[0]==='amount' && t[1]) : null;
      const msats = amtTag ? Number(amtTag[1]) : 0;
      if (!Number.isFinite(msats) || msats <= 0) continue;

      const row = {
        event_id: ev.id,
        pubkey: ev.pubkey,
        amount_msat: msats,
        created_at: new Date((ev.created_at||Math.floor(Date.now()/1000))*1000).toISOString(),
        relays_seen: (ev._relays || []).join(',')
      };

      // Upsert zap_receipts by primary key event_id
      try {
        await supa('zap_receipts', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates' },
          body: row
        });
        saved++;
      } catch { /* already exists */ }

      // Try to match to a pending
      const amount_sats = Math.round(msats/1000);
      const t = new Date(row.created_at).toISOString();

      // Pull candidate pendings with same amount within ±10 min and still 'pending'
      const minTs = new Date(new Date(row.created_at).getTime() - 10*60*1000).toISOString();
      const maxTs = new Date(new Date(row.created_at).getTime() + 10*60*1000).toISOString();

      const candidates = await supa('pending_tips', {
        params: {
          amount_sats: `eq.${amount_sats}`,
          status: 'eq.pending',
          intent_at: `gte.${minTs}`,
          // We'll filter upper bound after fetch (Supabase REST can't do both bounds on same col easily without RPC)
          select: '*'
        }
      });

      const filtered = candidates.filter(c => c.intent_at <= maxTs);
      if (!filtered.length) continue;

      // pick closest by absolute time diff
      filtered.sort((a,b)=>Math.abs(new Date(a.intent_at)-new Date(row.created_at)) - Math.abs(new Date(b.intent_at)-new Date(row.created_at)));
      const best = filtered[0];

      // Confirm: insert confirmed_tips, update pending->confirmed, supersede others
      const confirmRow = {
        pending_id: best.id,
        target_type: best.target_type,
        target_id: best.target_id,
        display_name: best.display_name,
        amount_sats,
        confirmed_at: t,
        payer_pubkey: ev.pubkey,
        relays_seen: row.relays_seen
      };
      await supa('confirmed_tips', { method:'POST', body: confirmRow });

      await supa('pending_tips', {
        method: 'PATCH',
        params: { id: `eq.${best.id}` },
        headers: { Prefer: 'return=minimal' },
        body: { status: 'confirmed', updated_at: new Date().toISOString() }
      });

      confirmed++;

      // Expire any other pendings for same device still pending (optional cleanup)
      await supa('pending_tips', {
        method: 'PATCH',
        params: { device_id: `eq.${best.device_id}`, status: 'eq.pending' },
        headers: { Prefer: 'return=minimal' },
        body: { status: 'expired', updated_at: new Date().toISOString() }
      });
    }

    res.status(200).json({ ok:true, relays: relays.length, receipts_saved: saved, tips_confirmed: confirmed });
  }catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
}

// Open multiple WebSockets to relays; collect events for ms timeout
function sweepRelays(relays, subId, filter, timeoutMs=6000){
  return new Promise((resolve) => {
    const events = [];
    const seen = new Set();
    const sockets = [];
    const timer = setTimeout(closeAll, timeoutMs);

    function closeAll(){
      clearTimeout(timer);
      sockets.forEach(ws => { try { ws.close(); } catch {} });
      // attach relays list to each event (simple)
      resolve(events);
    }

    const payload = JSON.stringify(['REQ', subId, filter]);
    for (const url of relays) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        ws.onopen = () => ws.send(payload);
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (Array.isArray(data) && data[0]==='EVENT' && data[1]===subId) {
              const ev = data[2];
              if (!seen.has(ev.id)) {
                seen.add(ev.id);
                ev._relays = (ev._relays || []);
                if (!ev._relays.includes(url)) ev._relays.push(url);
                events.push(ev);
              }
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {};
      } catch {}
    }
  });
}
