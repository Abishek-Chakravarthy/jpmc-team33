// /src/chatbot/utils/logger.js
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

/**
 * Format log message with timestamp and metadata
 */
const formatMessage = (level, message, metadata = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...metadata
  };
  return JSON.stringify(logEntry);
};

/**
 * Write log to file
 */
const writeToFile = (level, message, metadata) => {
  const logFile = path.join(logsDir, `chatbot-${new Date().toISOString().split('T')[0]}.log`);
  const formattedMessage = formatMessage(level, message, metadata);
  
  fs.appendFile(logFile, formattedMessage + '\n', (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
};

/**
 * Console log with colors
 */
const consoleLog = (level, message, metadata) => {
  const colors = {
    ERROR: '\x1b[31m', // Red
    WARN: '\x1b[33m',  // Yellow
    INFO: '\x1b[36m',  // Cyan
    DEBUG: '\x1b[90m'  // Gray
  };
  
  const reset = '\x1b[0m';
  const timestamp = new Date().toISOString();
  
  console.log(
    `${colors[level]}[${timestamp}] ${level}:${reset} ${message}`,
    metadata && Object.keys(metadata).length > 0 ? metadata : ''
  );
};

/**
 * Generic log function
 */
const log = (level, message, metadata = {}) => {
  const levelValue = LOG_LEVELS[level];
  
  if (levelValue <= currentLogLevel) {
    consoleLog(level, message, metadata);
    writeToFile(level, message, metadata);
  }
};

/**
 * Log chatbot interactions
 */
const logChatIntent = (sakhiId, intent, params, response, duration) => {
  const metadata = {
    sakhiId,
    intent,
    params,
    responseSuccess: response.success,
    responseSize: JSON.stringify(response).length,
    duration: `${duration}ms`,
    category: 'CHAT_INTENT'
  };
  
  log('INFO', `Chat intent processed: ${intent}`, metadata);
};

/**
 * Log database operations
 */
const logDbOperation = (operation, collection, query, duration, error = null) => {
  const metadata = {
    operation,
    collection,
    query: JSON.stringify(query),
    duration: `${duration}ms`,
    category: 'DATABASE'
  };
  
  if (error) {
    metadata.error = error.message;
    log('ERROR', `Database operation failed: ${operation} on ${collection}`, metadata);
  } else {
    log('DEBUG', `Database operation completed: ${operation} on ${collection}`, metadata);
  }
};

/**
 * Log API calls to external services
 */
const logApiCall = (service, endpoint, duration, statusCode, error = null) => {
  const metadata = {
    service,
    endpoint,
    duration: `${duration}ms`,
    statusCode,
    category: 'EXTERNAL_API'
  };
  
  if (error) {
    metadata.error = error.message;
    log('ERROR', `External API call failed: ${service}`, metadata);
  } else {
    log('INFO', `External API call completed: ${service}`, metadata);
  }
};

// Export specific log level functions
const logger = {
  error: (message, metadata) => log('ERROR', message, metadata),
  warn: (message, metadata) => log('WARN', message, metadata),
  info: (message, metadata) => log('INFO', message, metadata),
  debug: (message, metadata) => log('DEBUG', message, metadata),
  
  // Specialized logging functions
  logChatIntent,
  logDbOperation,
  logApiCall,
  
  // Utility functions
  setLogLevel: (level) => {
    if (LOG_LEVELS[level.toUpperCase()] !== undefined) {
      currentLogLevel = LOG_LEVELS[level.toUpperCase()];
    }
  },
  
  getCurrentLevel: () => {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel);
  }
};

module.exports = logger;