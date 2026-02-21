const CommonService = require('../services/common.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const CommonController = {
  async getCategories(req, res, next) {
    try {
      const categories = await CommonService.getCategories(req.user.role);
      res.json(categories);
    } catch (err) {
      next(err);
    }
  },

  async getProducts(req, res, next) {
    try {
      const products = await CommonService.getProducts(req.query.category);
      res.json(products);
    } catch (err) {
      next(err);
    }
  },

  async getProductPricing(req, res, next) {
    try {
      const pricing = await CommonService.getProductPricing(req.query.category);
      res.json(pricing);
    } catch (err) {
      next(err);
    }
  },

  async getFiscalYears(req, res, next) {
    try {
      const fiscalYears = await CommonService.getFiscalYears();
      res.json(fiscalYears);
    } catch (err) {
      next(err);
    }
  },

  async getAopTargets(req, res, next) {
    try {
      const { userId, fy } = req.query;
      const targets = await CommonService.getAopTargets(
        userId || req.user.employeeCode,
        fy
      );
      res.json(targets);
    } catch (err) {
      next(err);
    }
  },

  async getOrgHierarchy(req, res, next) {
    try {
      const hierarchy = await CommonService.getOrgHierarchy();
      res.json(hierarchy);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = CommonController;
