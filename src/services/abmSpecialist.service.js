/**
 * ABM Specialist Service
 * Business logic for ABM managing specialist submissions and yearly targets.
 *
 * Chain: Specialist → ABM (review/approve) → ZBM → Sales Head
 *
 * Tables used:
 *  - product_commitments       (specialist submissions)
 *  - commitment_approvals      (immutable audit trail)
 *  - yearly_target_assignments (top-down yearly targets)
 *  - auth_users                (specialist lookup)
 *  - audit_log                 (action logging)
 */

'use strict';

const { db } = require('../config/database');
const { SPECIALIST_ROLES } = require('../utils/specialistConstants');

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const getActiveFY = async () => {
  const fy = await db('fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

/** Get employee_codes of all active specialists under an ABM */
const getSpecialistCodes = async (abmEmployeeCode) => {
  const rows = await db('auth_users')
    .where({ reports_to: abmEmployeeCode, is_active: true })
    .whereIn('role', SPECIALIST_ROLES)
    .select('employee_code');
  return rows.map((r) => r.employee_code);
};

/** Format a product_commitments row for ABM review */
const formatSubmission = (r) => ({
  id: r.id,
  fiscalYearCode: r.fiscal_year_code,
  employeeCode: r.employee_code,
  employeeName: r.employee_name,
  employeeRole: r.employee_role,
  productCode: r.product_code,
  productName: r.product_name,
  categoryId: r.category_id,
  unit: r.unit,
  zoneName: r.zone_name,
  areaName: r.area_name,
  territoryName: r.territory_name,
  monthlyTargets: r.monthly_targets || {},
  status: r.status,
  submittedAt: r.submitted_at,
  approvedAt: r.approved_at,
  approvedByCode: r.approved_by_code,
  approvedByName: r.approved_by_name,
});

// ======================================================================
// GET /abm/specialist-submissions
// ======================================================================
const getSpecialistSubmissions = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const specialistCodes = await getSpecialistCodes(abmEmployeeCode);
  if (specialistCodes.length === 0) return [];

  const rows = await db('product_commitments')
    .whereIn('employee_code', specialistCodes)
    .where({ fiscal_year_code: fy })
    .whereIn('status', ['submitted', 'approved'])
    .orderBy('submitted_at', 'desc');

  return rows.map(formatSubmission);
};

// ======================================================================
// PUT /abm/approve-specialist/:id
// ======================================================================
const approveSpecialist = async (commitmentId, abmUser, corrections, comments) => {
  const commitment = await db('product_commitments').where({ id: commitmentId }).first();

  if (!commitment) {
    const err = new Error('Commitment not found');
    err.status = 404;
    throw err;
  }

  // Verify this specialist reports to the ABM
  const specialist = await db('auth_users')
    .where({ employee_code: commitment.employee_code, is_active: true })
    .first();

  if (!specialist || specialist.reports_to !== abmUser.employeeCode) {
    const err = new Error('This specialist does not report to you');
    err.status = 403;
    throw err;
  }

  if (commitment.status === 'approved') {
    const err = new Error('Already approved');
    err.status = 400;
    throw err;
  }

  if (commitment.status !== 'submitted') {
    const err = new Error('Only submitted commitments can be approved');
    err.status = 400;
    throw err;
  }

  const now = new Date();
  const hasCorrections = corrections && Object.keys(corrections).length > 0;
  const action = hasCorrections ? 'corrected_and_approved' : 'approved';

  await db.transaction(async (trx) => {
    let originalValues = null;
    let updatedTargets = { ...(commitment.monthly_targets || {}) };

    if (hasCorrections) {
      originalValues = {};
      for (const [month, vals] of Object.entries(corrections)) {
        if (updatedTargets[month]) {
          originalValues[month] = { ...updatedTargets[month] };
          updatedTargets[month] = { ...updatedTargets[month], ...vals };
        }
      }
    }

    const updateData = {
      status: 'approved',
      approved_at: now,
      approved_by_code: abmUser.employeeCode,
      approved_by_name: abmUser.fullName,
      updated_at: now,
    };
    if (hasCorrections) {
      updateData.monthly_targets = JSON.stringify(updatedTargets);
    }

    await trx('product_commitments').where({ id: commitmentId }).update(updateData);

    await trx('commitment_approvals').insert({
      commitment_id: commitmentId,
      action,
      actor_code: abmUser.employeeCode,
      actor_name: abmUser.fullName,
      actor_role: abmUser.role,
      corrections: hasCorrections ? JSON.stringify(corrections) : null,
      original_values: originalValues ? JSON.stringify(originalValues) : null,
      comments: comments || null,
      created_at: now,
    });

    await trx('audit_log').insert({
      actor_code: abmUser.employeeCode,
      actor_role: abmUser.role,
      action: `specialist_${action}`,
      entity_type: 'product_commitment',
      entity_id: commitmentId,
      detail: JSON.stringify({
        specialist_code: commitment.employee_code,
        product_code: commitment.product_code,
        has_corrections: hasCorrections,
      }),
      created_at: now,
    });
  });

  return { success: true };
};

// ======================================================================
// POST /abm/bulk-approve-specialist
// ======================================================================
const bulkApproveSpecialist = async (submissionIds, abmUser) => {
  const specialistCodes = await getSpecialistCodes(abmUser.employeeCode);

  const eligible = await db('product_commitments')
    .whereIn('id', submissionIds)
    .whereIn('employee_code', specialistCodes)
    .where({ status: 'submitted' });

  if (eligible.length === 0) {
    const err = new Error('No eligible submissions to approve');
    err.status = 400;
    throw err;
  }

  const ids = eligible.map((r) => r.id);
  const now = new Date();

  await db.transaction(async (trx) => {
    await trx('product_commitments')
      .whereIn('id', ids)
      .update({
        status: 'approved',
        approved_at: now,
        approved_by_code: abmUser.employeeCode,
        approved_by_name: abmUser.fullName,
        updated_at: now,
      });

    const approvalRows = ids.map((id) => ({
      commitment_id: id,
      action: 'bulk_approved',
      actor_code: abmUser.employeeCode,
      actor_name: abmUser.fullName,
      actor_role: abmUser.role,
      created_at: now,
    }));
    await trx('commitment_approvals').insert(approvalRows);

    await trx('audit_log').insert({
      actor_code: abmUser.employeeCode,
      actor_role: abmUser.role,
      action: 'specialist_bulk_approved',
      entity_type: 'product_commitment',
      detail: JSON.stringify({ approved_ids: ids, count: ids.length }),
      created_at: now,
    });
  });

  return { success: true, approvedCount: ids.length };
};

// ======================================================================
// GET /abm/specialists
// ======================================================================
const getSpecialists = async (abmEmployeeCode) => {
  const rows = await db('auth_users')
    .where({ reports_to: abmEmployeeCode, is_active: true })
    .whereIn('role', SPECIALIST_ROLES)
    .orderBy('full_name');

  return rows.map((r) => ({
    employeeCode: r.employee_code,
    fullName: r.full_name,
    role: r.role,
    designation: r.designation,
    email: r.email,
    phone: r.phone,
    zoneName: r.zone_name,
    areaName: r.area_name,
    territoryName: r.territory_name,
  }));
};

// ======================================================================
// GET /abm/specialist-yearly-targets?fy=
// ======================================================================
const getSpecialistYearlyTargets = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();

  const rows = await db('yearly_target_assignments')
    .where({ manager_code: abmEmployeeCode, fiscal_year_code: fy })
    .whereIn('assignee_role', SPECIALIST_ROLES)
    .orderBy('assignee_name');

  return rows.map((r) => ({
    id: r.id,
    fiscalYearCode: r.fiscal_year_code,
    assigneeCode: r.assignee_code,
    assigneeName: r.assignee_name,
    assigneeRole: r.assignee_role,
    assigneeTerritory: r.assignee_territory,
    lyTargetQty: parseFloat(r.ly_target_qty) || 0,
    lyAchievedQty: parseFloat(r.ly_achieved_qty) || 0,
    lyTargetValue: parseFloat(r.ly_target_value) || 0,
    lyAchievedValue: parseFloat(r.ly_achieved_value) || 0,
    cyTargetQty: parseFloat(r.cy_target_qty) || 0,
    cyTargetValue: parseFloat(r.cy_target_value) || 0,
    categoryBreakdown: r.category_breakdown || [],
    status: r.status,
    publishedAt: r.published_at,
  }));
};

// ======================================================================
// POST /abm/specialist-yearly-targets/save
// ======================================================================
const saveSpecialistYearlyTargets = async (targets, abmUser, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const now = new Date();

  await db.transaction(async (trx) => {
    for (const t of targets) {
      const existing = await trx('yearly_target_assignments')
        .where({
          fiscal_year_code: fy,
          manager_code: abmUser.employeeCode,
          assignee_code: t.assigneeCode,
        })
        .first();

      const data = {
        cy_target_value: t.cyTargetValue || 0,
        cy_target_qty: t.cyTargetQty || 0,
        category_breakdown: JSON.stringify(t.categoryBreakdown || []),
        status: 'draft',
        updated_at: now,
      };

      if (existing) {
        await trx('yearly_target_assignments').where({ id: existing.id }).update(data);
      } else {
        const specialist = await trx('auth_users')
          .where({ employee_code: t.assigneeCode, is_active: true })
          .first();

        await trx('yearly_target_assignments').insert({
          fiscal_year_code: fy,
          manager_code: abmUser.employeeCode,
          manager_role: abmUser.role,
          assignee_code: t.assigneeCode,
          assignee_name: t.assigneeName || specialist?.full_name || '',
          assignee_role: specialist?.role || 'at_iol_specialist',
          assignee_territory: specialist?.area_name || specialist?.territory_name || '',
          ly_target_qty: t.lyTargetQty || 0,
          ly_achieved_qty: t.lyAchievedQty || 0,
          ly_target_value: t.lyTargetValue || 0,
          ly_achieved_value: t.lyAchievedValue || 0,
          ...data,
          created_at: now,
        });
      }
    }
  });

  return { success: true };
};

// ======================================================================
// POST /abm/specialist-yearly-targets/publish
// ======================================================================
const publishSpecialistYearlyTargets = async (targets, abmUser, fiscalYearCode) => {
  // Save first, then flip status
  await saveSpecialistYearlyTargets(targets, abmUser, fiscalYearCode);

  const fy = fiscalYearCode || await getActiveFY();
  const now = new Date();
  const assigneeCodes = targets.map((t) => t.assigneeCode);

  await db('yearly_target_assignments')
    .where({ manager_code: abmUser.employeeCode, fiscal_year_code: fy })
    .whereIn('assignee_code', assigneeCodes)
    .update({ status: 'published', published_at: now, updated_at: now });

  await db('audit_log').insert({
    actor_code: abmUser.employeeCode,
    actor_role: abmUser.role,
    action: 'specialist_yearly_targets_published',
    entity_type: 'yearly_target_assignment',
    detail: JSON.stringify({ specialist_codes: assigneeCodes, fiscal_year: fy }),
    created_at: now,
  });

  return { success: true };
};

// ======================================================================
// GET /abm/specialist-dashboard-stats
// ======================================================================
const getSpecialistDashboardStats = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const specialistCodes = await getSpecialistCodes(abmEmployeeCode);

  if (specialistCodes.length === 0) {
    return {
      specialistCount: 0,
      submissions: { total: 0, pending: 0, approved: 0 },
      yearlyTargets: { total: 0, published: 0, notSet: 0 },
    };
  }

  const submissions = await db('product_commitments')
    .whereIn('employee_code', specialistCodes)
    .where({ fiscal_year_code: fy })
    .select(
      db.raw("COUNT(*) as total"),
      db.raw("COUNT(*) FILTER (WHERE status = 'submitted') as pending"),
      db.raw("COUNT(*) FILTER (WHERE status = 'approved') as approved")
    )
    .first();

  const yearlyStats = await db('yearly_target_assignments')
    .where({ manager_code: abmEmployeeCode, fiscal_year_code: fy })
    .whereIn('assignee_role', SPECIALIST_ROLES)
    .select(
      db.raw("COUNT(*) as total"),
      db.raw("COUNT(*) FILTER (WHERE status = 'published') as published"),
      db.raw("COUNT(*) FILTER (WHERE status = 'not_set') as not_set")
    )
    .first();

  return {
    specialistCount: specialistCodes.length,
    submissions: {
      total: parseInt(submissions?.total) || 0,
      pending: parseInt(submissions?.pending) || 0,
      approved: parseInt(submissions?.approved) || 0,
    },
    yearlyTargets: {
      total: parseInt(yearlyStats?.total) || 0,
      published: parseInt(yearlyStats?.published) || 0,
      notSet: parseInt(yearlyStats?.not_set) || 0,
    },
  };
};

module.exports = {
  getSpecialistSubmissions,
  approveSpecialist,
  bulkApproveSpecialist,
  getSpecialists,
  getSpecialistYearlyTargets,
  saveSpecialistYearlyTargets,
  publishSpecialistYearlyTargets,
  getSpecialistDashboardStats,
};
