const CommitmentService = require('../services/commitment.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const SalesRepController = {


  async getProducts(req, res, next) {
    try {
      const products = await CommitmentService.getProducts(
        req.user.employeeCode,
        req.query.fy
      );
      res.json(products);
    } catch (err) {
      next(err);
    }
  },

  async updateMonthlyTarget(req, res, next) {
    try {
      const result = await CommitmentService.updateMonthlyTarget(
        parseInt(req.params.id),
        req.params.month,
        req.body,
        req.user
      );
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async saveProduct(req, res, next) {
    try {
      const result = await CommitmentService.saveProduct(
        parseInt(req.params.id),
        req.body.monthlyTargets,
        req.user
      );

      req.logAudit({
        action: 'save_product',
        entityType: 'product_commitments',
        entityId: parseInt(req.params.id),
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async submitProduct(req, res, next) {
    try {
      const result = await CommitmentService.submitProduct(
        parseInt(req.params.id),
        req.user,
        req.body.comments
      );

      req.logAudit({
        action: 'submit_product',
        entityType: 'product_commitments',
        entityId: parseInt(req.params.id),
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async submitMultiple(req, res, next) {
    try {
      const result = await CommitmentService.submitMultiple(req.body.productIds, req.user);

      req.logAudit({
        action: 'submit_multiple_products',
        entityType: 'product_commitments',
        detail: { productIds: req.body.productIds },
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async saveAll(req, res, next) {
    try {
      const result = await CommitmentService.saveAll(req.body.products, req.user);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },


  async getDashboardSummary(req, res, next) {
    try {
      const summary = await CommitmentService.getDashboardSummary(req.user.employeeCode);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },

  async getQuarterlySummary(req, res, next) {
    try {
      const summary = await CommitmentService.getQuarterlySummary(
        req.user.employeeCode,
        req.query.fy
      );
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },

  async getCategoryPerformance(req, res, next) {
    try {
      const performance = await CommitmentService.getCategoryPerformance(req.user.employeeCode);
      res.json(performance);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = SalesRepController;
