/**
 * MongoDB Atlas Connection Diagnostic Tool
 * Run with: node test_atlas_connection.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function testConnection() {
  const uri = process.env.MONGODB_URI;

  console.log('====================================================');
  console.log('      MONGODB ATLAS CONNECTION DIAGNOSTIC TOOL       ');
  console.log('====================================================');

  if (!uri) {
    console.error('\n❌ ERROR: MONGODB_URI is not defined in backend/.env!');
    console.log('👉 Please open backend/.env and set MONGODB_URI to your Atlas connection string.');
    process.exit(1);
  }

  const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`\nConfigured URI: ${maskedUri}`);

  const isAtlas = uri.startsWith('mongodb+srv://') || uri.includes('.mongodb.net');
  console.log(`Cluster Type:   ${isAtlas ? 'MongoDB Atlas (Cloud)' : 'Local / Custom MongoDB'}`);
  console.log('\nAttempting connection (timeout: 15 seconds)...');

  const startTime = Date.now();

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ SUCCESS: Connected to MongoDB in ${elapsed}s!`);

    // Ping test
    const adminDb = mongoose.connection.db.admin();
    const pingResult = await adminDb.ping();
    console.log(`✅ Ping check: OK (cluster responded: ${JSON.stringify(pingResult)})`);

    // List collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`✅ Database name: "${mongoose.connection.db.databaseName}"`);
    console.log(`✅ Existing collections (${collections.length}):`, collections.map(c => c.name).join(', ') || '(none yet - will be auto-created)');

    console.log('\n🎉 Your MongoDB Atlas configuration is 100% ready!');
    console.log('====================================================\n');
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ FAILED to connect after ${elapsed}s: ${err.message}\n`);

    console.log('---------------- DIAGNOSTIC TIPS -------------------');
    if (err.message.includes('bad auth') || err.message.includes('Authentication failed')) {
      console.log('🔑 Authentication Failed:');
      console.log('   - Check the Database Username and Password in backend/.env.');
      console.log('   - Note: This is the Database User password created under "Database Access",');
      console.log('     NOT your personal MongoDB Atlas account login password.');
      console.log('   - If your password contains special characters (@, :, #, %, etc.),');
      console.log('     they must be URL-encoded (e.g., @ becomes %40).');
    } else if (err.name === 'MongoServerSelectionError' || err.message.includes('timed out') || err.message.includes('ENOTFOUND')) {
      console.log('🌐 Network / IP Access Blocked:');
      console.log('   - In MongoDB Atlas, go to "Network Access" in the left sidebar.');
      console.log('   - Click "Add IP Address" and select "Allow Access From Anywhere" (0.0.0.0/0).');
      console.log('   - Wait 1-2 minutes for the rule to become Active, then try again.');
    } else if (err.message.includes('Invalid scheme') || err.message.includes('URI')) {
      console.log('📝 Connection String Format Issue:');
      console.log('   - Atlas connection strings should start with "mongodb+srv://".');
      console.log('   - Example: mongodb+srv://myUser:myPassword@cluster0.abcde.mongodb.net/aml_db?retryWrites=true&w=majority');
    } else {
      console.log(`   Error details: ${err.stack || err.message}`);
    }
    console.log('----------------------------------------------------\n');
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

testConnection();
