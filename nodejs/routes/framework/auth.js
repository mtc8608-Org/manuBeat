const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { pool } = require('../../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1 AND is_active = true', [req.user.id]);
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
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { email, password, role = 'user' } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, is_active, created_at',
      [email, hash, role]
    );
    res.json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/users/:id', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
