const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { connectDB, models, Customer, Account } = require('../src/config/db');
const { getCustomers, getCustomerById } = require('../src/controllers/customerController');
const { matchSingleHeader, suggestMapping } = require('../src/services/columnMappingService');
const { CANONICAL_SCHEMA } = require('../src/config/canonicalSchema');

test.before(async () => {
  await connectDB();
});

test('Customer Model: FileModel & Mongoose schema contains required customer and account fields', () => {
  const CustModel = models.Customer || Customer;
  const AccModel = models.Account || Account;
  assert.ok(CustModel, 'Customer model must be available');
  assert.ok(AccModel, 'Account model must be available');

  // Verify Customer schema fields
  assert.ok(CANONICAL_SCHEMA.customer_id, 'Canonical schema includes customer_id');
  assert.ok(CANONICAL_SCHEMA.customer_name, 'Canonical schema includes customer_name');
  assert.ok(CANONICAL_SCHEMA.customer_type, 'Canonical schema includes customer_type');
  assert.ok(CANONICAL_SCHEMA.declared_income, 'Canonical schema includes declared_income');
  assert.ok(CANONICAL_SCHEMA.occupation, 'Canonical schema includes occupation');
  assert.ok(CANONICAL_SCHEMA.kyc_risk_rating, 'Canonical schema includes kyc_risk_rating');
  assert.ok(CANONICAL_SCHEMA.is_pep, 'Canonical schema includes is_pep');
});

test('Customer Column Mapping: recognizes customer field synonyms and variations', () => {
  const synonymsToTest = [
    { raw: 'cust_id', expected: 'customer_id' },
    { raw: 'Client Name', expected: 'customer_name' },
    { raw: 'entity_type', expected: 'customer_type' },
    { raw: 'declared_annual_income', expected: 'declared_income' },
    { raw: 'monthly_turnover', expected: 'declared_income' },
    { raw: 'profession', expected: 'occupation' },
    { raw: 'kyc_tier', expected: 'kyc_risk_rating' },
    { raw: 'politically_exposed', expected: 'is_pep' }
  ];

  for (const item of synonymsToTest) {
    const match = matchSingleHeader(item.raw);
    assert.ok(match, `Expected match for header "${item.raw}"`);
    assert.equal(match.canonical_field, item.expected, `Header "${item.raw}" should map to "${item.expected}"`);
  }
});

test('Customer Controller: getCustomers returns list with pagination and account counts', async () => {
  const mockReq = {
    query: {
      limit: '10',
      page: '1'
    }
  };

  let responseData = null;
  const mockRes = {
    json: (data) => {
      responseData = data;
    },
    status: (code) => {
      return {
        json: (data) => { responseData = { status: code, ...data }; }
      };
    }
  };

  await getCustomers(mockReq, mockRes);
  assert.ok(responseData, 'Response data must not be null');
  assert.equal(responseData.success, true, 'getCustomers should succeed');
  assert.ok(Array.isArray(responseData.data), 'data should be an array of customers');
  assert.ok(typeof responseData.total === 'number', 'total must be a number');

  if (responseData.data.length > 0) {
    const firstCust = responseData.data[0];
    assert.ok(firstCust.customer_id, 'Customer record must have customer_id');
    assert.ok(firstCust.name, 'Customer record must have name');
    assert.ok(firstCust.type, 'Customer record must have type');
    assert.ok(typeof firstCust.declared_monthly_income_or_turnover === 'number', 'Declared income must be numeric');
  }
});

test('Customer Controller: getCustomerById returns profile, baselines, risk summary, and linked entities', async () => {
  // First get any valid customer ID from list
  const listReq = { query: { limit: '1' } };
  let listData = null;
  const listRes = {
    json: (d) => { listData = d; },
    status: (code) => ({ json: (d) => { listData = { status: code, ...d }; } })
  };
  await getCustomers(listReq, listRes);

  const sampleCustId = listData?.data?.[0]?.customer_id || 'CUST10001';

  const mockReq = {
    params: { id: sampleCustId }
  };

  let detailData = null;
  const mockRes = {
    json: (d) => { detailData = d; },
    status: (code) => ({ json: (d) => { detailData = { status: code, ...d }; } })
  };

  await getCustomerById(mockReq, mockRes);
  assert.ok(detailData, 'Response should not be null');
  assert.equal(detailData.success, true, 'getCustomerById should succeed');

  const c360 = detailData.data;
  assert.ok(c360.profile, 'Must have profile');
  assert.equal(c360.profile.customer_id, sampleCustId);
  assert.ok(Array.isArray(c360.accounts), 'Must have accounts array');
  assert.ok(Array.isArray(c360.alerts), 'Must have alerts array');
  assert.ok(Array.isArray(c360.cases), 'Must have cases array');

  // Verify Baselines computation
  assert.ok(c360.baselines, 'Must have baselines');
  assert.ok(typeof c360.baselines.rolling_median_amount === 'number', 'rolling_median_amount is numeric');
  assert.ok(typeof c360.baselines.typical_monthly_volume === 'number', 'typical_monthly_volume is numeric');
  assert.ok(Array.isArray(c360.baselines.usual_countries), 'usual_countries is an array');
  assert.ok(c360.baselines.peer_group, 'peer_group baseline must be computed');

  // Verify Risk Summary
  assert.ok(c360.risk_summary, 'Must have risk_summary');
  assert.ok(typeof c360.risk_summary.volume_to_income_ratio === 'number', 'volume_to_income_ratio is numeric');
  assert.ok(typeof c360.risk_summary.peer_percentile_estimate === 'number', 'peer_percentile_estimate is numeric');
  assert.ok(Array.isArray(c360.risk_summary.risk_factors), 'risk_factors must be an array');
});
