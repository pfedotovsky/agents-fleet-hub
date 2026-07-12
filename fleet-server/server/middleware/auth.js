import jwt from 'jsonwebtoken';
import { userDb, appConfigDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';
import { isLoopbackHost } from '../shared-root/networkHosts.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// [fork-fix #16] Passwordless localhost. A client on the same machine (the hub)
// can mint a normal JWT with no credentials — the local box is already a trust
// boundary. On by default; opt out with FLEET_LOCALHOST_NO_AUTH=false.
const LOCALHOST_NO_AUTH = process.env.FLEET_LOCALHOST_NO_AUTH !== 'false';

// The auto-provisioned loopback user carries this sentinel instead of a bcrypt
// hash, so it can never satisfy a remote password login (bcrypt hashes are $2…).
const LOCAL_SENTINEL_HASH = 'local-no-remote-login';

// [fork-fix #16] True when the request's TCP peer is the loopback interface.
// Uses the socket's remote address (unspoofable) rather than the Host header.
const isLoopbackRequest = (req) => {
  const addr = (req.socket?.remoteAddress || req.connection?.remoteAddress || '')
    .replace(/^::ffff:/, ''); // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  return isLoopbackHost(addr);
};

// [fork-fix #16] Returns the single-user account, creating a loopback-only one
// on first use so a fresh server works locally with zero setup.
const resolveLocalUser = () => {
  let user = userDb.getFirstUser();
  if (!user) {
    userDb.createUser('local', LOCAL_SENTINEL_HASH);
    user = userDb.getFirstUser();
  }
  return user;
};

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET,
  LOCALHOST_NO_AUTH,
  LOCAL_SENTINEL_HASH,
  isLoopbackRequest,
  resolveLocalUser
};
