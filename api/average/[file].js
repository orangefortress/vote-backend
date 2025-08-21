const { createClient } = require("@supabase/supabase-js");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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

  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "GET") return res.status(405).set(headers).json({ error: "Method Not Allowed" });

  const file = req.query.file;
  if (!file) return res.status(400).set(headers).json({ error: "Missing file param" });

  const { supabase, error } = getSupabase();
  if (error) return res.status(500).set(headers).json({ error });

  try {
    const { data, error: dbErr } = await supabase
      .from("votes")
      .select("score")
      .eq("image_file", file);

    if (dbErr) return res.status(500).set(headers).json({ error: "Supabase select error: " + dbErr.message });

    const count = data.length;
    const average = count ? (data.reduce((s, r) => s + (r.score || 0), 0) / count) : 0;
    return res.status(200).set(headers).json({ file, average, count });
  } catch (e) {
    return res.status(500).set(headers).json({ error: e?.message || "Server error" });
  }
};
