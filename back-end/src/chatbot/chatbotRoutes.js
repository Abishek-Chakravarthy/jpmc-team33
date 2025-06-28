// /src/chatbot/chatbotRoutes.js
const express = require('express');
const { asyncHandler } = require('./utils/errorHandler');
const chatbotController = require('./chatbotController');

const router = express.Router();

/**
 * POST /chat
 * Main chatbot endpoint for processing intents
 * 
 * Request body:
 * {
 *   "intent": "stock_value|loan_trends|savings_alert|weather_forecast|rain_alert|scheme_eligibility|scheme_description|user_summary|financial_summary",
 *   "params": {
 *     // Intent-specific parameters
 *   },
 *   "message": "Optional natural language message"
 * }
 */
router.post('/chat', asyncHandler(chatbotController.processIntent));

/**
 * GET /intents
 * Get list of supported intents and their parameter requirements
 */
router.get('/intents', asyncHandler(chatbotController.getSupportedIntents));

/**
 * POST /batch
 * Process multiple intents in a single request
 * 
 * Request body:
 * {
 *   "intents": [
 *     { "intent": "stock_value", "params": {...} },
 *     { "intent": "weather_forecast", "params": {...} }
 *   ]
 * }
 */
router.post('/batch', asyncHandler(chatbotController.processBatchIntents));

/**
 * GET /history
 * Get chat history for the authenticated user
 */
router.get('/history', asyncHandler(chatbotController.getChatHistory));

module.exports = router;