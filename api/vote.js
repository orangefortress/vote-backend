const cors = require('cors');
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const { imageFile, score } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    try {
      await pool.query(
        'INSERT INTO votes (image_file, score, user_ip) VALUES ($1, $2, $3) ON CONFLICT (image_file, user_ip) DO UPDATE SET score = $2',
        [imageFile, score, userIp]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
