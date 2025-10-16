// api/email-receipt.js
// Accepts ForwardEmail webhook POSTs for *@worshipbitcoin.com.
// Parses sats + timestamp and confirms the nearest pending tip in Supabase.

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST')
      return res.status(405).json({ ok: false, error: 'Use POST' });

    const secret =
      (req.query?.secret ||
        req.headers['x-forwardemail-secret'] ||
        req.body?.secret ||
        '').toString();
    if (!secret || secret !== process.env.EMAIL_WEBHOOK_SECRET)
      return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const b = (typeof req.body === 'object' && req.body) || {};
    const from = (b.from || b.sender || '').toString();
    const subject = (b.subject || '').toString();
    const text = (b.text || b['body-plain'] || b.body || '').toString();
    const html = (b.html || b['body-html'] || '').toString();
    const to = (b.to || b.recipients || '').toString();
    const bodyAll = `${subject}\n${text}\n${html}`;

    const ALLOW = (process.env.EMAIL_ALLOW_LIST || '').toLowerCase();
    if (ALLOW) {
      const okSender = ALLOW.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .some(s => from.toLowerCase().includes(s));
      if (!okSender)
        return res.status(200).json({ ok: true, ignored: 'sender not allowed' });
    }

    // Parse sats
    let sats = null;
    const mSats = bodyAll.match(/([\d_., ]+)\s*sats?\b/i);
    if (mSats) {
      sats = Math.round(Number(mSats[1].replace(/[,_ ]/g, '')));
    } else {
      const mBtc = bodyAll.match(/([\d_., ]+)\s*btc\b/i);
      if (mBtc) {
        const btc = Number(mBtc[1].replace(/[,_ ]/g, ''));
        if (!Number.isNaN(btc)) sats = Math.round(btc * 100_000_000);
      }
    }
    if (!sats || !Number.isFinite(sats) || sats <= 0)
      return res.status(200).json({ ok: true, ignored: 'no sats parsed' });

    // Parse timestamp
    let receivedAt = new Date();
    const mIso = bodyAll.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?)/);
    if (mIso) {
      const t = new Date(mIso[1]);
      if (!isNaN(+t)) receivedAt = t;
    }

    const windowMinutes = Number(process.env.RECEIPT_MATCH_MINUTES || '15');
    const sinceIso = new Date(receivedAt.getTime() - windowMinutes * 60000).toISOString();
    const untilIso = new Date(receivedAt.getTime() + windowMinutes * 60000).toISOString();

    const tol = Math.min(Math.max(Math.round(sats * 0.1), 20), 1200);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    async function sb(path, init) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          ...(init && init.headers)
        }
      });
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      return { ok: r.ok, status: r.status, data: json, raw: text };
    }

    const qp = new URLSearchParams({
      status: 'eq.pending',
      intent_at: `gte.${sinceIso}`,
      order: 'intent_at.desc'
    }).toString();

    const { ok: okPend, data: pend } = await sb(`/pending_tips?${qp}`, { method: 'GET' });
    if (!okPend) return res.status(500).json({ ok: false, error: 'pending fetch failed' });

    const candidates = (pend || []).filter(p => {
      if (p.intent_at > untilIso) return false;
      const amt = Number(p.amount_sats || 0);
      return Math.abs(amt - sats) <= tol;
    });
    if (!candidates.length)
      return res.status(200).json({ ok: true, unmatched: true, sats, receivedAt });

    candidates.sort(
      (a, b) =>
        Math.abs(new Date(a.intent_at) - receivedAt) -
        Math.abs(new Date(b.intent_at) - receivedAt)
    );
    const best = candidates[0];

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
    const ins = await sb('/confirmed_tips', {
      method: 'POST',
      body: JSON.stringify(confirmRow)
    });
    if (!ins.ok)
      return res
        .status(500)
        .json({ ok: false, error: 'confirm insert failed', detail: ins.data || ins.raw });

    const upd = await sb(`/pending_tips?id=eq.${encodeURIComponent(best.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() })
    });
    if (!upd.ok)
      return res
        .status(500)
        .json({ ok: false, error: 'pending update failed', detail: upd.data || upd.raw });

    await sb(
      `/pending_tips?device_id=eq.${encodeURIComponent(best.device_id)}&status=eq.pending`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() })
      }
    );

    return res.status(200).json({ ok: true, matched_pending_id: best.id, sats, receivedAt });
  } catch (e) {
    console.error('email-receipt error', e);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
}
