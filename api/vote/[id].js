let votes = {};  // In-memory storage (resets on redeploy)

module.exports = (req, res) => {
  const { id } = req.query;  // e.g., "img1" or "img2"

  if (!id) {
    return res.status(400).json({ error: 'ID is required (e.g., img1)' });
  }

  if (req.method === 'POST') {
    // Increment vote
    votes[id] = (votes[id] || 0) + 1;
    return res.json({ message: `Voted for ${id}!`, totalVotes: votes[id] });
  } else if (req.method === 'GET') {
    // Get current votes
    return res.json({ totalVotes: votes[id] || 0 });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
