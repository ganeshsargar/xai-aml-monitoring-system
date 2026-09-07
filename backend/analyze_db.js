require('dotenv').config();
const mongoose = require('mongoose');

async function analyze() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const totalTx = await db.collection('transactions').countDocuments();
  const launderingTx = await db.collection('transactions').countDocuments({ is_laundering: 1 });
  const legitimateTx = await db.collection('transactions').countDocuments({ is_laundering: 0 });

  const critical = await db.collection('alerts').countDocuments({ level: 'Critical' });
  const high = await db.collection('alerts').countDocuments({ level: 'High' });
  const medium = await db.collection('alerts').countDocuments({ level: 'Medium' });
  const low = await db.collection('alerts').countDocuments({ level: 'Low' });
  const totalAlerts = await db.collection('alerts').countDocuments();

  console.log('--- TRANSACTION STATS ---');
  console.log({ totalTx, launderingTx, legitimateTx });

  console.log('--- ALERT LEVEL STATS ---');
  console.log({ Critical: critical, High: high, Medium: medium, Low: low, totalAlerts });

  // Score distribution for legitimate transactions
  const legitHighRisk = await db.collection('transactions').countDocuments({
    is_laundering: 0,
    risk_score: { $gte: 75 }
  });
  console.log(`Legitimate transactions falsely marked Critical (score >= 75): ${legitHighRisk}`);

  // Sample laundering transactions
  const launderingSamples = await db.collection('transactions').find({ is_laundering: 1 }).limit(10).toArray();
  console.log('\n--- SAMPLE LAUNDERING TRANSACTIONS (Total: ' + launderingTx + ') ---');
  for (const s of launderingSamples) {
    console.log({
      id: s.transaction_id,
      sender: s.sender_account,
      sender_name: s.sender_name,
      amount: s.amount,
      method: s.payment_method,
      country: s.country,
      score: s.risk_score,
      reasons: s.reasons,
      timestamp: s.timestamp
    });
  }

  // Check cases
  const cases = await db.collection('cases').find({}).toArray();
  console.log('\n--- CASES ---', cases.length);
  for (const c of cases) {
    console.log({ case_id: c.case_id, title: c.title, status: c.status, alerts: c.alerts });
  }

  await mongoose.disconnect();
}

analyze().catch(console.error);
