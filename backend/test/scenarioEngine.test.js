const test = require('node:test');
const assert = require('node:assert/strict');

const { connectDB, models, Scenario, Transaction } = require('../src/config/db');
const {
  BUILTIN_SCENARIOS,
  getActiveScenarios,
  refreshScenarios,
  evaluateTransaction,
  evaluateBatch,
  calculateFusedRiskScore,
  runBacktest,
  detectors
} = require('../src/services/scenarioEngine');

const {
  getScenarios,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  backtestScenario
} = require('../src/controllers/scenarioController');

test.before(async () => {
  await connectDB();
  refreshScenarios();
});

// Helper to create mock HTTP response
function createMockRes() {
  let responseData = null;
  let statusCode = 200;
  return {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { responseData = { statusCode, ...data }; }
      };
    },
    json: (data) => {
      responseData = { statusCode, ...data };
    },
    getData: () => responseData
  };
}

test('Scenario Engine: Default built-in scenarios are seeded and contain all 7 typologies', async () => {
  const scenarios = await getActiveScenarios();
  assert.ok(Array.isArray(scenarios), 'Scenarios must be an array');
  assert.ok(scenarios.length >= 7, 'Must have at least 7 default scenarios');

  const scenarioIds = scenarios.map(s => s.scenario_id);
  assert.ok(scenarioIds.includes('SCEN_STRUCTURING_MULTI_ACC'), 'Includes Structuring');
  assert.ok(scenarioIds.includes('SCEN_RAPID_PASSTHROUGH'), 'Includes Rapid Passthrough');
  assert.ok(scenarioIds.includes('SCEN_ROUND_AMOUNTS'), 'Includes Round Amounts');
  assert.ok(scenarioIds.includes('SCEN_DORMANT_REACTIVATION'), 'Includes Dormant Reactivation');
  assert.ok(scenarioIds.includes('SCEN_CASH_INTENSITY'), 'Includes Cash Intensity');
  assert.ok(scenarioIds.includes('SCEN_HIGH_RISK_GEO'), 'Includes High Risk Geo');
  assert.ok(scenarioIds.includes('SCEN_MANY_TO_ONE_FUNNEL'), 'Includes Many-to-One Funnel');
});

test('Scenario 1 (SCEN_STRUCTURING_MULTI_ACC): Detects multi-account structuring near CTR threshold', async () => {
  const now = Date.now();
  const tx1 = {
    transaction_id: 'TX_STRUC_1',
    customer_id: 'CUST_SMURF_01',
    sender_account: 'ACC_SMURF_1A',
    receiver_account: 'ACC_CLEAN_01',
    amount: 450000,
    timestamp: new Date(now - 12 * 3600 * 1000).toISOString()
  };

  const tx2 = {
    transaction_id: 'TX_STRUC_2',
    customer_id: 'CUST_SMURF_01',
    sender_account: 'ACC_SMURF_1B',
    receiver_account: 'ACC_CLEAN_02',
    amount: 480000,
    timestamp: new Date(now).toISOString()
  };

  const context = {
    history: [tx1],
    customerAccountsMap: {
      'ACC_SMURF_1A': { customer_id: 'CUST_SMURF_01', accounts: ['ACC_SMURF_1A', 'ACC_SMURF_1B'] },
      'ACC_SMURF_1B': { customer_id: 'CUST_SMURF_01', accounts: ['ACC_SMURF_1A', 'ACC_SMURF_1B'] }
    }
  };

  const params = {
    window_days: 7,
    min_tx_count: 2,
    band_lower_pct: 80.0,
    band_upper_pct: 99.9,
    sum_threshold: 900000.0
  };

  // Evaluate second transaction
  const hit = await detectors.detectStructuringMultiAcc(tx2, params, context);
  assert.ok(hit, 'Should trigger multi-account structuring scenario');
  assert.equal(hit.hit, true);
  assert.equal(hit.variables.customer_id, 'CUST_SMURF_01');
  assert.equal(hit.variables.account_count, 2);

  // Negative test: Single small transaction
  const cleanTx = {
    transaction_id: 'TX_CLEAN',
    customer_id: 'CUST_CLEAN',
    sender_account: 'ACC_CLEAN',
    amount: 15000,
    timestamp: new Date(now).toISOString()
  };
  const cleanHit = await detectors.detectStructuringMultiAcc(cleanTx, params, { history: [] });
  assert.equal(cleanHit, null, 'Clean small transaction should not trigger structuring');
});

test('Scenario 2 (SCEN_RAPID_PASSTHROUGH): Detects rapid in-out flow exceeding pass-through threshold', async () => {
  const now = Date.now();
  const inflowTx = {
    transaction_id: 'TX_INFLOW',
    sender_account: 'ACC_SOURCE',
    receiver_account: 'ACC_TRANSIT_MULE',
    amount: 200000,
    timestamp: new Date(now - 2 * 3600 * 1000).toISOString() // 2 hours ago
  };

  const outflowTx = {
    transaction_id: 'TX_OUTFLOW',
    sender_account: 'ACC_TRANSIT_MULE',
    receiver_account: 'ACC_TARGET',
    amount: 180000, // 90% pass-through
    timestamp: new Date(now).toISOString()
  };

  const context = { history: [inflowTx] };
  const params = { window_hours: 24, pass_through_ratio: 0.80, min_amount: 50000 };

  const hit = await detectors.detectRapidPassthrough(outflowTx, params, context);
  assert.ok(hit, 'Should trigger rapid pass-through');
  assert.equal(hit.hit, true);
  assert.equal(hit.variables.ratio_percent, 90);

  // Negative test: Low pass-through outflow (e.g. 20%)
  const smallOutflow = {
    transaction_id: 'TX_SMALL_OUT',
    sender_account: 'ACC_TRANSIT_MULE',
    receiver_account: 'ACC_TARGET',
    amount: 30000, // < min_amount and 15%
    timestamp: new Date(now).toISOString()
  };
  const negHit = await detectors.detectRapidPassthrough(smallOutflow, params, context);
  assert.equal(negHit, null, 'Low ratio/amount should not trigger rapid pass-through');
});

test('Scenario 3 (SCEN_ROUND_AMOUNTS): Detects consecutive round-amount pattern typical of hawala', async () => {
  const now = Date.now();
  const priorTx = {
    transaction_id: 'TX_ROUND_1',
    sender_account: 'ACC_HAWALA_01',
    amount: 50000,
    timestamp: new Date(now - 24 * 3600 * 1000).toISOString()
  };

  const currentTx = {
    transaction_id: 'TX_ROUND_2',
    sender_account: 'ACC_HAWALA_01',
    amount: 100000,
    timestamp: new Date(now).toISOString()
  };

  const context = { history: [priorTx] };
  const params = { min_amount: 50000, modulus: 5000, min_consecutive_count: 2 };

  const hit = await detectors.detectRoundAmounts(currentTx, params, context);
  assert.ok(hit, 'Should trigger round-amount scenario');
  assert.equal(hit.hit, true);
  assert.equal(hit.variables.round_count, 2);

  // Negative test: Arbitrary non-round amount
  const oddTx = {
    transaction_id: 'TX_ODD',
    sender_account: 'ACC_HAWALA_01',
    amount: 47823.50,
    timestamp: new Date(now).toISOString()
  };
  const negHit = await detectors.detectRoundAmounts(oddTx, params, context);
  assert.equal(negHit, null, 'Non-round amount should not trigger round-amount scenario');
});

test('Scenario 4 (SCEN_DORMANT_REACTIVATION): Detects sudden high-value reactivation after > 90 days dormancy', async () => {
  const now = Date.now();
  const oldTx = {
    transaction_id: 'TX_OLD',
    sender_account: 'ACC_DORMANT_01',
    amount: 1000,
    timestamp: new Date(now - 120 * 24 * 3600 * 1000).toISOString() // 120 days ago
  };

  const reactivateTx = {
    transaction_id: 'TX_REACTIVATED',
    sender_account: 'ACC_DORMANT_01',
    amount: 85000,
    timestamp: new Date(now).toISOString()
  };

  const context = { history: [oldTx] };
  const params = { dormancy_days: 90, min_reactivation_amount: 50000 };

  const hit = await detectors.detectDormantReactivation(reactivateTx, params, context);
  assert.ok(hit, 'Should trigger dormant account reactivation');
  assert.equal(hit.hit, true);
  assert.ok(hit.variables.dormant_days_actual >= 119);

  // Negative test: Active account transacting regularly (e.g. 5 days ago)
  const activePrevTx = {
    transaction_id: 'TX_RECENT',
    sender_account: 'ACC_ACTIVE',
    amount: 10000,
    timestamp: new Date(now - 5 * 24 * 3600 * 1000).toISOString()
  };
  const activeTx = {
    transaction_id: 'TX_CURRENT',
    sender_account: 'ACC_ACTIVE',
    amount: 85000,
    timestamp: new Date(now).toISOString()
  };
  const negHit = await detectors.detectDormantReactivation(activeTx, params, { history: [activePrevTx] });
  assert.equal(negHit, null, 'Regularly active account should not trigger dormancy alert');
});

test('Scenario 5 (SCEN_CASH_INTENSITY): Detects cash deposit volume exceeding baseline by > 2x', async () => {
  const now = Date.now();
  const currentCashTx = {
    transaction_id: 'TX_CASH_01',
    sender_account: 'ACC_CASH_INTENSIVE',
    amount: 250000,
    payment_method: 'Cash Deposit',
    sender_declared_income: 60000, // expected monthly cash is 15k, 250k is > 16x
    timestamp: new Date(now).toISOString()
  };

  const context = { history: [] };
  const params = {
    window_days: 30,
    min_cash_volume: 200000,
    cash_ratio_threshold: 0.50,
    baseline_multiplier: 2.0,
    cash_methods: ['Cash Deposit', 'Cash Withdrawal', 'ATM']
  };

  const hit = await detectors.detectCashIntensity(currentCashTx, params, context);
  assert.ok(hit, 'Should trigger cash intensity scenario');
  assert.equal(hit.hit, true);
  assert.ok(parseFloat(hit.variables.multiplier) >= 2.0);

  // Negative test: Pure digital transfer (e.g. NEFT)
  const digitalTx = {
    transaction_id: 'TX_DIGITAL',
    sender_account: 'ACC_DIGITAL',
    amount: 250000,
    payment_method: 'NEFT',
    timestamp: new Date(now).toISOString()
  };
  const negHit = await detectors.detectCashIntensity(digitalTx, params, context);
  assert.equal(negHit, null, 'Non-cash method should not trigger cash intensity scenario');
});

test('Scenario 6 (SCEN_HIGH_RISK_GEO): Detects high-risk offshore geography exceeding threshold', async () => {
  const highRiskTx = {
    transaction_id: 'TX_OFFSHORE',
    sender_account: 'ACC_CORP_01',
    country: 'KY', // Cayman Islands
    amount: 150000,
    timestamp: new Date().toISOString()
  };

  const params = {
    min_amount: 100000,
    jurisdictions: ['KY', 'PA', 'AE', 'RU', 'BS', 'LU']
  };

  const hit = await detectors.detectHighRiskGeo(highRiskTx, params, {});
  assert.ok(hit, 'Should trigger high-risk geography scenario');
  assert.equal(hit.hit, true);
  assert.equal(hit.variables.country, 'KY');

  // Negative test: Domestic transaction (IN) or low amount
  const domesticTx = {
    transaction_id: 'TX_DOMESTIC',
    sender_account: 'ACC_CORP_01',
    country: 'IN',
    amount: 150000,
    timestamp: new Date().toISOString()
  };
  const negHit1 = await detectors.detectHighRiskGeo(domesticTx, params, {});
  assert.equal(negHit1, null, 'Domestic transaction should not trigger high-risk geo');

  const lowAmtOffshoreTx = {
    transaction_id: 'TX_LOW_OFFSHORE',
    sender_account: 'ACC_CORP_01',
    country: 'KY',
    amount: 25000, // < 100k
    timestamp: new Date().toISOString()
  };
  const negHit2 = await detectors.detectHighRiskGeo(lowAmtOffshoreTx, params, {});
  assert.equal(negHit2, null, 'Offshore transaction below min amount should not trigger');
});

test('Scenario 7 (SCEN_MANY_TO_ONE_FUNNEL): Detects funnel aggregation from >= 3 distinct senders', async () => {
  const now = Date.now();
  const beneficiary = 'ACC_BENEFICIARY_HUB';

  const t1 = {
    transaction_id: 'TX_F1',
    sender_account: 'ACC_SENDER_A',
    receiver_account: beneficiary,
    amount: 40000,
    timestamp: new Date(now - 10 * 3600 * 1000).toISOString()
  };

  const t2 = {
    transaction_id: 'TX_F2',
    sender_account: 'ACC_SENDER_B',
    receiver_account: beneficiary,
    amount: 45000,
    timestamp: new Date(now - 5 * 3600 * 1000).toISOString()
  };

  const t3 = {
    transaction_id: 'TX_F3',
    sender_account: 'ACC_SENDER_C',
    receiver_account: beneficiary,
    amount: 50000,
    timestamp: new Date(now).toISOString()
  };

  const context = { history: [t1, t2] };
  const params = {
    window_hours: 48,
    min_distinct_senders: 3,
    min_total_inflow: 100000
  };

  const hit = await detectors.detectManyToOneFunnel(t3, params, context);
  assert.ok(hit, 'Should trigger many-to-one funnel aggregation');
  assert.equal(hit.hit, true);
  assert.equal(hit.variables.distinct_senders, 3);
  assert.equal(hit.variables.beneficiary, beneficiary);

  // Negative test: Multiple deposits from only 1 single sender
  const repeatSenderTx = {
    transaction_id: 'TX_REPEAT',
    sender_account: 'ACC_SENDER_A',
    receiver_account: beneficiary,
    amount: 50000,
    timestamp: new Date(now).toISOString()
  };
  const negHit = await detectors.detectManyToOneFunnel(repeatSenderTx, params, { history: [t1] });
  assert.equal(negHit, null, 'Single sender repeated deposits should not trigger many-to-one funnel');
});

test('Fusion Scoring: calculateFusedRiskScore combines ML and Rules with formula and critical floor', () => {
  // Test 1: Standard balanced fusion 50/50
  const res1 = calculateFusedRiskScore(60, 40, []);
  assert.equal(res1.fused_score, 50, '0.5*60 + 0.5*40 = 50');
  assert.equal(res1.critical_override, false);
  assert.ok(res1.formula.includes('0.50 * ML(60) + 0.50 * Rules(40)'));

  // Test 2: Custom weights (70% ML, 30% Rules)
  const res2 = calculateFusedRiskScore(80, 20, [], { ml_weight: 0.70, rule_weight: 0.30 });
  assert.equal(res2.fused_score, 62, '0.7*80 + 0.3*20 = 56 + 6 = 62');

  // Test 3: Critical severity floor override
  // Even if ML is low (10), a Critical rule hit must enforce regulatory floor (>= 75)
  const criticalHits = [{ severity: 'Critical', scenario_id: 'SCEN_HIGH_RISK_GEO', score: 90 }];
  const res3 = calculateFusedRiskScore(10, 90, criticalHits);
  assert.ok(res3.fused_score >= 75, 'Critical hit must enforce floor score >= 75');
  assert.equal(res3.critical_override, true, 'Critical override flag must be true');
});

test('Scenario Evaluation: evaluateTransaction runs scenarios and produces rule_hits and fused score', async () => {
  const tx = {
    transaction_id: 'TX_EVAL_TEST',
    sender_account: 'ACC_CORP_OFFSHORE',
    receiver_account: 'ACC_TARGET_01',
    country: 'KY',
    amount: 200000,
    timestamp: new Date().toISOString()
  };

  const result = await evaluateTransaction(tx, { history: [] }, 40);
  assert.ok(result, 'Result must not be null');
  assert.ok(Array.isArray(result.rule_hits), 'rule_hits must be an array');
  assert.ok(result.rule_hits.length > 0, 'High-risk geo should produce at least 1 rule hit');
  assert.ok(typeof result.rule_score === 'number');
  assert.ok(typeof result.fused_score === 'number');
  assert.ok(result.score_breakdown, 'score_breakdown must be attached');
  assert.equal(result.score_breakdown.critical_override, true);
});

test('Scenario Evaluation: evaluateBatch evaluates transaction stream efficiently', async () => {
  const batch = [
    {
      transaction_id: 'TX_B1',
      sender_account: 'ACC_CLEAN_A',
      receiver_account: 'ACC_CLEAN_B',
      country: 'IN',
      amount: 5000,
      timestamp: new Date('2026-03-01T10:00:00Z').toISOString()
    },
    {
      transaction_id: 'TX_B2',
      sender_account: 'ACC_CLEAN_A',
      receiver_account: 'ACC_CLEAN_B',
      country: 'KY',
      amount: 150000,
      timestamp: new Date('2026-03-01T11:00:00Z').toISOString()
    }
  ];

  const evaluated = await evaluateBatch(batch);
  assert.equal(evaluated.length, 2);
  assert.equal(evaluated[0].rule_hits.length, 0, 'Small domestic tx has 0 rule hits');
  assert.ok(evaluated[1].rule_hits.length >= 1, 'Offshore tx has >= 1 rule hit');
});

test('Scenario Backtesting: runBacktest simulates candidate parameters and computes metrics', async () => {
  const candidateParams = {
    min_amount: 50000,
    jurisdictions: ['KY', 'PA', 'AE']
  };

  const backtestResult = await runBacktest('SCEN_HIGH_RISK_GEO', candidateParams, { limit: 100 });
  assert.ok(backtestResult, 'Backtest result must not be null');
  assert.equal(backtestResult.scenario_id, 'SCEN_HIGH_RISK_GEO');
  assert.ok(typeof backtestResult.total_evaluated === 'number');
  assert.ok(typeof backtestResult.hit_count === 'number');
  assert.ok(typeof backtestResult.hit_rate === 'number');

  if (backtestResult.has_labels && backtestResult.metrics) {
    assert.ok(typeof backtestResult.metrics.precision === 'number');
    assert.ok(typeof backtestResult.metrics.recall === 'number');
    assert.ok(typeof backtestResult.metrics.f1_score === 'number');
  }
});

test('Scenario Controller: CRUD and Backtest API handlers', async () => {
  // 1. GET /api/scenarios
  const getReq = { query: {} };
  const getRes = createMockRes();
  await getScenarios(getReq, getRes);
  const scenariosData = getRes.getData();
  assert.equal(scenariosData.success, true);
  assert.ok(scenariosData.data.length >= 7);

  // 2. GET /api/scenarios/:id
  const getOneReq = { params: { id: 'SCEN_RAPID_PASSTHROUGH' } };
  const getOneRes = createMockRes();
  await getScenarioById(getOneReq, getOneRes);
  const oneData = getOneRes.getData();
  assert.equal(oneData.success, true);
  assert.equal(oneData.data.scenario_id, 'SCEN_RAPID_PASSTHROUGH');

  // 3. PUT /api/scenarios/:id (Update parameters)
  const putReq = {
    params: { id: 'SCEN_RAPID_PASSTHROUGH' },
    body: {
      parameters: {
        window_hours: 36,
        pass_through_ratio: 0.85,
        min_amount: 60000
      }
    }
  };
  const putRes = createMockRes();
  await updateScenario(putReq, putRes);
  const putData = putRes.getData();
  assert.equal(putData.success, true);
  assert.equal(putData.data.parameters.window_hours, 36);

  // 4. POST /api/scenarios/:id/backtest
  const btReq = {
    params: { id: 'SCEN_RAPID_PASSTHROUGH' },
    body: {
      parameters: {
        window_hours: 24,
        pass_through_ratio: 0.80,
        min_amount: 50000
      }
    }
  };
  const btRes = createMockRes();
  await backtestScenario(btReq, btRes);
  const btData = btRes.getData();
  assert.equal(btData.success, true);
  assert.ok(btData.data.total_evaluated >= 0);

  // 5. POST /api/scenarios (Create custom scenario)
  const postReq = {
    body: {
      scenario_id: 'SCEN_CUSTOM_TEST',
      name: 'Custom High Frequency Test',
      description: 'Testing custom scenario creation',
      category: 'Behavioral',
      severity: 'Medium',
      weight: 15,
      parameters: { tx_threshold: 10 },
      explanation_template: 'Account {account_id} exceeded transaction velocity.'
    }
  };
  const postRes = createMockRes();
  await createScenario(postReq, postRes);
  const postData = postRes.getData();
  assert.equal(postData.success, true);
  assert.equal(postData.data.scenario_id, 'SCEN_CUSTOM_TEST');

  // 6. DELETE /api/scenarios/:id (Delete custom scenario)
  const delReq = { params: { id: 'SCEN_CUSTOM_TEST' } };
  const delRes = createMockRes();
  await deleteScenario(delReq, delRes);
  const delData = delRes.getData();
  assert.equal(delData.success, true);
});
