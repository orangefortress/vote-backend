const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const db = new sqlite3.Database('/data/votes.db'); // Persistent path on Render (add /data/ for their disk)

app.use(bodyParser.json());
app.use(cors()); // Allows connection from Hostinger

db.run(`CREATE TABLE IF NOT EXISTS votes (
  imageFile TEXT,
  score INTEGER,
  userIp TEXT,
  UNIQUE(imageFile, userIp)
)`);

// Submit vote (one per image per IP)
app.post('/vote', (req, res) => {
  const { imageFile, score } = req.body;
  const userIp = req.headers['x-forwarded-for'] || req.ip; // Handle Render's proxies
  db.run('INSERT OR REPLACE INTO votes (imageFile, score, userIp) VALUES (?, ?, ?)', [imageFile, score, userIp], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ success: true });
  });
});

// Get average for an image
app.get('/average/:imageFile', (req, res) => {
  const imageFile = req.params.imageFile;
  db.all('SELECT score FROM votes WHERE imageFile = ?', [imageFile], (err, rows) => {
    if (err || rows.length === 0) return res.json({ average: 0 });
    const sum = rows.reduce((acc, row) => acc + row.score, 0);
    const average = sum / rows.length;
    res.json({ average });
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));