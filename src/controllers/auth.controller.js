/**
 * auth.controller.js — Authentication Controller
 * 
 * Handles:
 * - POST /auth/login        → Local username/password login
 * - POST /auth/sso-login    → Azure AD SSO login (NEW)
 * - POST /auth/logout       → Revoke session
 * - POST /auth/refresh      → Refresh JWT token
 * - GET  /auth/me           → Current user profile
 * 
 * @version 2.0.0 - Added SSO login
 * @author Appasamy Associates - Target Setting PWA
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../config/database');
const azureConfig = require('../config/azure-ad');
const ssoService = require('../services/sso.service');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const REFRESH_EXPIRY = process.env.REFRESH_EXPIRY || '7d';

const ROLE_LABELS = {
  sales_rep: 'Sales Representative',
  tbm: 'Territory Business Manager',
  abm: 'Area Business Manager',
  zbm: 'Zonal Business Manager',
  sales_head: 'Sales Head',
  admin: 'System Administrator',
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /auth/login — Local credential login
// ═══════════════════════════════════════════════════════════════════════════
async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
    }

    const knex = db.getKnex();

    // Find user by username
    const user = await knex('target_setting.auth_users')
      .where('username', username)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    // Check if user can login locally
    if (user.auth_provider === 'azure_ad') {
      return res.status(401).json({
        success: false,
        message: 'This account uses Microsoft SSO. Please use "Sign in with Microsoft".',
      });
    }

    // Verify password
    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: 'No password set. Please use SSO or contact admin.',
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    // Generate JWT + session
    const tokenData = await createSessionAndToken(knex, user, 'local', req);

    return res.json({
      success: true,
      ...tokenData,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /auth/sso-login — Azure AD SSO login (NEW)
// ═══════════════════════════════════════════════════════════════════════════
async function ssoLogin(req, res) {
  try {
    // Check if SSO is enabled
    if (!azureConfig.SSO_ENABLED) {
      return res.status(403).json({
        success: false,
        message: 'SSO is not enabled on this server',
      });
    }

    const { azure_token, email, name, azure_oid } = req.body;

    if (!azure_token) {
      return res.status(400).json({
        success: false,
        message: 'Azure AD token is required',
      });
    }

    // ── Step 1: Validate the Azure AD token ─────────────────────────────
    let claims;
    try {
      claims = await ssoService.validateAzureToken(azure_token);
    } catch (tokenErr) {
      console.error('[SSO] Token validation failed:', tokenErr.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired Azure AD token',
      });
    }

    // Extract data from validated claims (prefer claims over request body)
    const validatedEmail = (claims.preferred_username || claims.email || email || '').toLowerCase();
    const validatedName = claims.name || name || validatedEmail.split('@')[0];
    const validatedOid = claims.oid || claims.sub || azure_oid || '';
    const groups = claims.groups || [];

    if (!validatedOid) {
      return res.status(400).json({
        success: false,
        message: 'Could not determine Azure AD user identity',
      });
    }

    // ── Step 2: Find or create user ─────────────────────────────────────
    const knex = db.getKnex();
    const user = await ssoService.findOrCreateSsoUser({
      azure_oid: validatedOid,
      email: validatedEmail,
      name: validatedName,
      groups,
    });

    if (!user || !user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact admin.',
      });
    }

    // ── Step 3: Generate app JWT + session ───────────────────────────────
    const tokenData = await createSessionAndToken(knex, user, 'azure_ad', req);

    return res.json({
      success: true,
      ...tokenData,
    });
  } catch (error) {
    console.error('[Auth] SSO login error:', error);
    return res.status(500).json({
      success: false,
      message: 'SSO login failed. Please try again.',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /auth/logout — Revoke session
// ═══════════════════════════════════════════════════════════════════════════
async function logout(req, res) {
  try {
    const knex = db.getKnex();
    const tokenJti = req.user?.jti;

    if (tokenJti) {
      await knex('target_setting.user_sessions')
        .where('token_jti', tokenJti)
        .update({ revoked_at: knex.fn.now() });
    }

    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /auth/refresh — Refresh JWT token
// ═══════════════════════════════════════════════════════════════════════════
async function refresh(req, res) {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    const knex = db.getKnex();

    // Find active session with this refresh token
    const session = await knex('target_setting.user_sessions')
      .where('refresh_token', refresh_token)
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .first();

    if (!session) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    // Get user
    const user = await knex('target_setting.auth_users')
      .where('id', session.user_id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }

    // Revoke old session
    await knex('target_setting.user_sessions')
      .where('id', session.id)
      .update({ revoked_at: knex.fn.now() });

    // Create new session + token
    const tokenData = await createSessionAndToken(knex, user, session.auth_method || 'local', req);

    return res.json({ success: true, ...tokenData });
  } catch (error) {
    console.error('[Auth] Refresh error:', error);
    return res.status(500).json({ success: false, message: 'Token refresh failed' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /auth/me — Current user profile
// ═══════════════════════════════════════════════════════════════════════════
async function me(req, res) {
  try {
    const knex = db.getKnex();

    const user = await knex('target_setting.auth_users')
      .where('id', req.user.id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({
      success: true,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('[Auth] Me error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Create session + JWT + refresh token
// ═══════════════════════════════════════════════════════════════════════════
async function createSessionAndToken(knex, user, authMethod, req) {
  const jti = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(64).toString('hex');

  // Create JWT
  const token = jwt.sign(
    {
      id: user.id,
      employee_code: user.employee_code,
      role: user.role,
      jti,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  // Calculate expiry
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000);

  // Insert session
  await knex('target_setting.user_sessions').insert({
    user_id: user.id,
    token_jti: jti,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    ip_address: req.ip || req.connection?.remoteAddress || '0.0.0.0',
    user_agent: req.get('User-Agent') || '',
  });

  // Update last login
  await knex('target_setting.auth_users')
    .where('id', user.id)
    .update({ last_login_at: knex.fn.now() });

  return {
    token,
    refresh_token: refreshToken,
    expires_at: expiresAt.toISOString(),
    user: formatUserResponse(user),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Format user object for API response
// ═══════════════════════════════════════════════════════════════════════════
function formatUserResponse(user) {
  return {
    id: user.id,
    employee_code: user.employee_code,
    name: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    designation: user.designation,
    territory: user.territory_name || user.area_name || user.zone_name || 'Unassigned',
    zone_code: user.zone_code,
    zone_name: user.zone_name,
    area_code: user.area_code,
    area_name: user.area_name,
    territory_code: user.territory_code,
    territory_name: user.territory_name,
    reports_to: user.reports_to,
    auth_provider: user.auth_provider,
    azure_oid: user.azure_oid || null,
  };
}

module.exports = {
  login,
  ssoLogin,
  logout,
  refresh,
  me,
};
