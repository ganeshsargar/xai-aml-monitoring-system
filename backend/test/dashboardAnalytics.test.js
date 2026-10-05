const test = require('node:test');
const assert = require('node:assert');
const { connectDB } = require('../src/config/db');
const dashboardService = require('../src/services/dashboardService');
const dashboardController = require('../src/controllers/dashboardController');

test.before(async () => {
  await connectDB();
});

test('Dashboard Analytics: Returns comprehensive operational KPIs', async () => {
  const analytics = await dashboardService.getDashboardAnalytics({}, true);

  assert.ok(analytics, 'Analytics object should be defined');
  assert.ok(analytics.operational_kpis, 'Should contain operational_kpis section');
  assert.strictEqual(typeof analytics.operational_kpis.active_backlog, 'number');
  assert.strictEqual(typeof analytics.operational_kpis.sla_breached, 'number');
  assert.strictEqual(typeof analytics.operational_kpis.sla_urgent_24h, 'number');
  assert.strictEqual(typeof analytics.operational_kpis.avg_mttc_hours, 'number');
  assert.strictEqual(typeof analytics.feedback_attribution_kpis.str_conversion_rate_pct, 'number');
  assert.strictEqual(typeof analytics.feedback_attribution_kpis.false_positive_rate_pct, 'number');

  assert.ok(analytics.operational_kpis.backlog_by_status, 'Should contain backlog by status');
  assert.ok(Array.isArray(analytics.operational_kpis.alert_volume_trend), 'Should contain alert volume trend array');
  assert.ok(Array.isArray(analytics.operational_kpis.analyst_workload), 'Should contain analyst workload leaderboard');
  assert.ok(Array.isArray(analytics.typology_breakdown), 'Should contain typology breakdown');
  assert.ok(Array.isArray(analytics.feedback_attribution_kpis.detection_mode_split), 'Should contain detection_mode_split analysis');
  assert.ok(Array.isArray(analytics.risk_entities.channel_risk_heatmap), 'Should contain channel heatmap array');
  assert.ok(Array.isArray(analytics.risk_entities.top_risky_customers), 'Should contain top risky customers');
  assert.ok(Array.isArray(analytics.risk_entities.top_risky_accounts), 'Should contain top risky accounts');
  assert.ok(Array.isArray(analytics.risk_entities.geographic_risk_map), 'Should contain geographic risk map');
});

test('Dashboard Analytics: Detection mode comparison evaluates ML vs Rule vs Hybrid', async () => {
  const analytics = await dashboardService.getDashboardAnalytics({}, true);
  const modes = analytics.feedback_attribution_kpis.detection_mode_split;

  assert.ok(Array.isArray(modes), 'Modes should be an array');
  const modeKeys = modes.map(m => m.mode);
  assert.ok(modeKeys.includes('Hybrid (Both)'), 'Hybrid mode should exist');
  assert.ok(modeKeys.includes('ML-Only'), 'ML-Only mode should exist');
  assert.ok(modeKeys.includes('Rule-Only'), 'Rule-Only mode should exist');

  const hybrid = modes.find(m => m.mode === 'Hybrid (Both)');
  assert.strictEqual(typeof hybrid.transaction_count, 'number');
  assert.strictEqual(typeof hybrid.alerts_generated, 'number');
  assert.strictEqual(typeof hybrid.precision_rate, 'string');
  assert.strictEqual(typeof hybrid.str_conversion_rate, 'string');
});

test('Dashboard Analytics: Typology breakdown categorizes AML typologies accurately', async () => {
  const analytics = await dashboardService.getDashboardAnalytics({}, true);
  const typologies = analytics.typology_breakdown;

  assert.ok(Array.isArray(typologies), 'Typologies should be an array');
  const names = typologies.map(t => t.typology);
  assert.ok(names.includes('Structuring / Smurfing'));
  assert.ok(names.includes('Layering & Rapid Movement'));
  assert.ok(names.includes('Circular Flow / Network'));
  assert.ok(names.includes('High-Risk Geography'));
  assert.ok(names.includes('Velocity & Rapid Spike'));
});

test('Dashboard Analytics: Applies timeRange and segment filters without crash', async () => {
  const filters7d = { timeRange: '7d', country: 'IND', payment_method: 'CRYPTO' };
  const analytics = await dashboardService.getDashboardAnalytics(filters7d, true);

  assert.ok(analytics.filter_meta, 'Should contain filter_meta');
  assert.strictEqual(analytics.filter_meta.applied_filters.timeRange, '7d');
  assert.strictEqual(analytics.filter_meta.applied_filters.country, 'IND');
  assert.strictEqual(analytics.filter_meta.applied_filters.payment_method, 'CRYPTO');
});

test('Dashboard Analytics: Caching serves subsequent requests with TTL', async () => {
  const filters = { timeRange: '30d' };
  const firstCall = await dashboardService.getDashboardAnalytics(filters, true);
  const secondCall = await dashboardService.getDashboardAnalytics(filters, false);

  assert.strictEqual(firstCall.filter_meta.computed_at, secondCall.filter_meta.computed_at, 'Cached response should share timestamp');
  assert.strictEqual(secondCall.cached, true, 'Second call should be flagged as cached');
});

test('Dashboard Analytics: CSV export generates formatted CSV string', async () => {
  const analytics = await dashboardService.getDashboardAnalytics({}, true);

  const typologyCsv = dashboardService.exportDatasetCSV('typologies', analytics.typology_breakdown);
  assert.ok(typeof typologyCsv === 'string', 'Should return CSV string');
  assert.ok(typologyCsv.includes('typology,detections'), 'Should export typology headers');

  const analystCsv = dashboardService.exportDatasetCSV('analysts', analytics.operational_kpis.analyst_workload);
  assert.ok(analystCsv.includes('analyst,username'), 'Should export analyst headers');
});

test('Dashboard Controller: GET /api/dashboard/kpis and CSV endpoints return 200', async () => {
  const req = {
    query: { timeRange: '30d', refresh: 'true' }
  };
  let jsonResult = null;
  const res = {
    json: (data) => { jsonResult = data; },
    status: () => res
  };

  await dashboardController.getDashboardKPIs(req, res);
  assert.ok(jsonResult, 'Controller should return JSON payload');
  assert.strictEqual(jsonResult.success, true);
  assert.ok(jsonResult.data.operational_kpis);

  // Test CSV export endpoint
  const csvReq = { query: { dataset_key: 'alert_volume_trend' } };
  let headerSet = {};
  let sentCsv = '';
  const csvRes = {
    setHeader: (k, v) => { headerSet[k] = v; },
    send: (content) => { sentCsv = content; },
    status: () => csvRes,
    json: (d) => { sentCsv = JSON.stringify(d); }
  };

  await dashboardController.exportDashboardCSV(csvReq, csvRes);
  assert.strictEqual(headerSet['Content-Type'], 'text/csv');
  assert.ok(sentCsv.includes('date,total_alerts'));
});
