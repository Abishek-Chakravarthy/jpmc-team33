// test/chatbot.test.js
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock the services before requiring the chatbot module
jest.mock('../src/chatbot/chatbotService/inventoryService');
jest.mock('../src/chatbot/chatbotService/weatherService');
jest.mock('../src/chatbot/chatbotService/schemeService');
jest.mock('../src/chatbot/services/geminiService');
jest.mock('../src/chatbot/utils/logger');

const chatbotRouter = require('../src/chatbot');
const config = require('../src/chatbot/config');

// Mock services
const inventoryService = require('../src/chatbot/chatbotService/inventoryService');
const weatherService = require('../src/chatbot/chatbotService/weatherService');
const schemeService = require('../src/chatbot/chatbotService/schemeService');
const geminiService = require('../src/chatbot/services/geminiService');

describe('Chatbot API Tests', () => {
  let app;
  let validToken;
  let testSakhiId = 'test-sakhi-123';

  beforeAll(() => {
    // Setup Express app with chatbot router
    app = express();
    app.use('/chatbot', chatbotRouter);

    // Generate valid JWT token for testing
    validToken = jwt.sign(
      { sakhiId: testSakhiId, role: 'sakhi' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('Health Check Endpoints', () => {
    test('GET /chatbot/health - should return health status without auth', async () => {
      const response = await request(app)
        .get('/chatbot/health')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Chatbot service is running',
        timestamp: expect.any(String),
        version: expect.any(String)
      });
    });

    test('GET /chatbot/health (detailed) - should return service health with auth', async () => {
      geminiService.healthCheck.mockResolvedValue({
        status: 'healthy',
        model: 'gemini-2.0-flash-exp',
        responseTime: '120ms'
      });

      const response = await request(app)
        .get('/chatbot/health')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        services: expect.objectContaining({
          gemini: expect.any(Object),
          database: expect.any(String),
          redis: expect.any(String)
        }),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Authentication Tests', () => {
    test('should reject requests without token', async () => {
      const response = await request(app)
        .post('/chatbot/intent')
        .send({ intent: 'stock_value' })
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });

    test('should reject requests with invalid token', async () => {
      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', 'Bearer invalid-token')
        .send({ intent: 'stock_value' })
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });

    test('should accept requests with valid token', async () => {
      inventoryService.getStockValue.mockResolvedValue({
        totalValue: 50000,
        currency: 'INR',
        lastUpdated: new Date().toISOString()
      });

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ intent: 'stock_value' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Intent Processing Tests', () => {
    test('POST /chatbot/intent - stock_value intent', async () => {
      const mockStockData = {
        totalValue: 75000,
        currency: 'INR',
        categories: {
          electronics: 30000,
          clothing: 25000,
          food: 20000
        },
        lastUpdated: new Date().toISOString()
      };

      inventoryService.getStockValue.mockResolvedValue(mockStockData);

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intent: 'stock_value',
          params: { period: 'month' }
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        intent: 'stock_value',
        data: mockStockData,
        timestamp: expect.any(String),
        processingTime: expect.any(String)
      });

      expect(inventoryService.getStockValue).toHaveBeenCalledWith(
        testSakhiId,
        { period: 'month' }
      );
    });

    test('POST /chatbot/intent - weather_forecast intent', async () => {
      const mockWeatherData = {
        location: 'Mumbai',
        current: {
          temperature: 28,
          humidity: 75,
          description: 'Partly cloudy'
        },
        forecast: [
          { date: '2025-06-30', high: 30, low: 25, rain: 20 },
          { date: '2025-07-01', high: 29, low: 24, rain: 60 }
        ]
      };

      weatherService.getForecast.mockResolvedValue(mockWeatherData);

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intent: 'weather_forecast',
          params: { days: 3 }
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        intent: 'weather_forecast',
        data: mockWeatherData
      });

      expect(weatherService.getForecast).toHaveBeenCalledWith(
        testSakhiId,
        { days: 3 }
      );
    });

    test('POST /chatbot/intent - scheme_eligibility intent', async () => {
      const mockSchemeData = {
        totalUsers: 5,
        eligibleUsers: 3,
        schemes: {
          PM_KISAN: {
            eligible: ['user1', 'user2'],
            ineligible: ['user3']
          },
          MUDRA_LOAN: {
            eligible: ['user1'],
            ineligible: ['user2', 'user3']
          }
        }
      };

      schemeService.checkEligibility.mockResolvedValue(mockSchemeData);

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intent: 'scheme_eligibility',
          params: { schemes: ['PM_KISAN', 'MUDRA_LOAN'] }
        })
        .expect(200);

      expect(response.body.data).toEqual(mockSchemeData);
      expect(schemeService.checkEligibility).toHaveBeenCalledWith(
        testSakhiId,
        { schemes: ['PM_KISAN', 'MUDRA_LOAN'] }
      );
    });

    test('POST /chatbot/intent - should handle invalid intent', async () => {
      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intent: 'invalid_intent'
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Unsupported intent')
      });
    });

    test('POST /chatbot/intent - should handle missing required fields', async () => {
      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });
  });

  describe('Natural Language Processing Tests', () => {
    test('POST /chatbot/chat - should process natural language query', async () => {
      const mockIntentResult = {
        success: true,
        intent: 'stock_value',
        confidence: 0.85,
        parameters: { period: 'week' },
        needsLLMResponse: true
      };

      const mockStockData = {
        totalValue: 45000,
        currency: 'INR'
      };

      const mockConversationalResponse = {
        response: 'Your current stock value for this week is ₹45,000. This shows a healthy inventory level.',
        confidence: 0.9
      };

      geminiService.processNaturalLanguage.mockResolvedValue(mockIntentResult);
      inventoryService.getStockValue.mockResolvedValue(mockStockData);
      geminiService.generateConversationalResponse.mockResolvedValue(mockConversationalResponse);

      const response = await request(app)
        .post('/chatbot/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'What is my current stock value for this week?',
          includeConversational: true
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        originalQuery: 'What is my current stock value for this week?',
        detectedIntent: 'stock_value',
        confidence: 0.85,
        parameters: { period: 'week' },
        intentData: mockStockData,
        conversationalResponse: mockConversationalResponse,
        timestamp: expect.any(String),
        totalProcessingTime: expect.any(String)
      });
    });

    test('POST /chatbot/chat - should handle conversational queries', async () => {
      const mockIntentResult = {
        success: true,
        intent: 'conversational',
        confidence: 0.7,
        parameters: {},
        needsLLMResponse: true
      };

      const mockGeminiResponse = {
        response: 'Hello! I can help you with financial data, weather information, and government schemes. What would you like to know?',
        confidence: 0.8,
        processingTime: '150ms',
        model: 'gemini-2.0-flash-exp'
      };

      geminiService.processNaturalLanguage.mockResolvedValue(mockIntentResult);
      geminiService.generateResponse.mockResolvedValue(mockGeminiResponse);

      const response = await request(app)
        .post('/chatbot/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'Hello, how can you help me?'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        originalQuery: 'Hello, how can you help me?',
        detectedIntent: 'conversational',
        conversationalResponse: mockGeminiResponse.response,
        confidence: mockGeminiResponse.confidence
      });
    });

    test('POST /chatbot/chat - should handle short queries', async () => {
      const response = await request(app)
        .post('/chatbot/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'hi'
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('at least 2 characters')
      });
    });
  });

  describe('AI Response Tests', () => {
    test('POST /chatbot/ai - should generate AI response', async () => {
      const mockGeminiResponse = {
        response: 'Based on your financial data, I recommend focusing on increasing your savings rate and diversifying your income sources.',
        confidence: 0.88,
        processingTime: '200ms',
        model: 'gemini-2.0-flash-exp',
        contextUsed: true
      };

      geminiService.generateResponse.mockResolvedValue(mockGeminiResponse);

      const response = await request(app)
        .post('/chatbot/ai')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'Give me financial advice based on my data',
          context: { includeFinancialData: true }
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        query: 'Give me financial advice based on my data',
        response: mockGeminiResponse.response,
        confidence: mockGeminiResponse.confidence,
        model: mockGeminiResponse.model,
        timestamp: expect.any(String)
      });
    });
  });

  describe('Batch Processing Tests', () => {
    test('POST /chatbot/batch - should process multiple intents', async () => {
      inventoryService.getStockValue.mockResolvedValue({ totalValue: 50000 });
      weatherService.getForecast.mockResolvedValue({ temperature: 28 });
      inventoryService.getLoanTrends.mockResolvedValue({ totalLoans: 10 });

      const response = await request(app)
        .post('/chatbot/batch')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intents: [
            { intent: 'stock_value', params: {} },
            { intent: 'weather_forecast', params: { days: 2 } },
            { intent: 'loan_trends', params: {} }
          ]
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        totalRequests: 3,
        successfulRequests: 3,
        failedRequests: 0,
        results: expect.arrayContaining([
          expect.objectContaining({
            index: 0,
            intent: 'stock_value',
            success: true,
            data: expect.any(Object)
          }),
          expect.objectContaining({
            index: 1,
            intent: 'weather_forecast',
            success: true,
            data: expect.any(Object)
          }),
          expect.objectContaining({
            index: 2,
            intent: 'loan_trends',
            success: true,
            data: expect.any(Object)
          })
        ])
      });
    });

    test('POST /chatbot/batch - should handle mixed success/failure', async () => {
      inventoryService.getStockValue.mockResolvedValue({ totalValue: 50000 });
      weatherService.getForecast.mockRejectedValue(new Error('Weather service unavailable'));

      const response = await request(app)
        .post('/chatbot/batch')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          intents: [
            { intent: 'stock_value', params: {} },
            { intent: 'weather_forecast', params: {} }
          ]
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        totalRequests: 2,
        successfulRequests: 1,
        failedRequests: 1,
        results: expect.arrayContaining([
          expect.objectContaining({
            index: 0,
            intent: 'stock_value',
            success: true
          })
        ]),
        errors: expect.arrayContaining([
          expect.objectContaining({
            index: 1,
            intent: 'weather_forecast',
            success: false,
            error: expect.any(String)
          })
        ])
      });
    });

    test('POST /chatbot/batch - should reject too many intents', async () => {
      const manyIntents = Array(12).fill({ intent: 'stock_value', params: {} });

      const response = await request(app)
        .post('/chatbot/batch')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ intents: manyIntents })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Maximum 10 intents')
      });
    });
  });

  describe('Information Endpoints', () => {
    test('GET /chatbot/intents - should return supported intents', async () => {
      const response = await request(app)
        .get('/chatbot/intents')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        supportedIntents: expect.arrayContaining([
          'stock_value',
          'weather_forecast',
          'scheme_eligibility',
          'conversational'
        ]),
        descriptions: expect.any(Object),
        totalIntents: expect.any(Number),
        naturalLanguageSupported: true,
        aiModel: 'gemini-2.0-flash-exp'
      });

      // Check that all supported intents have descriptions
      expect(Object.keys(response.body.descriptions)).toEqual(
        expect.arrayContaining(response.body.supportedIntents)
      );
    });

    test('GET /chatbot/history - should return chat history placeholder', async () => {
      const response = await request(app)
        .get('/chatbot/history')
        .set('Authorization', `Bearer ${validToken}`)
        .query({ limit: 20, offset: 0 })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Chat history feature coming soon',
        sakhiId: testSakhiId,
        pagination: {
          limit: 20,
          offset: 0,
          total: 0
        },
        history: []
      });
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle service errors gracefully', async () => {
      inventoryService.getStockValue.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ intent: 'stock_value' })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });

    test('should handle 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/chatbot/unknown-route')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });

    test('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });
  });

  describe('Performance Tests', () => {
    test('should handle concurrent requests', async () => {
      inventoryService.getStockValue.mockResolvedValue({ totalValue: 50000 });

      const requests = Array(5).fill().map(() =>
        request(app)
          .post('/chatbot/intent')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ intent: 'stock_value' })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    test('should include processing time in responses', async () => {
      inventoryService.getStockValue.mockResolvedValue({ totalValue: 50000 });

      const response = await request(app)
        .post('/chatbot/intent')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ intent: 'stock_value' })
        .expect(200);

      expect(response.body.processingTime).toMatch(/^\d+ms$/);
    });
  });
});

// Additional test utilities
describe('Test Utilities', () => {
  test('should validate JWT token structure', () => {
    const decoded = jwt.decode(validToken);
    expect(decoded).toMatchObject({
      sakhiId: testSakhiId,
      role: 'sakhi',
      iat: expect.any(Number),
      exp: expect.any(Number)
    });
  });

  test('should create expired token for negative testing', () => {
    const expiredToken = jwt.sign(
      { sakhiId: testSakhiId, role: 'sakhi' },
      config.JWT_SECRET,
      { expiresIn: '-1h' }
    );

    expect(() => jwt.verify(expiredToken, config.JWT_SECRET)).toThrow();
  });
});