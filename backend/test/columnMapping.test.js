const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  normalizeString,
  computeSourceSignature,
  compareHeaderToField,
  matchSingleHeader,
  suggestMapping
} = require('../src/services/columnMappingService');
const { CANONICAL_SCHEMA, REQUIRED_FIELDS } = require('../src/config/canonicalSchema');

test('Unit Test: normalizeString cleans header variants properly', () => {
  assert.equal(normalizeString('Debit A/C No'), 'debitacno');
  assert.equal(normalizeString('amt_inr'), 'amtinr');
  assert.equal(normalizeString('txn_dt'), 'txndt');
  assert.equal(normalizeString('  SENDER_ACCOUNT  '), 'senderaccount');
  assert.equal(normalizeString('Beneficiary-Name (Account Holder)'), 'beneficiarynameaccountholder');
});

test('Unit Test: computeSourceSignature is deterministic and order-invariant', () => {
  const headers1 = ['Txn_ID', 'Amount', 'Date', 'Sender'];
  const headers2 = ['Date', 'sender', 'AMOUNT', 'txn_id'];
  const sig1 = computeSourceSignature(headers1);
  const sig2 = computeSourceSignature(headers2);
  assert.equal(sig1, sig2, 'Signatures should match regardless of order and case');

  const headers3 = ['Txn_ID', 'Amount', 'Date', 'Sender', 'ExtraCol'];
  const sig3 = computeSourceSignature(headers3);
  assert.notEqual(sig1, sig3, 'Signatures should differ when column set differs');
});

test('Unit Test: Synonym matcher matches common banking header variants', () => {
  const variants = [
    { raw: 'Debit A/C No', expectedField: 'sender_account', minConfidence: 0.9 },
    { raw: 'amt_inr', expectedField: 'amount', minConfidence: 0.9 },
    { raw: 'txn_dt', expectedField: 'timestamp', minConfidence: 0.9 },
    { raw: 'Txn_Ref_No', expectedField: 'transaction_id', minConfidence: 0.9 },
    { raw: 'Beneficiary Account', expectedField: 'receiver_account', minConfidence: 0.9 },
    { raw: 'CCY', expectedField: 'currency', minConfidence: 0.9 },
    { raw: 'origin_country', expectedField: 'country', minConfidence: 0.9 },
    { raw: 'remitter_name', expectedField: 'sender_name', minConfidence: 0.9 },
    { raw: 'payment_mode', expectedField: 'payment_method', minConfidence: 0.9 },
    { raw: 'payee_merchant', expectedField: 'merchant', minConfidence: 0.9 }
  ];

  for (const v of variants) {
    const match = matchSingleHeader(v.raw);
    assert.ok(match, `Expected match for raw header "${v.raw}"`);
    assert.equal(match.canonical_field, v.expectedField, `Raw header "${v.raw}" should map to "${v.expectedField}"`);
    assert.ok(match.confidence >= v.minConfidence, `Confidence for "${v.raw}" should be >= ${v.minConfidence}`);
    assert.equal(match.method, 'synonym');
  }
});

test('Unit Test: Fuzzy fallback matches non-synonym variants above threshold 0.6', () => {
  // Variants with minor typos or non-standard suffixes
  const fuzzyCases = [
    { raw: 'sender_acct_num', expectedField: 'sender_account' },
    { raw: 'receiver_acct_num', expectedField: 'receiver_account' }
  ];

  for (const fc of fuzzyCases) {
    const match = matchSingleHeader(fc.raw);
    assert.ok(match, `Expected fuzzy match for "${fc.raw}"`);
    assert.equal(match.canonical_field, fc.expectedField);
    assert.ok(match.confidence >= 0.6, `Expected confidence >= 0.6 for "${fc.raw}", got ${match.confidence}`);
  }
});

test('Unit Test: Unrelated headers return confidence 0 or null', () => {
  const unrelated = [
    'random_internal_guid_9823',
    'arbitrary_batch_sequence_number',
    'department_cost_center_code'
  ];

  for (const h of unrelated) {
    const match = matchSingleHeader(h);
    assert.equal(match, null, `Unrelated header "${h}" should not match any canonical field`);
  }
});

test('Unit Test: suggestMapping assigns one-to-one and flags missing required fields', () => {
  const rawHeaders = [
    'Txn_Ref_No',
    'Debit A/C No',
    'Creditor_Acc',
    'amt_inr',
    'CCY',
    // Missing 'timestamp'
    'random_audit_col'
  ];

  const result = suggestMapping(rawHeaders);
  assert.ok(Array.isArray(result.suggestions));
  assert.ok(result.missing_required.includes('timestamp'), 'Missing required fields should include timestamp');

  // Verify mapped suggestions
  const txIdSugg = result.suggestions.find(s => s.canonical_field === 'transaction_id');
  assert.equal(txIdSugg.suggested_raw_header, 'Txn_Ref_No');

  const senderSugg = result.suggestions.find(s => s.canonical_field === 'sender_account');
  assert.equal(senderSugg.suggested_raw_header, 'Debit A/C No');

  const receiverSugg = result.suggestions.find(s => s.canonical_field === 'receiver_account');
  assert.equal(receiverSugg.suggested_raw_header, 'Creditor_Acc');

  const amountSugg = result.suggestions.find(s => s.canonical_field === 'amount');
  assert.equal(amountSugg.suggested_raw_header, 'amt_inr');

  const currSugg = result.suggestions.find(s => s.canonical_field === 'currency');
  assert.equal(currSugg.suggested_raw_header, 'CCY');

  assert.ok(result.unmapped_raw.includes('random_audit_col'));
});

test('Unit Test: Competition between raw headers resolves greedily by highest confidence', () => {
  // Suppose we have both 'amount' (exact 1.0) and 'amt_approx' (fuzzy)
  const rawHeaders = ['amount', 'amt_approx'];
  const result = suggestMapping(rawHeaders);

  const amountSugg = result.suggestions.find(s => s.canonical_field === 'amount');
  assert.equal(amountSugg.suggested_raw_header, 'amount');
  assert.equal(amountSugg.confidence, 1.0);
  assert.ok(result.unmapped_raw.includes('amt_approx'), 'Lower confidence competing header should be unmapped');
});
