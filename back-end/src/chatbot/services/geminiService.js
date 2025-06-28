// /src/chatbot/services/geminiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { ExternalApiError, ValidationError } = require('../utils/errorHandler');
const config = require('../config');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    // System prompt for rural financial context
    this.systemPrompt = `You are an AI assistant helping rural financial coordinators (AvaSakhis) manage their communities. 

Context: You work with AvaSakhis who supervise rural laborers and artisans. Your responses should be:
- Simple and practical for rural contexts
- Focused on financial literacy and rural development
- Culturally appropriate for Indian rural communities
- Action-oriented with clear next steps

Available data types:
- User demographics (age, education, family size, disability status)
- Financial records (investments, earnings, profits, loans, savings)
- Inventory data (stock levels, sales, rates)
- Weather information and agricultural advisories
- Government scheme eligibility

Always respond in a helpful, respectful manner appropriate for rural development work.
Use Indian Rupee (₹) format for all monetary values.`;
  }

  /**
   * Generate response using Gemini with enhanced context
   */
  async generateResponse(query, sakhiId, context = {}) {
    const startTime = Date.now();
    
    try {
      // Validate required parameters
      if (!query || typeof query !== 'string') {
        throw new ValidationError('Query is required and must be a string');
      }

      if (!sakhiId) {
        throw new ValidationError('SakhiId is required for context');
      }

      // Build enhanced prompt with comprehensive context
      const enhancedPrompt = await this.buildPromptWithContext(query, sakhiId, context);
      
      const result = await this.model.generateContent(enhancedPrompt);
      const response = result.response;
      const text = response.text();
      
      const duration = Date.now() - startTime;
      
      logger.logApiCall('Gemini', 'generateContent', duration, 200);
      
      return {
        success: true,
        response: text,
        confidence: this.estimateConfidence(text),
        processingTime: duration,
        model: 'gemini-2.0-flash-exp',
        contextUsed: Object.keys(context)
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'generateContent', duration, 0, error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      if (error.message.includes('API key')) {
        throw new ExternalApiError('Invalid Gemini API key', 'Gemini', 401);
      } else if (error.message.includes('quota')) {
        throw new ExternalApiError('Gemini API quota exceeded', 'Gemini', 429);
      } else {
        throw new ExternalApiError('Gemini API error: ' + error.message, 'Gemini');
      }
    }
  }

  /**
   * Build contextual prompt with database-sourced information
   */
  async buildPromptWithContext(query, sakhiId, context = {}) {
    let prompt = this.systemPrompt + '\n\n';
    
    try {
      // Get AvaSakhi information
      const sakhiInfo = await this.getSakhiInfo(sakhiId);
      if (sakhiInfo) {
        prompt += `AvaSakhi Profile:\n`;
        prompt += `- Name: ${sakhiInfo.name || 'N/A'}\n`;
        prompt += `- Location: ${sakhiInfo.location || sakhiInfo.city || 'N/A'}\n`;
        prompt += `- Experience: ${sakhiInfo.experience || 'N/A'} years\n`;
        prompt += `- Specialization: ${sakhiInfo.specialization || 'General'}\n\n`;
      }

      // Add user data context if provided
      if (context.userData && Array.isArray(context.userData) && context.userData.length > 0) {
        prompt += `User Data Context:\n`;
        prompt += `- Total users supervised: ${context.userData.length}\n`;
        
        const demographics = this.analyzeUserDemographics(context.userData);
        prompt += `- Age distribution: ${demographics.ageDistribution}\n`;
        prompt += `- Education levels: ${demographics.educationLevels}\n`;
        prompt += `- Family sizes: ${demographics.familySizes}\n`;
        prompt += `- Gender distribution: ${demographics.genderDistribution}\n`;
        
        if (demographics.disabilities > 0) {
          prompt += `- Users with disabilities: ${demographics.disabilities}\n`;
        }
        
        if (demographics.categories && demographics.categories.length > 0) {
          prompt += `- User categories: ${demographics.categories.join(', ')}\n`;
        }
        prompt += '\n';
      }

      // Add financial context with proper formatting
      if (context.financialData) {
        prompt += `Financial Context:\n`;
        if (context.financialData.summary) {
          const summary = context.financialData.summary;
          prompt += `- Total savings: ₹${this.formatCurrency(summary.totalSavings || 0)}\n`;
          prompt += `- Total loans disbursed: ₹${this.formatCurrency(summary.totalLoans || 0)}\n`;
          prompt += `- Total revenue: ₹${this.formatCurrency(summary.totalRevenue || 0)}\n`;
          prompt += `- Active users: ${summary.activeUsers || 0}\n`;
          prompt += `- Total transactions: ${summary.transactionCount || 0}\n`;
        }
        
        if (context.financialData.healthMetrics) {
          const metrics = context.financialData.healthMetrics;
          prompt += `- Savings to loan ratio: ${metrics.savingsToLoanRatio || 0}\n`;
          prompt += `- Avg transactions per user: ${metrics.avgTransactionPerUser || 0}\n`;
          prompt += `- Avg savings per user: ₹${this.formatCurrency(metrics.avgSavingsPerUser || 0)}\n`;
        }
        prompt += '\n';
      }

      // Add inventory context
      if (context.inventoryData) {
        prompt += `Inventory Context:\n`;
        prompt += `- Total stock value: ₹${this.formatCurrency(context.inventoryData.totalValue || 0)}\n`;
        prompt += `- Total items in stock: ${context.inventoryData.totalItems || 0}\n`;
        if (context.inventoryData.categories) {
          prompt += `- Categories: ${context.inventoryData.categories.join(', ')}\n`;
        }
        if (context.inventoryData.averageItemValue) {
          prompt += `- Average item value: ₹${this.formatCurrency(context.inventoryData.averageItemValue)}\n`;
        }
        if (context.inventoryData.lastUpdated) {
          prompt += `- Last updated: ${new Date(context.inventoryData.lastUpdated).toLocaleDateString('en-IN')}\n`;
        }
        prompt += '\n';
      }

      // Add weather context
      if (context.weatherData) {
        prompt += `Weather Context:\n`;
        if (context.weatherData.current) {
          const current = context.weatherData.current;
          prompt += `- Current temperature: ${current.temperature}°C\n`;
          prompt += `- Weather: ${current.description}\n`;
          prompt += `- Humidity: ${current.humidity}%\n`;
        }
        
        if (context.weatherData.forecast && Array.isArray(context.weatherData.forecast)) {
          const rainyDays = context.weatherData.forecast.filter(day => day.rainfall > 5).length;
          if (rainyDays > 0) {
            prompt += `- Rain expected in next ${context.weatherData.forecast.length} days: ${rainyDays} day(s)\n`;
          }
        }
        
        if (context.weatherData.alerts && Array.isArray(context.weatherData.alerts)) {
          prompt += `- Weather alerts: ${context.weatherData.alerts.length}\n`;
        }
        prompt += '\n';
      }

      // Add scheme eligibility context
      if (context.schemeData) {
        prompt += `Government Scheme Context:\n`;
        if (context.schemeData.eligibleSchemes) {
          prompt += `- Eligible schemes: ${context.schemeData.eligibleSchemes.length}\n`;
        }
        if (context.schemeData.appliedSchemes) {
          prompt += `- Applied schemes: ${context.schemeData.appliedSchemes.length}\n`;
        }
        prompt += '\n';
      }

      // Add loan trends if available
      if (context.loanTrends) {
        prompt += `Loan Trends:\n`;
        if (context.loanTrends.current) {
          const current = context.loanTrends.current;
          prompt += `- Recent loan amount: ₹${this.formatCurrency(current.totalAmount || 0)}\n`;
          prompt += `- Recent loan count: ${current.totalLoans || 0}\n`;
          prompt += `- Average loan size: ₹${this.formatCurrency(current.averageLoan || 0)}\n`;
        }
        if (context.loanTrends.trends) {
          const trends = context.loanTrends.trends;
          prompt += `- Trend direction: ${trends.direction}\n`;
          if (trends.amountChange !== 0) {
            prompt += `- Amount change: ${trends.amountChange > 0 ? '+' : ''}${trends.amountChange}%\n`;
          }
        }
        prompt += '\n';
      }

    } catch (error) {
      logger.warn('Error building context', { sakhiId, error: error.message });
      // Continue with basic prompt if context building fails
    }

    prompt += `User Query: ${query}\n\n`;
    prompt += `Please provide a helpful response that addresses the query using the available context. 
    Guidelines:
    - If suggesting financial actions, be specific about next steps
    - Use Indian Rupee (₹) format for all monetary values with proper formatting (e.g., ₹1,50,000)
    - Keep language simple and appropriate for rural users
    - If discussing weather, consider agricultural implications
    - Suggest government schemes when relevant
    - Be encouraging and supportive in tone
    - Provide actionable advice when possible`;

    return prompt;
  }

  /**
   * Get AvaSakhi information from database
   */
  async getSakhiInfo(sakhiId) {
    try {
      const AvaSakhi = mongoose.model('AvaSakhi');
      const sakhi = await AvaSakhi.findById(sakhiId).select(
        'name email phone location city state experience specialization isActive'
      );
      return sakhi;
    } catch (error) {
      logger.warn('Could not fetch AvaSakhi info', { sakhiId, error: error.message });
      return null;
    }
  }

  /**
   * Enhanced demographic analysis with better handling
   */
  analyzeUserDemographics(userData) {
    if (!Array.isArray(userData) || userData.length === 0) {
      return {
        ageDistribution: 'No age data',
        educationLevels: 'No education data',
        familySizes: 'No family data',
        genderDistribution: 'No gender data',
        categories: [],
        disabilities: 0
      };
    }

    const ages = userData.map(u => u.age).filter(a => a && a > 0);
    const education = userData.map(u => u.education).filter(e => e && e.trim() !== '');
    const families = userData.map(u => u.familyMembers || u.familySize).filter(f => f && f > 0);
    const genders = userData.map(u => u.gender).filter(g => g && g.trim() !== '');
    const categories = userData.map(u => u.category).filter(c => c && c.trim() !== '');
    const disabilities = userData.filter(u => 
      u.disability && u.disability !== 'none' && u.disability.trim() !== ''
    ).length;

    // Calculate gender distribution
    const genderCounts = genders.reduce((acc, gender) => {
      acc[gender] = (acc[gender] || 0) + 1;
      return acc;
    }, {});
    
    const genderDistribution = Object.entries(genderCounts)
      .map(([gender, count]) => `${gender}: ${count}`)
      .join(', ') || 'No gender data';

    return {
      ageDistribution: ages.length > 0 ? 
        `${Math.min(...ages)}-${Math.max(...ages)} years (avg: ${Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)})` : 
        'No age data',
      educationLevels: [...new Set(education)].join(', ') || 'No education data',
      familySizes: families.length > 0 ? 
        `${Math.min(...families)}-${Math.max(...families)} members (avg: ${Math.round(families.reduce((a, b) => a + b, 0) / families.length)})` : 
        'No family data',
      genderDistribution,
      categories: [...new Set(categories)],
      disabilities
    };
  }

  /**
   * Enhanced natural language processing with better intent detection
   */
  async processNaturalLanguage(query, sakhiId, context = {}) {
    const startTime = Date.now();
    
    try {
      const intentPrompt = `
Analyze this query from an AvaSakhi (rural financial coordinator) and extract the intent and parameters:

Query: "${query}"

Available intents and their descriptions:
- stock_value: Get inventory/stock information and valuations
- financial_summary: Get comprehensive financial overview and analysis
- user_summary: Get information about supervised users and demographics
- weather_forecast: Get weather predictions for agricultural planning
- rain_alert: Check for rain warnings and agricultural advisories
- scheme_eligibility: Check government scheme eligibility for users
- scheme_description: Get detailed information about specific schemes
- loan_trends: Analyze loan disbursement patterns and trends
- savings_alert: Check users with low savings below threshold
- agriculture_advisory: Get crop-specific weather guidance
- conversational: General questions, greetings, or complex queries needing detailed explanation

Context available: ${Object.keys(context).join(', ')}

Respond ONLY with valid JSON in this exact format:
{
  "intent": "detected_intent",
  "confidence": 0.8,
  "parameters": {},
  "needsLLMResponse": true,
  "reasoning": "brief explanation"
}

Rules:
- Set needsLLMResponse to true for conversational queries or when detailed explanation is needed
- Set needsLLMResponse to false only for simple data requests
- Confidence should be between 0.0 and 1.0
- Include relevant parameters based on the query
`;

      const result = await this.model.generateContent(intentPrompt);
      const response = result.response.text();
      
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'intent_detection', duration, 200);
      
      // Try to parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const intentData = JSON.parse(jsonMatch[0]);
        
        // Validate intent data
        if (!intentData.intent || typeof intentData.confidence !== 'number') {
          throw new Error('Invalid intent data structure');
        }
        
        return {
          success: true,
          ...intentData
        };
      }
      
      throw new Error('Could not parse intent from response');
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'intent_detection', duration, 0, error);
      logger.warn('Intent extraction failed, using fallback', { query, error: error.message });
      
      // Enhanced fallback to keyword matching
      return this.fallbackIntentDetection(query);
    }
  }

  /**
   * Enhanced fallback intent detection
   */
  fallbackIntentDetection(query) {
    const lowerQuery = query.toLowerCase();
    
    const intentKeywords = {
      stock_value: ['stock', 'inventory', 'items', 'products', 'value', 'goods'],
      financial_summary: ['money', 'finance', 'earnings', 'profit', 'income', 'financial', 'summary'],
      user_summary: ['users', 'people', 'workers', 'laborers', 'artisans', 'members'],
      weather_forecast: ['weather', 'forecast', 'temperature', 'climate'],
      rain_alert: ['rain', 'rainfall', 'alert', 'warning'],
      scheme_eligibility: ['scheme', 'government', 'eligibility', 'benefits', 'subsidy'],
      loan_trends: ['loan', 'credit', 'borrowing', 'trend', 'disbursement'],
      savings_alert: ['savings', 'save', 'deposit', 'alert', 'low'],
      agriculture_advisory: ['crop', 'farming', 'agriculture', 'cultivation', 'harvest']
    };

    let bestMatch = { intent: 'conversational', confidence: 0.4 };
    
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      const matches = keywords.filter(keyword => lowerQuery.includes(keyword)).length;
      const confidence = Math.min(0.8, (matches / keywords.length) * 1.2); // Cap at 0.8 for fallback
      
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent, confidence };
      }
    }

    return {
      success: true,
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      parameters: {},
      needsLLMResponse: true,
      reasoning: 'Fallback keyword matching'
    };
  }

  /**
   * Enhanced confidence estimation
   */
  estimateConfidence(response) {
    if (!response || typeof response !== 'string') return 0.5;
    
    const length = response.length;
    const hasNumbers = /\d/.test(response);
    const hasRupee = /₹/.test(response);
    const hasSpecifics = /\b(specific|exactly|precisely|according to|based on)\b/i.test(response);
    const hasActionWords = /\b(should|recommend|suggest|consider|ensure)\b/i.test(response);
    const hasCurrency = /\b\d{1,3}(?:,\d{3})*\b/.test(response);
    
    let confidence = 0.6; // Base confidence
    
    if (length > 100) confidence += 0.1;
    if (length > 300) confidence += 0.1;
    if (hasNumbers) confidence += 0.1;
    if (hasRupee) confidence += 0.1;
    if (hasSpecifics) confidence += 0.1;
    if (hasActionWords) confidence += 0.05;
    if (hasCurrency) confidence += 0.05;
    
    return Math.min(confidence, 0.95);
  }

  /**
   * Generate enhanced conversational response
   */
  async generateConversationalResponse(intent, data, originalQuery, sakhiId) {
    const startTime = Date.now();
    
    try {
      const contextPrompt = `
As an AI assistant for AvaSakhis (rural financial coordinators), generate a conversational response.

Intent: ${intent}
Original Query: "${originalQuery}"
Data: ${JSON.stringify(data, null, 2)}

Guidelines:
- Be conversational, warm, and supportive
- Use Indian Rupee (₹) format with proper Indian number formatting (e.g., ₹1,50,000)
- Suggest specific, actionable next steps when appropriate
- Keep language simple and accessible for rural users
- Be encouraging and highlight positive aspects
- If numbers are involved, provide insights and interpretation
- Consider rural and agricultural context
- Include relevant government schemes or programs when applicable
- End with a question or offer for further assistance when appropriate

Generate a natural, helpful response that directly addresses their query.
`;

      const result = await this.model.generateContent(contextPrompt);
      const response = result.response.text();
      
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'conversational_response', duration, 200);
      
      return response;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'conversational_response', duration, 0, error);
      logger.error('Failed to generate conversational response', { error: error.message });
      
      // Enhanced fallback response
      return this.generateEnhancedFallbackResponse(intent, data, originalQuery);
    }
  }

  /**
   * Enhanced fallback response generator
   */
  generateEnhancedFallbackResponse(intent, data, originalQuery) {
    switch (intent) {
      case 'stock_value':
        return `Your current inventory is worth ₹${this.formatCurrency(data.totalValue || 0)} with ${data.totalItems || 0} items in stock. ${
          data.categories && data.categories.length > 0 ? 
          `Categories include: ${data.categories.join(', ')}. ` : ''
        }This helps you understand your business assets. Would you like to know more about any specific category?`;
      
      case 'financial_summary':
        const savings = data.summary?.totalSavings || data.totalSavings || 0;
        const loans = data.summary?.totalLoans || data.totalLoans || 0;
        const profit = (data.summary?.totalRevenue || data.totalRevenue || 0) - loans;
        return `Financial overview: You have ₹${this.formatCurrency(savings)} in total savings and ₹${this.formatCurrency(loans)} in loans disbursed. ${
          profit > 0 ? `Net revenue of ₹${this.formatCurrency(profit)} shows positive growth.` : 'Focus on increasing revenue streams.'
        } ${data.summary?.activeUsers ? `Currently managing ${data.summary.activeUsers} active users. ` : ''}How can I help you improve these numbers?`;
      
      case 'user_summary':
        return `You are currently supervising ${data.totalUsers || data.activeUsers || 0} users. ${
          data.demographics ? 
          `Average age is ${data.demographics.averageAge} years with good representation across different education levels. ` : ''
        }Your community is growing well. Would you like tips on engaging with your users more effectively?`;
      
      case 'weather_forecast':
        if (data.forecast && data.forecast.length > 0) {
          const today = data.forecast[0];
          return `Today's weather: ${today.temperature?.max || 'N/A'}°C high, ${today.temperature?.min || 'N/A'}°C low, ${today.weather?.description || 'conditions unclear'}. ${
            data.forecast.filter(day => day.rainfall > 5).length > 0 ? 
            'Rain expected in coming days - good for crops but plan indoor activities accordingly.' : 
            'No significant rain expected - consider irrigation needs.'
          }`;
        }
        return 'Weather information is currently unavailable. Please try again later or check with local weather sources.';
      
      case 'loan_trends':
        const current = data.current || {};
        const trends = data.trends || {};
        return `Recent loan activity: ₹${this.formatCurrency(current.totalAmount || 0)} disbursed across ${current.totalLoans || 0} loans. ${
          trends.direction === 'increasing' ? 'Loan demand is growing - ensure proper documentation and follow-ups.' :
          trends.direction === 'decreasing' ? 'Loan demand has decreased - consider outreach programs.' :
          'Loan activity is stable - maintain current processes.'
        } Average loan size is ₹${this.formatCurrency(current.averageLoan || 0)}.`;
      
      case 'savings_alert':
        return data.alertTriggered ? 
          `Alert: ${data.usersBelow || 0} users have savings below ₹${this.formatCurrency(data.threshold || 0)}. Consider organizing savings awareness sessions or offering incentives for regular deposits.` :
          `Good news! All users have healthy savings above ₹${this.formatCurrency(data.threshold || 0)}. Keep encouraging this positive saving behavior.`;
      
      default:
        return `I have the information you requested about ${intent.replace('_', ' ')}. The data shows positive engagement with your community. Is there anything specific you'd like me to explain further?`;
    }
  }

  /**
   * Helper function to format currency in Indian style
   */
  formatCurrency(amount) {
    if (typeof amount !== 'number') return '0';
    
    // Convert to Indian number format (lakhs, crores)
    return new Intl.NumberFormat('en-IN').format(Math.round(amount));
  }

  /**
   * Validate and sanitize input query
   */
  validateQuery(query) {
    if (!query || typeof query !== 'string') {
      throw new ValidationError('Query must be a non-empty string');
    }
    
    // Remove excessive whitespace and limit length
    const cleanQuery = query.trim().substring(0, 1000);
    
    if (cleanQuery.length < 2) {
      throw new ValidationError('Query must be at least 2 characters long');
    }
    
    return cleanQuery;
  }

  /**
   * Health check for the Gemini service
   */
  async healthCheck() {
    try {
      const testPrompt = "Respond with 'OK' if you can process this request.";
      const result = await this.model.generateContent(testPrompt);
      const response = result.response.text();
      
      return {
        status: 'healthy',
        model: 'gemini-2.0-flash-exp',
        responseTime: Date.now(),
        apiKeyConfigured: !!this.apiKey
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        apiKeyConfigured: !!this.apiKey
      };
    }
  }
}

module.exports = new GeminiService();