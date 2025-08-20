module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  // permissive CORS for hello (simple sanity check endpoint)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.setHeader("Content-Type", "application/json");
  res.status(200).json({ ok: true, message: "Hello from Vercel!" });
};
