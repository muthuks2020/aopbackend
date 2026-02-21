const TBMService = require('../services/tbm.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const TBMController = {


  async getSalesRepSubmissions(req, res, next) {
    try {
      const submissions = await TBMService.getSalesRepSubmissions(
        req.user.employeeCode,
        req.query
      );
      res.json(submissions);
    } catch (err) {
      next(err);
    }
  },

  async approveSalesRepTarget(req, res, next) {
    try {
      const result = await TBMService.approveSalesRepTarget(
        parseInt(req.params.id),
        req.user,
        req.body
      );

      req.logAudit({
        action: 'approve_sr_target',
        entityType: 'product_commitments',
        entityId: parseInt(req.params.id),
        detail: { corrections: req.body.corrections },
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async bulkApproveSalesRep(req, res, next) {
    try {
      const result = await TBMService.bulkApproveSalesRep(
        req.body.submissionIds,
        req.user,
        req.body.comments
      );

      req.logAudit({
        action: 'bulk_approve_sr',
        entityType: 'product_commitments',
        detail: { submissionIds: req.body.submissionIds },
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async getTerritoryTargets(req, res, next) {
    try {
      const targets = await TBMService.getTerritoryTargets(req.user.employeeCode, req.query);
      res.json(targets);
    } catch (err) {
      next(err);
    }
  },

  async saveTerritoryTargets(req, res, next) {
    try {
      const result = await TBMService.saveTerritoryTargets(req.body.targets, req.user);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async submitTerritoryTargets(req, res, next) {
    try {
      const result = await TBMService.submitTerritoryTargets(req.body.targetIds, req.user);

      req.logAudit({
        action: 'submit_territory_targets',
        entityType: 'product_commitments',
        detail: { targetIds: req.body.targetIds },
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async getIndividualTargets(req, res, next) {
    try {
      const targets = await TBMService.getIndividualTargets(req.user.employeeCode, req.query);
      res.json(targets);
    } catch (err) {
      next(err);
    }
  },

  async saveIndividualTargets(req, res, next) {
    try {
      const result = await TBMService.saveIndividualTargets(req.body.targets, req.user);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async submitIndividualTargets(req, res, next) {
    try {
      const result = await TBMService.submitIndividualTargets(req.body.targetIds, req.user);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async getDashboardStats(req, res, next) {
    try {
      const stats = await TBMService.getDashboardStats(req.user.employeeCode);
      res.json(stats);
    } catch (err) {
      next(err);
    }
  },


  async getYearlyTargets(req, res, next) {
    try {
      const result = await TBMService.getYearlyTargets(req.user.employeeCode, req.query.fy);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async saveYearlyTargets(req, res, next) {
    try {
      const result = await TBMService.saveYearlyTargets(
        req.user,
        req.body.fiscalYear,
        req.body.members
      );
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async publishYearlyTargets(req, res, next) {
    try {
      const result = await TBMService.publishYearlyTargets(
        req.user,
        req.body.fiscalYear,
        req.body.memberIds
      );

      req.logAudit({
        action: 'publish_yearly_targets',
        entityType: 'yearly_target_assignments',
        detail: { memberIds: req.body.memberIds },
      });

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async rejectSalesRepTarget(req, res, next) {
    try {
      const result = await TBMService.rejectSalesRepTarget(parseInt(req.params.id), req.user, req.body.reason || '');
      req.logAudit({ action: 'reject_sr_target', entityType: 'product_commitments', entityId: parseInt(req.params.id) });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async bulkRejectSalesRep(req, res, next) {
    try {
      const result = await TBMService.bulkRejectSalesRep(req.body.submissionIds, req.user, req.body.reason || '');
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async updateTerritoryTarget(req, res, next) {
    try {
      const result = await TBMService.updateSingleTarget(parseInt(req.params.id), req.user, req.body);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async updateIndividualTarget(req, res, next) {
    try {
      const result = await TBMService.updateSingleTarget(parseInt(req.params.id), req.user, req.body);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },


  async getTeamTargetsForRep(req, res, next) {
    try {
      const targets = await TBMService.getTeamTargetsForRep(req.user.employeeCode, req.params.repId);
      res.json(targets);
    } catch (err) { next(err); }
  },

  async saveTeamTargetsForRep(req, res, next) {
    try {
      const result = await TBMService.saveTeamTargetsForRep(req.user, req.params.repId, req.body.targets || req.body);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async assignTeamTargetsToRep(req, res, next) {
    try {
      const result = await TBMService.assignTeamTargetsToRep(req.user, req.params.repId, req.body.targets || req.body);
      req.logAudit({ action: 'assign_team_targets', entityType: 'team_product_targets', detail: { repId: req.params.repId } });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async getTeamTargetsSummary(req, res, next) {
    try {
      const summary = await TBMService.getTeamTargetsSummary(req.user.employeeCode);
      res.json(summary);
    } catch (err) { next(err); }
  },
};

module.exports = TBMController;
