/**
 * Specialist Controller
 * Thin request/response layer for specialist's own product commitments.
 *
 * Routes: /api/v1/specialist/*
 * Auth:   authenticate + authorize(SPECIALIST_ROLES)
 */

'use strict';

const specialistService = require('../services/specialist.service');

// GET /specialist/products
const getProducts = async (req, res, next) => {
  try {
    const products = await specialistService.getProducts(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(products);
  } catch (err) { next(err); }
};

// PUT /specialist/products/:id/save
const saveProduct = async (req, res, next) => {
  try {
    const result = await specialistService.saveProduct(
      parseInt(req.params.id, 10),
      req.body.monthlyTargets,
      req.user.employeeCode
    );
    res.json(result);
  } catch (err) { next(err); }
};

// POST /specialist/products/:id/submit
const submitProduct = async (req, res, next) => {
  try {
    const result = await specialistService.submitProduct(
      parseInt(req.params.id, 10),
      req.user.employeeCode
    );
    res.json(result);
  } catch (err) { next(err); }
};

// POST /specialist/products/submit-multiple
const submitMultiple = async (req, res, next) => {
  try {
    const result = await specialistService.submitMultiple(req.body.productIds, req.user);
    res.json(result);
  } catch (err) { next(err); }
};

// POST /specialist/products/save-all
const saveAll = async (req, res, next) => {
  try {
    const result = await specialistService.saveAll(req.body.products, req.user.employeeCode);
    res.json(result);
  } catch (err) { next(err); }
};

// GET /specialist/dashboard-summary
const getDashboardSummary = async (req, res, next) => {
  try {
    const result = await specialistService.getDashboardSummary(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(result);
  } catch (err) { next(err); }
};

// GET /specialist/quarterly-summary
const getQuarterlySummary = async (req, res, next) => {
  try {
    const result = await specialistService.getQuarterlySummary(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(result);
  } catch (err) { next(err); }
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
