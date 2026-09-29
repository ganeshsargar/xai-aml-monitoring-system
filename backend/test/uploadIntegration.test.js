const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app } = require('../server');
const { connectDB, models } = require('../src/config/db');

let server;
let baseUrl;
let token;

test.before(async () => {
  await connectDB();

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });

  // Authenticate as admin to get JWT token
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  assert.equal(loginRes.status, 200, 'Admin login should succeed');
  assert.ok(loginData.token, 'Token should be returned');
  token = loginData.token;
});

test.after(async () => {
  if (server) {
    server.close();
  }
});

test('Integration Test 1: Upload CSV with non-canonical headers detects headers & staging job', async () => {
  const csvContent = 
    `Txn_Ref_No,Booking_Date,Debtor_Acc,Creditor_Acc,Val,CCY,Payer,Payee,Origin_Jurisdiction,Channel\n` +
    `TX_INT_001,2026-05-10T10:00:00Z,ACC_DEBTOR_99,ACC_CREDITOR_88,450000,INR,Alice Sender,Bob Receiver,IN,UPI\n` +
    `TX_INT_002,2026-05-10T11:00:00Z,ACC_DEBTOR_99,ACC_CREDITOR_77,880000,INR,Alice Sender,Charlie Receiver,IN,RTGS\n`;

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'bank_export_alpha.csv');

  const res = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const data = await res.json();
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.ok(data.upload_id, 'upload_id should be present');
  assert.ok(Array.isArray(data.headers), 'headers should be an array');
  assert.equal(data.headers.length, 10, 'Expected 10 headers');
  assert.ok(data.headers.includes('Txn_Ref_No'));
  assert.ok(data.headers.includes('Debtor_Acc'));
  assert.ok(data.headers.includes('Val'));
  assert.ok(Array.isArray(data.preview_rows), 'preview_rows should be an array');
  assert.equal(data.preview_rows.length, 2);
  assert.equal(data.auto_applied_template, null, 'No template should be auto-applied for first-time format');

  // Verify UploadJob was saved in DB
  const job = await models.UploadJob.findOne({ upload_id: data.upload_id });
  assert.ok(job, 'UploadJob must exist in DB');
  assert.equal(job.status, 'pending_mapping');
});

test('Integration Test 2: Suggested mapping endpoint accurately suggests canonical fields', async () => {
  const csvContent = 
    `Txn_Ref_No,Booking_Date,Debtor_Acc,Creditor_Acc,Val,CCY,Payer,Payee,Origin_Jurisdiction,Channel\n` +
    `TX_INT_003,2026-05-10T12:00:00Z,ACC_11,ACC_22,120000,INR,Payer A,Payee B,IN,UPI\n`;

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'bank_export_beta.csv');

  const uploadRes = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();
  const uploadId = uploadData.upload_id;

  const suggRes = await fetch(`${baseUrl}/uploads/${uploadId}/suggested-mapping`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const suggData = await suggRes.json();

  assert.equal(suggRes.status, 200);
  assert.ok(Array.isArray(suggData.suggestions));

  const mappingObj = {};
  for (const s of suggData.suggestions) {
    if (s.suggested_raw_header) {
      mappingObj[s.canonical_field] = s.suggested_raw_header;
    }
  }

  assert.equal(mappingObj.transaction_id, 'Txn_Ref_No');
  assert.equal(mappingObj.timestamp, 'Booking_Date');
  assert.equal(mappingObj.sender_account, 'Debtor_Acc');
  assert.equal(mappingObj.receiver_account, 'Creditor_Acc');
  assert.equal(mappingObj.amount, 'Val');
  assert.equal(mappingObj.currency, 'CCY');
  assert.equal(suggData.missing_required.length, 0, 'All required fields should have suggestions');
});

test('Integration Test 3: Reject mapping when a REQUIRED canonical field is missing', async () => {
  const csvContent = `Txn_Ref_No,Debtor_Acc,Val\nTX1,ACC1,500\n`;
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'incomplete.csv');

  const uploadRes = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();
  const uploadId = uploadData.upload_id;

  // Attempt to confirm mapping without receiver_account, timestamp, currency
  const confirmRes = await fetch(`${baseUrl}/uploads/${uploadId}/mapping`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mapping: {
        transaction_id: 'Txn_Ref_No',
        sender_account: 'Debtor_Acc',
        amount: 'Val'
        // Missing timestamp, receiver_account, currency
      }
    })
  });

  const confirmData = await confirmRes.json();
  assert.equal(confirmRes.status, 400, 'Should reject with 400 status');
  assert.equal(confirmData.success, false);
  assert.ok(confirmData.error.includes('Required canonical fields must be mapped'));
  assert.ok(confirmData.missing_required.includes('timestamp'));
  assert.ok(confirmData.missing_required.includes('receiver_account'));
  assert.ok(confirmData.missing_required.includes('currency'));
});

test('Integration Test 4: Reject mapping when two canonical fields map to the same raw column', async () => {
  const csvContent = `ColA,ColB,ColC,ColD,ColE,ColF\n1,2,3,4,5,6\n`;
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'conflict.csv');

  const uploadRes = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();
  const uploadId = uploadData.upload_id;

  // Both sender_account and receiver_account point to ColC
  const confirmRes = await fetch(`${baseUrl}/uploads/${uploadId}/mapping`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mapping: {
        transaction_id: 'ColA',
        timestamp: 'ColB',
        sender_account: 'ColC',
        receiver_account: 'ColC', // CONFLICT: same raw column
        amount: 'ColD',
        currency: 'ColE'
      }
    })
  });

  const confirmData = await confirmRes.json();
  assert.equal(confirmRes.status, 400);
  assert.equal(confirmData.success, false);
  assert.ok(confirmData.error.includes('Duplicate column assignment') || confirmData.error.includes('cannot map to the same raw column'));
});

test('Integration Test 5: Confirm manual mapping with save_as_template persists data correctly', async () => {
  const uniqueTxId = 'TX_TRANSLATED_' + Date.now();
  const csvContent = 
    `Txn_Ref_No,Booking_Date,Debtor_Acc,Creditor_Acc,Val,CCY,Payer,Payee,Origin_Jurisdiction,Channel\n` +
    `${uniqueTxId},2026-05-15T14:30:00Z,ACC_SRC_777,ACC_DEST_888,850000,INR,Payer Corporate,Payee Trust,KY,RTGS\n`;

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'custom_banking_export.csv');

  const uploadRes = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();
  const uploadId = uploadData.upload_id;

  const mappingPayload = {
    mapping: {
      transaction_id: 'Txn_Ref_No',
      timestamp: 'Booking_Date',
      sender_account: 'Debtor_Acc',
      receiver_account: 'Creditor_Acc',
      amount: 'Val',
      currency: 'CCY',
      sender_name: 'Payer',
      receiver_name: 'Payee',
      country: 'Origin_Jurisdiction',
      payment_method: 'Channel'
    },
    save_as_template: true,
    template_name: 'Core Banking Standard Export'
  };

  const confirmRes = await fetch(`${baseUrl}/uploads/${uploadId}/mapping`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mappingPayload)
  });

  const confirmData = await confirmRes.json();
  assert.equal(confirmRes.status, 200, `Expected 200, got ${confirmRes.status}: ${JSON.stringify(confirmData)}`);
  assert.equal(confirmData.success, true);
  assert.ok(confirmData.processed >= 1, 'At least 1 transaction should be processed');
  assert.equal(confirmData.template_saved, true, 'Template should be saved');

  // Verify transaction in DB has correctly translated canonical field values
  const storedTx = await models.Transaction.findOne({ transaction_id: uniqueTxId });
  assert.ok(storedTx, 'Stored transaction must exist in DB');
  assert.equal(storedTx.sender_account, 'ACC_SRC_777');
  assert.equal(storedTx.receiver_account, 'ACC_DEST_888');
  assert.equal(storedTx.amount, 850000);
  assert.equal(storedTx.currency, 'INR');
  assert.equal(storedTx.country, 'KY');
  assert.equal(storedTx.payment_method, 'RTGS');
  assert.ok(storedTx.risk_score > 0, 'Risk score should be calculated');

  // Verify UploadJob record was updated
  const job = await models.UploadJob.findOne({ upload_id: uploadId });
  assert.equal(job.status, 'completed');
  assert.ok(job.processed_count >= 1);
});

test('Integration Test 6: Second upload with exact same headers auto-applies saved template', async () => {
  const csvContent = 
    `Txn_Ref_No,Booking_Date,Debtor_Acc,Creditor_Acc,Val,CCY,Payer,Payee,Origin_Jurisdiction,Channel\n` +
    `TX_AUTO_001,2026-05-16T09:00:00Z,ACC_SRC_1,ACC_DEST_2,50000,INR,Alice,Bob,IN,UPI\n`;

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'second_banking_export.csv');

  const uploadRes = await fetch(`${baseUrl}/uploads/detect-headers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();

  assert.equal(uploadRes.status, 200);
  assert.ok(uploadData.auto_applied_template, 'Auto applied template should NOT be null');
  assert.equal(uploadData.auto_applied_template.template_name, 'Core Banking Standard Export');
  assert.equal(uploadData.auto_applied_template.mapping.amount, 'Val');
  assert.equal(uploadData.auto_applied_template.mapping.sender_account, 'Debtor_Acc');
  assert.equal(uploadData.auto_applied_template.mapping.receiver_account, 'Creditor_Acc');
});

test('Integration Test 7: Manage mapping templates (list and delete)', async () => {
  // List templates
  const listRes = await fetch(`${baseUrl}/uploads/mapping-templates`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listData.templates));
  const found = listData.templates.find(t => t.template_name === 'Core Banking Standard Export');
  assert.ok(found, 'Saved template should be in list');

  // Delete template
  const deleteRes = await fetch(`${baseUrl}/uploads/mapping-templates/${found.template_id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  const deleteData = await deleteRes.json();
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteData.success, true);

  // Verify deleted
  const reListRes = await fetch(`${baseUrl}/uploads/mapping-templates`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const reListData = await reListRes.json();
  const reFound = reListData.templates.find(t => t.template_id === found.template_id);
  assert.equal(reFound, undefined, 'Template should no longer exist');
});
