const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

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
    if (req.method === "OPTIONS") {
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(204).end();
    }
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const file = req.query.file;
    if (!file) return res.status(400).json({ error: "Missing file param" });

    const r = await supabaseFetch(`/votes?image_file=eq.${encodeURIComponent(file)}&select=score`, { method: "GET" });
    if (!r.ok) {
      return res.status(r.status).json({ error: "Supabase select error (REST)", detail: r.json });
    }

    const rows = Array.isArray(r.json) ? r.json : [];
    const count = rows.length;
    const average = count ? rows.reduce((s, row) => s + (row.score || 0), 0) / count : 0;

    return res.status(200).json({ file, average, count });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error (handler)" });
  }
}
