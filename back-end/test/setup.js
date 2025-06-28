// test/setup.js
// Global test setup for Jest

// Set environment to test
process.env.NODE_ENV = 'test';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-key-12345';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';
process.env.WEATHER_API_KEY = 'test-weather-api-key';

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  // Uncomment to suppress console output during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global beforeEach to reset mocks
beforeEach(() => {
  jest.clearAllMocks();
});

// Global afterEach cleanup
afterEach(() => {
  // Clean up any test artifacts
  jest.restoreAllMocks();
});

// Mock Date.now for consistent testing
const mockDate = new Date('2025-06-29T10:00:00.000Z');
global.Date = class extends Date {
  constructor(...args) {
    if (args.length === 0) {
      return mockDate;
    }
    return new Date(...args);
  }

  static now() {
    return mockDate.getTime();
  }
};