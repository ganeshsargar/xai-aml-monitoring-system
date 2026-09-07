const axios = require('axios');

const API_URL = 'http://localhost:5050/api';
const ML_URL = 'http://localhost:5000';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING AUTOMATED QA API VERIFICATION TESTS');
  console.log('====================================================');

  const results = {
    auth: { pass: 0, fail: 0, details: [] },
    transactions: { pass: 0, fail: 0, details: [] },
    alerts: { pass: 0, fail: 0, details: [] },
    cases: { pass: 0, fail: 0, details: [] },
    admin: { pass: 0, fail: 0, details: [] },
    ml: { pass: 0, fail: 0, details: [] }
  };

  let adminToken = '';
  let investigatorToken = '';
  let auditorToken = '';

  // Helper assertions
  function assert(category, testName, condition, info = '') {
    if (condition) {
      results[category].pass++;
      console.log(`[PASS] [${category.toUpperCase()}] ${testName}`);
    } else {
      results[category].fail++;
      console.error(`[FAIL] [${category.toUpperCase()}] ${testName} - ${info}`);
      results[category].details.push({ testName, info });
    }
  }

  // PHASE 1: ML Health Check
  try {
    const health = await axios.get(`${ML_URL}/health`);
    assert('ml', 'ML Health Endpoint Response', health.status === 200 && health.data.status === 'healthy');
  } catch (err) {
    assert('ml', 'ML Health Endpoint Response', false, err.message);
  }

  // PHASE 2: Authentication & RBAC
  // Test Login Admin
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    assert('auth', 'Admin Login Successful', loginRes.status === 200 && loginRes.data.success === true);
    adminToken = loginRes.data.token;
  } catch (err) {
    assert('auth', 'Admin Login Successful', false, err.message);
  }

  // Test Login Investigator
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      username: 'investigator',
      password: 'investigator123'
    });
    assert('auth', 'Investigator Login Successful', loginRes.status === 200 && loginRes.data.success === true);
    investigatorToken = loginRes.data.token;
  } catch (err) {
    assert('auth', 'Investigator Login Successful', false, err.message);
  }

  // Test Login Auditor
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      username: 'auditor',
      password: 'auditor123'
    });
    assert('auth', 'Auditor Login Successful', loginRes.status === 200 && loginRes.data.success === true);
    auditorToken = loginRes.data.token;
  } catch (err) {
    assert('auth', 'Auditor Login Successful', false, err.message);
  }

  // Test Route Protection / Access Controls
  // Admin only route accessed by Investigator (should fail)
  try {
    await axios.get(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${investigatorToken}` }
    });
    assert('auth', 'Investigator blocked from Admin User List', false, 'Should have returned 403');
  } catch (err) {
    assert('auth', 'Investigator blocked from Admin User List', err.response && err.response.status === 403, err.message);
  }

  // Admin only route accessed by Admin (should pass)
  try {
    const usersRes = await axios.get(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert('auth', 'Admin can fetch User List', usersRes.status === 200 && usersRes.data.success === true);
  } catch (err) {
    assert('auth', 'Admin can fetch User List', false, err.message);
  }

  // Invalid Token Check
  try {
    await axios.get(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer invalid-token-xyz` }
    });
    assert('auth', 'Invalid token is rejected', false, 'Should have returned 403 or 401');
  } catch (err) {
    assert('auth', 'Invalid token is rejected', err.response && (err.response.status === 403 || err.response.status === 401), err.message);
  }

  // Missing Token Check
  try {
    await axios.get(`${API_URL}/admin/users`);
    assert('auth', 'Missing token is rejected', false, 'Should have returned 401');
  } catch (err) {
    assert('auth', 'Missing token is rejected', err.response && err.response.status === 401, err.message);
  }

  // PHASE 3: Transactions & Search/Filters/Pagination
  let sampleTxId = '';
  let sampleTxDbId = '';

  try {
    const txRes = await axios.get(`${API_URL}/transactions?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert('transactions', 'Get Transactions returns 200 with pagination', txRes.status === 200 && txRes.data.success === true && Array.isArray(txRes.data.data));
    if (txRes.data.data.length > 0) {
      sampleTxId = txRes.data.data[0].transaction_id;
      sampleTxDbId = txRes.data.data[0]._id;
    }
  } catch (err) {
    assert('transactions', 'Get Transactions returns 200 with pagination', false, err.message);
  }

  // Transaction Search
  if (sampleTxId) {
    try {
      const searchRes = await axios.get(`${API_URL}/transactions?search=${sampleTxId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert('transactions', 'Transaction Search by ID works', searchRes.status === 200 && searchRes.data.success === true && searchRes.data.data.some(tx => tx.transaction_id === sampleTxId));
    } catch (err) {
      assert('transactions', 'Transaction Search by ID works', false, err.message);
    }
  }

  // Transaction Create (Investigator)
  let newTxId = 'TXTEST' + Math.floor(100000 + Math.random() * 900000);
  try {
    const createRes = await axios.post(`${API_URL}/transactions`, {
      transaction_id: newTxId,
      sender_account: 'ACC10001',
      sender_name: 'Customer_10001',
      receiver_account: 'ACC10002',
      receiver_name: 'Customer_10002',
      amount: 950000.00, // structurally risky in INR (just below 10L CTR)
      currency: 'INR',
      country: 'KY', // High risk country
      payment_method: 'Crypto Transfer',
      category: 'Transfer'
    }, {
      headers: { Authorization: `Bearer ${investigatorToken}` }
    });
    assert('transactions', 'Create Transaction (with Auto Alert triggers)', createRes.status === 201 && createRes.data.success === true && createRes.data.data.risk_score >= 50, `status: ${createRes.status}, success: ${createRes.data?.success}, score: ${createRes.data?.data?.risk_score}`);
  } catch (err) {
    assert('transactions', 'Create Transaction (with Auto Alert triggers)', false, err.response ? JSON.stringify(err.response.data) : err.message);
  }

  // Auditor should be blocked from creating transactions
  try {
    await axios.post(`${API_URL}/transactions`, {
      sender_account: 'ACC10001',
      receiver_account: 'ACC10002',
      amount: 100,
      country: 'US'
    }, {
      headers: { Authorization: `Bearer ${auditorToken}` }
    });
    assert('transactions', 'Auditor blocked from creating transactions', false, 'Should have returned 403');
  } catch (err) {
    assert('transactions', 'Auditor blocked from creating transactions', err.response && err.response.status === 403, err.message);
  }

  // PHASE 4: Alerts
  let sampleAlertId = '';
  let sampleAlertDbId = '';
  try {
    const alertsRes = await axios.get(`${API_URL}/alerts`, {
      headers: { Authorization: `Bearer ${investigatorToken}` }
    });
    assert('alerts', 'Get Alerts list successfully', alertsRes.status === 200 && alertsRes.data.success === true && Array.isArray(alertsRes.data.data));
    const pendingAlerts = alertsRes.data.data.filter(a => a.status === 'New');
    if (pendingAlerts.length > 0) {
      sampleAlertId = pendingAlerts[0].alert_id;
      sampleAlertDbId = pendingAlerts[0]._id;
    }
  } catch (err) {
    assert('alerts', 'Get Alerts list successfully', false, err.message);
  }

  // Update alert status (Investigator)
  if (sampleAlertId) {
    try {
      const updateAlertRes = await axios.put(`${API_URL}/alerts/${sampleAlertId}`, {
        status: 'Investigating'
      }, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      assert('alerts', 'Update Alert status successfully', updateAlertRes.status === 200 && updateAlertRes.data.success === true);
    } catch (err) {
      assert('alerts', 'Update Alert status successfully', false, err.message);
    }
  }

  // PHASE 5: Case Manager
  let sampleCaseDbId = '';
  if (sampleAlertId) {
    try {
      const createCaseRes = await axios.post(`${API_URL}/cases`, {
        case_id: 'CAS' + Math.floor(100000 + Math.random() * 900000),
        title: 'Suspicious Structuring Test Case',
        description: 'Auto generated investigation case from QA test.',
        alerts: [sampleAlertId],
        priority: 'High'
      }, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      assert('cases', 'Create Investigation Case successfully', createCaseRes.status === 201 && createCaseRes.data.success === true);
      sampleCaseDbId = createCaseRes.data.data.case_id;
    } catch (err) {
      assert('cases', 'Create Investigation Case successfully', false, err.message);
    }
  }

  // Fetch Cases list
  try {
    const casesRes = await axios.get(`${API_URL}/cases`, {
      headers: { Authorization: `Bearer ${auditorToken}` } // Auditor can read cases
    });
    assert('cases', 'Fetch Case List successfully', casesRes.status === 200 && casesRes.data.success === true && Array.isArray(casesRes.data.data));
  } catch (err) {
    assert('cases', 'Fetch Case List successfully', false, err.message);
  }

  // Add Case Note (Investigator)
  if (sampleCaseDbId) {
    try {
      const noteRes = await axios.post(`${API_URL}/cases/${sampleCaseDbId}/notes`, {
        text: 'This looks like money layering. Escalating.'
      }, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      assert('cases', 'Add Note to Case successfully', noteRes.status === 200 && noteRes.data.success === true);
    } catch (err) {
      assert('cases', 'Add Note to Case successfully', false, err.message);
    }
  }

  // PHASE 6: Admin Panel & System Stats & Audit Logs
  try {
    const statsRes = await axios.get(`${API_URL}/admin/system-stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert('admin', 'Admin fetch system-stats successfully', statsRes.status === 200 && statsRes.data.success === true && statsRes.data.data.counts.transactions > 0);
  } catch (err) {
    assert('admin', 'Admin fetch system-stats successfully', false, err.message);
  }

  try {
    const logsRes = await axios.get(`${API_URL}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert('admin', 'Admin fetch audit-logs successfully', logsRes.status === 200 && logsRes.data.success === true && logsRes.data.data.length > 0);
  } catch (err) {
    assert('admin', 'Admin fetch audit-logs successfully', false, err.message);
  }

  // Print final results
  console.log('\n====================================================');
  console.log('AUTOMATED QA TEST SUMMARY');
  console.log('====================================================');
  let hasFailures = false;
  for (const cat in results) {
    console.log(`${cat.toUpperCase()}: ${results[cat].pass} PASS, ${results[cat].fail} FAIL`);
    if (results[cat].fail > 0) hasFailures = true;
  }
  console.log('====================================================');
  process.exit(hasFailures ? 1 : 0);
}

runTests();
