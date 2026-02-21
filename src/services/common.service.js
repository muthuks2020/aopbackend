const { db } = require('../config/database');

const CommonService = {


  async getCategories(userRole) {
    const rows = await db('product_categories AS c')
      .join('role_product_access AS rpa', function () {
        this.on('rpa.category_id', '=', 'c.id').andOn('rpa.can_view', '=', db.raw('true'));
      })
      .where('rpa.role', userRole)
      .where('c.is_active', true)
      .select('c.id', 'c.name', 'c.icon', 'c.color_class', 'c.is_revenue_only', 'c.display_order')
      .orderBy('c.display_order');

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      color: r.color_class,
      isRevenueOnly: r.is_revenue_only,
      displayOrder: r.display_order,
    }));
  },


  async getProducts(categoryId) {
    let query = db('product_pricing')
      .where('is_active', true)
      .select(
        'id', 'product_code', 'product_name', 'category_id', 'subcategory',
        'unit_cost', 'currency', 'effective_from', 'effective_to', 'fiscal_year_code'
      )
      .orderBy('product_name');

    if (categoryId) {
      query = query.where('category_id', categoryId);
    }

    const rows = await query;
    return rows.map((r) => ({
      id: r.id,
      productCode: r.product_code,
      productName: r.product_name,
      categoryId: r.category_id,
      subcategory: r.subcategory,
      unitCost: parseFloat(r.unit_cost),
      currency: r.currency,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      fiscalYearCode: r.fiscal_year_code,
    }));
  },


  async getProductPricing(categoryId) {
    let query = db('product_pricing')
      .where('is_active', true)
      .where('effective_from', '<=', new Date())
      .where(function () {
        this.whereNull('effective_to').orWhere('effective_to', '>=', new Date());
      })
      .select('product_code', 'product_name', 'category_id', 'subcategory', 'unit_cost', 'currency')
      .orderBy('product_name');

    if (categoryId) {
      query = query.where('category_id', categoryId);
    }

    const rows = await query;
    return rows.map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      categoryId: r.category_id,
      subcategory: r.subcategory,
      unitCost: parseFloat(r.unit_cost),
      currency: r.currency,
    }));
  },


  async getFiscalYears() {
    const rows = await db('fiscal_years')
      .select('id', 'code', 'label', 'start_date', 'end_date', 'is_active', 'is_commitment_open', 'commitment_deadline')
      .orderBy('start_date', 'desc');

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      startDate: r.start_date,
      endDate: r.end_date,
      isActive: r.is_active,
      isCommitmentOpen: r.is_commitment_open,
      commitmentDeadline: r.commitment_deadline,
    }));
  },


  async getAopTargets(userId, fiscalYear) {
    try {

      const schemaCheck = await db.raw(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'aop'`
      );
      if (schemaCheck.rows.length === 0) {
        return [];
      }

      const rows = await db.raw(
        `SELECT product_code, monthly_targets FROM aop.employee_product_targets
         WHERE employee_code = ? AND fiscal_year = ?`,
        [userId, fiscalYear]
      );
      return rows.rows;
    } catch {
      return [];
    }
  },


  async getOrgHierarchy() {
    const rows = await db('v_org_hierarchy')
      .select('*');

    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      role: r.role,
      designation: r.designation,
      email: r.email,
      phone: r.phone,
      zoneName: r.zone_name,
      areaName: r.area_name,
      territoryName: r.territory_name,
      reportsTo: r.reports_to,
      isActive: r.is_active,
      managerName: r.manager_name,
      managerRole: r.manager_role,
      directReportCount: parseInt(r.direct_report_count || 0),
    }));
  },


  async getActiveFiscalYear() {
    return db('fiscal_years').where('is_active', true).first();
  },
};

module.exports = CommonService;
