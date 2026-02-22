/**
 * ABM Specialist Controller
 * Thin request/response layer for ABM endpoints managing specialists.
 *
 * Mounted on /api/v1/abm alongside existing ABM routes.
 * Auth: authenticate + authorize('abm')
 */

'use strict';

const abmSpecialistService = require('../services/abmSpecialist.service');

// GET /abm/specialist-submissions
const getSpecialistSubmissions = async (req, res, next) => {
  try {
    const submissions = await abmSpecialistService.getSpecialistSubmissions(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(submissions);
  } catch (err) { next(err); }
};

// PUT /abm/approve-specialist/:id
const approveSpecialist = async (req, res, next) => {
  try {
    const result = await abmSpecialistService.approveSpecialist(
      parseInt(req.params.id, 10),
      req.user,
      req.body.corrections || null,
      req.body.comments || null
    );
    res.json(result);
  } catch (err) { next(err); }
};

// POST /abm/bulk-approve-specialist
const bulkApproveSpecialist = async (req, res, next) => {
  try {
    const result = await abmSpecialistService.bulkApproveSpecialist(
      req.body.submissionIds,
      req.user
    );
    res.json(result);
  } catch (err) { next(err); }
};

// GET /abm/specialists
const getSpecialists = async (req, res, next) => {
  try {
    const specialists = await abmSpecialistService.getSpecialists(req.user.employeeCode);
    res.json(specialists);
  } catch (err) { next(err); }
};

// GET /abm/specialist-yearly-targets?fy=
const getSpecialistYearlyTargets = async (req, res, next) => {
  try {
    const targets = await abmSpecialistService.getSpecialistYearlyTargets(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(targets);
  } catch (err) { next(err); }
};

// POST /abm/specialist-yearly-targets/save
const saveSpecialistYearlyTargets = async (req, res, next) => {
  try {
    const result = await abmSpecialistService.saveSpecialistYearlyTargets(
      req.body.targets,
      req.user,
      req.body.fiscalYear || null
    );
    res.json(result);
  } catch (err) { next(err); }
};

// POST /abm/specialist-yearly-targets/publish
const publishSpecialistYearlyTargets = async (req, res, next) => {
  try {
    const result = await abmSpecialistService.publishSpecialistYearlyTargets(
      req.body.targets,
      req.user,
      req.body.fiscalYear || null
    );
    res.json(result);
  } catch (err) { next(err); }
};

// GET /abm/specialist-dashboard-stats
const getSpecialistDashboardStats = async (req, res, next) => {
  try {
    const stats = await abmSpecialistService.getSpecialistDashboardStats(
      req.user.employeeCode,
      req.query.fy || null
    );
    res.json(stats);
  } catch (err) { next(err); }
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
