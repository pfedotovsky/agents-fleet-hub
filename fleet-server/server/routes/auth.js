import express from 'express';
import { userDb } from '../modules/database/index.js';
import {
  generateToken,
  authenticateToken,
  LOCALHOST_NO_AUTH,
  isLoopbackRequest,
  resolveLocalUser,
} from '../middleware/auth.js';

const router = express.Router();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const existing = userDb.getFirstUserWithHash();
    const hasPasswordAccount = !!existing?.password_hash?.startsWith('$2');
    res.json({
      // fleet-server intentionally has no browser/API account setup flow.
      // Remote credentials must be created locally with `fleet-server auth setup`.
      needsSetup: false,
      needsCliAuthSetup: !hasPasswordAccount,
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

// fleet-server does not expose browser/API account creation. Set or upgrade
// the single remote-login account from the host shell instead.
router.post('/register', (_req, res) => {
  res.status(410).json({
    error: 'fleet-server account setup is host-local. Run `fleet-server auth setup` on the host.',
  });
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
