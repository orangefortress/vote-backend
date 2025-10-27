// api/email-receipt.js
// ForwardEmail webhook → confirm nearest pending tip.
// Enhanced amount/time parsing for Coinos/Nostr-style receipts (⚡N, Memo JSON amount msat).

export const config = { runtime: 'nodejs' };

/* ---------- Supabase helpers ---------- */
function getSBEnv() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY || '';
  return { url, key };
}
function sbHeaders(key) {
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}
async function sb(path, init = {}) {
  const { url, key } = getSBEnv();
  if (!url || !key) return { ok: false, status: 500, data: { error: 'Missing Supabase env' } };
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1${path}`, {
    ...init, headers: { ...sbHeaders(key), ...(init.headers || {}) }
  });
  const txt = await r.text(); let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, data: json, raw: txt };
}

/* ---------- Body parsing (json/urlencoded/multipart) ---------- */
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await new Promise((resolve) => {
    let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data));
  });
  const ct = (req.headers['content-type'] || '').toLowerCase();

  if (ct.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const out = {}; for (const [k, v] of new URLSearchParams(raw)) out[k] = v; return out;
  }
  if (ct.includes('multipart/form-data')) {
    // Simple field extraction for typical keys
    const fields = {};
    const tryGrab = (name) => {
      const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`, 'm');
      const head = new RegExp(`name="${nameEsc}"[\\s\\S]*?\\r?\\n\\r?\\n`, 'm');
      const parts = raw.split(head);
      if (parts.length > 1) {
        const m = parts[1].match(/([\s\S]*?)\r?\n--/m);
        if (m) fields[name] = m[1].trim();
      }
    };
    ['from','sender','subject','text','body-plain','html','body'].forEach(tryGrab);
    return fields;
  }
  return {};
}

/* ---------- Amount & time parsing ---------- */
function parseAmountSats(allText) {
  if (!allText) return { sats: null, msat: null };

  // 1) explicit "NN sats"
  const mSats = allText.match(/([\d][\d _.,]*)\s*sats?\b/i);
  if (mSats) {
    const n = Number(mSats[1].replace(/[ _.,]/g, ''));
    if (Number.isFinite(n) && n > 0) return { sats: Math.round(n), msat: n * 1000 };
  }

  // 2) explicit "NN msat/msats"
  const mMsat = allText.match(/([\d][\d _.,]*)\s*msats?\b/i);
  if (mMsat) {
    const ms = Number(mMsat[1].replace(/[ _.,]/g, ''));
    if (Number.isFinite(ms) && ms > 0) return { sats: Math.round(ms / 1000), msat: ms };
  }

  // 3) "⚡️NN" or "⚡NN" (lightning amount with no unit)
  const mZap = allText.match(/⚡️?\s*([\d][\d _.,]*)\b/);
  if (mZap) {
    const n = Number(mZap[1].replace(/[ _.,]/g, ''));
    if (Number.isFinite(n) && n > 0) return { sats: Math.round(n), msat: n * 1000 };
  }

  // 4) Try to extract Memo JSON and read tags[["amount","<msat>"], ...]
  // Find first JSON-looking block after 'Memo:' or anywhere
  const memoMatch = allText.match(/Memo:\s*({[\s\S]+?})\s*$/m) || allText.match(/({[\s\S]+})/m);
  if (memoMatch) {
    try {
      const memo = JSON.parse(memoMatch[1]);
      if (Array.isArray(memo.tags)) {
        for (const t of memo.tags) {
          if (Array.isArray(t) && t[0] === 'amount' && t[1]) {
            const ms = Number(String(t[1]).replace(/[ _.,]/g, ''));
            if (Number.isFinite(ms) && ms > 0) return { sats: Math.round(ms / 1000), msat: ms };
          }
        }
      }
    } catch {/* ignore */}
  }

  // 5) "$0.02" present → not reliable for sats without rate; ignore.

  return { sats: null, msat: null };
}

function parseReceivedAt(allText) {
  // Prefer Memo JSON created_at (Unix seconds)
  const memoMatch = allText.match(/Memo:\s*({[\s\S]+?})\s*$/m) || allText.match(/({[\s\S]+})/m);
  if (memoMatch) {
    try {
      const memo = JSON.parse(memoMatch[1]);
      if (typeof memo.created_at === 'number' && isFinite(memo.created_at)) {
        const d = new Date(memo.created_at * 1000);
        if (!Number.isNaN(+d)) return d;
      }
    } catch {/* ignore */}
  }
  // Else, try ISO-like timestamp in the body
  const mIso = allText.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  if (mIso) {
    const d = new Date(mIso[1]); if (!Number.isNaN(+d)) return d;
  }
  // Fallback: now
  return new Date();
}

/* ---------- HTTP helpers ---------- */
function ok(res, body) { return res.status(200).json({ ok: true, ...body }); }
function bad(res, code, msg, detail) { return res.status(code).json({ ok: false, error: msg, detail: detail ?? null }); }

/* ---------- Main handler ---------- */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 405, 'Use POST');

    // Secret can be in query, header, or body
    const provided = String(
      req.query?.secret ||
      req.headers['x-forwardemail-secret'] ||
      (typeof req.body === 'object' && req.body?.secret) ||
      ''
    );
    if (!provided || provided !== process.env.EMAIL_WEBHOOK_SECRET) {
      return bad(res, 401, 'Unauthorized: bad secret');
    }

    const b = await parseBody(req);

    const from    = String(b.from || b.sender || '');
    const subject = String(b.subject || '');
    const text    = String(b.text || b['body-plain'] || b.body || '');
    const html    = String(b.html || b['body-html'] || '');
    const all     = `${subject}\n${text}\n${html}`;

    // Optional sender allowlist
    const allow = (process.env.EMAIL_ALLOW_LIST || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (allow.length) {
      const sender = from.toLowerCase();
      const allowed = allow.some(t => t && sender.includes(t));
      if (!allowed) {
        console.log('email-receipt: ignored sender', { from });
        return ok(res, { ignored: 'sender not allowed' });
      }
    }

    const { sats } = parseAmountSats(all);
    if (!sats || !Number.isFinite(sats) || sats <= 0) {
      console.log('email-receipt: no-sats-parsed', { subject, from });
      return ok(res, { ignored: 'no sats parsed' });
    }

    const receivedAt = parseReceivedAt(all);
    const windowMin = Math.max(1, Number(process.env.RECEIPT_MATCH_MINUTES || '30')); // default 30 min
    const sinceIso  = new Date(receivedAt.getTime() - windowMin * 60_000).toISOString();
    const untilIso  = new Date(receivedAt.getTime() + windowMin * 60_000).toISOString();

    // ±10% tolerance, min 20, max 1200
    const tol = Math.min(Math.max(Math.round(sats * 0.10), 20), 1200);

    // Fetch pendings in window
    const pendPath =
      `/pending_tips?select=*` +
      `&status=eq.pending` +
      `&intent_at=gte.${encodeURIComponent(sinceIso)}` +
      `&intent_at=lte.${encodeURIComponent(untilIso)}` +
      `&order=intent_at.desc`;
    const pend = await sb(pendPath, { method: 'GET' });
    if (!pend.ok) return bad(res, 500, 'pending fetch failed', { status: pend.status, data: pend.data });

    const candidates = (Array.isArray(pend.data) ? pend.data : []).filter(p => {
      const amt = Number(p.amount_sats || 0);
      return Math.abs(amt - sats) <= tol;
    });

    if (!candidates.length) {
      console.log('email-receipt: unmatched', { sats, receivedAt });
      return ok(res, { unmatched: true, sats, receivedAt });
    }

    // Pick best by time + amount
    const best = candidates
      .map(p => {
        const tDiff = Math.abs(new Date(p.intent_at) - receivedAt);  // ms
        const aDiff = Math.abs(Number(p.amount_sats || 0) - sats);   // sats
        const score = tDiff / 1000 + aDiff * 5; // weight time slightly more
        return { p, score };
      })
      .sort((a,b)=> a.score - b.score)[0].p;

    // Insert confirmation
    const confirmRow = {
      pending_id: best.id,
      target_type: best.target_type,
      target_id: best.target_id,
      display_name: best.display_name || null,
      amount_sats: sats,
      confirmed_at: new Date().toISOString(),
      source_tx_id: null,
      source_received_at: receivedAt.toISOString()
    };
    const ins = await sb('/confirmed_tips', { method: 'POST', body: JSON.stringify(confirmRow) });
    if (!ins.ok) return bad(res, 500, 'confirm insert failed', { status: ins.status, data: ins.data });

    // Update pending
    const upd = await sb(`/pending_tips?id=eq.${encodeURIComponent(best.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() })
    });
    if (!upd.ok) return bad(res, 500, 'pending update failed', { status: upd.status, data: upd.data });

    // Expire other pendings for same device
    if (best.device_id) {
      await sb(`/pending_tips?device_id=eq.${encodeURIComponent(best.device_id)}&status=eq.pending`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() })
      });
    }

    console.log('email-receipt: confirmed', { sats, pending_id: best.id, target: best.target_type, target_id: best.target_id || null });
    return ok(res, { matched_pending_id: best.id, sats, receivedAt });
  } catch (e) {
    console.error('email-receipt error', e);
    return bad(res, 500, 'server error', e?.message || String(e));
  }
}
