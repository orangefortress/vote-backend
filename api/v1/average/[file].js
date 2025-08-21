function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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
      "Prefer": "return=representation"
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
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "GET") return res.status(405).set(headers).json({ error: "Method Not Allowed" });

  const file = req.query.file;
  if (!file) return res.status(400).set(headers).json({ error: "Missing file param" });

  try {
    // Fetch all scores for given image_file (simple & clear)
    const r = await supabaseFetch(`/votes?image_file=eq.${encodeURIComponent(file)}&select=score`, {
      method: "GET"
    });
    if (!r.ok) {
      return res.status(r.status).set(headers).json({
        error: "Supabase select error (REST)",
        detail: r.json
      });
    }
    const rows = Array.isArray(r.json) ? r.json : [];
    const count = rows.length;
    const average = count ? rows.reduce((s, row) => s + (row.score || 0), 0) / count : 0;
    return res.status(200).set(headers).json({ file, average, count });
  } catch (e) {
    return res.status(500).set(headers).json({ error: e?.message || "Server error" });
  }
};
