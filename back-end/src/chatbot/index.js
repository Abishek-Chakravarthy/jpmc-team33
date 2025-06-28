// /src/chatbot/index.js
const express = require('express');
const { verifyToken } = require('./utils/jwtMiddleware');
const { errorHandler, notFoundHandler } = require('./utils/errorHandler');
const chatbotRoutes = require('./chatbotRoutes');
const logger = require('./utils/logger');

const router = express.Router();

// Middleware
router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true }));

// Request logging middleware
router.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Chatbot request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      sakhiId: req.sakhiId || 'unknown',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
});

// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Chatbot service is running',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// JWT authentication for all chatbot routes
router.use(verifyToken);

// Mount chatbot routes
router.use('/', chatbotRoutes);

// 404 handler for undefined chatbot routes
router.use(notFoundHandler);

// Error handling middleware
router.use(errorHandler);

module.exports = router;