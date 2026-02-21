/**
 * sso.service.js — Azure AD SSO Backend Service
 * 
 * Handles:
 * 1. Azure AD ID token validation (via JWKS)
 * 2. User lookup by azure_oid in auth_users
 * 3. Auto-provisioning: create new user on first SSO login
 * 4. Role assignment: default admin emails → admin, others → configurable default
 * 5. Azure AD group → role mapping (when group claims available)
 * 
 * @version 1.0.0
 * @author Appasamy Associates - Target Setting PWA
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const azureConfig = require('../config/azure-ad');
const db = require('../config/database');

// ─── JWKS client for Azure AD public key retrieval ──────────────────────────
let jwksClientInstance = null;

function getJwksClient() {
  if (!jwksClientInstance) {
    jwksClientInstance = jwksClient({
      jwksUri: azureConfig.JWKS_URI,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
    });
  }
  return jwksClientInstance;
}

/**
 * Get signing key from Azure AD JWKS endpoint.
 */
function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Validate an Azure AD ID token.
 * 
 * @param {string} idToken - The ID token from Azure AD (sent by frontend)
 * @returns {object} Decoded token claims if valid
 * @throws {Error} If token is invalid, expired, or from wrong issuer/audience
 */
async function validateAzureToken(idToken) {
  if (!idToken) {
    throw new Error('No token provided');
  }

  // Decode header to get kid for JWKS lookup
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header) {
    throw new Error('Invalid token format');
  }

  // Get the public key from Azure AD JWKS
  const publicKey = await getSigningKey(decoded.header);

  // Verify the token
  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: azureConfig.AUDIENCE,
    issuer: azureConfig.ISSUER,
  });

  return claims;
}

/**
 * Find or create a user in auth_users based on Azure AD claims.
 * 
 * Flow:
 * 1. Look up by azure_oid (primary SSO identifier)
 * 2. If not found, look up by email (might exist as local-only user)
 * 3. If found by email → link azure_oid and upgrade auth_provider to 'both'
 * 4. If not found at all → auto-create new user
 * 
 * @param {object} params
 * @param {string} params.azure_oid - Azure AD Object ID
 * @param {string} params.email - User email (UPN)
 * @param {string} params.name - Display name from Azure AD
 * @param {string[]} [params.groups] - Azure AD group names (for role mapping)
 * @returns {object} User record from auth_users
 */
async function findOrCreateSsoUser({ azure_oid, email, name, groups = [] }) {
  const knex = db.getKnex();
  const emailLower = (email || '').toLowerCase();

  // ── Step 1: Look up by azure_oid ──────────────────────────────────────
  let user = await knex('target_setting.auth_users')
    .where('azure_oid', azure_oid)
    .andWhere('is_active', true)
    .first();

  if (user) {
    // Update last login
    await knex('target_setting.auth_users')
      .where('id', user.id)
      .update({
        last_login_at: knex.fn.now(),
        full_name: name || user.full_name, // Update name if changed in AD
        updated_at: knex.fn.now(),
      });

    return user;
  }

  // ── Step 2: Look up by email (link existing local user to SSO) ────────
  if (emailLower) {
    user = await knex('target_setting.auth_users')
      .where(knex.raw('LOWER(email)'), emailLower)
      .andWhere('is_active', true)
      .first();

    if (user) {
      // Link Azure AD identity to existing local user
      await knex('target_setting.auth_users')
        .where('id', user.id)
        .update({
          azure_oid: azure_oid,
          azure_upn: emailLower,
          auth_provider: 'both', // Now supports both local + SSO
          last_login_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });

      // Re-fetch to get updated record
      return await knex('target_setting.auth_users')
        .where('id', user.id)
        .first();
    }
  }

  // ── Step 3: Auto-provision new user ───────────────────────────────────
  const role = determineRole(emailLower, groups);
  const employeeCode = await generateEmployeeCode(knex, role);
  const username = emailLower.split('@')[0] || `sso_${Date.now()}`;

  const [newUser] = await knex('target_setting.auth_users')
    .insert({
      employee_code: employeeCode,
      username: username,
      password_hash: null, // SSO-only, no password
      full_name: name || username,
      email: emailLower,
      role: role,
      designation: getRoleDesignation(role),
      azure_oid: azure_oid,
      azure_upn: emailLower,
      auth_provider: 'azure_ad',
      is_active: true,
      last_login_at: knex.fn.now(),
    })
    .returning('*');

  // ── Log auto-provisioning in audit_log ────────────────────────────────
  try {
    await knex('target_setting.audit_log').insert({
      user_id: newUser.id,
      action: 'sso_auto_provision',
      entity_type: 'auth_users',
      entity_id: newUser.id,
      new_values: JSON.stringify({
        employee_code: employeeCode,
        email: emailLower,
        role: role,
        auth_provider: 'azure_ad',
      }),
      ip_address: '0.0.0.0',
    });
  } catch (auditErr) {
    console.error('[SSO] Audit log insert failed (non-critical):', auditErr.message);
  }

  return newUser;
}

/**
 * Determine role for a new SSO user.
 * Priority: default admin emails → Azure AD group mapping → default role
 */
function determineRole(email, groups = []) {
  // 1. Check default admin emails
  if (azureConfig.DEFAULT_ADMIN_EMAILS.includes(email)) {
    return 'admin';
  }

  // 2. Check Azure AD group → role mapping
  for (const groupName of groups) {
    const mappedRole = azureConfig.GROUP_ROLE_MAP[groupName];
    if (mappedRole) {
      return mappedRole;
    }
  }

  // 3. Fall back to configured default
  return azureConfig.DEFAULT_SSO_ROLE;
}

/**
 * Generate a unique employee code based on role.
 */
async function generateEmployeeCode(knex, role) {
  const prefixMap = {
    sales_rep: 'SR',
    tbm: 'TBM',
    abm: 'ABM',
    zbm: 'ZBM',
    sales_head: 'SH',
    admin: 'ADM',
  };
  const prefix = prefixMap[role] || 'EMP';

  // Find the highest existing code for this prefix
  const latest = await knex('target_setting.auth_users')
    .where('employee_code', 'like', `${prefix}-%`)
    .orderByRaw("CAST(SPLIT_PART(employee_code, '-', 2) AS INTEGER) DESC")
    .first();

  let nextNum = 1;
  if (latest) {
    const parts = latest.employee_code.split('-');
    const num = parseInt(parts[1], 10);
    if (!isNaN(num)) nextNum = num + 1;
  }

  return `${prefix}-${String(nextNum).padStart(3, '0')}`;
}

/**
 * Get designation label for a role.
 */
function getRoleDesignation(role) {
  const map = {
    sales_rep: 'Sales Representative',
    tbm: 'Territory Business Manager',
    abm: 'Area Business Manager',
    zbm: 'Zonal Business Manager',
    sales_head: 'Sales Head',
    admin: 'System Administrator',
  };
  return map[role] || role;
}

module.exports = {
  validateAzureToken,
  findOrCreateSsoUser,
  determineRole,
};
