const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

let isFallbackMode = false;
const dataDir = path.join(__dirname, '..', '..', 'data');

// Schema definitions for reference (Mongoose mode)
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Investigator', 'Auditor'], required: true },
  createdAt: { type: Date, default: Date.now }
});

const TransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true },
  sender_account: { type: String, required: true },
  sender_name: { type: String, required: true },
  receiver_account: { type: String, required: true },
  receiver_name: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  timestamp: { type: Date, default: Date.now },
  country: { type: String, required: true },
  city: { type: String },
  device_id: { type: String },
  ip_address: { type: String },
  payment_method: { type: String },
  merchant: { type: String },
  category: { type: String },
  status: { type: String, default: 'Approved' },
  is_laundering: { type: Number, default: 0 },
  risk_score: { type: Number, default: 0 },
  shap_explanation: { type: Object },
  reasons: [{ type: String }]
});

const AlertSchema = new mongoose.Schema({
  alert_id: { type: String, required: true, unique: true },
  transaction_id: { type: String, required: true },
  risk_score: { type: Number, required: true },
  level: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true },
  status: { type: String, enum: ['New', 'Investigating', 'Dismissed', 'Escalated'], default: 'New' },
  createdAt: { type: Date, default: Date.now }
});

const CaseSchema = new mongoose.Schema({
  case_id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  assigned_to: { type: String, default: null }, // Username of Investigator
  status: { type: String, enum: ['Open', 'Under Review', 'Closed'], default: 'Open' },
  alerts: [{ type: String }], // Alert IDs
  notes: [{
    investigator: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
  }],
  evidence: [{
    filename: String,
    originalName: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const AuditLogSchema = new mongoose.Schema({
  username: { type: String, required: true },
  role: { type: String, required: true },
  action: { type: String, required: true },
  ip_address: { type: String },
  details: { type: String },
  timestamp: { type: Date, default: Date.now }
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

// JSON File Fallback DB Class Mocking Mongoose
class FileModel {
  constructor(collectionName, schema) {
    this.name = collectionName;
    this.filePath = path.join(dataDir, `${collectionName}.json`);
    this.schema = schema;
    
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

  async find(filter = {}) {
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
          // Handle mongoose $gte, $lte, $in, $regex operators
          const op = Object.keys(filter[key])[0];
          const val = filter[key][op];
          if (op === '$gte' && item[key] < val) return false;
          if (op === '$lte' && item[key] > val) return false;
          if (op === '$in' && (!Array.isArray(val) || !val.includes(item[key]))) return false;
          if (op === '$regex') {
            const regex = new RegExp(val, filter[key].$options || '');
            if (!regex.test(item[key])) return false;
          }
        } else if (item[key] !== filter[key]) {
          return false;
        }
      }
      return true;
    });
  }

  async findOne(filter = {}) {
    const results = await this.find(filter);
    return results[0] || null;
  }

  async findById(id) {
    const field = this.name === 'User' ? '_id' : 
      (this.name === 'Transaction' ? 'transaction_id' : 
      (this.name === 'Alert' ? 'alert_id' : 
      (this.name === 'Case' ? 'case_id' : 
      (this.name === 'UploadMappingTemplate' ? 'template_id' :
      (this.name === 'UploadJob' ? 'upload_id' : '_id')))));
    const data = this._read();
    return data.find(item => item[field] === id || item._id === id) || null;
  }

  async create(doc) {
    const data = this._read();
    const newDoc = { ...doc };
    
    // Add IDs and dates if not present
    if (!newDoc._id) {
      newDoc._id = Math.random().toString(36).substring(2, 11);
    }
    if (!newDoc.createdAt) {
      newDoc.createdAt = new Date().toISOString();
    }
    if (this.schema.updatedAt && !newDoc.updatedAt) {
      newDoc.updatedAt = new Date().toISOString();
    }
    
    data.push(newDoc);
    this._write(data);
    return newDoc;
  }

  async insertMany(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return [];
    const data = this._read();
    const inserted = [];
    const now = new Date().toISOString();

    for (const doc of docs) {
      const newDoc = { ...doc };
      if (!newDoc._id) {
        newDoc._id = Math.random().toString(36).substring(2, 11);
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
    const field = this.name === 'User' ? '_id' : 
      (this.name === 'Transaction' ? 'transaction_id' : 
      (this.name === 'Alert' ? 'alert_id' : 
      (this.name === 'Case' ? 'case_id' : 
      (this.name === 'UploadMappingTemplate' ? 'template_id' :
      (this.name === 'UploadJob' ? 'upload_id' : '_id')))));
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

  async countDocuments(filter = {}) {
    const results = await this.find(filter);
    return results.length;
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
}

// Setup models holder
let User, Transaction, Alert, Case, AuditLog, UploadMappingTemplate, UploadJob;

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
    Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);
    Case = mongoose.models.Case || mongoose.model('Case', CaseSchema);
    AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
    UploadMappingTemplate = mongoose.models.UploadMappingTemplate || mongoose.model('UploadMappingTemplate', UploadMappingTemplateSchema);
    UploadJob = mongoose.models.UploadJob || mongoose.model('UploadJob', UploadJobSchema);

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
    Alert = new FileModel('Alert', AlertSchema);
    Case = new FileModel('Case', CaseSchema);
    AuditLog = new FileModel('AuditLog', AuditLogSchema);
    UploadMappingTemplate = new FileModel('UploadMappingTemplate', UploadMappingTemplateSchema);
    UploadJob = new FileModel('UploadJob', UploadJobSchema);
    
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
          
          // Calculate calibrated local risk score for seeder
          let score = 5;
          const reasons = [];
          const shap = [];

          // INR thresholds matching ml-service engineer_features()
          if (txData.amount >= 820000 && txData.amount <= 999000) {
            score += 40;
            reasons.push(`₹${txData.amount.toLocaleString('en-IN')} structured in 82-99% band of India's CTR threshold — textbook smurfing to evade RBI reporting`);
            shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
          } else if (txData.amount >= 5000000) {
            score += 40;
            reasons.push(`Exceptionally large transfer ₹${txData.amount.toLocaleString('en-IN')} — exceeds ₹50L retail baseline; consistent with integration stage of money laundering`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.40, actual_value: 1 });
          } else if (txData.amount >= 1000000) {
            score += 30;
            reasons.push(`High-value transfer ₹${txData.amount.toLocaleString('en-IN')} exceeds ₹10L — triggers STR review under PMLA 2002`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.30, actual_value: 1 });
          } else if (txData.amount >= 500000) {
            score += 18;
            reasons.push(`Elevated transfer ₹${txData.amount.toLocaleString('en-IN')} — above 95th percentile for retail; warrants enhanced due diligence`);
            shap.push({ feature: 'is_large_amount', shap_value: 0.18, actual_value: 1 });
          } else {
            shap.push({ feature: 'amount_near_threshold', shap_value: -0.05, actual_value: 0 });
            shap.push({ feature: 'is_large_amount', shap_value: -0.05, actual_value: 0 });
          }
          shap.push({ feature: 'amount', shap_value: txData.amount > 250000 ? 0.1 : -0.1, actual_value: txData.amount });
          
          const highRiskCountries = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU'];
          const COUNTRY_NAMES = {
            KY: 'Cayman Islands (offshore tax haven)',
            PA: 'Panama (FATF grey-listed)',
            AE: 'UAE / Dubai (high cash-intensity hub)',
            RU: 'Russia (sanctions-listed)',
            BS: 'Bahamas (offshore financial centre)',
            LU: 'Luxembourg (opaque holding jurisdiction)',
          };
          if (highRiskCountries.includes(txData.country)) {
            score += 30;
            reasons.push(`Transaction routed through ${COUNTRY_NAMES[txData.country] || txData.country} — FATF-flagged jurisdiction; EDD required per FEMA & PMLA`);
            shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_high_risk_country', shap_value: -0.1, actual_value: 0 });
          }
          
          if (['Crypto Transfer', 'Cash Deposit', 'RTGS'].includes(txData.payment_method)) {
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
          if (hour >= 23 || hour <= 4) {
            score += 10;
            reasons.push('Late-night transaction timing');
            shap.push({ feature: 'is_night', shap_value: 0.10, actual_value: 1 });
          } else {
            shap.push({ feature: 'is_night', shap_value: -0.05, actual_value: 0 });
          }
          
          if (txData.category === 'Transfer' && (highRiskCountries.includes(txData.country) || ['Crypto Transfer', 'Cash Deposit'].includes(txData.payment_method))) {
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
          let alertLevel = null;
          if (savedTx.risk_score >= 80) alertLevel = 'Critical';
          else if (savedTx.risk_score >= 60) alertLevel = 'High';
          else if (savedTx.risk_score >= 35) alertLevel = 'Medium';
          else if (savedTx.risk_score >= 20) alertLevel = 'Low';

          if (alertLevel) {
            const alertId = 'ALT' + Math.floor(100000 + Math.random() * 900000);
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
    get Alert() { return Alert; },
    get Case() { return Case; },
    get AuditLog() { return AuditLog; },
    get UploadMappingTemplate() { return UploadMappingTemplate; },
    get UploadJob() { return UploadJob; }
  }
};
