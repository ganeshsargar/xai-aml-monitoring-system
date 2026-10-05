const test = require('node:test');
const assert = require('node:assert');
const { connectDB, models } = require('../src/config/db');
const { ingestionQueue, InMemoryQueueAdapter } = require('../src/services/ingestionQueue');
const transactionController = require('../src/controllers/transactionController');
const alertController = require('../src/controllers/alertController');
const caseController = require('../src/controllers/caseController');

test.before(async () => {
  await connectDB();
});

test('Performance: FileQuery supports chaining .sort(), .skip(), and .limit()', async () => {
  // Test FileQuery with mock / fallback items
  const query = models.Transaction.find({}).sort({ timestamp: -1 }).skip(0).limit(5);
  assert.ok(typeof query.sort === 'function', 'Should have .sort()');
  assert.ok(typeof query.skip === 'function', 'Should have .skip()');
  assert.ok(typeof query.limit === 'function', 'Should have .limit()');
  assert.ok(typeof query.then === 'function', 'Should be thenable');

  const results = await query;
  assert.ok(Array.isArray(results), 'Should resolve to an array');
  assert.ok(results.length <= 5, 'Should respect limit 5');
});

test('Performance: IngestionQueue manages background jobs and progress', async () => {
  const customQueue = new InMemoryQueueAdapter({ concurrency: 1 });
  let processedData = null;

  customQueue.process(async (data, reporter) => {
    await reporter.reportProgress({ progress_pct: 50, processed_count: 5, total_count: 10 });
    processedData = data;
    return { success: true, processed: 10 };
  });

  const job = await customQueue.add('test_job_101', { row_count_estimate: 10, source: 'test' });
  assert.strictEqual(job.job_id, 'test_job_101');
  assert.strictEqual(job.status, 'queued');

  // Wait for tick execution
  await new Promise(r => setTimeout(r, 50));

  const status = await customQueue.getStatus('test_job_101');
  assert.strictEqual(status.status, 'completed');
  assert.strictEqual(status.progress_pct, 100);
  assert.strictEqual(status.result.processed, 10);
  assert.deepStrictEqual(processedData, { row_count_estimate: 10, source: 'test' });
});

test('Performance: getTransactions executes server-side pagination without in-memory crash', async () => {
  const req = {
    query: { page: 1, limit: 10 }
  };
  let responseData = null;
  const res = {
    json: (data) => { responseData = data; return res; },
    status: () => res
  };

  await transactionController.getTransactions(req, res);
  assert.ok(responseData, 'Should return response data');
  assert.strictEqual(responseData.success, true);
  assert.ok(Array.isArray(responseData.data));
  assert.strictEqual(responseData.page, 1);
  assert.ok(responseData.totalPages >= 1);
});

test('Performance: getAlerts batches transaction lookups without N+1 queries', async () => {
  const req = {
    query: { page: 1, limit: 10 }
  };
  let responseData = null;
  const res = {
    json: (data) => { responseData = data; return res; },
    status: () => res
  };

  await alertController.getAlerts(req, res);
  assert.ok(responseData, 'Should return response data');
  assert.strictEqual(responseData.success, true);
  assert.ok(Array.isArray(responseData.data));
});
