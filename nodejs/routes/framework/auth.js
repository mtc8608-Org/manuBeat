const express   = require('express');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../../db');

const router = express.Router();

// Brute-force protection for the credential check. Must live express-side:
// the reverse proxy can rate-limit connections but cannot tell a failed
// password attempt from any other POST. Successful logins don't count
// against the window, so legitimate users are never locked out by their
// own activity. Keyed on req.ip — see 'trust proxy' in backend.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,                    // failed attempts per IP per window
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again later' },
});

// Separate limiter for account creation. Deliberately NOT the login limiter:
// this one counts SUCCESSFUL requests too (a successful signup is exactly what
// we are bounding), and self-registration is the only tokenless way to mint an
// account that can then reach every registered-tier endpoint.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,                     // new accounts per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address — try again later' },
});

// Minimum password length, enforced server-side on every path that sets one.
const MIN_PASSWORD_LENGTH = 10;

// The JWT carries both the role name and its tier (roles.tier) — every auth
// check compares the tier, so role/tier edits apply on the user's next login.
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query(
      'SELECT u.*, r.tier FROM users u JOIN roles r ON r.name = u.role WHERE u.email = $1 AND u.is_active = true',
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, tier: user.tier },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, tier: user.tier } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register', registerLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  // Server-side floor: the client's confirm-match check is a convenience, not a
  // control — /register is tokenless, so anything not enforced here is optional.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'registered') RETURNING id, email, role",
      [email, hash]
    );
    const user = result.rows[0];
    const tierRes = await pool.query('SELECT tier FROM roles WHERE name = $1', [user.role]);
    const tier = tierRes.rows[0]?.tier ?? 'registered';
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, tier },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, tier } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error('Register error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query(
      'SELECT u.id, u.email, u.role, r.tier FROM users u JOIN roles r ON r.name = u.role WHERE u.id = $1 AND u.is_active = true',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/change-password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1::uuid', [req.user.id]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2::uuid', [hash, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', async (req, res) => {
  if (req.user?.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users', async (req, res) => {
  if (req.user?.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { email, password, role = 'user' } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, is_active, created_at',
      [email, hash, role]
    );
    res.json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    if (e.code === '23503') return res.status(400).json({ error: 'Unknown role' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/users/:id', async (req, res) => {
  if (req.user?.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { is_active, role } = req.body ?? {};
  try {
    const fields = [];
    const values = [];
    if (is_active !== undefined) { fields.push(`is_active = $${fields.length + 1}`); values.push(is_active); }
    if (role !== undefined)      { fields.push(`role = $${fields.length + 1}`);      values.push(role); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}::uuid RETURNING id, email, role, is_active`,
      values
    );
    res.json(result.rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'Unknown role' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
