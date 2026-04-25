import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from './config/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({ 
  origin: process.env.FRONTEND_URL || 'http://81.91.179.113', 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    let user = null;
    try {
      const userResult = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
      if (userResult.rows.length > 0) {
        const row = userResult.rows[0];
        const valid = await bcrypt.compare(password, row.password_hash);
        if (valid) user = { id: row.id, name: row.name, login: row.login, role: row.role };
      }
    } catch(e) { /* skip */ }
    if (!user) {
      const wmResult = await pool.query('SELECT * FROM webmasters WHERE login = $1 AND fired = false', [login]);
      if (wmResult.rows.length > 0) {
        const row = wmResult.rows[0];
        const valid = await bcrypt.compare(password, row.password_hash);
        if (valid) user = { id: row.id, name: row.name, login: row.login, role: 'webmaster' };
      }
    }
    if (!user) {
      const tlResult = await pool.query('SELECT * FROM team_leaders WHERE login = $1', [login]);
      if (tlResult.rows.length > 0) {
        const row = tlResult.rows[0];
        const valid = await bcrypt.compare(password, row.password_hash);
        if (valid) user = { id: 'tl_' + row.id, name: row.name, login: row.login, role: 'teamlead' };
      }
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const accessToken = jwt.sign(
      { id: user.id, login: user.login, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    try {
      const logUserId = String(user.id).startsWith('tl_') ? null : user.id;
      await pool.query(
        'INSERT INTO activity_logs (action, user_id, user_name) VALUES ($1, $2, $3)',
        ['User login', logUserId, user.name]
      );
    } catch(e) { /* skip log error */ }
    
    res.json({ accessToken, user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid refresh token' });
    try {
      let user = null;
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
      if (userResult.rows.length > 0) {
        const row = userResult.rows[0];
        user = { id: row.id, name: row.name, login: row.login, role: row.role };
      }
      if (!user) {
        const wmResult = await pool.query('SELECT * FROM webmasters WHERE id = $1 AND fired = false', [decoded.id]);
        if (wmResult.rows.length > 0) {
          const row = wmResult.rows[0];
          user = { id: row.id, name: row.name, login: row.login, role: 'webmaster' };
        }
      }
      if (!user) {
        const tlId = String(decoded.id).replace('tl_', '');
        const tlResult = await pool.query('SELECT * FROM team_leaders WHERE id = $1', [tlId]);
        if (tlResult.rows.length > 0) {
          const row = tlResult.rows[0];
          user = { id: `tl_${row.id}`, name: row.name, login: row.login, role: 'teamlead' };
        }
      }
      if (!user) return res.status(403).json({ error: 'User not found' });
      const accessToken = jwt.sign(
        { id: user.id, login: user.login, role: user.role, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ accessToken, user });
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  res.clearCookie('refreshToken');
  await pool.query(
    'INSERT INTO activity_logs (action, user_id, user_name) VALUES ($1, $2, $3)',
    ['User logout', req.user.id, req.user.name]
  );
  res.json({ message: 'Logged out' });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ==================== WEBMASTERS ROUTES ====================
app.get('/api/webmasters', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM webmasters ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/webmasters', authenticateToken, async (req, res) => {
  try {
    const { name, team, login, password, teamLeaderId, rank } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    
    const result = await pool.query(
      `INSERT INTO webmasters (name, team, login, password_hash, team_leader_id, rank) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, team || null, login, passwordHash, teamLeaderId || null, rank || 'junior']
    );
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Created webmaster', req.user.id, req.user.name, `Created: ${name}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/webmasters/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, team, teamLeaderId, rank, fired, firedDate } = req.body;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (team !== undefined) {
      updates.push(`team = $${paramCount++}`);
      values.push(team);
    }
    if (teamLeaderId !== undefined) {
      updates.push(`team_leader_id = $${paramCount++}`);
      values.push(teamLeaderId);
    }
    if (rank !== undefined) {
      updates.push(`rank = $${paramCount++}`);
      values.push(rank);
    }
    if (fired !== undefined) {
      updates.push(`fired = $${paramCount++}`);
      values.push(fired);
    }
    if (firedDate !== undefined) {
      updates.push(`fired_date = $${paramCount++}`);
      values.push(firedDate);
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const result = await pool.query(
      `UPDATE webmasters SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Updated webmaster', req.user.id, req.user.name, `Updated: ${result.rows[0].name}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/webmasters/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM webmasters WHERE id = $1 RETURNING name', [id]);
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Deleted webmaster', req.user.id, req.user.name, `Deleted: ${result.rows[0].name}`]
    );
    
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/webmasters/:id/restore', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE webmasters SET fired = false, fired_date = NULL WHERE id = $1 RETURNING *',
      [id]
    );
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Restored webmaster', req.user.id, req.user.name, `Restored: ${result.rows[0].name}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== TRANSACTIONS ROUTES ====================
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { wmId, type, amount, description, date, reportMonth, category } = req.body;
    
    const result = await pool.query(
      `INSERT INTO transactions (wm_id, type, amount, description, category, date, report_month, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [wmId, type, amount, description || null, category || null, date, reportMonth, req.user.id]
    );
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Created transaction', req.user.id, req.user.name, `${type}: $${amount}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { wmId, type, amount, description, category, date, reportMonth } = req.body;
    const result = await pool.query(
      `UPDATE transactions SET
        wm_id = COALESCE($1, wm_id),
        type = COALESCE($2, type),
        amount = COALESCE($3, amount),
        description = $4,
        category = $5,
        date = COALESCE($6, date),
        report_month = COALESCE($7, report_month)
       WHERE id = $8 RETURNING *`,
      [wmId || null, type || null, amount || null, description || null, category || null, date || null, reportMonth || null, id]
    );
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Updated transaction', req.user.id, req.user.name, `Updated: ${type} $${amount}`]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name) VALUES ($1, $2, $3)',
      ['Deleted transaction', req.user.id, req.user.name]
    );
    
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== TEAM LEADERS ROUTES ====================
app.get('/api/team-leaders', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM team_leaders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/team-leaders', authenticateToken, async (req, res) => {
  try {
    const { name, login, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    
    const result = await pool.query(
      'INSERT INTO team_leaders (name, login, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [name, login, passwordHash]
    );
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Created team leader', req.user.id, req.user.name, `Created: ${name}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/team-leaders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password } = req.body;
    
    if (password) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        'UPDATE team_leaders SET name = $1, password_hash = $2, updated_at = NOW() WHERE id = $3',
        [name, passwordHash, id]
      );
    } else {
      await pool.query(
        'UPDATE team_leaders SET name = $1, updated_at = NOW() WHERE id = $2',
        [name, id]
      );
    }
    
    const result = await pool.query('SELECT * FROM team_leaders WHERE id = $1', [id]);
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Updated team leader', req.user.id, req.user.name, `Updated: ${name}`]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/team-leaders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Unassign webmasters
    await pool.query('UPDATE webmasters SET team_leader_id = NULL WHERE team_leader_id = $1', [id]);
    
    const result = await pool.query('DELETE FROM team_leaders WHERE id = $1 RETURNING name', [id]);
    
    await pool.query(
      'INSERT INTO activity_logs (action, user_id, user_name, details) VALUES ($1, $2, $3, $4)',
      ['Deleted team leader', req.user.id, req.user.name, `Deleted: ${result.rows[0].name}`]
    );
    
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== LOGS ROUTES ====================
app.get('/api/logs', authenticateToken, async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const result = await pool.query(
      'SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT $1',
      [limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Hamsters Finance API running on port ${PORT}`);
});
