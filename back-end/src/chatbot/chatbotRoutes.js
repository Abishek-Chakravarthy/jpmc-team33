// /src/chatbot/chatbotRoutes.js
const express = require('express');
const { asyncHandler } = require('./utils/errorHandler');
const {
  processIntent,
  processNaturalLanguage,
  generateAIResponse,
  getSupportedIntents,
  processBatchIntents,
  getChatHistory,
  getHealthCheck
} = require('./chatbotController');

const router = express.Router();

// Core chatbot routes
router.post('/intent', asyncHandler(processIntent));
router.post('/chat', asyncHandler(processNaturalLanguage));
router.post('/ai', asyncHandler(generateAIResponse));
router.post('/batch', asyncHandler(processBatchIntents));

// Information and utility routes
router.get('/intents', asyncHandler(getSupportedIntents));
router.get('/history', asyncHandler(getChatHistory));
router.get('/health', asyncHandler(getHealthCheck));

module.exports = router;