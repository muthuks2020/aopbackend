/**
 * authenticate.js — Dual-Auth Middleware
 * 
 * Verifies the app JWT (issued by our auth controller) on protected routes.
 * This middleware does NOT validate Azure AD tokens directly — that happens
 * only in the /auth/sso-login endpoint. Once a user logs in (local or SSO),
 * they receive an app JWT which this middleware validates.
 * 
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify JWT signature and expiry
 * 3. Check session is not revoked in user_sessions
 * 4. Attach user to req.user
 * 
 * @version 2.0.0 - Dual-auth support (local + SSO users use same app JWT)
 * @author Appasamy Associates - Target Setting PWA
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';

/**
 * Main authentication middleware.
 * All protected routes use this — works identically for local and SSO users
 * because both receive the same app JWT format from /auth/login or /auth/sso-login.
 */
async function authenticate(req, res, next) {
  try {
    // ── Step 1: Extract token ───────────────────────────────────────────
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid token format.',
      });
    }

    // ── Step 2: Verify JWT ──────────────────────────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    // ── Step 3: Check session is not revoked ────────────────────────────
    const knex = db.getKnex();
    
    if (decoded.jti) {
      const session = await knex('target_setting.user_sessions')
        .where('token_jti', decoded.jti)
        .whereNull('revoked_at')
        .where('expires_at', '>', knex.fn.now())
        .first();

      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Session expired or revoked. Please login again.',
          code: 'SESSION_REVOKED',
        });
      }
    }

    // ── Step 4: Fetch user and verify active ────────────────────────────
    const user = await knex('target_setting.auth_users')
      .where('id', decoded.id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found or deactivated.',
      });
    }

    // ── Step 5: Attach user to request ──────────────────────────────────
    req.user = {
      id: user.id,
      employee_code: user.employee_code,
      username: user.username,
      name: user.full_name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      zone_code: user.zone_code,
      zone_name: user.zone_name,
      area_code: user.area_code,
      area_name: user.area_name,
      territory_code: user.territory_code,
      territory_name: user.territory_name,
      reports_to: user.reports_to,
      auth_provider: user.auth_provider,
      jti: decoded.jti,
    };

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
    });
  }
}

/**
 * Optional auth middleware — attaches user if token present, but doesn't block.
 * Useful for endpoints that behave differently for authenticated vs anonymous.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  // Try to authenticate, but don't fail if it doesn't work
  try {
    await authenticate(req, res, () => {});
  } catch {
    req.user = null;
  }
  
  next();
}

module.exports = {
  authenticate,
  optionalAuth,
};
