// api/hello.js
module.exports = (req, res) => {
  // Permissive CORS so fetch() from any site works
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    // No body on preflight
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ ok: true, message: "Hello from Vercel!" }));
};
