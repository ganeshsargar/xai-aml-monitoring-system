const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { 
  validateBody, 
  createTransactionSchema, 
  adjustTransactionSchema, 
  statusEventSchema, 
  bulkAssignAlertsSchema, 
  bulkDismissAlertsSchema, 
  dispositionAlertSchema, 
  createCaseSchema, 
  addCaseNoteSchema, 
  updateCaseStatusSchema, 
  registerSchema, 
  loginSchema, 
  screeningDecisionSchema 
} = require('../middleware/validate');

const auth = require('../controllers/authController');
const transactions = require('../controllers/transactionController');
const alerts = require('../controllers/alertController');
const cases = require('../controllers/caseController');
const admin = require('../controllers/adminController');
const uploads = require('../controllers/uploadController');
const dashboard = require('../controllers/dashboardController');

const router = express.Router();

// ==========================================
// 0. Dashboard & Operational KPI Routes
// ==========================================
router.get('/dashboard/kpis', authenticateToken, dashboard.getDashboardKPIs);
router.get('/dashboard/export-csv', authenticateToken, dashboard.exportDashboardCSV);

// Configure Multer for File Uploads (CSV Imports & Case Evidence)
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// ==========================================
// 1. Authentication Routes
// ==========================================
router.post('/auth/register', validateBody(registerSchema), auth.register); // Allowed public self-reg or admin creation
router.post('/auth/login', validateBody(loginSchema), auth.login);
router.post('/auth/logout', authenticateToken, auth.logout);
router.get('/auth/profile', authenticateToken, auth.getProfile);
router.put('/auth/profile', authenticateToken, auth.updateProfile);

// ==========================================
// 2. Transaction Module Routes (Immutable + Adjustments + Events)
// ==========================================
router.get('/transactions', authenticateToken, transactions.getTransactions);
router.get('/transactions/:id/counterfactual', authenticateToken, transactions.getCounterfactualExplanation);
router.get('/transactions/:id/events', authenticateToken, transactions.getTransactionEvents);
router.post('/transactions', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(createTransactionSchema), transactions.createTransaction);
router.post('/transactions/:id/adjust', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(adjustTransactionSchema), transactions.adjustTransaction);
router.post('/transactions/:id/events', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(statusEventSchema), transactions.recordStatusEvent);
router.put('/transactions/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), transactions.updateTransaction); // Returns 405 Method Not Allowed
router.delete('/transactions/:id', authenticateToken, authorizeRoles('Admin'), transactions.deleteTransaction); // Returns 405 Method Not Allowed
router.post('/transactions/import', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), transactions.importCSV);


// ==========================================
// 2B. Column Mapping & Upload Gateway Routes
// ==========================================
router.post('/uploads/detect-headers', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), uploads.detectHeaders);
router.get('/uploads/:upload_id/suggested-mapping', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.getSuggestedMapping);
router.post('/uploads/:upload_id/mapping', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.confirmMapping);
router.get('/uploads/status/:id', authenticateToken, uploads.getJobStatus);
router.get('/uploads/queue', authenticateToken, uploads.listQueueJobs);
router.get('/uploads/mapping-templates', authenticateToken, uploads.getMappingTemplates);
router.delete('/uploads/mapping-templates/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.deleteMappingTemplate);

// ==========================================
// 3. Alert Module Routes
// ==========================================
router.get('/alerts', authenticateToken, alerts.getAlerts);
router.get('/alerts/active-learning', authenticateToken, alerts.getActiveLearningAlerts);
router.post('/alerts/bulk-assign', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(bulkAssignAlertsSchema), alerts.bulkAssignAlerts);
router.post('/alerts/bulk-dismiss', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(bulkDismissAlertsSchema), alerts.bulkDismissAlerts);
router.put('/alerts/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), alerts.updateAlert);
router.post('/alerts/:id/disposition', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(dispositionAlertSchema), alerts.dispositionAlert);

// ==========================================
// 4. Investigation / Case Module Routes
// ==========================================
router.get('/cases', authenticateToken, cases.getCases);
router.get('/cases/:id', authenticateToken, cases.getCaseById);
router.post('/cases', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(createCaseSchema), cases.createCase);
router.post('/cases/:id/merge', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.mergeCase);
router.put('/cases/:id/assign', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.assignCase);
router.post('/cases/:id/notes', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(addCaseNoteSchema), cases.addNote);
router.post('/cases/:id/evidence', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), cases.uploadEvidence);
router.put('/cases/:id/status', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(updateCaseStatusSchema), cases.updateCaseStatus);
router.get('/cases/:id/report', authenticateToken, cases.downloadReport); // Open to all authenticated roles (Auditor, Investigator, Admin)
router.get('/cases/:id/graph', authenticateToken, cases.getCaseGraph); // Case Cytoscape network analytics

// ==========================================
// 5. Admin Console Routes
// ==========================================
router.get('/admin/users', authenticateToken, authorizeRoles('Admin'), admin.getUsers);
router.delete('/admin/users/:username', authenticateToken, authorizeRoles('Admin'), admin.deleteUser);
router.get('/admin/audit-logs', authenticateToken, authorizeRoles('Admin', 'Auditor'), admin.getAuditLogs);
router.get('/admin/audit-logs/verify', authenticateToken, authorizeRoles('Admin', 'Auditor'), admin.verifyAuditLogs);
router.get('/admin/system-stats', authenticateToken, authorizeRoles('Admin', 'Auditor', 'Investigator'), admin.getSystemStats);
router.get('/admin/feedback-metrics', authenticateToken, authorizeRoles('Admin', 'Auditor', 'Investigator'), admin.getFeedbackMetrics);
router.post('/admin/train', authenticateToken, authorizeRoles('Admin', 'Investigator'), admin.trainModel);
router.get('/admin/risk-config', authenticateToken, authorizeRoles('Admin'), admin.getRiskConfig);
router.put('/admin/risk-config', authenticateToken, authorizeRoles('Admin'), admin.updateRiskConfig);

// Model Registry, Lifecycle, Drift Monitoring & Governance
router.get('/admin/models/versions', authenticateToken, admin.listModelVersions);
router.post('/admin/models/promote', authenticateToken, authorizeRoles('Admin'), admin.promoteModelVersion);
router.post('/admin/models/rollback', authenticateToken, authorizeRoles('Admin'), admin.rollbackModelVersion);
router.post('/admin/models/shadow-mode', authenticateToken, authorizeRoles('Admin'), admin.setShadowMode);
router.get('/admin/models/drift', authenticateToken, admin.getModelDrift);
router.get('/admin/models/versions/:version_id/report', authenticateToken, admin.getModelValidationReport);
router.get('/admin/models/versions/:version_id/report/pdf', authenticateToken, admin.exportModelValidationReportPDF);

// ==========================================
// 6. Customer 360 & Account Module Routes
// ==========================================
const customers = require('../controllers/customerController');
router.get('/customers', authenticateToken, customers.getCustomers);
router.post('/customers', authenticateToken, authorizeRoles('Admin', 'Investigator'), customers.createCustomer);
router.get('/customers/:id', authenticateToken, customers.getCustomerById);

// ==========================================
// 7. Configurable Scenario Engine & Back-Testing Routes
// ==========================================
const scenarios = require('../controllers/scenarioController');
router.get('/scenarios', authenticateToken, scenarios.getScenarios);
router.get('/scenarios/:id', authenticateToken, scenarios.getScenarioById);
router.post('/scenarios', authenticateToken, authorizeRoles('Admin'), scenarios.createScenario);
router.put('/scenarios/:id', authenticateToken, authorizeRoles('Admin'), scenarios.updateScenario);
router.delete('/scenarios/:id', authenticateToken, authorizeRoles('Admin'), scenarios.deleteScenario);
router.post('/scenarios/:id/backtest', authenticateToken, authorizeRoles('Admin', 'Investigator'), scenarios.backtestScenario);

// ==========================================
// 8. Name Screening & Watchlist Decisioning Routes
// ==========================================
const screening = require('../controllers/screeningController');
router.post('/screening/screen', authenticateToken, screening.screenName);
router.get('/screening/decisions', authenticateToken, screening.getDecisions);
router.post('/screening/decisions', authenticateToken, authorizeRoles('Admin', 'Investigator'), validateBody(screeningDecisionSchema), screening.recordDecision);
router.get('/screening/watchlists', authenticateToken, screening.getWatchlists);

// ==========================================
// 9. Regulatory Reporting Workflows (STR / CTR / FIU-IND)
// ==========================================
const regulatory = require('../controllers/regulatoryController');
// STR routes
router.get('/reports/str', authenticateToken, regulatory.getSTRs);
router.post('/reports/str/generate', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.generateSTR);
router.get('/reports/str/:id', authenticateToken, regulatory.getSTRById);
router.put('/reports/str/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.updateSTR);
router.post('/reports/str/:id/approve', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.approveSTR);
router.post('/reports/str/:id/file', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.fileSTR);
router.post('/reports/str/:id/reject', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.rejectSTR);
router.get('/reports/str/:id/export', authenticateToken, regulatory.exportSTR);
router.get('/reports/str/:id/pdf', authenticateToken, regulatory.exportSTRPDF);

// CTR routes
router.get('/reports/ctr', authenticateToken, regulatory.getCTRs);
router.post('/reports/ctr/generate', authenticateToken, authorizeRoles('Admin', 'Investigator'), regulatory.generateCTR);
router.get('/reports/ctr/:id/export', authenticateToken, regulatory.exportCTR);
router.get('/reports/ctr/:id/pdf', authenticateToken, regulatory.exportCTRPDF);

module.exports = router;
