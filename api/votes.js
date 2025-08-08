let votes = {};  // Shared in-memory storage (same as [id].js; resets on redeploy)

module.exports = (req, res) => {
  if (req.method === 'GET') {
    return res.json({ allVotes: votes });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
