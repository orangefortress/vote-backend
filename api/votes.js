const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('votes')
      .select('image_file, score');

    if (error) return res.status(500).json({ error: 'Failed to get all votes: ' + error.message });

    // Aggregate totals (total votes per image)
    const allVotes = data.reduce((acc, { image_file, score }) => {
      if (!acc[image_file]) acc[image_file] = { totalVotes: 0, totalScore: 0 };
      acc[image_file].totalVotes += 1;
      acc[image_file].totalScore += score;
      return acc;
    }, {});

    return res.json({ allVotes });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
