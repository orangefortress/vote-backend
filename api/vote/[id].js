const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
  const { id } = req.query;  // e.g., "img1" or "img2"
  const userIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';  // Get user IP

  if (!id) {
    return res.status(400).json({ error: 'ID is required (e.g., img1)' });
  }

  if (req.method === 'POST') {
    const { score } = req.body;  // Expect {score: number} in body (1-10)
    if (!score || score < 1 || score > 10) {
      return res.status(400).json({ error: 'Score must be between 1 and 10' });
    }

    // Insert into your votes table (handles UNIQUE constraint)
    const { data, error } = await supabase
      .from('votes')
      .insert({ image_file: id, score, user_ip: userIp });

    if (error) {
      if (error.code === '23505') {  // Duplicate (already voted)
        return res.status(409).json({ error: 'You already voted for this image' });
      }
      return res.status(500).json({ error: 'Failed to vote: ' + error.message });
    }

    return res.json({ message: `Rated ${id} with score ${score}!` });
  } else if (req.method === 'GET') {
    // Get total vote count for this image (number of scores submitted)
    const { count, error } = await supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('image_file', id);

    if (error) return res.status(500).json({ error: 'Failed to get votes: ' + error.message });
    return res.json({ totalVotes: count });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
