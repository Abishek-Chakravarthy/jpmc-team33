// /src/chatbot/utils/jwtMiddleware.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

/**
 * Middleware to verify JWT token and extract sakhiId
 * Expects Authorization header: "Bearer <token>"
 */
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      logger.warn('No authorization header provided', { ip: req.ip });
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.',
        errorCode: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1]; // Remove "Bearer " prefix
    
    if (!token) {
      logger.warn('Invalid authorization header format', { ip: req.ip });
      return res.status(401).json({
        success: false,
        error: 'Access denied. Invalid token format.',
        errorCode: 'INVALID_TOKEN_FORMAT'
      });
    }

    // Verify and decode token
    const decoded = jwt.verify(token, config.JWT_SECRET);
    
    // Extract sakhiId from token payload
    if (!decoded.sakhiId && !decoded.id) {
      logger.warn('Token missing sakhiId', { tokenPayload: decoded });
      return res.status(401).json({
        success: false,
        error: 'Invalid token payload.',
        errorCode: 'INVALID_TOKEN_PAYLOAD'
      });
    }

    // Attach user info to request object
    req.sakhiId = decoded.sakhiId || decoded.id;
    req.userType = decoded.userType || 'avaSakhi';
    req.email = decoded.email;
    
    logger.info('Token verified successfully', { 
      sakhiId: req.sakhiId,
      userType: req.userType,
      ip: req.ip 
    });
    
    next();
    
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Expired token used', { ip: req.ip });
      return res.status(401).json({
        success: false,
        error: 'Token has expired.',
        errorCode: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token used', { ip: req.ip, error: error.message });
      return res.status(401).json({
        success: false,
        error: 'Invalid token.',
        errorCode: 'INVALID_TOKEN'
      });
    }
    
    logger.error('JWT verification error', { error: error.message, ip: req.ip });
    return res.status(500).json({
      success: false,
      error: 'Token verification failed.',
      errorCode: 'TOKEN_VERIFICATION_ERROR'
    });
  }
};

/**
 * Optional middleware for admin-only routes
 */
const verifyAdmin = (req, res, next) => {
  if (req.userType !== 'admin') {
    logger.warn('Non-admin trying to access admin route', { 
      sakhiId: req.sakhiId,
      userType: req.userType,
      ip: req.ip 
    });
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.',
      errorCode: 'INSUFFICIENT_PRIVILEGES'
    });
  }
  next();
};

/**
 * Middleware to extract sakhiId from token without strict verification
 * Useful for logging and analytics
 */
const extractSakhiId = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const decoded = jwt.decode(token); // Don't verify, just decode
        req.sakhiId = decoded?.sakhiId || decoded?.id;
        req.userType = decoded?.userType;
      }
    }
  } catch (error) {
    // Silently fail, don't block request
    logger.debug('Could not extract sakhiId from token', { error: error.message });
  }
  next();
};

module.exports = {
  verifyToken,
  verifyAdmin,
  extractSakhiId
};