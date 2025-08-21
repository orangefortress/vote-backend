// Dependency-free Supabase REST approach (no @supabase/* needed)
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

async function supabaseFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) {
    return { ok: false, status: 500, json: { error: "Missing env: SUPABASE_URL and/or SUPABASE_KEY" } };
  }
  const full = url.replace(/\/+$/, "") + "/rest/v1" + path;
  const headers = Object.assign(
    {
      "apikey": key,
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Prefer": "return=representation" // get row back (optional)
    },
    opts.headers || {}
  );
  const res = await fetch(full, { ...opts, headers });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

module.exports = async (req, res) => {
  const headers = cors();

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();

  // Health check: GET /api/v1/vote
  if (req.method === "GET") {
    const haveEnv = { SUPABASE_URL: !!process.env.SUPABASE_URL, SUPABASE_KEY: !!process.env.SUPABASE_KEY };
    if (!haveEnv.SUPABASE_URL || !haveEnv.SUPABASE_KEY) {
      return res.status(500).set(headers).json({ ok: false, haveEnv, db_ok: false, error: "Missing env vars" });
    }
    try {
      // Zero-row probe: ask for id, limit=1 just to see if table is reachable
      const r = await supabaseFetch("/votes?select=id&limit=1", { method: "GET", headers: { "Prefer": "count=exact" } });
      if (!r.ok) {
        return res.status(r.status).set(headers).json({
          ok: false, haveEnv, db_ok: false,
          error: "Supabase REST error on votes",
          detail: r.json
        });
      }
      const countHeader = "x-content-range"; // e.g., "0-0/123"
      const contentRange = (r.json && Array.isArray(r.json)) ? `${r.json.length ? "0-0" : "0- -1"}/${r.json.length}` : null;
      return res.status(200).set(headers).json({
        ok: true, haveEnv, db_ok: true,
        note: "Using Supabase REST via fetch (no npm deps).",
        sample_rows_returned: Array.isArray(r.json) ? r.json.length : null,
        content_range: contentRange
      });
    } catch (e) {
      return res.status(500).set(headers).json({ ok: false, error: e?.message || String(e) });
    }
  }

  // Insert vote: POST /api/v1/vote
  if (req.method !== "POST") {
    return res.status(405).set(headers).json({ error: "Method Not Allowed" });
  }

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      try { body = JSON.parse(req.body); } catch { body = null; }
    }
    if (!body) return res.status(400).set(headers).json({ error: "Invalid JSON body" });

    const { imageFile, score } = body;
    const nScore = Number(score);
    if (typeof imageFile !== "string" || !imageFile.trim()) {
      return res.status(400).set(headers).json({ error: "imageFile is required" });
    }
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 10) {
      return res.status(400).set(headers).json({ error: "score must be an integer 1–10" });
    }

    const user_ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

    // POST to Supabase REST
    const payload = [{ image_file: imageFile.trim(), score: nScore, user_ip }];
    const r = await supabaseFetch("/votes", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Prefer": "return=representation" }
    });

    if (!r.ok) {
      return res.status(r.status).set(headers).json({
        error: "Supabase insert error (REST)",
        detail: r.json
      });
    }

    return res.status(200).set(headers).json({ success: true, rows: r.json });
  } catch (e) {
    return res.status(500).set(headers).json({ error: e?.message || "Server error" });
  }
};
