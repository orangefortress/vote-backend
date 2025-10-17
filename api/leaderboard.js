// api/leaderboard.js
export const config = { runtime: 'nodejs' };

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

function bad(res, code, msg){ res.status(code).json({ ok:false, error:msg }); }

async function sb(path, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      ...(init && init.headers),
    }
  });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, data: json, raw: txt };
}

export default async function handler(req, res){
  try{
    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return bad(res,500,'Missing Supabase env');

    // Optional ?range=24h|7d|30d|all
    const range = (req.query.range || 'all').toLowerCase();
    const now = Date.now();
    const sinceIso =
      range === '24h' ? new Date(now - 24*60*60*1000).toISOString() :
      range === '7d'  ? new Date(now - 7*24*60*60*1000).toISOString() :
      range === '30d' ? new Date(now - 30*24*60*60*1000).toISOString() : null;

    // Build PostgREST query to aggregate by display_name
    let path = `/confirmed_tips?select=who:display_name,sats:sum.amount_sats&group=display_name&order=sats.desc&limit=20`;
    if (sinceIso) path += `&confirmed_at=gte.${encodeURIComponent(sinceIso)}`;

    const resp = await sb(path, { method:'GET' });
    if (!resp.ok) return res.status(500).json({ ok:false, error:'supabase fetch failed', detail: resp.data || resp.raw });

    const rows = (resp.data || []).map(r => ({
      who: (r.who && r.who.trim()) ? r.who : 'Anonymous',
      sats: Number(r.sats||0)
    })).sort((a,b)=>b.sats-a.sats);

    res.status(200).json({ ok:true, rows });
  }catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
}
