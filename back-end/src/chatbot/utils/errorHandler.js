// /src/chatbot/utils/errorHandler.js
const logger = require('./logger');
const config = require('../config');

/**
 * Custom error classes for better error handling
 */
class ChatbotError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'ChatbotError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

class ValidationError extends ChatbotError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
  }
}

class DatabaseError extends ChatbotError {
  constructor(message, operation = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

class ExternalApiError extends ChatbotError {
  constructor(message, service = null, statusCode = 503) {
    super(message, statusCode, 'EXTERNAL_API_ERROR');
    this.name = 'ExternalApiError';
    this.service = service;
  }
}

class AuthenticationError extends ChatbotError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends ChatbotError {
  constructor(message = 'Insufficient privileges') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

/**
 * Format error response for client
 */
const formatErrorResponse = (error, sakhiId = null) => {
  const response = {
    success: false,
    error: error.message || config.RESPONSE_TEMPLATES.SERVER_ERROR,
    errorCode: error.errorCode || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString()
  };

  // Add additional fields for specific error types
  if (error instanceof ValidationError && error.field) {
    response.field = error.field;
  }

  if (error instanceof ExternalApiError && error.service) {
    response.service = error.service;
  }

  // Don't expose sensitive error details in production
  if (process.env.NODE_ENV === 'development') {
    response.stack = error.stack;
  }

  return response;
};

/**
 * Async error handler wrapper for route handlers
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Central error handling middleware
 */
const errorHandler = (error, req, res, next) => {
  const sakhiId = req.sakhiId || 'unknown';
  const intent = req.body?.intent || req.body?.query || 'unknown';
  
  // Log the error with context
  logger.error('Chatbot error occurred', {
    sakhiId,
    intent,
    error: error.message,
    errorCode: error.errorCode,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Handle specific error types
  let statusCode = 500;
  let response;

  if (error instanceof ChatbotError) {
    statusCode = error.statusCode;
    response = formatErrorResponse(error, sakhiId);
  } else if (error.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    response = formatErrorResponse(
      new ValidationError(error.message),
      sakhiId
    );
  } else if (error.name === 'CastError') {
    // Mongoose cast error (invalid ObjectId, etc.)
    statusCode = 400;
    response = formatErrorResponse(
      new ValidationError('Invalid data format'),
      sakhiId
    );
  } else if (error.code === 11000) {
    // MongoDB duplicate key error
    statusCode = 409;
    response = formatErrorResponse(
      new ValidationError('Duplicate entry found'),
      sakhiId
    );
  } else if (error.name === 'MongoTimeoutError') {
    statusCode = 503;
    response = formatErrorResponse(
      new DatabaseError('Database connection timeout'),
      sakhiId
    );
  } else {
    // Generic server error
    response = formatErrorResponse(
      new ChatbotError(config.RESPONSE_TEMPLATES?.SERVER_ERROR || 'Internal server error'),
      sakhiId
    );
  }

  res.status(statusCode).json(response);
};

/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res) => {
  const response = {
    success: false,
    error: 'Route not found',
    errorCode: 'ROUTE_NOT_FOUND',
    timestamp: new Date().toISOString(),
    path: req.path
  };

  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    ip: req.ip,
    sakhiId: req.sakhiId || 'unknown'
  });

  res.status(404).json(response);
};

/**
 * Validate required fields in request body
 */
const validateRequired = (data, requiredFields) => {
  const missing = [];
  
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missing.push(field);
    }
  }
  
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missing.join(', ')}`,
      missing[0]
    );
  }
};

/**
 * Validate intent and parameters
 */
const validateIntent = (intent, params = {}) => {
  if (!intent) {
    throw new ValidationError('Intent is required', 'intent');
  }

  // Support for conversational intent
  const supportedIntents = [...(config.SUPPORTED_INTENTS || []), 'conversational'];
  
  if (!supportedIntents.includes(intent)) {
    throw new ValidationError(
      `Unsupported intent: ${intent}. Supported intents: ${supportedIntents.join(', ')}`,
      'intent'
    );
  }

  // Validate parameters based on intent
  switch (intent) {
    case 'stock_value':
      if (params.period && !['day', 'week', 'month', 'quarter', 'year'].includes(params.period)) {
        throw new ValidationError('Invalid period. Use: day, week, month, quarter, year', 'period');
      }
      break;
      
    case 'weather_forecast':
      if (params.days && (params.days < 1 || params.days > 7)) {
        throw new ValidationError('Weather forecast days must be between 1 and 7', 'days');
      }
      break;
      
    case 'rain_alert':
      if (params.threshold && params.threshold < 0) {
        throw new ValidationError('Rain threshold must be positive', 'threshold');
      }
      break;
      
    case 'scheme_description':
      if (!params.schemeCode) {
        throw new ValidationError('Scheme code is required for scheme description', 'schemeCode');
      }
      break;
      
    case 'conversational':
      // No specific validation needed for conversational intent
      break;
  }
};

/**
 * Validate natural language query
 */
const validateQuery = (query) => {
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query must be a non-empty string', 'query');
  }
  
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new ValidationError('Query must be at least 2 characters long', 'query');
  }
  
  if (trimmed.length > 1000) {
    throw new ValidationError('Query must be less than 1000 characters', 'query');
  }
  
  return trimmed;
};

/**
 * Validate context object for AI requests
 */
const validateContext = (context) => {
  if (context && typeof context !== 'object') {
    throw new ValidationError('Context must be an object', 'context');
  }
  
  if (context && Array.isArray(context)) {
    throw new ValidationError('Context must be an object, not an array', 'context');
  }
  
  return context || {};
};

module.exports = {
  // Error classes
  ChatbotError,
  ValidationError,
  DatabaseError,
  ExternalApiError,
  AuthenticationError,
  AuthorizationError,
  
  // Middleware and handlers
  errorHandler,
  notFoundHandler,
  asyncHandler,
  
  // Utility functions
  formatErrorResponse,
  validateRequired,
  validateIntent,
  validateQuery,
  validateContext
};