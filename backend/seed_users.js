/**
 * One-time seed script: creates default users in MongoDB if they don't exist.
 * Run with: node seed_users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name:     { type: String, required: true },
  role:     { type: String, enum: ['Admin', 'Investigator', 'Auditor'], required: true },
  createdAt:{ type: Date, default: Date.now }
});

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aml_db';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('Connected to MongoDB.');

  const User = mongoose.model('User', UserSchema);

  const accounts = [
    { username: 'admin',        password: 'admin123',        name: 'System Admin',       role: 'Admin' },
    { username: 'investigator', password: 'investigator123', name: 'Chief Investigator',  role: 'Investigator' },
    { username: 'auditor',      password: 'auditor123',      name: 'Compliance Auditor',  role: 'Auditor' },
  ];

  for (const acc of accounts) {
    const existing = await User.findOne({ username: acc.username });
    if (existing) {
      console.log(`User '${acc.username}' already exists — skipping.`);
    } else {
      const hashed = await bcrypt.hash(acc.password, 10);
      await User.create({ ...acc, password: hashed });
      console.log(`Created user '${acc.username}' with role '${acc.role}'.`);
    }
  }

  await mongoose.disconnect();
  console.log('Seeding complete.');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
