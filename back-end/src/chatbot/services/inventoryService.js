// /src/chatbot/chatbotService/inventoryService.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { DatabaseError, ValidationError } = require('../utils/errorHandler');
const config = require('../config');

/**
 * Get current stock/inventory value for AvaSakhi's users
 */
const getStockValue = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { period = 'current', category } = params;
    
    // Build aggregation pipeline to get inventory data
    const pipeline = [
      {
        $match: {
          sakhiId: new mongoose.Types.ObjectId(sakhiId),
          ...(category && { category })
        }
      },
      {
        $group: {
          _id: null,
          totalValue: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
          totalItems: { $sum: '$quantity' },
          categories: { $addToSet: '$category' },
          lastUpdated: { $max: '$updatedAt' }
        }
      }
    ];

    // Add date filtering based on period
    if (period !== 'current') {
      const dateFilter = getDateFilter(period);
      pipeline[0].$match.updatedAt = dateFilter;
    }

    const Inventory = mongoose.model('Inventory');
    const result = await Inventory.aggregate(pipeline);
    
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Inventory', pipeline[0].$match, duration);

    if (!result || result.length === 0) {
      return {
        success: true,
        message: "No inventory data found for the specified period.",
        data: {
          totalValue: 0,
          totalItems: 0,
          categories: [],
          period,
          lastUpdated: null
        }
      };
    }

    const stockData = result[0];
    
    return {
      success: true,
      message: `Current stock value: ₹${stockData.totalValue.toLocaleString('en-IN')}`,
      data: {
        totalValue: stockData.totalValue,
        totalItems: stockData.totalItems,
        categories: stockData.categories,
        period,
        lastUpdated: stockData.lastUpdated,
        averageItemValue: stockData.totalItems > 0 ? 
          Math.round(stockData.totalValue / stockData.totalItems) : 0
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Inventory', { sakhiId }, duration, error);
    throw new DatabaseError(`Failed to retrieve stock value: ${error.message}`, 'getStockValue');
  }
};

/**
 * Analyze loan disbursement trends
 */
const getLoanTrends = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { period = 'month', loanType } = params;
    
    const Financial = mongoose.model('Financial');
    
    // Get current period data
    const currentPeriodFilter = {
      sakhiId: new mongoose.Types.ObjectId(sakhiId),
      transactionType: 'loan_disbursement',
      createdAt: getDateFilter(period),
      ...(loanType && { loanType })
    };

    // Get previous period for comparison
    const previousPeriodFilter = {
      ...currentPeriodFilter,
      createdAt: getPreviousDateFilter(period)
    };

    const [currentPeriod, previousPeriod] = await Promise.all([
      Financial.aggregate([
        { $match: currentPeriodFilter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            totalLoans: { $sum: 1 },
            averageLoan: { $avg: '$amount' },
            loanTypes: { $addToSet: '$loanType' }
          }
        }
      ]),
      Financial.aggregate([
        { $match: previousPeriodFilter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            totalLoans: { $sum: 1 }
          }
        }
      ])
    ]);

    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', currentPeriodFilter, duration);

    const current = currentPeriod[0] || { totalAmount: 0, totalLoans: 0, averageLoan: 0, loanTypes: [] };
    const previous = previousPeriod[0] || { totalAmount: 0, totalLoans: 0 };

    // Calculate trends
    const amountChange = previous.totalAmount > 0 ? 
      ((current.totalAmount - previous.totalAmount) / previous.totalAmount * 100) : 0;
    const countChange = previous.totalLoans > 0 ? 
      ((current.totalLoans - previous.totalLoans) / previous.totalLoans * 100) : 0;

    const trendMessage = amountChange > 0 ? 
      `Loan disbursements increased by ${amountChange.toFixed(1)}% this ${period}` :
      amountChange < 0 ? 
      `Loan disbursements decreased by ${Math.abs(amountChange).toFixed(1)}% this ${period}` :
      `Loan disbursements remained stable this ${period}`;

    return {
      success: true,
      message: trendMessage,
      data: {
        current: {
          totalAmount: current.totalAmount,
          totalLoans: current.totalLoans,
          averageLoan: Math.round(current.averageLoan || 0),
          loanTypes: current.loanTypes
        },
        trends: {
          amountChange: Math.round(amountChange * 10) / 10,
          countChange: Math.round(countChange * 10) / 10,
          direction: amountChange > 5 ? 'increasing' : amountChange < -5 ? 'decreasing' : 'stable'
        },
        period,
        comparison: `vs previous ${period}`
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', { sakhiId }, duration, error);
    throw new DatabaseError(`Failed to analyze loan trends: ${error.message}`, 'getLoanTrends');
  }
};

/**
 * Check if savings alert should be triggered
 */
const checkSavingsAlert = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { threshold = config.SAVINGS_THRESHOLD } = params;
    
    const Financial = mongoose.model('Financial');
    
    // Get total savings for all users under this AvaSakhi
    const result = await Financial.aggregate([
      {
        $match: {
          sakhiId: new mongoose.Types.ObjectId(sakhiId),
          transactionType: 'savings_deposit'
        }
      },
      {
        $group: {
          _id: '$userId',
          totalSavings: { $sum: '$amount' },
          lastDeposit: { $max: '$createdAt' },
          depositCount: { $sum: 1 }
        }
      },
      {
        $match: {
          totalSavings: { $lt: threshold }
        }
      }
    ]);

    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', { sakhiId, threshold }, duration);

    const lowSavingsUsers = result.length;
    const shouldAlert = lowSavingsUsers > 0;

    let message;
    if (shouldAlert) {
      message = `Alert: ${lowSavingsUsers} user(s) have savings below ₹${threshold.toLocaleString('en-IN')}`;
    } else {
      message = `Good news! All users have savings above ₹${threshold.toLocaleString('en-IN')}`;
    }

    return {
      success: true,
      message,
      data: {
        alertTriggered: shouldAlert,
        threshold,
        usersBelow: lowSavingsUsers,
        details: result.map(user => ({
          userId: user._id,
          currentSavings: user.totalSavings,
          lastDeposit: user.lastDeposit,
          depositCount: user.depositCount,
          shortfall: threshold - user.totalSavings
        }))
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', { sakhiId }, duration, error);
    throw new DatabaseError(`Failed to check savings alert: ${error.message}`, 'checkSavingsAlert');
  }
};

/**
 * Get comprehensive financial summary
 */
const getFinancialSummary = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { period = 'month', includeProjections = false } = params;
    
    const Financial = mongoose.model('Financial');
    const dateFilter = getDateFilter(period);
    
    // Get financial data by transaction type
    const result = await Financial.aggregate([
      {
        $match: {
          sakhiId: new mongoose.Types.ObjectId(sakhiId),
          createdAt: dateFilter
        }
      },
      {
        $group: {
          _id: '$transactionType',
          totalAmount: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
          averageAmount: { $avg: '$amount' },
          lastTransaction: { $max: '$createdAt' }
        }
      }
    ]);

    // Get user count
    const User = mongoose.model('User');
    const userCount = await User.countDocuments({
      sakhiId: new mongoose.Types.ObjectId(sakhiId),
      isActive: true
    });

    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', { sakhiId }, duration);

    // Process results into summary
    const summary = {
      totalSavings: 0,
      totalLoans: 0,
      totalRevenue: 0,
      transactionCount: 0,
      activeUsers: userCount
    };

    const transactionBreakdown = {};

    result.forEach(item => {
      transactionBreakdown[item._id] = {
        amount: item.totalAmount,
        count: item.transactionCount,
        average: Math.round(item.averageAmount),
        lastTransaction: item.lastTransaction
      };

      summary.transactionCount += item.transactionCount;

      switch (item._id) {
        case 'savings_deposit':
          summary.totalSavings += item.totalAmount;
          break;
        case 'loan_disbursement':
          summary.totalLoans += item.totalAmount;
          break;
        case 'revenue':
        case 'interest_payment':
          summary.totalRevenue += item.totalAmount;
          break;
      }
    });

    // Calculate health metrics
    const healthMetrics = {
      savingsToLoanRatio: summary.totalLoans > 0 ? 
        Math.round(summary.totalSavings / summary.totalLoans * 100) / 100 : 0,
      avgTransactionPerUser: userCount > 0 ? 
        Math.round(summary.transactionCount / userCount * 10) / 10 : 0,
      avgSavingsPerUser: userCount > 0 ? 
        Math.round(summary.totalSavings / userCount) : 0
    };

    let message = `Financial summary for ${period}: ₹${summary.totalSavings.toLocaleString('en-IN')} in savings, `;
    message += `₹${summary.totalLoans.toLocaleString('en-IN')} in loans disbursed`;

    return {
      success: true,
      message,
      data: {
        summary,
        transactionBreakdown,
        healthMetrics,
        period,
        activeUsers: userCount,
        ...(includeProjections && {
          projections: calculateProjections(summary, period)
        })
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'Financial', { sakhiId }, duration, error);
    throw new DatabaseError(`Failed to get financial summary: ${error.message}`, 'getFinancialSummary');
  }
};

/**
 * Get summary of users under supervision
 */
const getUserSummary = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { includeInactive = false, category } = params;
    
    const User = mongoose.model('User');
    
    const matchFilter = {
      sakhiId: new mongoose.Types.ObjectId(sakhiId),
      ...(category && { category }),
      ...(!includeInactive && { isActive: true })
    };

    const result = await User.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          categories: { $addToSet: '$category' },
          avgAge: { $avg: '$age' },
          genderDistribution: {
            $push: '$gender'
          },
          lastRegistration: { $max: '$createdAt' }
        }
      }
    ]);

    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'User', matchFilter, duration);

    if (!result || result.length === 0) {
      return {
        success: true,
        message: "No users found matching the criteria.",
        data: {
          totalUsers: 0,
          activeUsers: 0,
          categories: [],
          demographics: {}
        }
      };
    }

    const userData = result[0];
    
    // Process gender distribution
    const genderCounts = userData.genderDistribution.reduce((acc, gender) => {
      acc[gender] = (acc[gender] || 0) + 1;
      return acc;
    }, {});

    const message = `Managing ${userData.activeUsers} active users out of ${userData.totalUsers} total`;

    return {
      success: true,
      message,
      data: {
        totalUsers: userData.totalUsers,
        activeUsers: userData.activeUsers,
        inactiveUsers: userData.totalUsers - userData.activeUsers,
        categories: userData.categories,
        demographics: {
          averageAge: Math.round(userData.avgAge || 0),
          genderDistribution: genderCounts
        },
        lastRegistration: userData.lastRegistration,
        includeInactive
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('aggregate', 'User', { sakhiId }, duration, error);
    throw new DatabaseError(`Failed to get user summary: ${error.message}`, 'getUserSummary');
  }
};

/**
 * Helper function to get date filter based on period
 */
const getDateFilter = (period) => {
  const now = new Date();
  let startDate;

  switch (period) {
    case 'day':
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'quarter':
      startDate = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      return {}; // No filter for 'current'
  }

  return { $gte: startDate };
};

/**
 * Helper function to get previous period date filter
 */
const getPreviousDateFilter = (period) => {
  const now = new Date();
  let startDate, endDate;

  switch (period) {
    case 'day':
      endDate = new Date(now.setHours(0, 0, 0, 0));
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      endDate = new Date(now.setDate(now.getDate() - 7));
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      endDate = new Date(now.setMonth(now.getMonth() - 1));
      startDate = new Date(endDate.getTime());
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'quarter':
      endDate = new Date(now.setMonth(now.getMonth() - 3));
      startDate = new Date(endDate.getTime());
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case 'year':
      endDate = new Date(now.setFullYear(now.getFullYear() - 1));
      startDate = new Date(endDate.getTime());
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      return {};
  }

  return { $gte: startDate, $lt: endDate };
};

/**
 * Calculate simple projections based on current trends
 */
const calculateProjections = (summary, period) => {
  const multiplier = {
    day: 30,
    week: 4,
    month: 12,
    quarter: 4,
    year: 1
  }[period] || 1;

  return {
    projectedAnnualSavings: summary.totalSavings * multiplier,
    projectedAnnualLoans: summary.totalLoans * multiplier,
    projectedAnnualRevenue: summary.totalRevenue * multiplier,
    note: `Projections based on current ${period} performance`
  };
};

module.exports = {
  getStockValue,
  getLoanTrends,
  checkSavingsAlert,
  getFinancialSummary,
  getUserSummary
};