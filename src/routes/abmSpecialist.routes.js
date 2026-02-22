/**
 * ABM Specialist Routes
 * Additional routes for ABM managing specialists.
 *
 * Mount in server.js alongside existing ABM routes:
 *   app.use(`${API_PREFIX}/abm`, authenticate, authorize('abm'), abmSpecialistRoutes);
 *
 * Or merge into existing abm.routes.js:
 *   const abmSpecialistRoutes = require('./abmSpecialist.routes');
 *   router.use('/', abmSpecialistRoutes);
 */

'use strict';

const express = require('express');
const router = express.Router();
const { validateBody } = require('../middleware/validate');
const ABMSpecialistController = require('../controllers/abmSpecialist.controller');
const {
  approveSpecialistSchema,
  bulkApproveSpecialistSchema,
  saveSpecialistYearlyTargetsSchema,
} = require('../validators/specialistSchemas');

// NOTE: authenticate + authorize('abm') is already applied by the parent router.

// ── Specialist Submission Approvals ──────────────────────────────
router.get('/specialist-submissions', ABMSpecialistController.getSpecialistSubmissions);
router.put('/approve-specialist/:id', validateBody(approveSpecialistSchema), ABMSpecialistController.approveSpecialist);
router.post('/bulk-approve-specialist', validateBody(bulkApproveSpecialistSchema), ABMSpecialistController.bulkApproveSpecialist);

// ── Specialist Team Management ───────────────────────────────────
router.get('/specialists', ABMSpecialistController.getSpecialists);

// ── Specialist Yearly Targets (Top-Down) ─────────────────────────
router.get('/specialist-yearly-targets', ABMSpecialistController.getSpecialistYearlyTargets);
router.post('/specialist-yearly-targets/save', validateBody(saveSpecialistYearlyTargetsSchema), ABMSpecialistController.saveSpecialistYearlyTargets);
router.post('/specialist-yearly-targets/publish', validateBody(saveSpecialistYearlyTargetsSchema), ABMSpecialistController.publishSpecialistYearlyTargets);

// ── Dashboard Stats ──────────────────────────────────────────────
router.get('/specialist-dashboard-stats', ABMSpecialistController.getSpecialistDashboardStats);

module.exports = router;
