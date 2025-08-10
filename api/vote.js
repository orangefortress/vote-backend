const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { imageFile, score } = req.body;
  const userIp = req.headers['x-forwarded-for'] || 'unknown';

  if (!imageFile || !score || score < 1 || score > 10) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { error } = await supabase.from('votes').insert({ image_file: imageFile, score, user_ip: userIp });
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already voted for this image' });
    return res.status(500).json({ error: 'Failed to submit vote' });
  }

  res.json({ success: true });
};
