/**
 * auth.routes.js — Authentication Routes
 * 
 * Routes:
 * POST /api/v1/auth/login       → Local username/password login
 * POST /api/v1/auth/sso-login   → Azure AD SSO login (NEW)
 * POST /api/v1/auth/logout      → Revoke session (requires auth)
 * POST /api/v1/auth/refresh     → Refresh JWT token
 * GET  /api/v1/auth/me          → Current user profile (requires auth)
 * 
 * @version 2.0.0 - Added SSO login route
 * @author Appasamy Associates - Target Setting PWA
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');

// ─── Public routes (no auth required) ───────────────────────────────────────
router.post('/login', authController.login);
router.post('/sso-login', authController.ssoLogin);    // ← NEW: Azure AD SSO
router.post('/refresh', authController.refresh);

// ─── Protected routes (auth required) ───────────────────────────────────────
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
