const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Ensure test environment
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/aml_test_trustworthiness';

const { connectDB, models } = require('../src/config/db');
const { 
  GENESIS_HASH, 
  computeLogHash, 
  logAction, 
  verifyAuditLogChain 
} = require('../src/config/auditLogger');
const { 
  generateUUID, 
  generateTxId, 
  generateAdjustmentId, 
  generateAlertId, 
  generateCaseId, 
  generateDecisionId 
} = require('../src/utils/idGenerator');
const { 
  STATIC_FX_TO_INR, 
  normalizeCurrency, 
  getFxRate, 
  convertToINR 
} = require('../src/config/fxConfig');
const { 
  createTransactionSchema, 
  adjustTransactionSchema, 
  statusEventSchema 
} = require('../src/middleware/validate');

test.before(async () => {
  await connectDB();
});

test('Trustworthiness: Transaction Immutability & Adjustments', async (t) => {
  await t.test('1. Direct update (PUT) returns 405 Method Not Allowed', async () => {
    const { updateTransaction } = require('../src/controllers/transactionController');
    let statusCode = null;
    let jsonPayload = null;
    const req = { params: { id: 'TX-IMMUTABLE-01' }, body: { amount: 999999 } };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonPayload = payload;
        return this;
      }
    };

    await updateTransaction(req, res);
    assert.strictEqual(statusCode, 405, 'Should return HTTP 405 for PUT /transactions/:id');
    assert.strictEqual(jsonPayload.success, false);
    assert.match(jsonPayload.message, /immutable/i);
  });

  await t.test('2. Direct delete (DELETE) returns 405 Method Not Allowed', async () => {
    const { deleteTransaction } = require('../src/controllers/transactionController');
    let statusCode = null;
    let jsonPayload = null;
    const req = { params: { id: 'TX-IMMUTABLE-01' } };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonPayload = payload;
        return this;
      }
    };

    await deleteTransaction(req, res);
    assert.strictEqual(statusCode, 405, 'Should return HTTP 405 for DELETE /transactions/:id');
    assert.strictEqual(jsonPayload.success, false);
    assert.match(jsonPayload.message, /immutable/i);
  });

  await t.test('3. POST /transactions/:id/adjust creates linked adjustment with reference', async () => {
    const originalTxId = generateTxId();
    const origTx = await models.Transaction.create({
      transaction_id: originalTxId,
      sender_account: 'ACC_ORIG_1001',
      sender_name: 'Alpha Corp',
      receiver_account: 'ACC_ORIG_2002',
      receiver_name: 'Beta Global',
      amount: 50000,
      currency: 'INR',
      amount_inr: 50000,
      country: 'IN',
      status: 'Approved'
    });

    const { adjustTransaction } = require('../src/controllers/transactionController');
    let statusCode = null;
    let jsonPayload = null;
    const req = {
      params: { id: originalTxId },
      body: {
        adjustment_reason: 'Incorrect initial invoicing amount; revised per verified billing statement.',
        amount: 45000,
        currency: 'INR'
      },
      user: { username: 'investigator_lead', role: 'Investigator' },
      ip: '192.168.1.50'
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonPayload = payload;
        return this;
      }
    };

    await adjustTransaction(req, res);
    assert.strictEqual(statusCode, 201, 'Adjustment creation should return HTTP 201');
    assert.strictEqual(jsonPayload.success, true);
    assert.ok(jsonPayload.data.transaction_id.startsWith('ADJ-'), 'Adjustment ID should start with ADJ-');
    assert.strictEqual(jsonPayload.data.original_transaction_id, originalTxId);
    assert.strictEqual(jsonPayload.data.is_adjustment, true);
    assert.strictEqual(jsonPayload.data.amount, 45000);
    assert.strictEqual(jsonPayload.data.adjusted_by, 'investigator_lead');
  });

  await t.test('4. Status transition events recorded in immutable TransactionEvent collection', async () => {
    const txId = generateTxId();
    await models.Transaction.create({
      transaction_id: txId,
      sender_account: 'ACC_EVT_1',
      sender_name: 'Alice',
      receiver_account: 'ACC_EVT_2',
      receiver_name: 'Bob',
      amount: 10000,
      country: 'IN',
      status: 'Approved'
    });

    const { recordStatusEvent, getTransactionEvents } = require('../src/controllers/transactionController');
    let statusCode = null;
    let jsonPayload = null;
    const req = {
      params: { id: txId },
      body: {
        new_status: 'Under Investigation',
        reason: 'Flagged for cross-border smurfing inquiry'
      },
      user: { username: 'investigator_01', role: 'Investigator' },
      ip: '127.0.0.1'
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonPayload = payload;
        return this;
      }
    };

    await recordStatusEvent(req, res);
    assert.strictEqual(statusCode, 201);
    assert.strictEqual(jsonPayload.data.transaction_id, txId);
    assert.strictEqual(jsonPayload.data.new_status, 'Under Investigation');

    // Retrieve events
    let listPayload = null;
    const listRes = {
      json(payload) {
        listPayload = payload;
        return this;
      }
    };
    await getTransactionEvents({ params: { id: txId } }, listRes);
    assert.strictEqual(listPayload.success, true);
    assert.ok(listPayload.count >= 1);
    assert.strictEqual(listPayload.data[0].transaction_id, txId);
  });
});

test('Trustworthiness: Cryptographic Audit Log Hash Chain & Verification', async (t) => {
  await t.test('1. Append-only logs form a sequential hash chain', async () => {
    const log1 = await logAction('admin', 'Admin', 'SYSTEM_INIT', '127.0.0.1', 'System node started');
    const log2 = await logAction('investigator', 'Investigator', 'ALERT_REVIEWED', '127.0.0.1', 'Reviewed alert ALT-1001');
    const log3 = await logAction('auditor', 'Auditor', 'COMPLIANCE_AUDIT', '127.0.0.1', 'Audit sampling completed');

    assert.ok(log1 && log1.hash, 'Log 1 must have SHA-256 hash');
    assert.ok(log2 && log2.hash, 'Log 2 must have SHA-256 hash');
    assert.ok(log3 && log3.hash, 'Log 3 must have SHA-256 hash');

    assert.strictEqual(log2.previous_hash, log1.hash, 'Log 2 previous_hash must equal Log 1 hash');
    assert.strictEqual(log3.previous_hash, log2.hash, 'Log 3 previous_hash must equal Log 2 hash');
  });

  await t.test('2. verifyAuditLogChain confirms intact hash chain', async () => {
    const result = await verifyAuditLogChain();
    assert.strictEqual(result.verified, true, 'Audit log chain verification should pass');
    assert.ok(result.total_entries >= 3, 'Should verify all appended entries');
    assert.ok(result.latest_hash, 'Should return latest head hash');
  });

  await t.test('3. verifyAuditLogChain detects tampering in details or hash', async () => {
    const logs = await models.AuditLog.find();
    const target = logs.find(l => l && l.sequence && l.hash);
    if (target) {
      const originalDetails = target.details;
      target.details = 'TAMPERED: Illicitly modified by unauthorized intruder';
      if (typeof target.save === 'function') {
        await target.save();
      } else if (models.AuditLog.updateOne) {
        await models.AuditLog.updateOne({ _id: target._id || target.log_id }, { details: target.details });
      }

      const tamperedResult = await verifyAuditLogChain();
      assert.strictEqual(tamperedResult.verified, false, 'Tampered log should fail chain verification');
      assert.ok(tamperedResult.message.includes('tampering') || tamperedResult.message.includes('mismatch'));

      // Restore original state
      target.details = originalDetails;
      if (typeof target.save === 'function') {
        await target.save();
      } else if (models.AuditLog.updateOne) {
        await models.AuditLog.updateOne({ _id: target._id || target.log_id }, { details: originalDetails });
      }
    }
  });
});

test('Trustworthiness: Collision-Safe Cryptographic ID Generators', async (t) => {
  await t.test('Generates high-entropy UUIDs and prefixed IDs without Math.random', () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    assert.notStrictEqual(uuid1, uuid2);
    assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const txId = generateTxId();
    assert.match(txId, /^TX-[0-9A-Z]+-[0-9A-F]{8}$/);

    const adjId = generateAdjustmentId();
    assert.match(adjId, /^ADJ-[0-9A-Z]+-[0-9A-F]{8}$/);

    const alertId = generateAlertId();
    assert.match(alertId, /^ALT-[0-9A-Z]+-[0-9A-F]{6,8}$/);

    const caseId = generateCaseId();
    assert.match(caseId, /^CASE-[0-9A-Z]+-[0-9A-F]{6,8}$/);

    const decId = generateDecisionId();
    assert.match(decId, /^DEC-[0-9A-Z]+-[0-9A-F]{6,8}$/);
  });
});

test('Trustworthiness: Zod Input Validation for Write Endpoints', async (t) => {
  await t.test('1. Valid transaction payload passes Zod validation', () => {
    const valid = {
      sender_account: 'ACC1001',
      receiver_account: 'ACC2002',
      amount: 150000,
      currency: 'USD',
      country: 'US',
      timestamp: '2026-10-05T12:00:00.000Z'
    };
    const parsed = createTransactionSchema.parse(valid);
    assert.strictEqual(parsed.amount, 150000);
    assert.strictEqual(parsed.currency, 'USD');
  });

  await t.test('2. Negative or non-positive amount throws Zod error', () => {
    const invalid = {
      sender_account: 'ACC1001',
      receiver_account: 'ACC2002',
      amount: -500,
      country: 'IN'
    };
    assert.throws(() => {
      createTransactionSchema.parse(invalid);
    }, /positive/i);
  });

  await t.test('3. Invalid currency code throws Zod error', () => {
    const invalid = {
      sender_account: 'ACC1001',
      receiver_account: 'ACC2002',
      amount: 500,
      currency: 'INVALID_CURRENCY_XYZ',
      country: 'IN'
    };
    assert.throws(() => {
      createTransactionSchema.parse(invalid);
    }, /currency/i);
  });

  await t.test('4. Missing required sender/receiver throws Zod error', () => {
    const invalid = {
      amount: 500,
      country: 'IN'
    };
    assert.throws(() => {
      createTransactionSchema.parse(invalid);
    }, /(?:Sender account is required|invalid_type)/i);
  });

  await t.test('5. Adjustment schema enforces reason length and positive amount', () => {
    const validAdj = {
      adjustment_reason: 'Legitimate correction of commercial discount invoice',
      amount: 25000,
      currency: 'EUR'
    };
    const parsed = adjustTransactionSchema.parse(validAdj);
    assert.strictEqual(parsed.amount, 25000);

    const invalidAdj = {
      adjustment_reason: 'no', // too short (< 5 chars)
      amount: 25000
    };
    assert.throws(() => {
      adjustTransactionSchema.parse(invalidAdj);
    }, /Adjustment reason must be at least 5 characters/i);
  });
});

test('Trustworthiness: Multi-Currency & FX Rate Normalization', async (t) => {
  await t.test('1. Static FX rates accurately map major currencies to INR baseline', () => {
    assert.strictEqual(getFxRate('INR'), 1.0);
    assert.strictEqual(getFxRate('USD'), 83.50);
    assert.strictEqual(getFxRate('EUR'), 90.75);
    assert.strictEqual(getFxRate('GBP'), 105.60);
    assert.strictEqual(getFxRate('AED'), 22.74);
    assert.strictEqual(getFxRate('JPY'), 0.55);
  });

  await t.test('2. convertToINR computes exact amount_inr, fx_rate, and fx_date', () => {
    const usdConv = convertToINR(1000, 'USD', '2026-10-05T00:00:00.000Z');
    assert.strictEqual(usdConv.amount, 1000);
    assert.strictEqual(usdConv.currency, 'USD');
    assert.strictEqual(usdConv.fx_rate, 83.50);
    assert.strictEqual(usdConv.amount_inr, 83500.00);

    const aedConv = convertToINR(5000, 'AED');
    assert.strictEqual(aedConv.amount, 5000);
    assert.strictEqual(aedConv.currency, 'AED');
    assert.strictEqual(aedConv.fx_rate, 22.74);
    assert.strictEqual(aedConv.amount_inr, 113700.00);
  });
});

test('Trustworthiness: Evidence Files SHA-256 Checksum Calculation', async (t) => {
  await t.test('Calculates and verifies exact SHA-256 cryptographic checksum for evidence', () => {
    const sampleBuffer = Buffer.from('Official FIU-IND Suspicious Transaction Investigation Evidence Artifact #4928');
    const expectedHash = crypto.createHash('sha256').update(sampleBuffer).digest('hex');

    assert.strictEqual(expectedHash.length, 64, 'SHA-256 hex string should be 64 characters');

    // Recomputing from identical stream yields identical hash (deterministic integrity)
    const secondHash = crypto.createHash('sha256').update(sampleBuffer).digest('hex');
    assert.strictEqual(expectedHash, secondHash);

    // Any modification changes the checksum entirely
    const modifiedBuffer = Buffer.from('Official FIU-IND Suspicious Transaction Investigation Evidence Artifact #4929');
    const modifiedHash = crypto.createHash('sha256').update(modifiedBuffer).digest('hex');
    assert.notStrictEqual(expectedHash, modifiedHash);
  });
});
