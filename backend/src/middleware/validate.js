const { z } = require('zod');
const { STATIC_FX_TO_INR, normalizeCurrency } = require('../config/fxConfig');

/**
 * Zod validation middleware for write endpoints.
 * Returns structured 400 Bad Request responses with detailed field-level errors.
 */

const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: formattedErrors.map(e => `${e.field ? e.field + ': ' : ''}${e.message}`).join('; '),
          details: formattedErrors
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Invalid Request Payload',
        message: error.message
      });
    }
  };
};

// -------------------------------------------------------------
// 1. Transaction Schemas
// -------------------------------------------------------------
const validCurrencies = Object.keys(STATIC_FX_TO_INR);

const createTransactionSchema = z.object({
  transaction_id: z.string().trim().optional(),
  sender_account: z.string({ required_error: 'Sender account is required' }).trim().min(1, 'Sender account is required'),
  receiver_account: z.string({ required_error: 'Receiver account is required' }).trim().min(1, 'Receiver account is required'),
  sender_name: z.string().trim().optional().default('Unknown Sender'),
  receiver_name: z.string().trim().optional().default('Unknown Receiver'),
  amount: z.coerce.number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
    .positive('Amount must be a positive number greater than 0'),
  currency: z.string().trim().optional().default('INR')
    .refine(curr => {
      const norm = normalizeCurrency(curr);
      return Boolean(STATIC_FX_TO_INR[norm] || STATIC_FX_TO_INR[curr.toUpperCase()]);
    }, { message: 'Invalid currency code. Supported: INR, USD, EUR, GBP, AED, SGD, JPY, CAD, etc.' }),
  country: z.string({ required_error: 'Country code is required' }).trim().min(2, 'Country code must be at least 2 characters (e.g. IN, US, AE)'),
  city: z.string().trim().optional(),
  device_id: z.string().trim().optional(),
  ip_address: z.string().trim().optional(),
  payment_method: z.string().trim().optional().default('UPI'),
  merchant: z.string().trim().optional(),
  category: z.string().trim().optional().default('Transfer'),
  timestamp: z.string().optional().refine(val => {
    if (!val) return true;
    return !isNaN(Date.parse(val));
  }, { message: 'Timestamp must be a valid parsable ISO 8601 date string' }),
  status: z.enum(['Approved', 'Flagged', 'Blocked', 'Pending', 'Adjusted']).optional().default('Approved'),
  customer_id: z.string().trim().optional()
});

const adjustTransactionSchema = z.object({
  adjustment_reason: z.string().trim().min(5, 'Adjustment reason must be at least 5 characters explaining the correction'),
  amount: z.coerce.number({ invalid_type_error: 'Adjustment amount must be a number' })
    .positive('Adjustment amount must be a positive number'),
  currency: z.string().trim().optional().default('INR')
    .refine(curr => {
      const norm = normalizeCurrency(curr);
      return Boolean(STATIC_FX_TO_INR[norm] || STATIC_FX_TO_INR[curr.toUpperCase()]);
    }, { message: 'Invalid currency code for adjustment.' }),
  sender_account: z.string().trim().optional(),
  receiver_account: z.string().trim().optional(),
  country: z.string().trim().optional(),
  payment_method: z.string().trim().optional(),
  category: z.string().trim().optional().default('Adjustment')
});

const statusEventSchema = z.object({
  new_status: z.enum(['Approved', 'Flagged', 'Blocked', 'Pending', 'Under Investigation', 'Cleared', 'Adjusted'], {
    errorMap: () => ({ message: 'Invalid transaction status.' })
  }),
  reason: z.string().trim().min(3, 'Status event reason must be provided (at least 3 characters)')
});

// -------------------------------------------------------------
// 2. Alert & Case Schemas
// -------------------------------------------------------------
const bulkAssignAlertsSchema = z.object({
  alert_ids: z.array(z.string().trim().min(1)).min(1, 'At least one alert_id must be provided'),
  assignee: z.string().trim().min(1, 'Assignee username is required')
});

const bulkDismissAlertsSchema = z.object({
  alert_ids: z.array(z.string().trim().min(1)).min(1, 'At least one alert_id must be provided'),
  rationale: z.string().trim().min(5, 'Mandatory dismissal rationale required (at least 5 characters)')
});

const dispositionAlertSchema = z.object({
  disposition: z.enum(['False Positive', 'True Positive - STR Filed', 'True Positive - No Filing', 'Insufficient Information'], {
    errorMap: () => ({ message: 'Invalid alert disposition code.' })
  }),
  rationale: z.string().trim().min(3, 'Disposition rationale is required')
});

const createCaseSchema = z.object({
  title: z.string().trim().min(3, 'Case title must be at least 3 characters'),
  assigned_to: z.string().trim().optional().default(null),
  alerts: z.array(z.string().trim()).optional().default([]),
  notes: z.string().trim().optional()
});

const addCaseNoteSchema = z.object({
  text: z.string().trim().min(1, 'Note content cannot be empty')
});

const updateCaseStatusSchema = z.object({
  status: z.enum(['Open', 'Under Review', 'Pending STR', 'Closed'], {
    errorMap: () => ({ message: 'Status must be Open, Under Review, Pending STR, or Closed' })
  }),
  closure_reason: z.string().trim().optional(),
  disposition_code: z.string().trim().optional()
});

// -------------------------------------------------------------
// 3. Auth & Screening Schemas
// -------------------------------------------------------------
const registerSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().trim().min(1, 'Full name is required'),
  role: z.enum(['Admin', 'Investigator', 'Auditor']).optional().default('Investigator')
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

const screeningDecisionSchema = z.object({
  screened_name: z.string().trim().min(1, 'Screened name is required'),
  matched_entity_id: z.string().trim().min(1, 'Matched entity ID is required'),
  matched_name: z.string().trim().min(1, 'Matched name is required'),
  list_type: z.enum(['Sanctions', 'PEP', 'AdverseMedia']),
  match_score: z.coerce.number().min(0).max(100),
  decision: z.enum(['TrueMatch', 'FalsePositive', 'UnderReview']),
  notes: z.string().trim().optional().default('')
});

module.exports = {
  validateBody,
  createTransactionSchema,
  adjustTransactionSchema,
  statusEventSchema,
  bulkAssignAlertsSchema,
  bulkDismissAlertsSchema,
  dispositionAlertSchema,
  createCaseSchema,
  addCaseNoteSchema,
  updateCaseStatusSchema,
  registerSchema,
  loginSchema,
  screeningDecisionSchema
};
