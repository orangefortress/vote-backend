// ESM + dependency-free Supabase REST
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function haveEnv() {
  return {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_KEY: !!process.env.SUPABASE_KEY
  };
}

async function supabaseFetch(path, opts = {}) {
  const base = process.env.SUPABASE_URL || "";
  const key  = process.env.SUPABASE_KEY || "";
  if (!base || !key) {
    return { ok: false, status: 500, json: { error: "Missing env: SUPABASE_URL and/or SUPABASE_KEY" } };
  }
  const url = base.replace(/\/+$/, "") + "/rest/v1" + path;
  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...(opts.headers || {})
  };
  const res = await fetch(url, { ...opts, headers });
  let json = null;
  try { json = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, json };
}

export default async function handler(req, res) {
  try {
    // CORS / preflight
    if (req.method === "OPTIONS") {
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(204).end();
    }
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method === "GET") {
      const env = haveEnv();
      if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
        return res.status(500).json({ ok: false, haveEnv: env, db_ok: false, error: "Missing env vars" });
      }
      // Tiny probe: read 1 id to confirm table reachability (and get a clear REST error if not)
      const r = await supabaseFetch("/votes?select=id&limit=1", { method: "GET", headers: { Prefer: "count=exact" } });
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, haveEnv: env, db_ok: false, error: "Supabase REST error on votes", detail: r.json });
      }
      return res.status(200).json({
        ok: true,
        haveEnv: env,
        db_ok: true,
        note: "Using Supabase REST via fetch (no npm deps).",
        sample_rows_returned: Array.isArray(r.json) ? r.json.length : null
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // POST
    let body = req.body;
    if (!body || typeof body !== "object") {
      try { body = JSON.parse(req.body); } catch { body = null; }
    }
    if (!body) return res.status(400).json({ error: "Invalid JSON body" });

    const { imageFile, score } = body;
    const nScore = Number(score);
    if (typeof imageFile !== "string" || !imageFile.trim()) {
      return res.status(400).json({ error: "imageFile is required" });
    }
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 10) {
      return res.status(400).json({ error: "score must be an integer 1–10" });
    }

    const user_ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const payload = [{ image_file: imageFile.trim(), score: nScore, user_ip }];

    const r = await supabaseFetch("/votes", { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) {
      return res.status(r.status).json({ error: "Supabase insert error (REST)", detail: r.json });
    }

    return res.status(200).json({ success: true, rows: r.json });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error (handler)" });
  }
}
