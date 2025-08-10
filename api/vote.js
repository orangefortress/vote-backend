const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageFile, score } = req.body;
  const userIp = req.headers['x-forwarded-for'] || 'unknown';

  if (!imageFile || !score || score < 1 || score > 10) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { error } = await supabase
    .from('votes')
    .insert({ image_file: imageFile, score, user_ip: userIp });

  if (error) {
    return res.status(500).json({ error: 'Database error', detail: error.message });
  }

  res.json({ success: true });
};
