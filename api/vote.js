const { createClient } = require("@supabase/supabase-js");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) return { error: "Missing Supabase env vars (SUPABASE_URL and/or SUPABASE_KEY)." };
  try { return { supabase: createClient(url, key) }; }
  catch (e) { return { error: "Failed to init Supabase client: " + (e?.message || String(e)) }; }
}

module.exports = async (req, res) => {
  const headers = cors();

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();

  // Health probe: GET /api/vote
  if (req.method === "GET") {
    const haveEnv = { SUPABASE_URL: !!process.env.SUPABASE_URL, SUPABASE_KEY: !!process.env.SUPABASE_KEY };
    const { supabase, error } = getSupabase();
    if (error) return res.status(500).set(headers).json({ ok: false, haveEnv, db_ok: false, error });

    try {
      const { count, error: dbErr } = await supabase
        .from("votes")
        .select("*", { head: true, count: "exact" })
        .limit(0);

      if (dbErr) return res.status(500).set(headers).json({
        ok: false, haveEnv, db_ok: false, error: "Supabase error on table 'votes': " + dbErr.message
      });

      return res.status(200).set(headers).json({ ok: true, haveEnv, db_ok: true, votes_count_sample: count });
    } catch (e) {
      return res.status(500).set(headers).json({
        ok: false, haveEnv, db_ok: false, error: "Exception during DB probe: " + (e?.message || String(e))
      });
    }
  }

  // POST /api/vote
  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method Not Allowed" });

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      if (typeof req.body === "string") { try { body = JSON.parse(req.body); } catch { body = null; } }
      else if (req.rawBody) { try { body = JSON.parse(req.rawBody.toString("utf8")); } catch { body = null; } }
    }
    if (!body) return res.status(400).set(headers).json({ error: "Invalid JSON body" });

    const { imageFile, score } = body;
    if (typeof imageFile !== "string" || !imageFile.trim()) {
      return res.status(400).set(headers).json({ error: "imageFile is required" });
    }
    const nScore = Number(score);
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 10) {
      return res.status(400).set(headers).json({ error: "score must be an integer 1–10" });
    }

    const { supabase, error } = getSupabase();
    if (error) return res.status(500).set(headers).json({ error });

    const user_ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

    const { error: dbErr } = await supabase
      .from("votes")
      .insert({ image_file: imageFile, score: nScore, user_ip });

    if (dbErr) return res.status(500).set(headers).json({ error: "Supabase insert error: " + dbErr.message });

    return res.status(200).set(headers).json({ success: true });
  } catch (err) {
    return res.status(500).set(headers).json({ error: err?.message || "Server error" });
  }
};
