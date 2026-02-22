/**
 * Specialist Role Constants
 * Shared across specialist routes, controllers, and services.
 *
 * DB enum user_role includes:
 *   at_iol_specialist, eq_spec_diagnostic, eq_spec_surgical   (specialist)
 *   at_iol_manager, eq_mgr_diagnostic, eq_mgr_surgical        (specialist managers)
 *
 * Reporting chain: Specialist → ABM → ZBM → Sales Head
 */

'use strict';

const SPECIALIST_ROLES = [
  'at_iol_specialist',
  'eq_spec_diagnostic',
  'eq_spec_surgical',
];

const SPECIALIST_MANAGER_ROLES = [
  'at_iol_manager',
  'eq_mgr_diagnostic',
  'eq_mgr_surgical',
];

const FISCAL_MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];

const QUARTERS = {
  Q1: ['apr', 'may', 'jun'],
  Q2: ['jul', 'aug', 'sep'],
  Q3: ['oct', 'nov', 'dec'],
  Q4: ['jan', 'feb', 'mar'],
};

const isSpecialistRole = (role) => SPECIALIST_ROLES.includes(role);

module.exports = {
  SPECIALIST_ROLES,
  SPECIALIST_MANAGER_ROLES,
  FISCAL_MONTHS,
  QUARTERS,
  isSpecialistRole,
};
