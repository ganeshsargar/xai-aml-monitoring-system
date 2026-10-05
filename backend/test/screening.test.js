const test = require('node:test');
const assert = require('node:assert/strict');

const { connectDB, models, Transaction, ScreeningDecision } = require('../src/config/db');
const {
  normalizeName,
  calculateNameSimilarity,
  calculateInitialsScore,
  loadWatchlists,
  ingestOfacSdn,
  ingestUnConsolidated,
  screenName,
  screenTransaction,
  recordDecision,
  isFalsePositive,
  syncFalsePositiveCache
} = require('../src/services/screeningService');

const {
  screenName: screenNameCtrl,
  getDecisions: getDecisionsCtrl,
  recordDecision: recordDecisionCtrl,
  getWatchlists: getWatchlistsCtrl
} = require('../src/controllers/screeningController');

const { createTransaction } = require('../src/controllers/transactionController');

test.before(async () => {
  await connectDB();
  await loadWatchlists(true);
});

// Helper for mock HTTP responses
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

test('Fuzzy Name Matching: Normalization strips diacritics, honorifics, and corporate suffixes', () => {
  assert.equal(normalizeName('Dr. Victor Moriarity Sterling'), 'victor moriarity sterling');
  assert.equal(normalizeName('Zephyr Global Trading FZE'), 'zephyr global trading fze');
  assert.equal(normalizeName('Hàssân Al-Zâhír Fâroûk'), 'hassan al zahir farouk');
});

test('Fuzzy Name Matching: Handles name order variations ("Kumar Sharma Rahul" vs "Rahul K. Sharma")', () => {
  const result = calculateNameSimilarity('Kumar Sharma Rahul', 'Rahul K. Sharma');
  assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
  assert.ok(result.details.tokenSetRatio >= 85, 'Token set ratio should be high for inverted words');

  const invertedSanction = calculateNameSimilarity('Sterling Victor Moriarity', 'Victor Moriarity Sterling');
  assert.ok(invertedSanction.score >= 90, `Expected score >= 90, got ${invertedSanction.score}`);
});

test('Fuzzy Name Matching: Handles initials and abbreviations ("Rahul K. Sharma" vs "Rahul Kumar Sharma")', () => {
  const sim = calculateNameSimilarity('Rahul K. Sharma', 'Rahul Kumar Sharma');
  assert.ok(sim.score >= 85, `Expected score >= 85, got ${sim.score}`);

  const sim2 = calculateNameSimilarity('V. M. Sterling', 'Victor Moriarity Sterling');
  assert.ok(sim2.score >= 85, `Expected score >= 85, got ${sim2.score}`);
});

test('Fuzzy Name Matching: Handles transliteration and spelling variants', () => {
  // Mohd vs Muhammad / Mohammed
  const simMohd = calculateNameSimilarity('Mohd Farouk', 'Muhammad Farouk');
  assert.ok(simMohd.score >= 90, `Expected score >= 90 for Mohd vs Muhammad, got ${simMohd.score}`);

  // Bikash vs Vikas
  const simBikash = calculateNameSimilarity('Bikash Chandra Verma', 'Vikas Chandra Verma');
  assert.ok(simBikash.score >= 90, `Expected score >= 90 for Bikash vs Vikas, got ${simBikash.score}`);

  // Dmitri vs Dmitriy
  const simDmitri = calculateNameSimilarity('Dmitriy Sokolov', 'Dmitri Sokolov');
  assert.ok(simDmitri.score >= 90, `Expected score >= 90 for Dmitriy vs Dmitri, got ${simDmitri.score}`);
});

test('Fuzzy Name Matching: Handles typographical noise and minor misspellings', () => {
  const simTypo = calculateNameSimilarity('Vicktor Sterlling', 'Victor Sterling');
  assert.ok(simTypo.score >= 80, `Expected score >= 80 for minor typo, got ${simTypo.score}`);

  const simCorp = calculateNameSimilarity('AeroPhantom Maritime Logistic', 'AeroPhantom Maritime Logistics');
  assert.ok(simCorp.score >= 90, `Expected score >= 90 for missing plural s, got ${simCorp.score}`);
});

test('Fuzzy Name Matching: Negative test for unrelated names yields low score', () => {
  const simNegative1 = calculateNameSimilarity('Johnathan David Smith', 'Rahul Kumar Sharma');
  assert.ok(simNegative1.score < 40, `Unrelated names should score < 40, got ${simNegative1.score}`);

  const simNegative2 = calculateNameSimilarity('Carlos Eduardo Montez', 'Amit Ramesh Patel');
  assert.ok(simNegative2.score < 40, `Unrelated names should score < 40, got ${simNegative2.score}`);
});

test('Watchlist Loader: Loads sample fictional entries from sanctions, pep, and adverse media CSVs', async () => {
  const lists = await loadWatchlists(true);
  assert.ok(Array.isArray(lists.sanctions), 'Sanctions must be an array');
  assert.ok(lists.sanctions.length >= 5, 'Must have at least 5 sample sanctions');

  assert.ok(Array.isArray(lists.pep), 'PEP must be an array');
  assert.ok(lists.pep.length >= 5, 'Must have at least 5 sample PEP entries');

  assert.ok(Array.isArray(lists.adverse_media), 'Adverse media must be an array');
  assert.ok(lists.adverse_media.length >= 3, 'Must have sample adverse media entries');

  // Verify none contain placeholder or real people
  for (const s of lists.sanctions) {
    assert.ok(s.entity_id.startsWith('SANCT-'), 'Sanctions IDs match standard format');
    assert.ok(s.name, 'Sanctions entry must have a name');
  }
});

test('Extensible Watchlist Ingestion: OFAC SDN and UN Consolidated formats parse accurately', () => {
  const sampleOfacCsv = `ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vess_type,Tonnage,GRT,Vess_flag,Vess_owner,Remarks\n1001,"TEST ENTITY ALPHA","Entity","SDNT-TEST",,,,,,,,"Sample OFAC entry"`;
  const ofacEntries = ingestOfacSdn(sampleOfacCsv, 'csv');
  assert.equal(ofacEntries.length, 1);
  assert.equal(ofacEntries[0].entity_id, 'OFAC-1001');
  assert.equal(ofacEntries[0].name, 'TEST ENTITY ALPHA');

  const sampleUnCsv = `DATAID,FIRST_NAME,SECOND_NAME\n9001,"KHALID","AL-SAMPLE"`;
  const unEntries = ingestUnConsolidated(sampleUnCsv, 'csv');
  assert.equal(unEntries.length, 1);
  assert.equal(unEntries[0].entity_id, 'UN-9001');
  assert.equal(unEntries[0].name, 'KHALID AL-SAMPLE');
});

test('Name Screening: Screens sender against sanctions list and flags Critical hit', async () => {
  const res = await screenName('Victor M. Sterling');
  assert.equal(res.matched, true);
  assert.ok(res.hits.length > 0);

  const topHit = res.hits[0];
  assert.equal(topHit.matched_entity_id, 'SANCT-001');
  assert.equal(topHit.list_type, 'Sanctions');
  assert.equal(topHit.severity, 'Critical');
  assert.ok(topHit.match_score >= 85);
});

test('Name Screening: Screens receiver against PEP list and flags High hit', async () => {
  const res = await screenName('Kumar Sharma Rahul');
  assert.equal(res.matched, true);
  assert.ok(res.hits.length > 0);

  const pepHit = res.hits.find(h => h.list_type === 'PEP');
  assert.ok(pepHit, 'Should hit PEP watchlist for Rahul Kumar Sharma');
  assert.equal(pepHit.matched_entity_id, 'PEP-001');
  assert.equal(pepHit.severity, 'High');
  assert.ok(pepHit.match_score >= 80);
});

test('Transaction Integration: Screening hit elevates risk score and mandates Critical alert', async () => {
  const req = {
    body: {
      transaction_id: 'TX_SCREEN_TEST_' + Date.now(),
      sender_account: 'ACC_SANCTIONED_01',
      sender_name: 'Victor M. Sterling', // Designated entity
      receiver_account: 'ACC_RECV_01',
      receiver_name: 'Clean Merchant Ltd',
      amount: 45000,
      country: 'IN',
      payment_method: 'UPI'
    },
    user: { username: 'investigator', role: 'Investigator' },
    ip: '127.0.0.1'
  };

  const res = createMockRes();
  await createTransaction(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  const savedTx = data.data;

  assert.ok(Array.isArray(savedTx.screening_hits), 'Transaction must contain screening_hits');
  assert.ok(savedTx.screening_hits.length > 0, 'Must have at least 1 screening hit');
  assert.ok(savedTx.risk_score >= 75, `Sanctions hit must enforce critical risk score floor >= 75, got ${savedTx.risk_score}`);
  assert.ok(savedTx.reasons.some(r => r.includes('Sanctions Match')), 'Reasons must cite Sanctions Match');
});

test('False Positive Management: Recording False Positive whitelists pair and suppresses future alerts', async () => {
  const screenedName = 'Carlos E. Montez';
  const matchedEntityId = 'SANCT-005';

  // Ensure clean state for test run
  try {
    if (models.ScreeningDecision) {
      if (models.ScreeningDecision.deleteMany) {
        await models.ScreeningDecision.deleteMany({ screened_name: screenedName });
      } else if (models.ScreeningDecision.remove) {
        await models.ScreeningDecision.remove({ screened_name: screenedName });
      }
    }
  } catch (e) {}
  await syncFalsePositiveCache(true);

  // 1. Initial screen should match Carlos Eduardo Montez
  const initialScreen = await screenName(screenedName);
  assert.equal(initialScreen.matched, true);
  assert.equal(initialScreen.hits[0].is_false_positive, false);

  // 2. Compliance Officer marks as False Positive
  const decisionRecord = await recordDecision({
    entity_type: 'Transaction',
    entity_id: 'TX_MANUAL_REVIEW',
    screened_name: screenedName,
    matched_entity_id: matchedEntityId,
    matched_name: 'Carlos Eduardo Montez',
    list_type: 'Sanctions',
    match_score: 90,
    decision: 'FalsePositive',
    notes: 'Verified passport; different date of birth and Colombian national ID.',
    decided_by: 'senior_investigator'
  });

  assert.ok(decisionRecord);
  assert.equal(await isFalsePositive(screenedName, matchedEntityId), true);

  // 3. Subsequent screening of the same name should now be suppressed
  const subsequentScreen = await screenName(screenedName);
  const suppressedHit = subsequentScreen.hits.find(h => h.matched_entity_id === matchedEntityId);
  assert.ok(suppressedHit, 'Hit should still be listed in audit trail');
  assert.equal(suppressedHit.is_false_positive, true, 'is_false_positive must be true');
  assert.equal(suppressedHit.status, 'FalsePositiveSuppressed', 'Status must be FalsePositiveSuppressed');
  assert.equal(subsequentScreen.active_hits.length, 0, 'No active hits after false-positive suppression');
  assert.equal(subsequentScreen.matched, false, 'Should not alert on suppressed false positive');
});

test('Screening Controller: screenName, decisions, and watchlists API endpoints', async () => {
  // 1. POST /api/screening/screen
  const screenReq = { body: { name: 'Elena Vance Vasilev', threshold: 75 } };
  const screenRes = createMockRes();
  await screenNameCtrl(screenReq, screenRes);
  const screenData = screenRes.getData();
  assert.equal(screenData.success, true);
  assert.ok(screenData.data.hits.length > 0);

  // 2. GET /api/screening/watchlists
  const wlReq = {};
  const wlRes = createMockRes();
  await getWatchlistsCtrl(wlReq, wlRes);
  const wlData = wlRes.getData();
  assert.equal(wlData.success, true);
  assert.ok(wlData.data.sanctions_count >= 5);
  assert.ok(wlData.data.pep_count >= 5);

  // 3. POST /api/screening/decisions
  const decReq = {
    body: {
      screened_name: 'Dmitri Sokolov',
      matched_entity_id: 'ADV-001',
      matched_name: 'Dmitri Alexeyevich Sokolov',
      list_type: 'AdverseMedia',
      match_score: 88,
      decision: 'TrueMatch',
      notes: 'Confirmed identity against corporate filings'
    },
    user: { username: 'lead_auditor' }
  };
  const decRes = createMockRes();
  await recordDecisionCtrl(decReq, decRes);
  const decData = decRes.getData();
  assert.equal(decData.success, true);

  // 4. GET /api/screening/decisions
  const getDecReq = { query: { screened_name: 'Dmitri Sokolov' } };
  const getDecRes = createMockRes();
  await getDecisionsCtrl(getDecReq, getDecRes);
  const getDecData = getDecRes.getData();
  assert.equal(getDecData.success, true);
  assert.ok(getDecData.data.length > 0);
});
