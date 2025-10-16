// api/tips/start.js
export const config = { runtime: 'nodejs' };

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

function bad(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

async function supa(path, { method = 'GET', body, params, headers } = {}) {
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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(`${r.status} ${json?.message || json?.error || text || 'supabase error'}`);
  return json;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 405, 'Use POST');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return bad(res, 500, 'Missing Supabase env');

    // Robust body parsing
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        let data = '';
        await new Promise(resolve => {
          req.on('data', c => (data += c));
          req.on('end', resolve);
        });
        body = JSON.parse(data || '{}');
      } catch {
        body = null;
      }
    }
    if (!body) return bad(res, 400, 'Invalid JSON body');

    const {
      device_id,
      intent_id,
      target_type,   // 'page' | 'image'
      target_id,     // required if image
      display_name,
      amount_sats,
      client_ts
    } = body || {};

    if (!device_id || !target_type || !amount_sats)
      return bad(res, 400, 'device_id, target_type, amount_sats required');
    if (target_type === 'image' && !target_id)
      return bad(res, 400, 'target_id required for image tips');

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

    // 1) Supersede any previous pending for this device
    await supa('pending_tips', {
      method: 'PATCH',
      params: { device_id: `eq.${device_id}`, status: 'eq.pending' },
      headers: { Prefer: 'return=minimal' },
      body: { status: 'superseded', updated_at: nowIso }
    });

    // 2) Insert the new pending
    const inserted = await supa('pending_tips', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: payload
    });

    res.status(200).json({ ok: true, pending: inserted?.[0] || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
