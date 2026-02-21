const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');

const TBMService = {


  async getSalesRepSubmissions(tbmEmployeeCode, filters = {}) {

    const directReports = await db.raw(
      `SELECT employee_code FROM fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);

    if (srCodes.length === 0) return [];

    let query = db('product_commitments')
      .whereIn('employee_code', srCodes);


    if (filters.status) {
      query = query.where('status', filters.status);
    } else {
      query = query.whereIn('status', ['submitted', 'approved']);
    }

    if (filters.categoryId) query = query.where('category_id', filters.categoryId);
    if (filters.salesRepId) query = query.where('employee_code', filters.salesRepId);


    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (activeFy) query = query.where('fiscal_year_code', activeFy.code);

    const rows = await query.orderBy('employee_name').orderBy('category_id').orderBy('product_name');

    return rows.map((r) => ({
      id: r.id,
      salesRepId: r.employee_code,
      salesRepName: r.employee_name,
      territory: r.territory_name,
      categoryId: r.category_id,
      subcategory: null,
      name: r.product_name,
      code: r.product_code,
      status: r.status,
      submittedDate: r.submitted_at,
      approvedDate: r.approved_at,
      approvedBy: r.approved_by_name,
      monthlyTargets: r.monthly_targets,
    }));
  },


  async approveSalesRepTarget(commitmentId, tbmUser, { comments = '', corrections = null } = {}) {
    const commitment = await db('product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') {
      throw Object.assign(new Error(`Can only approve 'submitted' commitments. Current: '${commitment.status}'.`), { status: 400 });
    }


    const sr = await db('auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== tbmUser.employeeCode) {
      throw Object.assign(new Error('This sales rep does not report to you.'), { status: 403 });
    }

    let originalValues = null;
    let action = 'approved';


    if (corrections && Object.keys(corrections).length > 0) {
      originalValues = { ...commitment.monthly_targets };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) {
        if (updated[month]) {
          updated[month] = { ...updated[month], ...values };
        }
      }
      await db('product_commitments').where({ id: commitmentId }).update({
        monthly_targets: JSON.stringify(updated),
      });
      action = 'corrected_and_approved';
    }


    await db('product_commitments').where({ id: commitmentId }).update({
      status: 'approved',
      approved_at: new Date(),
      approved_by_code: tbmUser.employeeCode,
      approved_by_name: tbmUser.fullName,
    });


    await db('commitment_approvals').insert({
      commitment_id: commitmentId,
      action,
      actor_code: tbmUser.employeeCode,
      actor_name: tbmUser.fullName,
      actor_role: tbmUser.role,
      corrections: corrections ? JSON.stringify(corrections) : null,
      original_values: originalValues ? JSON.stringify(originalValues) : null,
      comments,
    });

    return { success: true, submissionId: commitmentId, action };
  },


  async bulkApproveSalesRep(submissionIds, tbmUser, comments = '') {

    const directReports = await db.raw(
      `SELECT employee_code FROM fn_get_direct_reports(?)`,
      [tbmUser.employeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);

    const commitments = await db('product_commitments')
      .whereIn('id', submissionIds)
      .where('status', 'submitted')
      .whereIn('employee_code', srCodes);

    if (commitments.length === 0) {
      throw Object.assign(new Error('No eligible submissions found.'), { status: 400 });
    }

    const validIds = commitments.map((c) => c.id);

    await db('product_commitments')
      .whereIn('id', validIds)
      .update({
        status: 'approved',
        approved_at: new Date(),
        approved_by_code: tbmUser.employeeCode,
        approved_by_name: tbmUser.fullName,
      });

    const approvalRows = validIds.map((id) => ({
      commitment_id: id,
      action: 'bulk_approved',
      actor_code: tbmUser.employeeCode,
      actor_name: tbmUser.fullName,
      actor_role: tbmUser.role,
      comments,
    }));
    await db('commitment_approvals').insert(approvalRows);

    return {
      success: true,
      approvedCount: validIds.length,
      message: `${validIds.length} targets approved successfully`,
    };
  },


  async getTerritoryTargets(tbmEmployeeCode, filters = {}) {
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    let query = db('product_commitments')
      .where('employee_code', tbmEmployeeCode);

    if (activeFy) query = query.where('fiscal_year_code', activeFy.code);
    if (filters.status) query = query.where('status', filters.status);
    if (filters.categoryId) query = query.where('category_id', filters.categoryId);

    const rows = await query.orderBy('category_id').orderBy('product_name');
    return rows.map(formatCommitment);
  },


  async saveTerritoryTargets(targets, tbmUser) {
    let savedCount = 0;
    for (const t of targets) {
      const existing = await db('product_commitments')
        .where({ id: t.id, employee_code: tbmUser.employeeCode })
        .whereIn('status', ['not_started', 'draft'])
        .first();

      if (existing) {
        await db('product_commitments').where({ id: t.id }).update({
          monthly_targets: JSON.stringify(t.monthlyTargets),
          status: 'draft',
        });
        savedCount++;
      }
    }
    return { success: true, savedCount, message: 'Targets saved as draft' };
  },


  async submitTerritoryTargets(targetIds, tbmUser) {
    const commitments = await db('product_commitments')
      .whereIn('id', targetIds)
      .where('employee_code', tbmUser.employeeCode)
      .where('status', 'draft');

    if (commitments.length === 0) {
      throw Object.assign(new Error('No eligible draft targets found.'), { status: 400 });
    }

    const validIds = commitments.map((c) => c.id);
    await db('product_commitments')
      .whereIn('id', validIds)
      .update({ status: 'submitted', submitted_at: new Date() });

    const approvalRows = validIds.map((id) => ({
      commitment_id: id,
      action: 'submitted',
      actor_code: tbmUser.employeeCode,
      actor_name: tbmUser.fullName,
      actor_role: tbmUser.role,
    }));
    await db('commitment_approvals').insert(approvalRows);

    return {
      success: true,
      submittedCount: validIds.length,
      message: `${validIds.length} targets submitted for ABM approval`,
    };
  },


  async getIndividualTargets(tbmEmployeeCode, filters = {}) {

    return this.getTerritoryTargets(tbmEmployeeCode, filters);
  },


  async saveIndividualTargets(targets, tbmUser) {
    return this.saveTerritoryTargets(targets, tbmUser);
  },


  async submitIndividualTargets(targetIds, tbmUser) {
    return this.submitTerritoryTargets(targetIds, tbmUser);
  },


  async getDashboardStats(tbmEmployeeCode) {
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (!activeFy) return {};


    const directReports = await db.raw(
      `SELECT employee_code, full_name FROM fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);


    const srCommitments = srCodes.length > 0
      ? await db('product_commitments')
          .whereIn('employee_code', srCodes)
          .where('fiscal_year_code', activeFy.code)
      : [];

    const salesRepStats = {
      total: srCommitments.length,
      submitted: srCommitments.filter((c) => c.status === 'submitted').length,
      approved: srCommitments.filter((c) => c.status === 'approved').length,
      draft: srCommitments.filter((c) => c.status === 'draft').length,
    };


    const tbmCommitments = await db('product_commitments')
      .where({ employee_code: tbmEmployeeCode, fiscal_year_code: activeFy.code });

    const tbmStats = {
      total: tbmCommitments.length,
      submitted: tbmCommitments.filter((c) => c.status === 'submitted').length,
      approved: tbmCommitments.filter((c) => c.status === 'approved').length,
      draft: tbmCommitments.filter((c) => c.status === 'draft').length,
    };

    const salesRepTotals = aggregateMonthlyTargets(srCommitments);
    const tbmTotals = aggregateMonthlyTargets(tbmCommitments);

    return {
      salesRepSubmissions: salesRepStats,
      tbmTargets: tbmStats,
      tbmIndividualTargets: tbmStats,
      salesRepTotals,
      tbmTotals,
      tbmIndividualTotals: tbmTotals,
      salesRepCount: srCodes.length,
    };
  },


  async getYearlyTargets(tbmEmployeeCode, fiscalYearCode) {
    const fy = fiscalYearCode || (await db('fiscal_years').where('is_active', true).first())?.code;
    if (!fy) return { members: [] };


    const directReports = await db.raw(
      `SELECT employee_code, full_name, designation, territory_name FROM fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );

    const members = [];
    for (const sr of directReports.rows) {

      const assignment = await db('yearly_target_assignments')
        .where({
          fiscal_year_code: fy,
          manager_code: tbmEmployeeCode,
          assignee_code: sr.employee_code,
        })
        .first();

      members.push({
        id: sr.employee_code,
        name: sr.full_name,
        territory: sr.territory_name,
        designation: sr.designation,
        lyTarget: assignment ? parseFloat(assignment.ly_target_qty) : 0,
        lyAchieved: assignment ? parseFloat(assignment.ly_achieved_qty) : 0,
        lyTargetValue: assignment ? parseFloat(assignment.ly_target_value) : 0,
        lyAchievedValue: assignment ? parseFloat(assignment.ly_achieved_value) : 0,
        cyTarget: assignment ? parseFloat(assignment.cy_target_qty) : 0,
        cyTargetValue: assignment ? parseFloat(assignment.cy_target_value) : 0,
        status: assignment?.status || 'not_set',
        lastUpdated: assignment?.updated_at || null,
        categoryBreakdown: assignment?.category_breakdown || [],
      });
    }

    return { members };
  },


  async saveYearlyTargets(tbmUser, fiscalYear, membersData) {
    let savedCount = 0;

    for (const m of membersData) {
      const existing = await db('yearly_target_assignments')
        .where({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          assignee_code: m.id,
        })
        .first();

      const data = {
        cy_target_qty: m.cyTarget || 0,
        cy_target_value: m.cyTargetValue || 0,
        category_breakdown: m.categoryBreakdown ? JSON.stringify(m.categoryBreakdown) : '[]',
        status: 'draft',
      };

      if (existing) {
        await db('yearly_target_assignments').where({ id: existing.id }).update(data);
      } else {

        const assignee = await db('auth_users').where({ employee_code: m.id }).first();
        await db('yearly_target_assignments').insert({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          manager_role: tbmUser.role,
          assignee_code: m.id,
          assignee_name: assignee?.full_name || '',
          assignee_role: assignee?.role || 'sales_rep',
          assignee_territory: assignee?.territory_name || '',
          ...data,
        });
      }
      savedCount++;
    }

    return { success: true, savedCount };
  },


  async publishYearlyTargets(tbmUser, fiscalYear, memberIds) {
    let publishedCount = 0;

    for (const memberId of memberIds) {
      const updated = await db('yearly_target_assignments')
        .where({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          assignee_code: memberId,
        })
        .update({ status: 'published', published_at: new Date() });

      if (updated > 0) publishedCount++;
    }

    return { success: true, publishedCount };
  },


  async rejectSalesRepTarget(commitmentId, tbmUser, reason = '') {
    const commitment = await db('product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') {
      throw Object.assign(new Error(`Can only reject 'submitted' commitments.`), { status: 400 });
    }
    const sr = await db('auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== tbmUser.employeeCode) {
      throw Object.assign(new Error('This sales rep does not report to you.'), { status: 403 });
    }

    await db('product_commitments').where({ id: commitmentId }).update({ status: 'draft' });
    await db('commitment_approvals').insert({
      commitment_id: commitmentId,
      action: 'submitted',
      actor_code: tbmUser.employeeCode,
      actor_name: tbmUser.fullName,
      actor_role: tbmUser.role,
      comments: `REJECTED: ${reason}`,
    });
    return { success: true, submissionId: commitmentId, reason };
  },


  async bulkRejectSalesRep(submissionIds, tbmUser, reason = '') {
    const directReports = await db.raw(`SELECT employee_code FROM fn_get_direct_reports(?)`, [tbmUser.employeeCode]);
    const srCodes = directReports.rows.map((r) => r.employee_code);
    const commitments = await db('product_commitments')
      .whereIn('id', submissionIds).where('status', 'submitted').whereIn('employee_code', srCodes);
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions found.'), { status: 400 });
    const validIds = commitments.map((c) => c.id);
    await db('product_commitments').whereIn('id', validIds).update({ status: 'draft' });
    const rows = validIds.map((id) => ({
      commitment_id: id, action: 'submitted',
      actor_code: tbmUser.employeeCode, actor_name: tbmUser.fullName, actor_role: tbmUser.role,
      comments: `BULK REJECTED: ${reason}`,
    }));
    await db('commitment_approvals').insert(rows);
    return { success: true, rejectedCount: validIds.length, message: `${validIds.length} targets rejected` };
  },


  async updateSingleTarget(targetId, tbmUser, { month, values }) {
    const commitment = await db('product_commitments')
      .where({ id: targetId, employee_code: tbmUser.employeeCode }).first();
    if (!commitment) throw Object.assign(new Error('Target not found or not yours.'), { status: 404 });
    const updated = { ...(commitment.monthly_targets || {}) };
    if (!updated[month]) updated[month] = {};
    updated[month] = { ...updated[month], ...values };
    await db('product_commitments').where({ id: targetId }).update({
      monthly_targets: JSON.stringify(updated), status: 'draft',
    });
    return { success: true, targetId, month, values };
  },


  async getTeamTargetsForRep(tbmEmployeeCode, repId) {
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const targets = await db('team_product_targets')
      .where({ manager_code: tbmEmployeeCode, member_code: repId, fiscal_year_code: activeFy.code })
      .orderBy('category_id').orderBy('product_name');
    return targets.map((r) => ({
      id: r.id, categoryId: r.category_id, name: r.product_name, code: r.product_code,
      monthlyTargets: r.monthly_targets, status: r.status, assigned: r.status === 'published',
      assignedDate: r.assigned_at,
    }));
  },


  async saveTeamTargetsForRep(tbmUser, repId, targets) {
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (!activeFy) throw Object.assign(new Error('No active fiscal year.'), { status: 400 });
    let savedCount = 0;
    for (const t of targets) {
      const existing = await db('team_product_targets').where({
        fiscal_year_code: activeFy.code, manager_code: tbmUser.employeeCode,
        member_code: repId, product_code: t.code || t.productCode,
      }).first();
      if (existing) {
        await db('team_product_targets').where({ id: existing.id }).update({
          monthly_targets: JSON.stringify(t.monthlyTargets), status: 'draft',
        });
      } else {
        await db('team_product_targets').insert({
          fiscal_year_code: activeFy.code, manager_code: tbmUser.employeeCode,
          manager_role: tbmUser.role, member_code: repId,
          member_name: t.memberName || '', product_code: t.code || t.productCode,
          product_name: t.name || t.productName, category_id: t.categoryId,
          monthly_targets: JSON.stringify(t.monthlyTargets), status: 'draft',
        });
      }
      savedCount++;
    }
    return { success: true, repId, savedCount };
  },


  async assignTeamTargetsToRep(tbmUser, repId, targets) {
    const result = await this.saveTeamTargetsForRep(tbmUser, repId, targets);
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (activeFy) {
      await db('team_product_targets')
        .where({ manager_code: tbmUser.employeeCode, member_code: repId, fiscal_year_code: activeFy.code })
        .update({ status: 'published', assigned_at: new Date() });
    }
    return { success: true, repId, assignedCount: result.savedCount };
  },


  async getTeamTargetsSummary(tbmEmployeeCode) {
    const activeFy = await db('fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const directReports = await db.raw(`SELECT employee_code, full_name, territory_name FROM fn_get_direct_reports(?)`, [tbmEmployeeCode]);
    const summary = [];
    for (const sr of directReports.rows) {
      const targets = await db('team_product_targets')
        .where({ manager_code: tbmEmployeeCode, member_code: sr.employee_code, fiscal_year_code: activeFy.code });
      let totalQty = 0;
      targets.forEach((t) => {
        const mt = t.monthly_targets || {};
        Object.values(mt).forEach((m) => { totalQty += Number(m.cyQty || 0); });
      });
      summary.push({
        id: sr.employee_code, name: sr.full_name, territory: sr.territory_name,
        productCount: targets.length, totalQty,
        assigned: targets.some((t) => t.status === 'published'),
      });
    }
    return summary;
  },
};

module.exports = TBMService;
