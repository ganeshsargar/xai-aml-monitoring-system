const EventEmitter = require('events');
const { models } = require('../config/db');

/**
 * Interface definition for Ingestion Queue Adapters
 * Can be implemented by InMemoryQueueAdapter, RedisQueueAdapter (Bull/BullMQ), or KafkaQueueAdapter.
 */
class BaseQueueAdapter extends EventEmitter {
  async add(jobId, data) {
    throw new Error('Not implemented: add()');
  }

  async getStatus(jobId) {
    throw new Error('Not implemented: getStatus()');
  }

  async setProgress(jobId, progressData) {
    throw new Error('Not implemented: setProgress()');
  }

  async setCompleted(jobId, result) {
    throw new Error('Not implemented: setCompleted()');
  }

  async setFailed(jobId, error) {
    throw new Error('Not implemented: setFailed()');
  }

  process(handler) {
    throw new Error('Not implemented: process()');
  }
}

/**
 * In-Memory Asynchronous Queue Adapter
 * Lightweight, zero-external-dependency event-driven background job runner
 * with concurrency control, live progress events, and resilient error capture.
 */
class InMemoryQueueAdapter extends BaseQueueAdapter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 2;
    this.runningCount = 0;
    this.queue = [];
    this.jobs = new Map();
    this.handler = null;
  }

  async add(jobId, data) {
    const jobRecord = {
      job_id: jobId,
      data,
      status: 'queued',
      progress_pct: 0,
      processed_count: 0,
      total_count: data.row_count_estimate || 0,
      flagged_count: 0,
      error: null,
      result: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null
    };

    this.jobs.set(jobId, jobRecord);
    this.queue.push(jobId);
    this.emit('job_queued', jobRecord);

    // Trigger processing tick
    setImmediate(() => this._tick());
    return jobRecord;
  }

  async getStatus(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async listJobs() {
    return Array.from(this.jobs.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async setProgress(jobId, progressData) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    if (progressData.progress_pct !== undefined) job.progress_pct = Math.min(100, Math.max(0, Math.round(progressData.progress_pct)));
    if (progressData.processed_count !== undefined) job.processed_count = progressData.processed_count;
    if (progressData.total_count !== undefined) job.total_count = progressData.total_count;
    if (progressData.flagged_count !== undefined) job.flagged_count = progressData.flagged_count;

    this.emit('job_progress', { jobId, ...progressData });

    // Sync to DB UploadJob record if present
    if (models && models.UploadJob) {
      try {
        if (typeof models.UploadJob.findOneAndUpdate === 'function') {
          await models.UploadJob.findOneAndUpdate(
            { upload_id: jobId },
            { 
              status: 'processing',
              processed_count: job.processed_count,
              flagged_count: job.flagged_count
            }
          );
        }
      } catch (err) {
        // Non-fatal database progress sync
      }
    }
  }

  async setCompleted(jobId, result = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress_pct = 100;
    job.completed_at = new Date().toISOString();
    job.result = result;
    if (result.processed !== undefined) job.processed_count = result.processed;
    if (result.flagged !== undefined) job.flagged_count = result.flagged;

    this.emit('job_completed', { jobId, result });

    if (models && models.UploadJob) {
      try {
        if (typeof models.UploadJob.findOneAndUpdate === 'function') {
          await models.UploadJob.findOneAndUpdate(
            { upload_id: jobId },
            { 
              status: 'completed',
              processed_count: job.processed_count,
              flagged_count: job.flagged_count,
              completed_at: new Date()
            }
          );
        }
      } catch (err) {}
    }
  }

  async setFailed(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.completed_at = new Date().toISOString();
    job.error = error.message || String(error);

    this.emit('job_failed', { jobId, error: job.error });

    if (models && models.UploadJob) {
      try {
        if (typeof models.UploadJob.findOneAndUpdate === 'function') {
          await models.UploadJob.findOneAndUpdate(
            { upload_id: jobId },
            { 
              status: 'failed',
              error: job.error,
              completed_at: new Date()
            }
          );
        }
      } catch (err) {}
    }
  }

  process(handler) {
    this.handler = handler;
    setImmediate(() => this._tick());
  }

  async _tick() {
    if (this.runningCount >= this.concurrency || this.queue.length === 0 || !this.handler) {
      return;
    }

    const jobId = this.queue.shift();
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'queued') {
      setImmediate(() => this._tick());
      return;
    }

    this.runningCount++;
    job.status = 'processing';
    job.started_at = new Date().toISOString();

    const progressReporter = {
      reportProgress: (p) => this.setProgress(jobId, p)
    };

    try {
      const result = await this.handler(job.data, progressReporter);
      await this.setCompleted(jobId, result);
    } catch (err) {
      console.error(`[Ingestion Queue Worker] Job ${jobId} failed:`, err);
      await this.setFailed(jobId, err);
    } finally {
      this.runningCount--;
      setImmediate(() => this._tick());
    }
  }
}

/**
 * Pluggable Redis / Kafka Adapter Stub
 * Interface ready for drop-in replacement in multi-node clusters.
 */
class RedisQueueAdapter extends BaseQueueAdapter {
  constructor(redisConfig = {}) {
    super();
    this.redisConfig = redisConfig;
  }
  // Standard Redis / BullMQ protocol integration hooks
}

// Ingestion Service Singleton
const ingestionQueue = new InMemoryQueueAdapter({ concurrency: 2 });

module.exports = {
  ingestionQueue,
  InMemoryQueueAdapter,
  RedisQueueAdapter,
  BaseQueueAdapter
};
