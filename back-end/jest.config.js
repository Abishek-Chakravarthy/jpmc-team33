// jest.config.js
module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],

  // Test file patterns
  testMatch: [
    '**/test/**/*.test.js',
    '**/test/**/*-test.js',
    '**/__tests__/**/*.js'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__tests__/**',
    '!src/server.js',
    '!**/node_modules/**'
  ],

  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'html'
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Module path mapping (if needed)
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  // Test timeout
  testTimeout: 10000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Detect handles preventing Jest from exiting
  detectOpenHandles: true,

  // Force exit after tests complete
  forceExit: true,

  // Transform files (if using ES6 modules)
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Files to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/dist/'
  ],

  // Global variables available in tests
  globals: {
    'process.env.NODE_ENV': 'test'
  }
};