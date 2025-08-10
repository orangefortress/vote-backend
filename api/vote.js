const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  // Always send CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight response for OPTIONS method
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse JSON body manually
  let rawBody = '';
  for await (const chunk of req) rawBody += chunk;
  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { imageFile, score } = parsed;
  const userIp = req.headers['x-forwarded-for'] || 'unknown';

  if (!imageFile || typeof score !== 'number' || score < 1 || score > 10) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { error } = await supabase
    .from('votes')
    .insert({ image_file: imageFile, score, user_ip: userIp });

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: 'Database error', detail: error.message });
  }

  res.json({ success: true });
};
