const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

let isFallbackMode = false;
const dataDir = path.join(__dirname, '..', '..', 'data');

let User, Transaction, Alert, Case, AuditLog, UploadMappingTemplate, UploadJob, Customer, Account, Scenario, ScreeningDecision, STRReport, CTRReport, Label, TransactionEvent;

// Schema definitions for reference (Mongoose mode)
const LabelSchema = new mongoose.Schema({
  label_id: { type: String, required: true, unique: true, index: true },
  transaction_id: { type: String, required: true, index: true },
  customer_id: { type: String, default: null, index: true },
  label: { type: Number, required: true }, // 1: True Positive (Suspicious), 0: False Positive (Benign)
  disposition: { type: String, required: true },
  rationale: { type: String, default: '' },
  label_source: { type: String, default: 'Alert Disposition' }, // 'Alert Disposition', 'Case Closure', 'STR Filing', 'Active Learning'
  analyst: { type: String, required: true },
  weight: { type: Number, default: 3.0 },
  used_in_training: { type: Boolean, default: false },
  trained_at: { type: Date, default: null },
  timestamp: { type: Date, default: Date.now }
});
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Investigator', 'Auditor'], required: true },
  createdAt: { type: Date, default: Date.now }
});

const TransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true, index: true },
  sender_account: { type: String, required: true, index: true },
  sender_name: { type: String, required: true },
  receiver_account: { type: String, required: true, index: true },
  receiver_name: { type: String, required: true },
  amount: { type: Number, required: true, index: true },
  currency: { type: String, default: 'INR', index: true },
  amount_inr: { type: Number, index: true },
  fx_rate: { type: Number, default: 1.0 },
  fx_date: { type: Date, default: null },
  timestamp: { type: Date, default: Date.now, index: true },
  country: { type: String, required: true, index: true },
  city: { type: String },
  device_id: { type: String },
  ip_address: { type: String },
  payment_method: { type: String, index: true },
  merchant: { type: String },
  category: { type: String },
  status: { type: String, default: 'Approved', index: true },
  original_transaction_id: { type: String, default: null, index: true },
  is_adjustment: { type: Boolean, default: false, index: true },
  adjustment_reason: { type: String, default: null },
  adjusted_by: { type: String, default: null },
  is_laundering: { type: Number, default: 0, index: true },
  risk_score: { type: Number, default: 0, index: true },
  rule_score: { type: Number, default: 0 },
  ml_score: { type: Number, default: 0 },
  score_breakdown: { type: Object, default: null },
  rule_hits: [{ type: Object }],
  screening_hits: [{ type: Object }],
  customer_id: { type: String, default: null, index: true },
  shap_explanation: { type: Object },
  reasons: [{ type: String }],
  model_version: { type: String, default: null },
  shadow_prediction: { type: Object, default: null }
});

// Performance Compound & Single Indexes for Transaction Queries
TransactionSchema.index({ sender_account: 1, timestamp: -1 });
TransactionSchema.index({ receiver_account: 1, timestamp: -1 });
TransactionSchema.index({ customer_id: 1, timestamp: -1 });
TransactionSchema.index({ risk_score: -1, timestamp: -1 });
TransactionSchema.index({ status: 1, timestamp: -1 });
TransactionSchema.index({ original_transaction_id: 1 });

const TransactionEventSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true, index: true },
  transaction_id: { type: String, required: true, index: true },
  event_type: { type: String, default: 'STATUS_CHANGE', index: true },
  old_status: { type: String, default: null },
  new_status: { type: String, required: true },
  reason: { type: String, required: true },
  changed_by: { type: String, required: true },
  ip_address: { type: String, default: '127.0.0.1' },
  timestamp: { type: Date, default: Date.now, index: true }
});

const AlertSchema = new mongoose.Schema({
  alert_id: { type: String, required: true, unique: true, index: true },
  entity_type: { type: String, enum: ['Customer', 'Account'], default: 'Account', index: true },
  entity_id: { type: String, required: true, index: true },
  entity_name: { type: String, default: '' },
  dedup_key: { type: String, index: true },
  transaction_id: { type: String, required: true, index: true },
  transaction_ids: [{ type: String }],
  transaction_count: { type: Number, default: 1 },
  total_volume: { type: Number, default: 0 },
  risk_score: { type: Number, required: true, index: true },
  priority_score: { type: Number, default: 50, index: true },
  level: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true, index: true },
  status: { 
    type: String, 
    enum: ['New', 'In Review L1', 'Escalated L2', 'Closed', 'Investigating', 'Dismissed', 'Escalated'], 
    default: 'New',
    index: true
  },
  assignee: { type: String, default: null, index: true },
  due_at: { type: Date, index: true },
  disposition_code: { 
    type: String, 
    enum: ['False Positive', 'True Positive - STR Filed', 'True Positive - No Filing', 'Insufficient Information', null], 
    default: null 
  },
  closure_reason: { type: String, default: null },
  closed_by: { type: String, default: null },
  closed_at: { type: Date, default: null },
  proposed_disposition: { type: String, default: null },
  proposed_by: { type: String, default: null },
  proposed_rationale: { type: String, default: null },
  proposed_at: { type: Date, default: null },
  reasons: [{ type: String }],
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Performance Compound Indexes for Alert Queues & SLA Tracking
AlertSchema.index({ status: 1, level: 1, createdAt: -1 });
AlertSchema.index({ entity_id: 1, status: 1 });
AlertSchema.index({ priority_score: -1, createdAt: -1 });
AlertSchema.index({ due_at: 1, status: 1 });

const CaseSchema = new mongoose.Schema({
  case_id: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  assigned_to: { type: String, default: null, index: true }, // Username of Investigator
  status: { type: String, enum: ['Open', 'Under Review', 'Pending STR', 'Closed'], default: 'Open', index: true },
  alerts: [{ type: String }], // Alert IDs
  merged_into_case_id: { type: String, default: null },
  merged_cases: [{ type: String }],
  notes: [{
    investigator: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
  }],
  timeline: [{
    event_type: { type: String, default: 'note' },
    user: { type: String, default: 'System' },
    role: { type: String, default: 'Investigator' },
    action: { type: String, required: true },
    details: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  }],
  evidence: [{
    evidence_id: { type: String },
    filename: String,
    originalName: String,
    mime_type: String,
    size_bytes: Number,
    checksum_sha256: { type: String, index: true },
    uploadedBy: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  disposition_code: { type: String, default: null },
  closure_reason: { type: String, default: null },
  closed_by: { type: String, default: null },
  closed_at: { type: Date, default: null },
  proposed_by: { type: String, default: null },
  proposed_disposition: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now, index: true }
});

CaseSchema.index({ status: 1, updatedAt: -1 });

const AuditLogSchema = new mongoose.Schema({
  log_id: { type: String, unique: true, index: true },
  sequence: { type: Number, index: true },
  previous_hash: { type: String, default: null },
  hash: { type: String, default: null, index: true },
  username: { type: String, required: true },
  role: { type: String, required: true },
  action: { type: String, required: true },
  ip_address: { type: String },
  details: { type: String },
  timestamp: { type: Date, default: Date.now, index: true }
});

const UploadMappingTemplateSchema = new mongoose.Schema({
  template_id: { type: String, required: true, unique: true },
  template_name: { type: String, required: true },
  source_signature: { type: String, required: true, index: true },
  headers: [{ type: String }],
  mapping: { type: Object, required: true },
  created_by: { type: String, default: 'System' },
  created_at: { type: Date, default: Date.now },
  last_used_at: { type: Date, default: Date.now },
  usage_count: { type: Number, default: 1 }
});

const UploadJobSchema = new mongoose.Schema({
  upload_id: { type: String, required: true, unique: true },
  file_path: { type: String, required: true },
  original_filename: { type: String, required: true },
  headers: [{ type: String }],
  source_signature: { type: String, required: true },
  row_count_estimate: { type: Number, default: 0 },
  status: { type: String, enum: ['pending_mapping', 'mapping_confirmed', 'processing', 'completed', 'failed'], default: 'pending_mapping' },
  mapping: { type: Object, default: null },
  auto_applied: { type: Boolean, default: false },
  auto_applied_template_id: { type: String, default: null },
  auto_applied_template_name: { type: String, default: null },
  processed_count: { type: Number, default: 0 },
  flagged_count: { type: Number, default: 0 },
  created_by: { type: String, default: 'System' },
  created_at: { type: Date, default: Date.now },
  completed_at: { type: Date, default: null },
  error: { type: String, default: null }
});

const CustomerSchema = new mongoose.Schema({
  customer_id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['individual', 'business'], default: 'individual' },
  occupation_or_business_type: { type: String, default: 'General' },
  declared_monthly_income_or_turnover: { type: Number, default: 0 },
  kyc_risk_rating: { type: String, enum: ['Low', 'Med', 'High'], default: 'Low' },
  is_pep: { type: Boolean, default: false },
  onboarding_date: { type: Date, default: Date.now },
  country_of_residence: { type: String, default: 'IN' },
  beneficial_owner_ids: [{ type: String }],
  screening_hits: [{ type: Object }],
  createdAt: { type: Date, default: Date.now }
});

const AccountSchema = new mongoose.Schema({
  account_id: { type: String, required: true, unique: true, index: true },
  customer_id: { type: String, required: true, index: true },
  open_date: { type: Date, default: Date.now },
  product_type: { type: String, default: 'savings' },
  createdAt: { type: Date, default: Date.now }
});

const ScenarioSchema = new mongoose.Schema({
  scenario_id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  category: { 
    type: String, 
    enum: ['Structuring', 'FlowOfFunds', 'Behavioral', 'Geographic', 'Network', 'Custom'],
    default: 'Behavioral' 
  },
  severity: { 
    type: String, 
    enum: ['Low', 'Medium', 'High', 'Critical'], 
    default: 'Medium' 
  },
  weight: { type: Number, default: 25 },
  enabled: { type: Boolean, default: true },
  parameters: { type: Object, default: {} },
  explanation_template: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ScreeningDecisionSchema = new mongoose.Schema({
  decision_id: { type: String, required: true, unique: true, index: true },
  entity_type: { type: String, enum: ['Transaction', 'Customer', 'AdHoc'], default: 'Transaction' },
  entity_id: { type: String, default: '' },
  screened_name: { type: String, required: true, index: true },
  matched_entity_id: { type: String, required: true, index: true },
  matched_name: { type: String, required: true },
  list_type: { type: String, enum: ['Sanctions', 'PEP', 'AdverseMedia'], required: true },
  match_score: { type: Number, required: true },
  decision: { type: String, enum: ['TrueMatch', 'FalsePositive', 'UnderReview'], default: 'UnderReview' },
  notes: { type: String, default: '' },
  decided_by: { type: String, default: 'Compliance Officer' },
  decided_at: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const STRReportSchema = new mongoose.Schema({
  str_id: { type: String, required: true, unique: true, index: true },
  case_id: { type: String, required: true, index: true },
  case_title: { type: String, default: '' },
  subject_info: { type: Object, default: {} },
  linked_accounts: [{ type: String }],
  transactions: [{ type: Object }],
  total_suspicious_amount: { type: Number, default: 0 },
  detected_typologies: [{ type: String }],
  reasons_for_suspicion: [{ type: String }],
  narrative: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['Draft', 'Pending Approval', 'Filed', 'Rejected'], 
    default: 'Draft' 
  },
  prepared_by: { type: String, required: true },
  prepared_at: { type: Date, default: Date.now },
  approved_by: { type: String, default: null },
  approved_at: { type: Date, default: null },
  rejection_reason: { type: String, default: null },
  filing_date: { type: Date, default: null },
  acknowledgement_reference: { type: String, default: null },
  due_date: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const CTRReportSchema = new mongoose.Schema({
  ctr_id: { type: String, required: true, unique: true, index: true },
  period: { type: String, required: true }, // e.g. 2026-10
  customer_id: { type: String, default: null },
  customer_name: { type: String, default: '' },
  account_id: { type: String, default: '' },
  total_cash_amount: { type: Number, required: true },
  transaction_count: { type: Number, default: 1 },
  transactions: [{ type: Object }],
  status: { 
    type: String, 
    enum: ['Generated', 'Pending Approval', 'Filed'], 
    default: 'Generated' 
  },
  generated_by: { type: String, default: 'System' },
  approved_by: { type: String, default: null },
  acknowledgement_reference: { type: String, default: null },
  filing_date: { type: Date, default: null },
  due_date: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ============================================================================
// [DEV-ONLY FALLBACK]: FileQuery & FileModel
// Provides in-memory / JSON filesystem query simulation with Mongoose-like chaining
// for offline dev & unit testing when MongoDB is unreachable.
// Production deployments must connect to MongoDB for indexing & high throughput.
// ============================================================================

class FileQuery {
  constructor(executor) {
    this._executor = executor;
    this._sortCriteria = null;
    this._skipCount = 0;
    this._limitCount = null;
    this._selectFields = null;
  }

  sort(criteria) {
    this._sortCriteria = criteria;
    return this;
  }

  skip(n) {
    this._skipCount = Math.max(0, parseInt(n, 10) || 0);
    return this;
  }

  limit(n) {
    if (n !== undefined && n !== null) {
      this._limitCount = Math.max(0, parseInt(n, 10) || 0);
    }
    return this;
  }

  select(fields) {
    this._selectFields = fields;
    return this;
  }

  lean() {
    return this;
  }

  async exec() {
    let items = await this._executor();
    if (!Array.isArray(items)) return items;

    if (this._sortCriteria) {
      const keys = Object.keys(this._sortCriteria);
      items.sort((a, b) => {
        for (const k of keys) {
          const dir = this._sortCriteria[k] === -1 || this._sortCriteria[k] === 'desc' ? -1 : 1;
          let valA = a[k];
          let valB = b[k];

          if (valA === undefined || valA === null) valA = '';
          if (valB === undefined || valB === null) valB = '';

          // Compare dates or timestamps
          const timeA = new Date(valA).getTime();
          const timeB = new Date(valB).getTime();
          if (!isNaN(timeA) && !isNaN(timeB) && typeof valA !== 'number' && typeof valB !== 'number') {
            if (timeA < timeB) return -1 * dir;
            if (timeA > timeB) return 1 * dir;
            continue;
          }

          if (valA < valB) return -1 * dir;
          if (valA > valB) return 1 * dir;
        }
        return 0;
      });
    }

    if (this._skipCount > 0) {
      items = items.slice(this._skipCount);
    }

    if (this._limitCount !== null && this._limitCount !== undefined) {
      items = items.slice(0, this._limitCount);
    }

    return items;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

// JSON File Fallback DB Class Mocking Mongoose (Dev-Only)
class FileModel {
  constructor(collectionName, schema) {
    this.name = collectionName;
    this.filePath = path.join(dataDir, `${collectionName}.json`);
    this.schema = schema;
    this.isDevFallback = true;
    
    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Ensure file exists
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
    }
  }

  _read() {
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`Error reading ${this.name}: ${e.message}`);
      return [];
    }
  }

  _write(data) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data));
    } catch (e) {
      console.error(`Error writing ${this.name}: ${e.message}`);
    }
  }

  _findRaw(filter = {}) {
    const data = this._read();
    return data.filter(item => {
      // Support Mongoose $or operator
      if (filter.$or && Array.isArray(filter.$or)) {
        const matchesAny = filter.$or.some(subFilter => {
          for (let key in subFilter) {
            if (subFilter[key] && typeof subFilter[key] === 'object' && !Array.isArray(subFilter[key])) {
              const op = Object.keys(subFilter[key])[0];
              const val = subFilter[key][op];
              if (op === '$in' && (!Array.isArray(val) || !val.includes(item[key]))) return false;
              if (op === '$gte' && item[key] < val) return false;
              if (op === '$lte' && item[key] > val) return false;
              if (op === '$regex') {
                const regex = new RegExp(val, subFilter[key].$options || 'i');
                if (!regex.test(item[key])) return false;
              }
            } else if (item[key] !== subFilter[key]) {
              return false;
            }
          }
          return true;
        });
        if (!matchesAny) return false;
      }

      for (let key in filter) {
        if (key === '$or') continue;
        // Handle basic filters (string/number matches, arrays)
        if (filter[key] && typeof filter[key] === 'object' && !Array.isArray(filter[key])) {
          // Handle mongoose $gte, $lte, $lt, $gt, $in, $regex operators
          const op = Object.keys(filter[key])[0];
          const val = filter[key][op];
          if (op === '$gte' && item[key] < val) return false;
          if (op === '$lte' && item[key] > val) return false;
          if (op === '$gt' && item[key] <= val) return false;
          if (op === '$lt' && item[key] >= val) return false;
          if (op === '$in' && (!Array.isArray(val) || !val.includes(item[key]))) return false;
          if (op === '$regex') {
            const regex = new RegExp(val, filter[key].$options || 'i');
            if (!regex.test(item[key])) return false;
          }
        } else if (item[key] !== filter[key]) {
          return false;
        }
      }
      return true;
    });
  }

  find(filter = {}) {
    return new FileQuery(async () => {
      const raw = this._findRaw(filter);
      return raw.map(item => this._wrapDoc(item));
    });
  }

  _wrapDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    if (doc.save && typeof doc.save === 'function') return doc;
    const model = this;
    const wrapped = Object.assign({}, doc);
    wrapped.toObject = () => ({ ...wrapped });
    wrapped.toJSON = () => ({ ...wrapped });
    wrapped.save = async function() {
      const data = model._read();
      const idField = model._getIdField();
      const idx = data.findIndex(item => (wrapped[idField] && item[idField] === wrapped[idField]) || (wrapped._id && item._id === wrapped._id));
      if (idx > -1) {
        data[idx] = { ...wrapped };
        model._write(data);
      } else {
        data.push({ ...wrapped });
        model._write(data);
      }
      return wrapped;
    };
    return wrapped;
  }

  async findOne(filter = {}) {
    const raw = this._findRaw(filter);
    return raw[0] ? this._wrapDoc(raw[0]) : null;
  }

  _getIdField() {
    const map = {
      User: '_id',
      Transaction: 'transaction_id',
      TransactionEvent: 'event_id',
      Alert: 'alert_id',
      Case: 'case_id',
      UploadMappingTemplate: 'template_id',
      UploadJob: 'upload_id',
      Customer: 'customer_id',
      Account: 'account_id',
      Scenario: 'scenario_id',
      ScreeningDecision: 'decision_id',
      STRReport: 'str_id',
      CTRReport: 'ctr_id',
      Label: 'label_id',
      AuditLog: 'log_id'
    };
    return map[this.name] || '_id';
  }

  async findById(id) {
    const field = this._getIdField();
    const data = this._read();
    const found = data.find(item => item[field] === id || item._id === id);
    return found ? this._wrapDoc(found) : null;
  }

  async create(doc) {
    const data = this._read();
    const newDoc = { ...doc };
    const crypto = require('crypto');
    
    // Add IDs and dates if not present
    if (!newDoc._id) {
      newDoc._id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    }
    if (!newDoc.createdAt) {
      newDoc.createdAt = new Date().toISOString();
    }
    if (this.schema.updatedAt && !newDoc.updatedAt) {
      newDoc.updatedAt = new Date().toISOString();
    }
    
    data.push(newDoc);
    this._write(data);
    return this._wrapDoc(newDoc);
  }

  async insertMany(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return [];
    const data = this._read();
    const inserted = [];
    const now = new Date().toISOString();
    const crypto = require('crypto');

    for (const doc of docs) {
      const newDoc = { ...doc };
      if (!newDoc._id) {
        newDoc._id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      }
      if (!newDoc.createdAt) {
        newDoc.createdAt = now;
      }
      if (this.schema.updatedAt && !newDoc.updatedAt) {
        newDoc.updatedAt = now;
      }
      data.push(newDoc);
      inserted.push(newDoc);
    }

    this._write(data);
    return inserted;
  }

  async findByIdAndUpdate(id, update, options = { new: true }) {
    const field = this._getIdField();
    const data = this._read();
    const index = data.findIndex(item => item[field] === id || item._id === id);
    
    if (index === -1) return null;
    
    const current = data[index];
    
    // Handle mongoose update operators (like $push or basic updates)
    let updatedDoc = { ...current };
    
    if (update.$push) {
      for (let key in update.$push) {
        if (!updatedDoc[key]) updatedDoc[key] = [];
        updatedDoc[key].push(update.$push[key]);
      }
    }
    
    // Apply normal updates
    for (let key in update) {
      if (key !== '$push' && key !== '$set') {
        updatedDoc[key] = update[key];
      } else if (key === '$set') {
        updatedDoc = { ...updatedDoc, ...update.$set };
      }
    }
    
    if (this.schema.updatedAt) {
      updatedDoc.updatedAt = new Date().toISOString();
    }
    
    data[index] = updatedDoc;
    this._write(data);
    return updatedDoc;
  }

  async findOneAndUpdate(filter = {}, update = {}, options = { new: true }) {
    const results = await this.find(filter);
    if (!results || results.length === 0) return null;
    const target = results[0];
    return this.findByIdAndUpdate(target._id, update, options);
  }

  async updateOne(filter = {}, update = {}) {
    const results = await this.find(filter);
    if (!results || results.length === 0) return { matchedCount: 0, modifiedCount: 0 };
    const target = results[0];
    await this.findByIdAndUpdate(target._id, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async countDocuments(filter = {}) {
    const raw = this._findRaw(filter);
    return raw.length;
  }

  async deleteOne(filter = {}) {
    const data = this._read();
    const index = data.findIndex(item => {
      for (let key in filter) {
        if (item[key] !== filter[key]) return false;
      }
      return true;
    });
    if (index > -1) {
      data.splice(index, 1);
      this._write(data);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(filter = {}) {
    const data = this._read();
    if (Object.keys(filter).length === 0) {
      this._write([]);
      return { deletedCount: data.length };
    }
    const remaining = data.filter(item => {
      for (let key in filter) {
        if (item[key] === filter[key]) return false;
      }
      return true;
    });
    const deletedCount = data.length - remaining.length;
    this._write(remaining);
    return { deletedCount };
  }
}

// Setup models holder

const DEFAULT_SCENARIOS = [
  {
    scenario_id: 'SCEN_STRUCTURING_MULTI_ACC',
    name: 'Structuring Across Customer Accounts',
    description: 'Detects multiple transactions across accounts owned by the same customer within rolling windows just below the CTR reporting threshold.',
    category: 'Structuring',
    severity: 'High',
    weight: 35,
    enabled: true,
    parameters: {
      window_days: 7,
      min_tx_count: 2,
      band_lower_pct: 80.0,
      band_upper_pct: 99.9,
      sum_threshold: 1000000.0
    },
    explanation_template: 'Customer {customer_id} transacted ₹{total_window_amount} across {account_count} linked account(s) within {window_days} days via {tx_count} transactions near CTR reporting threshold (₹{ctr_threshold}), indicating intentional structuring.'
  },
  {
    scenario_id: 'SCEN_RAPID_PASSTHROUGH',
    name: 'Rapid In-Out Pass-Through Flow',
    description: 'Identifies transit accounts where significant inbound funds are disbursed rapidly within hours.',
    category: 'FlowOfFunds',
    severity: 'High',
    weight: 30,
    enabled: true,
    parameters: {
      window_hours: 24,
      pass_through_ratio: 0.80,
      min_amount: 50000.0
    },
    explanation_template: 'Account {account_id} received ₹{inflow_amount} and subsequently disbursed ₹{outflow_amount} ({ratio_percent}% pass-through) within {time_diff_hours} hours, indicating transit/mule pass-through layering.'
  },
  {
    scenario_id: 'SCEN_ROUND_AMOUNTS',
    name: 'Repetitive Round-Amount Pattern',
    description: 'Flags transactions executed in exact, clean round amounts lacking economic commercial variance.',
    category: 'Behavioral',
    severity: 'Medium',
    weight: 20,
    enabled: true,
    parameters: {
      min_amount: 50000.0,
      modulus: 5000.0,
      min_consecutive_count: 2
    },
    explanation_template: 'Account {account_id} executed {round_count} consecutive round-amount transactions of ₹{amount} (divisible by ₹{modulus}), typical of informal hawala or pre-negotiated disbursements.'
  },
  {
    scenario_id: 'SCEN_DORMANT_REACTIVATION',
    name: 'Dormant Account Sudden Reactivation',
    description: 'Flags accounts dormant for extended periods that suddenly execute substantial transactions.',
    category: 'Behavioral',
    severity: 'High',
    weight: 30,
    enabled: true,
    parameters: {
      dormancy_days: 90,
      min_reactivation_amount: 50000.0
    },
    explanation_template: 'Account {account_id} was dormant for {dormant_days_actual} days (> {dormancy_days} threshold) and suddenly reactivated with an unexpected high-value transaction of ₹{amount}.'
  },
  {
    scenario_id: 'SCEN_CASH_INTENSITY',
    name: 'Cash Intensity Exceeding Behavioral Baseline',
    description: 'Monitors elevated cash deposit or withdrawal ratios relative to historical and peer baseline activity.',
    category: 'Behavioral',
    severity: 'High',
    weight: 25,
    enabled: true,
    parameters: {
      window_days: 30,
      min_cash_volume: 200000.0,
      cash_ratio_threshold: 0.50,
      baseline_multiplier: 2.0,
      cash_methods: ['Cash Deposit', 'Cash Withdrawal', 'ATM']
    },
    explanation_template: 'Account {account_id} transacted ₹{cash_volume} in cash ({cash_ratio_percent}% of volume) over 30 days, exceeding customer\'s typical baseline by {multiplier}x.'
  },
  {
    scenario_id: 'SCEN_HIGH_RISK_GEO',
    name: 'High-Risk Geography with Elevated Volume',
    description: 'Detects transactions involving FATF-monitored or sanctioned offshore tax havens exceeding thresholds.',
    category: 'Geographic',
    severity: 'Critical',
    weight: 40,
    enabled: true,
    parameters: {
      min_amount: 100000.0,
      jurisdictions: [] // verify against current rules - dynamic fallback to risk_config.json
    },
    explanation_template: 'Transaction of ₹{amount} routed to/from high-risk monitored jurisdiction {country} ({country_label}), exceeding regulatory threshold of ₹{min_amount}.'
  },
  {
    scenario_id: 'SCEN_MANY_TO_ONE_FUNNEL',
    name: 'Many-to-One Funnel Deposit Aggregation',
    description: 'Detects funnel beneficiary accounts collecting multiple deposits from disparate originators.',
    category: 'Network',
    severity: 'High',
    weight: 35,
    enabled: true,
    parameters: {
      window_hours: 48,
      min_distinct_senders: 3,
      min_total_inflow: 100000.0
    },
    explanation_template: 'Beneficiary account {account_id} received funds from {distinct_senders_count} distinct senders totaling ₹{total_inflow} within {window_hours} hours, characteristic of funnel account smurfing aggregation.'
  }
];

async function seedDefaultScenarios() {
  try {
    const count = await Scenario.countDocuments({});
    if (count === 0) {
      console.log('Bootstrapping default compliance scenarios...');
      for (const scen of DEFAULT_SCENARIOS) {
        await Scenario.create(scen);
      }
      console.log(`Successfully seeded ${DEFAULT_SCENARIOS.length} compliance scenarios.`);
    }
  } catch (err) {
    console.warn(`[Scenario Seeder Warning]: ${err.message}`);
  }
}

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aml_db';
  try {
    const isAtlas = uri.startsWith('mongodb+srv://') || uri.includes('.mongodb.net');
    const sanitizedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
    console.log(`Connecting to MongoDB at: ${sanitizedUri}...`);
    // Connect with longer timeout for Atlas/cloud networks (15s), shorter for local (5s)
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: isAtlas ? 15000 : 5000
    });
    console.log("Successfully connected to MongoDB server.");
    
    // Initialize Mongoose Models
    User = mongoose.models.User || mongoose.model('User', UserSchema);
    Transaction = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);
    TransactionEvent = mongoose.models.TransactionEvent || mongoose.model('TransactionEvent', TransactionEventSchema);
    Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);
    Case = mongoose.models.Case || mongoose.model('Case', CaseSchema);
    AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
    UploadMappingTemplate = mongoose.models.UploadMappingTemplate || mongoose.model('UploadMappingTemplate', UploadMappingTemplateSchema);
    UploadJob = mongoose.models.UploadJob || mongoose.model('UploadJob', UploadJobSchema);
    Customer = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
    Account = mongoose.models.Account || mongoose.model('Account', AccountSchema);
    Scenario = mongoose.models.Scenario || mongoose.model('Scenario', ScenarioSchema);
    ScreeningDecision = mongoose.models.ScreeningDecision || mongoose.model('ScreeningDecision', ScreeningDecisionSchema);
    STRReport = mongoose.models.STRReport || mongoose.model('STRReport', STRReportSchema);
    CTRReport = mongoose.models.CTRReport || mongoose.model('CTRReport', CTRReportSchema);
    Label = mongoose.models.Label || mongoose.model('Label', LabelSchema);

    await seedDefaultScenarios();

    // Seed default users if empty in MongoDB
    const admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      const bcrypt = require('bcryptjs');
      const hashedAdminPassword = await bcrypt.hash('admin123', 10);
      const hashedInvestigatorPassword = await bcrypt.hash('investigator123', 10);
      const hashedAuditorPassword = await bcrypt.hash('auditor123', 10);

      await User.create({
        username: 'admin',
        password: hashedAdminPassword,
        name: 'System Admin',
        role: 'Admin'
      });
      await User.create({
        username: 'investigator',
        password: hashedInvestigatorPassword,
        name: 'Chief Investigator',
        role: 'Investigator'
      });
      await User.create({
        username: 'auditor',
        password: hashedAuditorPassword,
        name: 'Compliance Auditor',
        role: 'Auditor'
      });
      console.log("MongoDB database seeded with default accounts (admin123, investigator123, auditor123).");
    }
  } catch (error) {
    console.warn(`[Database WARNING] MongoDB connection failed: ${error.message}`);
    console.warn(`Initiating Local JSON File-Based Fallback Database...`);
    isFallbackMode = true;
    
    // Initialize File-Based Mock Models
    User = new FileModel('User', UserSchema);
    Transaction = new FileModel('Transaction', TransactionSchema);
    TransactionEvent = new FileModel('TransactionEvent', TransactionEventSchema);
    Alert = new FileModel('Alert', AlertSchema);
    Case = new FileModel('Case', CaseSchema);
    AuditLog = new FileModel('AuditLog', AuditLogSchema);
    UploadMappingTemplate = new FileModel('UploadMappingTemplate', UploadMappingTemplateSchema);
    UploadJob = new FileModel('UploadJob', UploadJobSchema);
    Customer = new FileModel('Customer', CustomerSchema);
    Account = new FileModel('Account', AccountSchema);
    Scenario = new FileModel('Scenario', ScenarioSchema);
    ScreeningDecision = new FileModel('ScreeningDecision', ScreeningDecisionSchema);
    STRReport = new FileModel('STRReport', STRReportSchema);
    CTRReport = new FileModel('CTRReport', CTRReportSchema);
    Label = new FileModel('Label', LabelSchema);

    await seedDefaultScenarios();
    
    // Seed default users if empty
    const admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      const bcrypt = require('bcryptjs');
      const hashedAdminPassword = await bcrypt.hash('admin123', 10);
      const hashedInvestigatorPassword = await bcrypt.hash('investigator123', 10);
      const hashedAuditorPassword = await bcrypt.hash('auditor123', 10);

      await User.create({
        username: 'admin',
        password: hashedAdminPassword,
        name: 'System Admin',
        role: 'Admin'
      });
      await User.create({
        username: 'investigator',
        password: hashedInvestigatorPassword,
        name: 'Chief Investigator',
        role: 'Investigator'
      });
      await User.create({
        username: 'auditor',
        password: hashedAuditorPassword,
        name: 'Compliance Auditor',
        role: 'Auditor'
      });
      console.log("File-based fallback DB seeded with default accounts (admin123, investigator123, auditor123).");
    }
  }

  // Seed default transactions only if explicitly configured via AUTO_SEED=true
  try {
    const txCount = await Transaction.countDocuments({});
    if (process.env.AUTO_SEED === 'true' && txCount === 0) {
      console.log("Database transaction log is empty. Bootstrapping initial records...");
      const csvPath = path.join(__dirname, '..', '..', '..', 'dataset', 'dataset.csv');
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.split('\n');
        
        // Seed first 300 transactions (ideal size for instant database setup)
        const seedCount = Math.min(lines.length - 1, 300);
        console.log(`Seeding first ${seedCount} transactions from synthetic dataset...`);
        
        for (let i = 1; i <= seedCount; i++) {
          if (!lines[i].trim()) continue;
          
          const cols = lines[i].replace('\r', '').split(',');
          if (cols.length < 15) continue;
          
          const txData = {
            transaction_id: cols[0],
            sender_account: cols[1],
            sender_name: cols[2],
            receiver_account: cols[3],
            receiver_name: cols[4],
            amount: parseFloat(cols[5]),
            currency: cols[6],
            timestamp: cols[7],
            country: cols[8],
            city: cols[9],
            device_id: cols[10],
            ip_address: cols[11],
            payment_method: cols[12],
            merchant: cols[13],
            category: cols[14],
            status: cols[15],
            is_laundering: parseInt(cols[16] || 0),
            risk_score: 0,
            reasons: [],
            shap_explanation: []
          };
          
          // Calculate calibrated local risk score for seeder using shared riskConfig
          let score = 5;
          const reasons = [];
          const shap = [];

          const {
            getStructuringBounds,
            getHighRiskJurisdictions,
            getNightHours,
            getHighRiskPaymentMethods,
            getAlertLevel
          } = require('./riskConfig');

          const bounds = getStructuringBounds();
          const highRiskJurisdictions = getHighRiskJurisdictions();
          const highRiskCountries = Object.keys(highRiskJurisdictions);
          const highRiskMethods = getHighRiskPaymentMethods();
          const nightHours = getNightHours();

          if (txData.amount >= bounds.lower && txData.amount <= bounds.upper) {
            score += 40;
            reasons.push(`₹${txData.amount.toLocaleString('en-IN')} structured near India's CTR threshold — smurfing to evade reporting`);
            shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
          } else if (txData.amount >= bounds.ctr * 5) {
            score += 40;
            reasons.push(`Exceptionally large transfer ₹${txData.amount.toLocaleString('en-IN')} — exceeds retail baseline; consistent with integration stage of money laundering`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.40, actual_value: 1 });
          } else if (txData.amount >= bounds.ctr) {
            score += 30;
            reasons.push(`High-value transfer ₹${txData.amount.toLocaleString('en-IN')} exceeds CTR threshold — triggers STR review`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.30, actual_value: 1 });
          } else if (txData.amount >= bounds.ctr * 0.5) {
            score += 18;
            reasons.push(`Elevated transfer ₹${txData.amount.toLocaleString('en-IN')} — above retail 95th percentile; warrants enhanced due diligence`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.18, actual_value: 1 });
          } else {
            shap.push({ feature: 'amount_near_threshold', shap_value: -0.05, actual_value: 0 });
            shap.push({ feature: 'is_large_amount', shap_value: -0.05, actual_value: 0 });
          }
          shap.push({ feature: 'amount', shap_value: txData.amount > 250000 ? 0.1 : -0.1, actual_value: txData.amount });
          
          if (highRiskCountries.includes(txData.country)) {
            score += 30;
            const jur = highRiskJurisdictions[txData.country] || { name: txData.country, label: 'High-Risk Jurisdiction', source: 'Compliance Watchlist' };
            const labelSnippet = jur.label ? ` (${jur.label})` : '';
            reasons.push(`Transaction routed through ${jur.name || txData.country}${labelSnippet} — flagged under ${jur.source || 'Watchlist'}; EDD required per FEMA & PMLA`);
            shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_high_risk_country', shap_value: -0.1, actual_value: 0 });
          }
          
          if (highRiskMethods.includes(txData.payment_method)) {
            score += 20;
            if (txData.payment_method === 'Crypto Transfer') {
              reasons.push(`Cryptocurrency channel — bypasses AML controls and KYC; heavily exploited in layering phase`);
            } else if (txData.payment_method === 'Cash Deposit') {
              reasons.push(`Cash deposit — anonymous placement method; consistent with first stage of money laundering`);
            } else {
              reasons.push(`RTGS high-value channel — used in high-velocity layering schemes to rapidly move large sums`);
            }
            shap.push({ feature: 'is_wire_or_crypto', shap_value: 0.20, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_wire_or_crypto', shap_value: -0.05, actual_value: 0 });
          }
          
          const hour = new Date(txData.timestamp).getHours();
          if (nightHours.includes(hour)) {
            score += 10;
            reasons.push('Late-night transaction timing');
            shap.push({ feature: 'is_night', shap_value: 0.10, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_night', shap_value: -0.05, actual_value: 0 });
          }
          
          if (txData.category === 'Transfer' && (highRiskCountries.includes(txData.country) || highRiskMethods.includes(txData.payment_method))) {
            score += 10;
            reasons.push('Direct unclassified capital transfer');
            shap.push({ feature: 'is_transfer', shap_value: 0.10, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_transfer', shap_value: -0.05, actual_value: 0 });
          }
          
          shap.push({ feature: 'sender_time_diff', shap_value: 0.0, actual_value: 9999 });
          shap.push({ feature: 'receiver_time_diff', shap_value: 0.0, actual_value: 9999 });
          shap.push({ feature: 'sender_velocity_2h', shap_value: 0.0, actual_value: 0 });
          shap.push({ feature: 'receiver_velocity_2h', shap_value: 0.0, actual_value: 0 });
          
          if (txData.is_laundering === 1) {
            score = Math.max(score, 75);
            if (reasons.length === 0) reasons.push('Suspicious transfer pattern');
          }
          
          txData.risk_score = Math.min(score, 99);
          txData.reasons = reasons.slice(0, 3);
          txData.shap_explanation = shap;
          
          const savedTx = await Transaction.create(txData);
          
          // Auto Alert with realistic calibrated thresholds
          const alertLevel = getAlertLevel(savedTx.risk_score);

          if (alertLevel) {
            const { generateAlertId } = require('../utils/idGenerator');
            const alertId = generateAlertId();
            await Alert.create({
              alert_id: alertId,
              transaction_id: savedTx.transaction_id,
              risk_score: savedTx.risk_score,
              level: alertLevel,
              status: 'New',
              createdAt: savedTx.timestamp
            });
          }
        }
        console.log(`Automatic bootstrap transactions seeding completed successfully.`);
      }
    }
  } catch (seederErr) {
    console.error(`[Seeder Error]: Failed to bootstrap transaction records: ${seederErr.message}`);
  }
}

// Export models as a getter to support late-binding after connection attempts
module.exports = {
  connectDB,
  isFallback: () => isFallbackMode,
  models: {
    get User() { return User; },
    get Transaction() { return Transaction; },
    get TransactionEvent() { return TransactionEvent; },
    get Alert() { return Alert; },
    get Case() { return Case; },
    get AuditLog() { return AuditLog; },
    get UploadMappingTemplate() { return UploadMappingTemplate; },
    get UploadJob() { return UploadJob; },
    get Customer() { return Customer; },
    get Account() { return Account; },
    get Scenario() { return Scenario; },
    get ScreeningDecision() { return ScreeningDecision; },
    get STRReport() { return STRReport; },
    get CTRReport() { return CTRReport; },
    get Label() { return Label; }
  },
  get User() { return User; },
  get Transaction() { return Transaction; },
  get TransactionEvent() { return TransactionEvent; },
  get Alert() { return Alert; },
  get Case() { return Case; },
  get AuditLog() { return AuditLog; },
  get UploadMappingTemplate() { return UploadMappingTemplate; },
  get UploadJob() { return UploadJob; },
  get Customer() { return Customer; },
  get Account() { return Account; },
  get Scenario() { return Scenario; },
  get ScreeningDecision() { return ScreeningDecision; },
  get STRReport() { return STRReport; },
  get CTRReport() { return CTRReport; },
  get Label() { return Label; }
};
