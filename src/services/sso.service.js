/**
 * sso.service.js — Azure AD SSO Backend Service
 * @version 2.0.0 - Migrated to aop schema (v5)
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const azureConfig = require('../config/azure-ad');
const db = require('../config/database');

let jwksClientInstance = null;

function getJwksClient() {
  if (!jwksClientInstance) {
    jwksClientInstance = jwksClient({
      jwksUri: azureConfig.JWKS_URI,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
    });
  }
  return jwksClientInstance;
}

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function validateAzureToken(idToken) {
  if (!idToken) throw new Error('No token provided');

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header) throw new Error('Invalid token format');

  const publicKey = await getSigningKey(decoded.header);

  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: azureConfig.AUDIENCE,
    issuer: azureConfig.ISSUER,
  });

  return claims;
}

async function findOrCreateSsoUser({ azure_oid, email, name, groups }) {
  const knex = db.getKnex();

  // 1. Look up by azure_oid
  let user = await knex('ts_auth_users').where('azure_oid', azure_oid).first();

  if (user) {
    await knex('ts_auth_users').where('id', user.id).update({
      azure_upn: email,
      last_login_at: new Date(),
    });
    return await knex('ts_auth_users').where('id', user.id).first();
  }

  // 2. Look up by email — link azure_oid
  user = await knex('ts_auth_users').where('email', email).first();

  if (user) {
    await knex('ts_auth_users').where('id', user.id).update({
      azure_oid,
      azure_upn: email,
      auth_provider: 'both',
      last_login_at: new Date(),
    });

    await knex('ts_audit_log').insert({
      actor_code: user.employee_code,
      actor_role: user.role,
      action: 'sso_account_linked',
      entity_type: 'auth_users',
      entity_id: user.id,
      detail: JSON.stringify({ azure_oid, email }),
    });

    return await knex('ts_auth_users').where('id', user.id).first();
  }

  // 3. Auto-provision new user
  const role = determineRole(groups, email);
  const employeeCode = await generateEmployeeCode(knex, role);

  const [newUser] = await knex('ts_auth_users').insert({
    employee_code: employeeCode,
    username: email.split('@')[0],
    full_name: name,
    email,
    role,
    auth_provider: 'azure_ad',
    azure_oid,
    azure_upn: email,
    is_active: true,
    last_login_at: new Date(),
  }).returning('*');

  await knex('ts_audit_log').insert({
    actor_code: employeeCode,
    actor_role: role,
    action: 'sso_user_provisioned',
    entity_type: 'auth_users',
    entity_id: newUser.id,
    detail: JSON.stringify({ azure_oid, email, groups }),
  });

  return newUser;
}

function determineRole(groups, email) {
  const adminEmails = (process.env.DEFAULT_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
  if (adminEmails.includes(email.toLowerCase())) return 'admin';

  if (groups && groups.length > 0 && azureConfig.GROUP_ROLE_MAP) {
    for (const [groupName, role] of Object.entries(azureConfig.GROUP_ROLE_MAP)) {
      if (groups.includes(groupName)) return role;
    }
  }

  return process.env.DEFAULT_SSO_ROLE || 'sales_rep';
}

async function generateEmployeeCode(knex, role) {
  const prefixMap = {
    sales_rep: 'SR', tbm: 'TBM', abm: 'ABM', zbm: 'ZBM',
    sales_head: 'SH', admin: 'ADM',
    at_iol_specialist: 'ATIOL', eq_spec_diagnostic: 'EQSD', eq_spec_surgical: 'EQSS',
    at_iol_manager: 'ATIOLM', eq_mgr_diagnostic: 'EQMD', eq_mgr_surgical: 'EQMS',
  };
  const prefix = prefixMap[role] || 'EMP';

  const lastUser = await knex('ts_auth_users')
    .where('employee_code', 'like', `${prefix}-%`)
    .orderBy('employee_code', 'desc')
    .first();

  let nextNum = 1;
  if (lastUser) {
    const parts = lastUser.employee_code.split('-');
    nextNum = parseInt(parts[parts.length - 1] || 0) + 1;
  }

  return `${prefix}-${String(nextNum).padStart(4, '0')}`;
}

module.exports = {
  validateAzureToken,
  findOrCreateSsoUser,
  determineRole,
  generateEmployeeCode,
};
