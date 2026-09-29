const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const auth = require('../controllers/authController');
const transactions = require('../controllers/transactionController');
const alerts = require('../controllers/alertController');
const cases = require('../controllers/caseController');
const admin = require('../controllers/adminController');
const uploads = require('../controllers/uploadController');

const router = express.Router();

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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// ==========================================
// 1. Authentication Routes
// ==========================================
router.post('/auth/register', auth.register); // Allowed public self-reg or admin creation
router.post('/auth/login', auth.login);
router.post('/auth/logout', authenticateToken, auth.logout);
router.get('/auth/profile', authenticateToken, auth.getProfile);
router.put('/auth/profile', authenticateToken, auth.updateProfile);

// ==========================================
// 2. Transaction Module Routes
// ==========================================
router.get('/transactions', authenticateToken, transactions.getTransactions);
router.post('/transactions', authenticateToken, authorizeRoles('Admin', 'Investigator'), transactions.createTransaction);
router.put('/transactions/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), transactions.updateTransaction);
router.delete('/transactions/:id', authenticateToken, authorizeRoles('Admin'), transactions.deleteTransaction);
router.post('/transactions/import', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), transactions.importCSV);

// ==========================================
// 2B. Column Mapping & Upload Gateway Routes
// ==========================================
router.post('/uploads/detect-headers', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), uploads.detectHeaders);
router.get('/uploads/:upload_id/suggested-mapping', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.getSuggestedMapping);
router.post('/uploads/:upload_id/mapping', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.confirmMapping);
router.get('/uploads/mapping-templates', authenticateToken, uploads.getMappingTemplates);
router.delete('/uploads/mapping-templates/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), uploads.deleteMappingTemplate);

// ==========================================
// 3. Alert Module Routes
// ==========================================
router.get('/alerts', authenticateToken, alerts.getAlerts);
router.put('/alerts/:id', authenticateToken, authorizeRoles('Admin', 'Investigator'), alerts.updateAlert);

// ==========================================
// 4. Investigation / Case Module Routes
// ==========================================
router.get('/cases', authenticateToken, cases.getCases);
router.post('/cases', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.createCase);
router.put('/cases/:id/assign', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.assignCase);
router.post('/cases/:id/notes', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.addNote);
router.post('/cases/:id/evidence', authenticateToken, authorizeRoles('Admin', 'Investigator'), upload.single('file'), cases.uploadEvidence);
router.put('/cases/:id/status', authenticateToken, authorizeRoles('Admin', 'Investigator'), cases.updateCaseStatus);
router.get('/cases/:id/report', authenticateToken, cases.downloadReport); // Open to all authenticated roles (Auditor, Investigator, Admin)
router.get('/cases/:id/graph', authenticateToken, cases.getCaseGraph); // Case Cytoscape network analytics

// ==========================================
// 5. Admin Console Routes
// ==========================================
router.get('/admin/users', authenticateToken, authorizeRoles('Admin'), admin.getUsers);
router.delete('/admin/users/:username', authenticateToken, authorizeRoles('Admin'), admin.deleteUser);
router.get('/admin/audit-logs', authenticateToken, authorizeRoles('Admin', 'Auditor'), admin.getAuditLogs);
router.get('/admin/system-stats', authenticateToken, authorizeRoles('Admin', 'Auditor', 'Investigator'), admin.getSystemStats);
router.post('/admin/train', authenticateToken, authorizeRoles('Admin', 'Investigator'), admin.trainModel);

module.exports = router;
