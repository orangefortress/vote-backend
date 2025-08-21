module.exports = async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "GET") return res.status(405).set(headers).json({ error: "Method Not Allowed" });

  const file = req.query.file;
  if (!file) return res.status(400).set(headers).json({ error: "Missing file param" });

  // Return dummy data so the route always works
  return res.status(200).set(headers).json({ file, average: 0, count: 0, stub: true });
};
