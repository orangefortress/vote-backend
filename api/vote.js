const { createClient } = require("@supabase/supabase-js");

const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
  : ["*"]; // e.g. "https://yourdomain.com,https://www.yourdomain.com"

function corsHeaders(origin) {
  const allowOrigin =
    ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === "*"
      ? "*"
      : ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
  if (req.method !== "POST") {
    return res.status(405).set(headers).json({ error: "Method Not Allowed" });
  }

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      if (typeof req.body === "string") {
        try { body = JSON.parse(req.body); } catch { body = null; }
      } else if (req.rawBody) {
        try { body = JSON.parse(req.rawBody.toString("utf8")); } catch { body = null; }
      }
    }
    if (!body) {
      return res.status(400).set(headers).json({ error: "Invalid JSON body" });
    }

    const { imageFile, score } = body;

    if (typeof imageFile !== "string" || !imageFile.trim()) {
      return res.status(400).set(headers).json({ error: "imageFile is required" });
    }

    const nScore = Number(score);
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 10) {
      return res.status(400).set(headers).json({ error: "score must be an integer 1–10" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).set(headers).json({ error: "Missing Supabase env vars" });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const user_ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
      .split(",")[0]
      .trim();

    const { error } = await supabase
      .from("votes")
      .insert({ image_file: imageFile, score: nScore, user_ip });

    if (error) {
      return res.status(500).set(headers).json({ error: error.message });
    }

    return res.status(200).set(headers).json({ success: true });
  } catch (err) {
    return res.status(500).set(headers).json({ error: err?.message || "Server error" });
  }
};
