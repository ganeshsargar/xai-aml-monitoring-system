require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { connectDB } = require('./src/config/db');
const apiRouter = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 5050;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security Middlewares
app.use(helmet({
  crossOriginResourcePolicy: false // Allows loading uploaded evidence assets locally
}));

// CORS Configuration
app.use(cors({
  origin: '*', // In production, replace with specific React app domains
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploads static folder (for downloading evidence)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiting (prevent brute-forcing compliance operations)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 10000, // Generous ceiling for rich AML UI & batch testing
  skip: (req) => {
    // Never lock out developers or local browser sessions on localhost
    if (process.env.NODE_ENV !== 'production') {
      const ip = req.ip || req.connection?.remoteAddress || '';
      return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.includes('127.0.0.1');
    }
    return false;
  },
  message: {
    success: false,
    error: 'Too many compliance requests from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Root status endpoint for cloud health checks (Render / Vercel / Railway)
app.get('/', (req, res) => {
  res.json({
    service: 'FundTraceAI API Gateway',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Mount API endpoints
app.use('/api', apiRouter);

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Global Server Error]:', err.stack);
  res.status(500).json({
    success: false,
    error: 'An unexpected internal server error occurred on the AML platform.'
  });
});

// Initialize database and start listening
async function startServer() {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`  AML EXPRESS BACKEND API RUNNING ON PORT ${PORT}`);
    console.log(`  API Health endpoint: http://127.0.0.1:${PORT}/api/admin/system-stats`);
    console.log(`==================================================`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
