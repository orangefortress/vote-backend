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

    const range = (req.query.range || 'all').toLowerCase();
    let since = null;
    if (range === '24h') since = "now() - interval '24 hours'";
    else if (range === '7d') since = "now() - interval '7 days'";
    else if (range === '30d') since = "now() - interval '30 days'";

    // Build PostgREST query to get who + sum(amount_sats), grouped and ordered
    // We’ll let PostgREST aggregate: select=who:display_name,sats:sum.amount_sats
    // and group=display_name, order by sats desc
    let path = `/confirmed_tips?select=who:display_name,sats:sum.amount_sats&group=display_name&order=sats.desc&limit=20`;

    if (since) {
      // Filter on confirmed_at >= since using PostgREST lt/gt syntax with raw expression
      // Use confirmed_at=gte.<ISO> if you prefer exact JS time; here we lean on server-side now()
      // For an expression, we need a view or RPC; so instead we’ll compute since in JS.
      const sinceIso = new Date(
        range === '24h' ? Date.now() - 24*60*60*1000 :
        range === '7d'  ? Date.now() - 7*24*60*60*1000 :
        range === '30d' ? Date.now() - 30*24*60*60*1000 : Date.now()
      ).toISOString();
      path += `&confirmed_at=gte.${encodeURIComponent(sinceIso)}`;
    }

    // Fetch
    const resp = await sb(path, { method:'GET' });
    if (!resp.ok) return res.status(500).json({ ok:false, error:'supabase fetch failed', detail: resp.data || resp.raw });

    // Normalize names: fallback to payer_pubkey prefix if display_name blank (do it in code)
    const rows = (resp.data || []).map(r => ({
      who: (r.who && r.who.trim()) ? r.who : 'Anonymous',
      sats: Number(r.sats||0)
    })).sort((a,b)=>b.sats-a.sats);

    res.status(200).json({ ok:true, rows });
  }catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
}
