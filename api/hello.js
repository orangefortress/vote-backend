module.exports = (req, res) => {
  // CORS headers (permissive so fetch() works from anywhere)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    // 204 = No Content; avoids “headers already sent” issues
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ ok: true, message: "Hello from Vercel!" });
};
