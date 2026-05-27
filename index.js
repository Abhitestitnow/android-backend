require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Firebase Admin setup
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

// Create tables on startup
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      profile_picture TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      is_done BOOLEAN DEFAULT FALSE,
      due_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      word VARCHAR(255) NOT NULL,
      definition TEXT,
      example TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      event_date TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database tables ready!');
}
initDB();

// Middleware to verify Google token
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── AUTH ───────────────────────────────────────────

// Login / Register with Google
app.post('/auth/google', async (req, res) => {
  const { google_id, name, email, profile_picture } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (google_id, name, email, profile_picture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
       SET name=$2, profile_picture=$4
       RETURNING *`,
      [google_id, name, email, profile_picture]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TODOS ──────────────────────────────────────────

app.get('/todos', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const result = await pool.query(
    'SELECT * FROM todos WHERE user_id=$1 ORDER BY created_at DESC',
    [user.id]
  );
  res.json(result.rows);
});

app.post('/todos', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const { title, description, due_date } = req.body;
  const result = await pool.query(
    'INSERT INTO todos (user_id, title, description, due_date) VALUES ($1,$2,$3,$4) RETURNING *',
    [user.id, title, description, due_date]
  );
  res.json(result.rows[0]);
});

app.patch('/todos/:id', verifyToken, async (req, res) => {
  const { is_done } = req.body;
  const result = await pool.query(
    'UPDATE todos SET is_done=$1 WHERE id=$2 RETURNING *',
    [is_done, req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete('/todos/:id', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM todos WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// ─── VOCABULARY ─────────────────────────────────────

app.get('/vocabulary', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const result = await pool.query(
    'SELECT * FROM vocabulary WHERE user_id=$1 ORDER BY created_at DESC',
    [user.id]
  );
  res.json(result.rows);
});

app.post('/vocabulary', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const { word, definition, example } = req.body;
  const result = await pool.query(
    'INSERT INTO vocabulary (user_id, word, definition, example) VALUES ($1,$2,$3,$4) RETURNING *',
    [user.id, word, definition, example]
  );
  res.json(result.rows[0]);
});

app.delete('/vocabulary/:id', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM vocabulary WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// ─── CALENDAR EVENTS ────────────────────────────────

app.get('/events', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const result = await pool.query(
    'SELECT * FROM calendar_events WHERE user_id=$1 ORDER BY event_date ASC',
    [user.id]
  );
  res.json(result.rows);
});

app.post('/events', verifyToken, async (req, res) => {
  const user = await getUser(req.user.email);
  const { title, description, event_date } = req.body;
  const result = await pool.query(
    'INSERT INTO calendar_events (user_id, title, description, event_date) VALUES ($1,$2,$3,$4) RETURNING *',
    [user.id, title, description, event_date]
  );
  res.json(result.rows[0]);
});

app.delete('/events/:id', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM calendar_events WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// ─── HELPER ─────────────────────────────────────────

async function getUser(email) {
  const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return result.rows[0];
}

// Health check
app.get('/', (req, res) => res.json({ status: 'Personal Space API running!' }));

app.listen(process.env.PORT || 3000, () => console.log('Server started!'));
