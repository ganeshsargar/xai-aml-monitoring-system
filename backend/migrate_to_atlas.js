/**
 * Data Migration Tool: Local MongoDB -> MongoDB Atlas
 * 
 * Usage:
 *   node migrate_to_atlas.js
 * 
 * It reads the local MongoDB at mongodb://127.0.0.1:27017/aml_db
 * and transfers all collections (users, transactions, alerts, cases, auditlogs)
 * to the Atlas MONGODB_URI configured in backend/.env.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

const LOCAL_URI = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/aml_db';
const TARGET_URI = process.argv[2] || process.env.MONGODB_URI;

async function migrate() {
  console.log('====================================================');
  console.log('       FUNDTRACE AI - ATLAS MIGRATION TOOL          ');
  console.log('====================================================');

  if (!TARGET_URI || TARGET_URI.includes('127.0.0.1') || TARGET_URI.includes('localhost')) {
    console.error('\n❌ ERROR: Target URI is set to local MongoDB.');
    console.log('👉 Please set MONGODB_URI in backend/.env to your MongoDB Atlas connection string,');
    console.log('   or pass it as an argument: node migrate_to_atlas.js "mongodb+srv://..."\n');
    process.exit(1);
  }

  const maskedTarget = TARGET_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`Source: ${LOCAL_URI}`);
  console.log(`Target: ${maskedTarget}\n`);

  console.log('Connecting to Source (Local MongoDB)...');
  const sourceConn = await mongoose.createConnection(LOCAL_URI, {
    serverSelectionTimeoutMS: 5000
  }).asPromise();
  console.log(' Connected to Source.');

  console.log('Connecting to Target (MongoDB Atlas)...');
  const targetConn = await mongoose.createConnection(TARGET_URI, {
    serverSelectionTimeoutMS: 15000
  }).asPromise();
  console.log(' Connected to Target.\n');

  const collections = ['users', 'transactions', 'alerts', 'cases', 'auditlogs'];

  for (const colName of collections) {
    try {
      const sourceCol = sourceConn.collection(colName);
      const targetCol = targetConn.collection(colName);

      const docs = await sourceCol.find({}).toArray();
      console.log(`Migrating "${colName}" (${docs.length} documents)...`);

      if (docs.length > 0) {
        // Clear destination collection or upsert
        for (const doc of docs) {
          const filter = doc.transaction_id ? { transaction_id: doc.transaction_id }
                       : doc.alert_id ? { alert_id: doc.alert_id }
                       : doc.case_id ? { case_id: doc.case_id }
                       : doc.username ? { username: doc.username }
                       : { _id: doc._id };
          await targetCol.updateOne(filter, { $set: doc }, { upsert: true });
        }
        console.log(`  Successfully transferred/upserted ${docs.length} documents in "${colName}".`);
      } else {
        console.log(`  No documents found in local "${colName}".`);
      }
    } catch (colErr) {
      console.warn(`  Warning while migrating ${colName}: ${colErr.message}`);
    }
  }

  await sourceConn.close();
  await targetConn.close();

  console.log('\n====================================================');
  console.log('🎉 Migration completed successfully to MongoDB Atlas!');
  console.log('====================================================\n');
}

migrate().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
