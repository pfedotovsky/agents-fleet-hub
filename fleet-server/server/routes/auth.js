import express from 'express';
import { userDb } from '../modules/database/index.js';
import { getConnection } from '../modules/database/connection.js';
import {
  generateToken,
  authenticateToken,
  LOCALHOST_NO_AUTH,
  isLoopbackRequest,
  resolveLocalUser,
} from '../middleware/auth.js';

const router = express.Router();
const db = getConnection();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({
      needsSetup: !hasUsers,
      isAuthenticated: false, // Will be overridden by frontend if token exists
      // [fork-fix #16] Signals a same-machine client that it can skip the
      // password and mint a token via POST /api/auth/local-token.
      localAuthBypass: LOCALHOST_NO_AUTH && isLoopbackRequest(req)
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [fork-fix #16] Passwordless localhost: hand a loopback client a normal JWT
// with no credentials. Gated to the loopback interface — remote peers get 403.
router.post('/local-token', (req, res) => {
  try {
    if (!LOCALHOST_NO_AUTH || !isLoopbackRequest(req)) {
      return res.status(403).json({ error: 'Local token is only available to loopback clients' });
    }
    const user = resolveLocalUser();
    if (!user) {
      return res.status(500).json({ error: 'Failed to resolve local user' });
    }
    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    console.error('Local token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }
    
    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const existing = userDb.getFirstUserWithHash();
      // [fork-fix #16] A real account (bcrypt $2… hash) blocks re-registration.
      // But an auto-provisioned loopback account (sentinel hash) may be upgraded
      // here — this is how remote password login gets enabled after the server
      // has already been used locally.
      if (existing && existing.password_hash && existing.password_hash.startsWith('$2')) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }

      // Hash password. Bun.password with the bcrypt algorithm produces and
      // verifies the same $2b$ hashes as the node bcrypt module, so databases
      // created by upstream CloudCLI keep working (see docs/bun-port-notes.md).
      const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });

      // Upgrade the existing loopback account, or create a fresh user.
      const user = existing
        ? (userDb.updateCredentials(existing.id, username, passwordHash), { id: existing.id, username })
        : userDb.createUser(username, passwordHash);

      // Generate token
      const token = generateToken(user);

      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // [fork-fix #16] An auto-provisioned loopback account carries a sentinel
    // hash, not a bcrypt one — reject cleanly instead of letting Bun.password
    // throw on a non-$2 string. Such accounts have no remote password.
    if (!user.password_hash || !user.password_hash.startsWith('$2')) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const isValidPassword = await Bun.password.verify(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
