module.exports = async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();

  if (req.method === "GET") {
    // Health probe for stub
    return res.status(200).set(headers).json({
      ok: true,
      stub: true,
      message: "vote.js stub alive (no Supabase)"
    });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (!body || typeof body !== "object") {
      try { body = JSON.parse(req.body); } catch { body = null; }
    }
    if (!body) return res.status(400).set(headers).json({ error: "Invalid JSON body" });

    const { imageFile, score } = body;
    return res.status(200).set(headers).json({
      success: true,
      stub: true,
      echo: { imageFile, score }
    });
  }

  return res.status(405).set(headers).json({ error: "Method Not Allowed" });
};
