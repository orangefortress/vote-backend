const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'File is required' });

  const { data, error } = await supabase
    .from('votes')
    .select('score')
    .eq('image_file', file);

  if (error) return res.status(500).json({ error: 'Failed to get average' });

  const scores = data.map(v => v.score);
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  res.json({ average });
};
