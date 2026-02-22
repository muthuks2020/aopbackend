/**
 * Specialist Service
 * Business logic for Specialist's own product commitments.
 *
 * Specialist → ABM → ZBM → Sales Head
 * Reuses product_commitments, commitment_approvals tables.
 */

'use strict';

const { db } = require('../config/database');
const { FISCAL_MONTHS, QUARTERS } = require('../utils/specialistConstants');

// ──────────────────────────────────────────────────────────────────
// Helper: active fiscal year
// ──────────────────────────────────────────────────────────────────
const getActiveFY = async () => {
  const fy = await db('fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

// ──────────────────────────────────────────────────────────────────
// Helper: format a product_commitments row for API response
// ──────────────────────────────────────────────────────────────────
const formatCommitment = (r) => ({
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
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ──────────────────────────────────────────────────────────────────
// Helper: verify ownership
// ──────────────────────────────────────────────────────────────────
const getOwnCommitment = async (commitmentId, employeeCode) => {
  const row = await db('product_commitments')
    .where({ id: commitmentId, employee_code: employeeCode })
    .first();
  if (!row) {
    const err = new Error('Commitment not found or access denied');
    err.status = 404;
    throw err;
  }
  return row;
};

// ======================================================================
// GET /specialist/products
// ======================================================================
const getProducts = async (employeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const rows = await db('product_commitments')
    .where({ employee_code: employeeCode, fiscal_year_code: fy })
    .orderBy('category_id')
    .orderBy('product_name');
  return rows.map(formatCommitment);
};

// ======================================================================
// PUT /specialist/products/:id/save
// ======================================================================
const saveProduct = async (commitmentId, monthlyTargets, employeeCode) => {
  const commitment = await getOwnCommitment(commitmentId, employeeCode);

  if (commitment.status === 'submitted' || commitment.status === 'approved') {
    const err = new Error('Cannot edit a submitted or approved commitment');
    err.status = 400;
    throw err;
  }

  await db('product_commitments')
    .where({ id: commitmentId })
    .update({
      monthly_targets: JSON.stringify(monthlyTargets),
      status: 'draft',
      updated_at: db.fn.now(),
    });

  return { success: true };
};

// ======================================================================
// POST /specialist/products/:id/submit
// ======================================================================
const submitProduct = async (commitmentId, employeeCode) => {
  const commitment = await getOwnCommitment(commitmentId, employeeCode);

  if (commitment.status === 'approved') {
    const err = new Error('Already approved');
    err.status = 400;
    throw err;
  }
  if (commitment.status === 'not_started') {
    const err = new Error('Cannot submit a commitment with no data. Save as draft first.');
    err.status = 400;
    throw err;
  }

  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('product_commitments')
      .where({ id: commitmentId })
      .update({ status: 'submitted', submitted_at: now, updated_at: now });

    await trx('commitment_approvals').insert({
      commitment_id: commitmentId,
      action: 'submitted',
      actor_code: employeeCode,
      actor_name: commitment.employee_name,
      actor_role: commitment.employee_role,
      created_at: now,
    });
  });

  return { success: true };
};

// ======================================================================
// POST /specialist/products/submit-multiple
// ======================================================================
const submitMultiple = async (productIds, user) => {
  const submittable = await db('product_commitments')
    .whereIn('id', productIds)
    .where({ employee_code: user.employeeCode })
    .where('status', 'draft');

  if (submittable.length === 0) {
    const err = new Error('No eligible commitments to submit (must be in draft status)');
    err.status = 400;
    throw err;
  }

  const ids = submittable.map((r) => r.id);
  const now = new Date();

  await db.transaction(async (trx) => {
    await trx('product_commitments')
      .whereIn('id', ids)
      .update({ status: 'submitted', submitted_at: now, updated_at: now });

    const approvalRows = ids.map((id) => ({
      commitment_id: id,
      action: 'submitted',
      actor_code: user.employeeCode,
      actor_name: user.fullName,
      actor_role: user.role,
      created_at: now,
    }));
    await trx('commitment_approvals').insert(approvalRows);
  });

  return { success: true, submittedCount: ids.length };
};

// ======================================================================
// POST /specialist/products/save-all
// ======================================================================
const saveAll = async (products, employeeCode) => {
  const ids = products.map((p) => (typeof p.id === 'string' ? parseInt(p.id, 10) : p.id));

  const owned = await db('product_commitments')
    .whereIn('id', ids)
    .where({ employee_code: employeeCode })
    .whereIn('status', ['not_started', 'draft']);

  const ownedSet = new Set(owned.map((r) => r.id));
  let savedCount = 0;

  await db.transaction(async (trx) => {
    for (const p of products) {
      const pid = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
      if (!ownedSet.has(pid)) continue;

      await trx('product_commitments')
        .where({ id: pid })
        .update({
          monthly_targets: JSON.stringify(p.monthlyTargets),
          status: 'draft',
          updated_at: db.fn.now(),
        });
      savedCount++;
    }
  });

  return { success: true, savedCount };
};

// ======================================================================
// GET /specialist/dashboard-summary
// ======================================================================
const getDashboardSummary = async (employeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();

  const rows = await db('product_commitments')
    .where({ employee_code: employeeCode, fiscal_year_code: fy });

  let totalLY = 0;
  let totalCY = 0;
  let draftCount = 0;
  let submittedCount = 0;
  let approvedCount = 0;

  for (const r of rows) {
    const mt = r.monthly_targets || {};
    for (const m of FISCAL_MONTHS) {
      totalLY += mt[m]?.lyRev || 0;
      totalCY += mt[m]?.cyRev || 0;
    }
    if (r.status === 'draft') draftCount++;
    else if (r.status === 'submitted') submittedCount++;
    else if (r.status === 'approved') approvedCount++;
  }

  const growth = totalLY > 0 ? parseFloat(((totalCY - totalLY) / totalLY * 100).toFixed(1)) : 0;

  return {
    totalLY,
    totalCY,
    growth,
    totalProducts: rows.length,
    draftCount,
    submittedCount,
    approvedCount,
  };
};

// ======================================================================
// GET /specialist/quarterly-summary
// ======================================================================
const getQuarterlySummary = async (employeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();

  const rows = await db('product_commitments')
    .where({ employee_code: employeeCode, fiscal_year_code: fy });

  const catMap = {};
  for (const r of rows) {
    const catId = r.category_id || 'other';
    if (!catMap[catId]) {
      catMap[catId] = { categoryId: catId, quarters: {} };
      for (const qName of Object.keys(QUARTERS)) {
        catMap[catId].quarters[qName] = { lyRev: 0, cyRev: 0, lyQty: 0, cyQty: 0 };
      }
    }
    const mt = r.monthly_targets || {};
    for (const [qName, months] of Object.entries(QUARTERS)) {
      for (const m of months) {
        catMap[catId].quarters[qName].lyRev += mt[m]?.lyRev || 0;
        catMap[catId].quarters[qName].cyRev += mt[m]?.cyRev || 0;
        catMap[catId].quarters[qName].lyQty += mt[m]?.lyQty || 0;
        catMap[catId].quarters[qName].cyQty += mt[m]?.cyQty || 0;
      }
    }
  }

  return { fiscalYear: fy, categories: Object.values(catMap) };
};

module.exports = {
  getProducts,
  saveProduct,
  submitProduct,
  submitMultiple,
  saveAll,
  getDashboardSummary,
  getQuarterlySummary,
};
