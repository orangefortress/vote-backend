// api/email-receipt.js
// Accepts ForwardEmail webhook POSTs and confirms nearest matching pending tip.
// Hardened: supports SUPABASE_SERVICE_ROLE or SUPABASE_KEY, safer allowlist,
// better amount parsing, wider but configurable time window, robust candidate pick.

export const config = { runtime: 'nodejs' };

// --- Env helpers (accept either SERVICE_ROLE or KEY) ---
function getSBEnv() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_KEY ||            // fallback for older handlers
    '';
  return { url, key };
}

function sbHeaders(key) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

// --- HTTP helper to Supabase PostgREST ---
async function sbFetch(path, init = {}) {
  const { url, key } = getSBEnv();
  if (!url || !key) {
    return { ok: false, status: 500, data: { error: 'Missing Supabase env' } };
  }
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1${path}`, {
    ...init,
    headers: { ...sbHeaders(key), ...(init.headers || {}) },
  });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, data: json, raw: txt };
}

// --- Utils ---
function parseAmountSats(str) {
  if (!str) return null;
  // sats first
  const mSats = str.match(/([\d][\d _.,]*)\s*sats?\b/i);
  if (mSats) {
    const n = Number(mSats[1].replace(/[ _.,]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  // btc fallback
  const mBtc = str.match(/([\d][\d _.,]*)\s*btc\b/i);
  if (mBtc) {
    const n = Number(mBtc[1].replace(/[ _.,]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100_000_000) : null;
  }
  return null;
}

function firstIsoLike(str) {
  if (!str) return null;
  const m = str.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return null;
  const t = new Date(m[1]);
  return Number.isNaN(+t) ? null : t;
}

function ok(res, body) { return res.status(200).json({ ok: true, ...body }); }
function bad(res, code, msg, detail) { return res.status(code).json({ ok: false, error: msg, detail: detail ?? null }); }

// --- Main handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 405, 'Use POST');

    // Secret check (query, header, or body)
    const provided = String(
      req.query?.secret ||
      req.headers['x-forwardemail-secret'] ||
      (typeof req.body === 'object' && req.body?.secret) ||
      ''
    );
    if (!provided || provided !== process.env.EMAIL_WEBHOOK_SECRET) {
      return bad(res, 401, 'Unauthorized: bad secret');
    }

    // Normalized body
    const body = (typeof req.body === 'object' && req.body) || {};
    const from    = String(body.from || body.sender || '');
    const subject = String(body.subject || '');
    const text    = String(body.text || body['body-plain'] || body.body || '');
    const html    = String(body.html || body['body-html'] || '');
    const all     = `${subject}\n${text}\n${html}`;

    // Optional allowlist (comma-separated, matches substring)
    const allow = (process.env.EMAIL_ALLOW_LIST || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (allow.length) {
      const sender = from.toLowerCase();
      const allowed = allow.some(t => t && sender.includes(t));
      if (!allowed) return ok(res, { ignored: 'sender not allowed' });
    }

    // Amount + time parsing
    const sats = parseAmountSats(all);
    if (!sats || !Number.isFinite(sats) || sats <= 0) return ok(res, { ignored: 'no sats parsed' });

    const tParsed = firstIsoLike(all) || new Date();
    const receivedAt = new Date(tParsed); // normalize
    const windowMin = Math.max(1, Number(process.env.RECEIPT_MATCH_MINUTES || '30')); // default 30m (was 15m)
    const since = new Date(receivedAt.getTime() - windowMin * 60_000).toISOString();
    const until = new Date(receivedAt.getTime() + windowMin * 60_000).toISOString();

    // Tolerance: ±10%, min 20, max 1200 (same as before)
    const tol = Math.min(Math.max(Math.round(sats * 0.10), 20), 1200);

    // Fetch candidate pendings within window
    const pendPath =
      `/pending_tips?select=*` +
      `&status=eq.pending` +
      `&intent_at=gte.${encodeURIComponent(since)}` +
      `&intent_at=lte.${encodeURIComponent(until)}` +
      `&order=intent_at.desc`;

    const pend = await sbFetch(pendPath, { method: 'GET' });
    if (!pend.ok) return bad(res, 500, 'pending fetch failed', { status: pend.status, data: pend.data });

    const candidates = (Array.isArray(pend.data) ? pend.data : []).filter(p => {
      const amt = Number(p.amount_sats || 0);
      return Math.abs(amt - sats) <= tol;
    });

    if (!candidates.length) return ok(res, { unmatched: true, sats, receivedAt });

    // Pick best by (time distance + amount distance), with time weighted slightly more
    const best = candidates
      .map(p => {
        const tDiff = Math.abs(new Date(p.intent_at) - receivedAt);  // ms
        const aDiff = Math.abs(Number(p.amount_sats || 0) - sats);   // sats
        const score = tDiff / 1000 + aDiff * 5; // 1s ~= 5 sats (tuneable)
        return { p, score };
      })
      .sort((a,b) => a.score - b.score)[0].p;

    // Insert confirmation
    const confirmRow = {
      pending_id: best.id,
      target_type: best.target_type,
      target_id: best.target_id,
      display_name: best.display_name || null,
      amount_sats: sats,
      confirmed_at: new Date().toISOString(),
      source_tx_id: null,
      source_received_at: receivedAt.toISOString(),
    };

    const ins = await sbFetch('/confirmed_tips', {
      method: 'POST',
      body: JSON.stringify(confirmRow),
    });
    if (!ins.ok) return bad(res, 500, 'confirm insert failed', { status: ins.status, data: ins.data });

    // Mark matched pending as confirmed
    const upd1 = await sbFetch(`/pending_tips?id=eq.${encodeURIComponent(best.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    if (!upd1.ok) return bad(res, 500, 'pending update failed', { status: upd1.status, data: upd1.data });

    // Expire any other pendings for same device (cleanup)
    if (best.device_id) {
      await sbFetch(`/pending_tips?device_id=eq.${encodeURIComponent(best.device_id)}&status=eq.pending`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
    }

    return ok(res, { matched_pending_id: best.id, sats, receivedAt });
  } catch (e) {
    return bad(res, 500, 'server error', e?.message || String(e));
  }
}
