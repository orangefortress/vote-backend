const { createClient } = require("@supabase/supabase-js");

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return res.status(200).set(headers).end();
  }

  if (req.method !== "GET") {
    return res.status(405).set(headers).json({ error: "Method Not Allowed" });
  }

  const file = req.query.file;
  if (!file) {
    return res.status(400).set(headers).json({ error: "Missing file param" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).set(headers).json({ error: "Missing Supabase env vars" });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // Get rows and compute avg client-side (keeps it simple for anon key)
    const { data, error } = await supabase
      .from("votes")
      .select("score")
      .eq("image_file", file);

    if (error) {
      return res.status(500).set(headers).json({ error: error.message });
    }

    const count = data.length;
    const average = count ? (data.reduce((s, r) => s + (r.score || 0), 0) / count) : 0;
    return res.status(200).set(headers).json({ file, average, count });
  } catch (err) {
    return res.status(500).set(headers).json({ error: err?.message || "Server error" });
  }
};
