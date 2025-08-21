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

function supa() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) return { err: "Missing Supabase env vars (SUPABASE_URL and/or SUPABASE_KEY)." };
  try { return { db: createClient(url, key) }; }
  catch (e) { return { err: "Failed to init Supabase client: " + (e?.message || String(e)) }; }
}

module.exports = async (req, res) => {
  const headers = cors();
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();

  if (req.method === "GET") {
    const haveEnv = { SUPABASE_URL: !!process.env.SUPABASE_URL, SUPABASE_KEY: !!process.env.SUPABASE_KEY };
    const { db, err } = supa();
    if (err) return res.status(500).set(headers).json({ ok:false, haveEnv, db_ok:false, error: err });

    try {
      const { count, error } = await db.from("votes").select("*", { head: true, count: "exact" }).limit(0);
      if (error) return res.status(500).set(headers).json({ ok:false, haveEnv, db_ok:false, error: "Supabase error on votes: " + error.message });
      return res.status(200).set(headers).json({ ok:true, haveEnv, db_ok:true, votes_count_sample: count });
    } catch (e) {
      return res.status(500).set(headers).json({ ok:false, error: e?.message || String(e) });
    }
  }

  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method Not Allowed" });

  try {
    let body = req.body;
    if (!body || typeof body !== "object") { try { body = JSON.parse(req.body); } catch { body = null; } }
    if (!body) return res.status(400).set(headers).json({ error: "Invalid JSON body" });

    const { imageFile, score } = body;
    if (typeof imageFile !== "string" || !imageFile.trim()) return res.status(400).set(headers).json({ error: "imageFile is required" });
    const n = Number(score);
    if (!Number.isInteger(n) || n < 1 || n > 10) return res.status(400).set(headers).json({ error: "score must be an integer 1–10" });

    const { db, err } = supa();
    if (err) return res.status(500).set(headers).json({ error: err });

    const user_ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const { error } = await db.from("votes").insert({ image_file: imageFile, score: n, user_ip });
    if (error) return res.status(500).set(headers).json({ error: "Supabase insert error: " + error.message });

    return res.status(200).set(headers).json({ success: true });
  } catch (e) {
    return res.status(500).set(headers).json({ error: e?.message || "Server error" });
  }
};
