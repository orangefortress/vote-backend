// api/leaderboard.js
export const config = { runtime: 'nodejs' };

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

function bad(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

async function supa(sql) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || 'rpc error');
  return j;
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
      return bad(res, 500, 'Missing Supabase env');

    const range = (req.query.range || 'all').toLowerCase();
    const whereRange =
      range === '24h'
        ? "AND confirmed_at >= now() - interval '24 hours'"
        : range === '7d'
        ? "AND confirmed_at >= now() - interval '7 days'"
        : range === '30d'
        ? "AND confirmed_at >= now() - interval '30 days'"
        : '';

    const sql = `
      SELECT COALESCE(NULLIF(display_name,''), LEFT(payer_pubkey, 8) || '…') AS who,
             SUM(amount_sats)::int AS sats
      FROM confirmed_tips
      WHERE TRUE ${whereRange}
      GROUP BY who
      ORDER BY sats DESC
      LIMIT 20;
    `;
    const rows = await supa(sql);
    res.status(200).json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
