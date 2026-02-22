/**
 * Specialist Validation Schemas
 * Joi schemas for specialist and ABM-specialist endpoints.
 * 
 * Follows same patterns as validators/schemas.js
 */

'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Shared sub-schemas (same JSONB shape as sales rep)
// ---------------------------------------------------------------------------

const monthlyValuesSchema = Joi.object({
  lyQty: Joi.number().min(0).default(0),
  cyQty: Joi.number().min(0).default(0),
  lyRev: Joi.number().min(0).default(0),
  cyRev: Joi.number().min(0).default(0),
}).unknown(false);

const monthlyTargetsSchema = Joi.object({
  apr: monthlyValuesSchema, may: monthlyValuesSchema, jun: monthlyValuesSchema,
  jul: monthlyValuesSchema, aug: monthlyValuesSchema, sep: monthlyValuesSchema,
  oct: monthlyValuesSchema, nov: monthlyValuesSchema, dec: monthlyValuesSchema,
  jan: monthlyValuesSchema, feb: monthlyValuesSchema, mar: monthlyValuesSchema,
}).unknown(false);

// ---------------------------------------------------------------------------
// Specialist-side schemas
// ---------------------------------------------------------------------------

const saveSpecialistProductSchema = Joi.object({
  monthlyTargets: monthlyTargetsSchema.required(),
});

const submitSpecialistMultipleSchema = Joi.object({
  productIds: Joi.array().items(
    Joi.alternatives().try(Joi.number().integer().positive(), Joi.string())
  ).min(1).required(),
});

const saveAllSpecialistProductsSchema = Joi.object({
  products: Joi.array().items(
    Joi.object({
      id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).required(),
      monthlyTargets: monthlyTargetsSchema.required(),
    })
  ).min(1).required(),
});

// ---------------------------------------------------------------------------
// ABM-side specialist schemas
// ---------------------------------------------------------------------------

const approveSpecialistSchema = Joi.object({
  corrections: monthlyTargetsSchema.allow(null).default(null),
  comments: Joi.string().max(1000).allow('', null).default(null),
});

const bulkApproveSpecialistSchema = Joi.object({
  submissionIds: Joi.array().items(
    Joi.alternatives().try(Joi.number().integer().positive(), Joi.string())
  ).min(1).required(),
});

const saveSpecialistYearlyTargetsSchema = Joi.object({
  targets: Joi.array().items(
    Joi.object({
      assigneeCode: Joi.string().required(),
      assigneeName: Joi.string().allow('', null),
      cyTargetValue: Joi.number().min(0).default(0),
      cyTargetQty: Joi.number().min(0).default(0),
      lyTargetQty: Joi.number().min(0).allow(null),
      lyAchievedQty: Joi.number().min(0).allow(null),
      lyTargetValue: Joi.number().min(0).allow(null),
      lyAchievedValue: Joi.number().min(0).allow(null),
      categoryBreakdown: Joi.array().items(Joi.object().unknown(true)).default([]),
    })
  ).min(1).required(),
  fiscalYear: Joi.string().pattern(/^FY\d{2}_\d{2}$/).default('FY26_27'),
});

module.exports = {
  saveSpecialistProductSchema,
  submitSpecialistMultipleSchema,
  saveAllSpecialistProductsSchema,
  approveSpecialistSchema,
  bulkApproveSpecialistSchema,
  saveSpecialistYearlyTargetsSchema,
};
