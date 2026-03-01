'use strict';
/**
 * azure-ad.js — Azure AD / SSO configuration
 * @version 2.0.0 — SSO pre-built, activate via .env
 */
module.exports = {
  enabled: process.env.AZURE_SSO_ENABLED === 'true',
  credentials: {
    tenantId:     process.env.AZURE_TENANT_ID     || '',
    clientId:     process.env.AZURE_CLIENT_ID      || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET  || '',
  },
  metadata: {
    authority:    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}`,
    discovery:    '.well-known/openid-configuration',
    version:      'v2.0',
  },
  settings: {
    validateIssuer: true,
    passReqToCallback: true,
    loggingLevel: 'warn',
    loggingNoPII: true,
  },
  redirectUrl: process.env.AZURE_REDIRECT_URI || 'http://localhost:3000/api/v1/auth/sso-callback',
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};
