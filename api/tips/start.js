// api/tips/start.js
export const config = { runtime: 'nodejs18.x' };

// --- helpers ---
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

function bad(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

async function supa(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) {
    const m = json?.message || json?.error || text || 'supabase error';
    throw new Error(`${r.status} ${m}`);
  }
  return json;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 405, 'Use POST');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return bad(res, 500, 'Missing Supabase env');
    }

    const body = await (async () => {
      try { return await req.json(); } catch { return null; }
    })();

    const {
      device_id,
      intent_id,             // optional; if not provided, server will set one
      target_type,           // 'page' | 'image'
      target_id,             // e.g. 'img3' (required if target_type==='image')
      display_name,          // optional
      amount_sats,           // integer
      client_ts              // ISO string (optional)
    } = body || {};

    if (!device_id || !target_type || !amount_sats) {
      return bad(res, 400, 'device_id, target_type, amount_sats required');
    }
    if (target_type === 'image' && !target_id) {
      return bad(res, 400, 'target_id required for image tips');
    }

    const nowIso = new Date().toISOString();
    const payload = {
      device_id,
      intent_id: intent_id || crypto.randomUUID(),
      target_type,
      target_id: target_type === 'image' ? target_id : null,
      display_name: display_name || null,
      amount_sats: Number(amount_sats),
      intent_at: client_ts || nowIso,
      status: 'pending',
      updated_at: nowIso
    };

    // Upsert single active pending per device:
    // Strategy:
    // 1) Mark any existing 'pending' for this device as 'superseded'
    await supa('pending_tips', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'superseded', updated_at: nowIso }),
      // filter: device_id=eq.<id>&status=eq.pending
    // Note: Supabase REST uses query string filters:
    }) // We add filters via URL
  } catch (e) {
    // We'll rework with query param version to support filters
  }
}
