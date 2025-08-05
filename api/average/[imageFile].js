const cors = require('cors');
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = async (req, res) => {
  const { imageFile } = req.params;  // Use params for dynamic route

  try {
    const result = await pool.query('SELECT score FROM votes WHERE image_file = $1', [imageFile]);
    if (result.rows.length === 0) return res.json({ average: 0 });

    const sum = result.rows.reduce((acc, row) => acc + row.score, 0);
    const average = sum / result.rows.length;
    res.json({ average });
  } catch (err) {
    console.error(err);
    res.status(500).json({ average: 0 });
  }
};
