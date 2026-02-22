/**
 * Specialist Routes
 * /api/v1/specialist/*
 *
 * All routes require JWT auth + specialist role.
 * Specialist → ABM → ZBM → Sales Head
 */

'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const SpecialistController = require('../controllers/specialist.controller');
const {
  saveSpecialistProductSchema,
  submitSpecialistMultipleSchema,
  saveAllSpecialistProductsSchema,
} = require('../validators/specialistSchemas');

// All specialist routes require auth + any specialist role
router.use(authenticate);
router.use(authorize('at_iol_specialist', 'eq_spec_diagnostic', 'eq_spec_surgical'));

// ── Product Commitment CRUD ──────────────────────────────────────
router.get('/products', SpecialistController.getProducts);
router.put('/products/:id/save', validateBody(saveSpecialistProductSchema), SpecialistController.saveProduct);
router.post('/products/:id/submit', SpecialistController.submitProduct);
router.post('/products/submit-multiple', validateBody(submitSpecialistMultipleSchema), SpecialistController.submitMultiple);
router.post('/products/save-all', validateBody(saveAllSpecialistProductsSchema), SpecialistController.saveAll);

// ── Dashboard & Analytics ────────────────────────────────────────
router.get('/dashboard-summary', SpecialistController.getDashboardSummary);
router.get('/quarterly-summary', SpecialistController.getQuarterlySummary);

module.exports = router;
