// /src/chatbot/chatbotService/geminiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');
const { ExternalApiError, ValidationError } = require('../utils/errorHandler');

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
- Financial records (investments, earnings, profits)
- Inventory data (stock levels, sales, rates)
- Weather information
- Government scheme eligibility

Always respond in a helpful, respectful manner appropriate for rural development work.`;
  }

  /**
   * Generate response using Gemini with context about user data
   */
  async generateResponse(query, context = {}) {
    const startTime = Date.now();
    
    try {
      // Build enhanced prompt with context
      const enhancedPrompt = this.buildPromptWithContext(query, context);
      
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
        model: 'gemini-2.0-flash-exp'
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logApiCall('Gemini', 'generateContent', duration, 0, error);
      
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
   * Build contextual prompt for better responses
   */
  buildPromptWithContext(query, context) {
    let prompt = this.systemPrompt + '\n\n';
    
    // Add context information
    if (context.userData && context.userData.length > 0) {
      prompt += `User Data Context:\n`;
      prompt += `- Total users supervised: ${context.userData.length}\n`;
      
      const demographics = this.analyzeUserDemographics(context.userData);
      prompt += `- Age distribution: ${demographics.ageDistribution}\n`;
      prompt += `- Education levels: ${demographics.educationLevels}\n`;
      prompt += `- Family sizes: ${demographics.familySizes}\n`;
      
      if (demographics.disabilities > 0) {
        prompt += `- Users with disabilities: ${demographics.disabilities}\n`;
      }
      prompt += '\n';
    }

    if (context.financialData) {
      prompt += `Financial Context:\n`;
      prompt += `- Total investments: ₹${context.financialData.totalInvested || 0}\n`;
      prompt += `- Total earnings: ₹${context.financialData.totalEarned || 0}\n`;
      prompt += `- Net profit: ₹${context.financialData.totalProfit || 0}\n\n`;
    }

    if (context.inventoryData) {
      prompt += `Inventory Context:\n`;
      prompt += `- Total stock value: ₹${context.inventoryData.totalValue || 0}\n`;
      prompt += `- Items in stock: ${context.inventoryData.totalItems || 0}\n`;
      prompt += `- Items sold: ${context.inventoryData.totalSold || 0}\n\n`;
    }

    if (context.weatherData) {
      prompt += `Weather Context:\n`;
      prompt += `- Current conditions: ${context.weatherData.current || 'N/A'}\n`;
      prompt += `- Forecast: ${context.weatherData.forecast || 'N/A'}\n\n`;
    }

    prompt += `User Query: ${query}\n\n`;
    prompt += `Please provide a helpful response that addresses the query using the available context. 
    If suggesting actions, be specific about next steps. If discussing financial matters, 
    use Indian Rupee (₹) format. Keep language simple and appropriate for rural users.`;

    return prompt;
  }

  /**
   * Analyze user demographics for context
   */
  analyzeUserDemographics(userData) {
    const ages = userData.map(u => u.age).filter(a => a);
    const education = userData.map(u => u.education).filter(e => e);
    const families = userData.map(u => u.familyMembers).filter(f => f);
    const disabilities = userData.filter(u => u.disability && u.disability !== 'none').length;

    return {
      ageDistribution: ages.length > 0 ? 
        `${Math.min(...ages)}-${Math.max(...ages)} years (avg: ${Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)})` : 
        'No age data',
      educationLevels: [...new Set(education)].join(', ') || 'No education data',
      familySizes: families.length > 0 ? 
        `${Math.min(...families)}-${Math.max(...families)} members` : 
        'No family data',
      disabilities
    };
  }

  /**
   * Process natural language query and extract intent
   */
  async processNaturalLanguage(query, context = {}) {
    const intentPrompt = `
Analyze this query and extract the intent and parameters:

Query: "${query}"

Available intents:
- stock_value: Get inventory/stock information
- financial_summary: Get financial overview  
- user_summary: Get user information
- weather_forecast: Get weather information
- rain_alert: Check rain alerts
- scheme_eligibility: Check government scheme eligibility
- scheme_description: Get scheme details
- loan_trends: Analyze loan patterns
- savings_alert: Check savings alerts

Respond with JSON only:
{
  "intent": "detected_intent",
  "confidence": 0.8,
  "parameters": {},
  "needsLLMResponse": true/false
}

If the query is conversational or needs detailed explanation, set needsLLMResponse to true.
`;

    try {
      const result = await this.model.generateContent(intentPrompt);
      const response = result.response.text();
      
      // Try to parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const intentData = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          ...intentData
        };
      }
      
      throw new Error('Could not parse intent from response');
      
    } catch (error) {
      logger.warn('Intent extraction failed', { query, error: error.message });
      
      // Fallback to simple keyword matching
      return this.fallbackIntentDetection(query);
    }
  }

  /**
   * Fallback intent detection using keywords
   */
  fallbackIntentDetection(query) {
    const lowerQuery = query.toLowerCase();
    
    const intentKeywords = {
      stock_value: ['stock', 'inventory', 'items', 'products', 'value'],
      financial_summary: ['money', 'finance', 'earnings', 'profit', 'income'],
      user_summary: ['users', 'people', 'workers', 'laborers', 'artisans'],
      weather_forecast: ['weather', 'rain', 'temperature', 'forecast'],
      scheme_eligibility: ['scheme', 'government', 'eligibility', 'benefits']
    };

    let bestMatch = { intent: 'financial_summary', confidence: 0.3 };
    
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      const matches = keywords.filter(keyword => lowerQuery.includes(keyword)).length;
      const confidence = matches / keywords.length;
      
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent, confidence };
      }
    }

    return {
      success: true,
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      parameters: {},
      needsLLMResponse: true
    };
  }

  /**
   * Estimate response confidence based on content
   */
  estimateConfidence(response) {
    const length = response.length;
    const hasNumbers = /\d/.test(response);
    const hasRupee = /₹/.test(response);
    const hasSpecifics = /\b(specific|exactly|precisely|according to)\b/i.test(response);
    
    let confidence = 0.7; // Base confidence
    
    if (length > 100) confidence += 0.1;
    if (hasNumbers) confidence += 0.1;
    if (hasRupee) confidence += 0.05;
    if (hasSpecifics) confidence += 0.05;
    
    return Math.min(confidence, 0.95);
  }

  /**
   * Generate conversational response with user data context
   */
  async generateConversationalResponse(intent, data, originalQuery) {
    const contextPrompt = `
Based on this ${intent} data, generate a conversational response to the user query.

Original Query: "${originalQuery}"

Data: ${JSON.stringify(data, null, 2)}

Guidelines:
- Be conversational and helpful
- Use Indian Rupee (₹) format for money
- Suggest actionable next steps if appropriate
- Keep language simple for rural users
- Be encouraging and supportive
- If numbers are involved, highlight key insights

Generate a response that feels natural and addresses their query directly.
`;

    try {
      const result = await this.model.generateContent(contextPrompt);
      return result.response.text();
    } catch (error) {
      logger.error('Failed to generate conversational response', { error: error.message });
      
      // Fallback to structured response
      return this.generateFallbackResponse(intent, data);
    }
  }

  /**
   * Generate fallback response when LLM fails
   */
  generateFallbackResponse(intent, data) {
    switch (intent) {
      case 'stock_value':
        return `Your current stock value is ₹${data.totalValue || 0}. You have ${data.totalItems || 0} items in inventory.`;
      
      case 'financial_summary':
        return `Financial Summary: Total invested ₹${data.totalInvested || 0}, Total earned ₹${data.totalEarned || 0}, Net profit ₹${data.totalProfit || 0}.`;
      
      case 'user_summary':
        return `You are supervising ${data.totalUsers || 0} users. ${data.summary || 'No additional details available.'}`;
      
      default:
        return 'I have the information you requested. Please let me know if you need any clarification.';
    }
  }
}

module.exports = new GeminiService();