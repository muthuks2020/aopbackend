/**
 * azure-ad.js — Azure AD Configuration for Backend
 * 
 * Configures Azure AD token validation and user provisioning settings.
 * All values come from .env — no hardcoded secrets.
 * 
 * @version 1.0.0
 * @author Appasamy Associates - Target Setting PWA
 */

module.exports = {
  // ─── Feature toggle ─────────────────────────────────────────────────────
  SSO_ENABLED: process.env.AZURE_SSO_ENABLED === 'true',

  // ─── Azure AD App Registration ─────────────────────────────────────────
  TENANT_ID: process.env.AZURE_TENANT_ID || '',
  CLIENT_ID: process.env.AZURE_CLIENT_ID || '',
  CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET || '',

  // ─── Token validation ──────────────────────────────────────────────────
  // Microsoft identity platform v2.0 endpoints
  ISSUER: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/v2.0`,
  JWKS_URI: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/discovery/v2.0/keys`,
  METADATA_URL: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/v2.0/.well-known/openid-configuration`,

  // ─── Audience (must match client_id in the Azure AD token) ─────────────
  AUDIENCE: process.env.AZURE_CLIENT_ID || '',

  // ─── Default admin emails (auto-assigned admin role on first SSO login) ─
  DEFAULT_ADMIN_EMAILS: (
    process.env.DEFAULT_ADMIN_EMAILS || 'muthu@appasamy.com,yoga@appasamy.com'
  ).split(',').map(e => e.trim().toLowerCase()),

  // ─── Azure AD Security Group → App Role mapping ───────────────────────
  GROUP_ROLE_MAP: {
    'SG-PWA-SalesRep':  'sales_rep',
    'SG-PWA-TBM':       'tbm',
    'SG-PWA-ABM':       'abm',
    'SG-PWA-ZBM':       'zbm',
    'SG-PWA-SalesHead': 'sales_head',
    'SG-PWA-Admin':     'admin',
  },

  // ─── Auto-provisioning defaults ────────────────────────────────────────
  // Role assigned to new SSO users who are NOT in DEFAULT_ADMIN_EMAILS
  // and don't have a group mapping. 'sales_rep' is safe default.
  // Admin can reassign via admin panel.
  DEFAULT_SSO_ROLE: process.env.DEFAULT_SSO_ROLE || 'sales_rep',
};
