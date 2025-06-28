// /src/chatbot/chatbotController.js
const { validateRequired, validateIntent, ValidationError } = require('./utils/errorHandler');
const logger = require('./utils/logger');
const config = require('./config');

// Import service modules
const inventoryService = require('./chatbotService/inventoryService');
//================================
const weatherService = require('./chatbotService/weatherService');
const schemeService = require('./chatbotService/schemeService');
const geminiService = require('./services/geminiService');

/**
 * Main intent processing controller
 */
const processIntent = async (req, res) => {
  const startTime = Date.now();
  const { intent, params = {}, message } = req.body;
  const sakhiId = req.sakhiId;

  try {
    // Validate request
    validateRequired(req.body, ['intent']);
    validateIntent(intent, params);

    let response;

    // Route to appropriate service based on intent
    switch (intent) {
      case 'stock_value':
        response = await inventoryService.getStockValue(sakhiId, params);
        break;
        
      case 'loan_trends':
        response = await inventoryService.getLoanTrends(sakhiId, params);
        break;
        
      case 'savings_alert':
        response = await inventoryService.checkSavingsAlert(sakhiId, params);
        break;
        
      case 'financial_summary':
        response = await inventoryService.getFinancialSummary(sakhiId, params);
        break;
        
      case 'weather_forecast':
        response = await weatherService.getForecast(sakhiId, params);
        break;
        
      case 'rain_alert':
        response = await weatherService.checkRainAlert(sakhiId, params);
        break;
        
      case 'scheme_eligibility':
        response = await schemeService.checkEligibility(sakhiId, params);
        break;
        
      case 'scheme_description':
        response = await schemeService.getSchemeDescription(params);
        break;
        
      case 'user_summary':
        response = await inventoryService.getUserSummary(sakhiId, params);
        break;
        
      default:
        throw new ValidationError(`Unsupported intent: ${intent}`);
    }

    const duration = Date.now() - startTime;

    // Log successful intent processing
    logger.logChatIntent(sakhiId, intent, params, response, duration);

    // Format successful response
    const result = {
      success: true,
      intent,
      data: response,
      timestamp: new Date().toISOString(),
      processingTime: `${duration}ms`
    };

    // Add conversational message if available
    if (response.message) {
      result.message = response.message;
    }

    res.json(result);

  } catch (error) {
    // Error will be handled by errorHandler middleware
    throw error;
  }
};

/**
 * Process natural language query using Gemini AI
 */
const processNaturalLanguage = async (req, res) => {
  const startTime = Date.now();
  const { query, context = {}, includeConversational = true } = req.body;
  const sakhiId = req.sakhiId;

  try {
    // Validate request
    validateRequired(req.body, ['query']);
    
    if (typeof query !== 'string' || query.trim().length < 2) {
      throw new ValidationError('Query must be a valid string with at least 2 characters');
    }

    // Step 1: Extract intent using Gemini
    const intentResult = await geminiService.processNaturalLanguage(query, sakhiId, context);
    
    if (!intentResult.success) {
      throw new ValidationError('Failed to process natural language query');
    }

    let response = {
      success: true,
      originalQuery: query,
      detectedIntent: intentResult.intent,
      confidence: intentResult.confidence,
      parameters: intentResult.parameters,
      needsLLMResponse: intentResult.needsLLMResponse,
      timestamp: new Date().toISOString()
    };

    // Step 2: If it's a supported intent, fetch data
    if (config.SUPPORTED_INTENTS.includes(intentResult.intent)) {
      try {
        const intentData = await processIndividualIntent(
          intentResult.intent, 
          intentResult.parameters, 
          sakhiId
        );
        response.intentData = intentData;

        // Step 3: Generate conversational response if requested
        if (includeConversational && intentResult.needsLLMResponse) {
          const conversationalResponse = await geminiService.generateConversationalResponse(
            intentResult.intent,
            intentData,
            query,
            sakhiId
          );
          response.conversationalResponse = conversationalResponse;
        }
      } catch (intentError) {
        logger.warn('Intent processing failed, proceeding with LLM response only', {
          sakhiId,
          intent: intentResult.intent,
          error: intentError.message
        });
        
        // If intent processing fails but we have a conversational intent, generate response anyway
        if (intentResult.needsLLMResponse) {
          const fallbackResponse = await geminiService.generateResponse(query, sakhiId, context);
          response.conversationalResponse = fallbackResponse.response;
          response.fallbackUsed = true;
        }
      }
    } else if (intentResult.intent === 'conversational' || intentResult.needsLLMResponse) {
      // Step 4: Handle conversational queries
      const geminiResponse = await geminiService.generateResponse(query, sakhiId, context);
      response.conversationalResponse = geminiResponse.response;
      response.confidence = geminiResponse.confidence;
      response.processingTime = geminiResponse.processingTime;
      response.modelUsed = geminiResponse.model;
    }

    const duration = Date.now() - startTime;
    response.totalProcessingTime = `${duration}ms`;

    // Log the natural language processing
    logger.logChatIntent(sakhiId, 'natural_language', { query, detectedIntent: intentResult.intent }, response, duration);

    res.json(response);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Natural language processing failed', {
      sakhiId,
      query,
      error: error.message,
      duration: `${duration}ms`
    });
    throw error;
  }
};

/**
 * Generate response directly using Gemini (for complex queries)
 */
const generateAIResponse = async (req, res) => {
  const startTime = Date.now();
  const { query, context = {} } = req.body;
  const sakhiId = req.sakhiId;

  try {
    validateRequired(req.body, ['query']);

    const geminiResponse = await geminiService.generateResponse(query, sakhiId, context);

    const response = {
      success: true,
      query,
      response: geminiResponse.response,
      confidence: geminiResponse.confidence,
      processingTime: geminiResponse.processingTime,
      model: geminiResponse.model,
      contextUsed: geminiResponse.contextUsed,
      timestamp: new Date().toISOString()
    };

    const duration = Date.now() - startTime;
    logger.logChatIntent(sakhiId, 'ai_response', { query }, response, duration);

    res.json(response);

  } catch (error) {
    throw error;
  }
};

/**
 * Get supported intents and their parameter requirements
 */
const getSupportedIntents = async (req, res) => {
  const intentDescriptions = {
    stock_value: {
      description: 'Get current stock/inventory value',
      parameters: {
        period: 'Optional: day, week, month, quarter, year (default: current)',
        category: 'Optional: filter by product category'
      },
      example: {
        intent: 'stock_value',
        params: { period: 'month', category: 'electronics' }
      }
    },
    loan_trends: {
      description: 'Analyze loan disbursement trends',
      parameters: {
        period: 'Optional: comparison period (default: month)',
        loanType: 'Optional: filter by loan type'
      },
      example: {
        intent: 'loan_trends',
        params: { period: 'quarter' }
      }
    },
    savings_alert: {
      description: 'Check if savings threshold alert should be triggered',
      parameters: {
        threshold: 'Optional: custom threshold amount'
      },
      example: {
        intent: 'savings_alert',
        params: { threshold: 10000 }
      }
    },
    financial_summary: {
      description: 'Get comprehensive financial overview',
      parameters: {
        period: 'Optional: summary period (default: month)',
        includeProjections: 'Optional: include future projections'
      },
      example: {
        intent: 'financial_summary',
        params: { period: 'quarter', includeProjections: true }
      }
    },
    weather_forecast: {
      description: 'Get weather forecast for user location',
      parameters: {
        days: 'Optional: number of forecast days (1-7, default: 3)',
        location: 'Optional: override default location'
      },
      example: {
        intent: 'weather_forecast',
        params: { days: 5 }
      }
    },
    rain_alert: {
      description: 'Check rain alert based on threshold',
      parameters: {
        threshold: 'Optional: rain threshold in mm (default: 50)',
        date: 'Optional: specific date to check (default: today)'
      },
      example: {
        intent: 'rain_alert',
        params: { threshold: 30 }
      }
    },
    scheme_eligibility: {
      description: 'Check government scheme eligibility for users',
      parameters: {
        userIds: 'Optional: specific user IDs to check (default: all supervised users)',
        schemes: 'Optional: specific schemes to check'
      },
      example: {
        intent: 'scheme_eligibility',
        params: { schemes: ['PM_KISAN', 'MUDRA_LOAN'] }
      }
    },
    scheme_description: {
      description: 'Get detailed information about government schemes',
      parameters: {
        schemeCode: 'Required: scheme code (PM_KISAN, MUDRA_LOAN, PMAY, SHG_SUBSIDY)'
      },
      example: {
        intent: 'scheme_description',
        params: { schemeCode: 'PM_KISAN' }
      }
    },
    user_summary: {
      description: 'Get summary of users under supervision',
      parameters: {
        includeInactive: 'Optional: include inactive users (default: false)',
        category: 'Optional: filter by user category'
      },
      example: {
        intent: 'user_summary',
        params: { includeInactive: true }
      }
    },
    conversational: {
      description: 'Natural language conversation and complex queries',
      parameters: {
        context: 'Optional: additional context for better responses'
      },
      example: {
        intent: 'conversational',
        params: { context: 'weather and financial data' }
      }
    }
  };

  // Add conversational to supported intents
  const allSupportedIntents = [...config.SUPPORTED_INTENTS, 'conversational'];

  res.json({
    success: true,
    supportedIntents: allSupportedIntents,
    descriptions: intentDescriptions,
    totalIntents: allSupportedIntents.length,
    naturalLanguageSupported: true,
    aiModel: 'gemini-2.0-flash-exp'
  });
};

/**
 * Process multiple intents in batch
 */
const processBatchIntents = async (req, res) => {
  const { intents } = req.body;
  const sakhiId = req.sakhiId;

  validateRequired(req.body, ['intents']);
  
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new ValidationError('Intents must be a non-empty array');
  }

  if (intents.length > 10) {
    throw new ValidationError('Maximum 10 intents allowed per batch request');
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < intents.length; i++) {
    try {
      const { intent, params = {} } = intents[i];
      validateIntent(intent, params);

      // Process individual intent
      const result = await processIndividualIntent(intent, params, sakhiId);
      results.push({
        index: i,
        intent,
        success: true,
        data: result
      });

    } catch (error) {
      errors.push({
        index: i,
        intent: intents[i].intent,
        success: false,
        error: error.message,
        errorCode: error.errorCode || 'UNKNOWN_ERROR'
      });
    }
  }

  res.json({
    success: true,
    totalRequests: intents.length,
    successfulRequests: results.length,
    failedRequests: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString()
  });
};

/**
 * Helper function to process individual intent (extracted from processIntent)
 */
const processIndividualIntent = async (intent, params, sakhiId) => {
  switch (intent) {
    case 'stock_value':
      return await inventoryService.getStockValue(sakhiId, params);
    case 'loan_trends':
      return await inventoryService.getLoanTrends(sakhiId, params);
    case 'savings_alert':
      return await inventoryService.checkSavingsAlert(sakhiId, params);
    case 'financial_summary':
      return await inventoryService.getFinancialSummary(sakhiId, params);
    case 'weather_forecast':
      return await weatherService.getForecast(sakhiId, params);
    case 'rain_alert':
      return await weatherService.checkRainAlert(sakhiId, params);
    case 'scheme_eligibility':
      return await schemeService.checkEligibility(sakhiId, params);
    case 'scheme_description':
      return await schemeService.getSchemeDescription(params);
    case 'user_summary':
      return await inventoryService.getUserSummary(sakhiId, params);
    default:
      throw new ValidationError(`Unsupported intent: ${intent}`);
  }
};

/**
 * Get chat history (placeholder for future implementation)
 */
const getChatHistory = async (req, res) => {
  const sakhiId = req.sakhiId;
  const { limit = 50, offset = 0 } = req.query;

  // TODO: Implement chat history storage and retrieval
  res.json({
    success: true,
    message: 'Chat history feature coming soon',
    sakhiId,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: 0
    },
    history: []
  });
};

/**
 * Health check for AI services
 */
const getHealthCheck = async (req, res) => {
  try {
    const geminiHealth = await geminiService.healthCheck();
    
    res.json({
      success: true,
      services: {
        gemini: geminiHealth,
        database: 'healthy', // TODO: Add actual DB health check
        redis: 'not_configured' // TODO: Add Redis health check if used
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  processIntent,
  processNaturalLanguage,
  generateAIResponse,
  getSupportedIntents,
  processBatchIntents,
  getChatHistory,
  getHealthCheck
};