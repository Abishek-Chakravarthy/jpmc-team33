// /src/chatbot/config.js
module.exports = {
  // Weather API Configuration
  WEATHER_API_KEY: process.env.WEATHER_API_KEY || 'your_openweather_api_key',
  WEATHER_API_URL: 'https://api.openweathermap.org/data/2.5',
  
  // Gemini API Configuration
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  
  // Alert Thresholds
  RAIN_THRESHOLD_MM: 50,
  SAVINGS_THRESHOLD: 5000,
  
  // Government Schemes Configuration
  SCHEME_RULES: {
    'PM_KISAN': {
      name: 'PM-KISAN Scheme',
      description: 'Income support to farmers with cultivable land',
      benefits: '₹6,000 per year in 3 installments',
      eligibility: {
        hasAadhaar: true,
        hasPancard: false, // Either Aadhaar OR PAN
        landOwnership: true,
        maxIncome: null
      }
    },
    'MUDRA_LOAN': {
      name: 'Pradhan Mantri MUDRA Yojana',
      description: 'Micro-finance for small businesses',
      benefits: 'Loans from ₹50,000 to ₹10 lakhs without collateral',
      eligibility: {
        hasAadhaar: true,
        hasPancard: true,
        businessType: 'micro_enterprise',
        maxIncome: 1000000
      }
    },
    'PMAY': {
      name: 'Pradhan Mantri Awas Yojana',
      description: 'Housing for all scheme',
      benefits: 'Subsidy on home loans up to ₹2.67 lakhs',
      eligibility: {
        hasAadhaar: true,
        hasPancard: true,
        familyIncome: 1800000,
        houselessness: true
      }
    },
    'SHG_SUBSIDY': {
      name: 'Self Help Group Subsidy',
      description: 'Support for women entrepreneurs',
      benefits: '25-35% subsidy on project cost',
      eligibility: {
        hasAadhaar: true,
        hasPancard: false,
        gender: 'female',
        shgMembership: true
      }
    }
  },
  
  // JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret_key',
  
  // Database timeout settings
  DB_TIMEOUT: 5000,
  
  // Chatbot Response Templates
  RESPONSE_TEMPLATES: {
    NO_DATA: "I couldn't find any data for your request. Please check if you have users registered under your supervision.",
    WEATHER_ERROR: "I'm unable to fetch weather information right now. Please try again later.",
    SCHEME_NOT_FOUND: "I don't have information about that particular scheme. Please check the scheme name.",
    AUTHENTICATION_ERROR: "You need to be logged in to access this information.",
    SERVER_ERROR: "Something went wrong. Please try again.",
    GEMINI_ERROR: "I'm having trouble processing your request right now. Please try again later.",
    INVALID_QUERY: "I couldn't understand your request. Please try rephrasing your question."
  },
  
  // Supported Intents - Updated to include all intents
  SUPPORTED_INTENTS: [
    'stock_value',
    'loan_trends',
    'savings_alert',
    'weather_forecast',
    'rain_alert',
    'scheme_eligibility',
    'scheme_description',
    'user_summary',
    'financial_summary',
    'agriculture_advisory',
    'conversational'
  ],
  
  // AI Service Configuration
  AI_CONFIG: {
    DEFAULT_MODEL: 'gemini-2.0-flash-exp',
    MAX_QUERY_LENGTH: 1000,
    MIN_QUERY_LENGTH: 2,
    DEFAULT_CONFIDENCE_THRESHOLD: 0.6,
    RESPONSE_TIMEOUT: 30000, // 30 seconds
    MAX_CONTEXT_SIZE: 10000 // Maximum context data size in characters
  }
};