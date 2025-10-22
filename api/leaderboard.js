// /api/leaderboard.js
export const config = { runtime: 'nodejs' };

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function send(res, code, body) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(code).json(body);
}

function escLiteral(s = '') {
  return String(s).replace(/'/g, "''");
}

async function execSQL(sql) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(j?.message || 'rpc error');
    err.detail = j;
    throw err;
  }
  return j;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, null);
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return send(res, 500, { ok: false, error: 'Missing Supabase env' });
    }

    const range = String(req.query.range || 'all').toLowerCase();
    const whereRange =
      range === '24h' ? "AND confirmed_at >= now() - interval '24 hours'" :
      range === '7d'  ? "AND confirmed_at >= now() - interval '7 days'"  :
      range === '30d' ? "AND confirmed_at >= now() - interval '30 days'" :
                        '';

    const target = String(req.query.target || '').toLowerCase();
    const target_id = String(req.query.target || req.query.target_id || '');
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));

    let sql;

    if (target === 'image' && target_id) {
      const tid = escLiteral(target_id);
      sql = `
        SELECT
          COALESCE(NULLIF(display_name,''), LEFT(payer_pubkey, 8) || '…') AS who,
          SUM(amount_sats)::int AS sats
        FROM confirmed_tips
        WHERE target_type = 'image'
          AND target_id = '${tid}'
          ${whereRange}
        GROUP BY who
        ORDER BY sats DESC
        LIMIT ${limit}
      `;
    } else {
      sql = `
        SELECT
          COALESCE(NULLIF(display_name,''), LEFT(payer_pubkey, 8) || '…') AS who,
          SUM(amount_sats)::int AS sats
        FROM confirmed_tips
        WHERE TRUE
          ${whereRange}
        GROUP BY who
        ORDER BY sats DESC
        LIMIT ${limit}
      `;
    }

    const rows = await execSQL(sql);
    return send(res, 200, { ok: true, rows });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message || 'server error', detail: e.detail || null });
  }
}
