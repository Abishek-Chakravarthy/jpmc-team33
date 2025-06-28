// /src/chatbot/chatbotService/schemeService.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { ValidationError, DatabaseError } = require('../utils/errorHandler');
const config = require('../config');

/**
 * Government schemes database with eligibility criteria
 */
const GOVERNMENT_SCHEMES = {
  'PM-KISAN': {
    code: 'PM-KISAN',
    name: 'Pradhan Mantri Kisan Samman Nidhi',
    category: 'agriculture',
    description: 'Direct income support to farmers with cultivable landholding',
    benefits: '₹6,000 per year in three installments of ₹2,000 each',
    eligibility: {
      landholding: { max: 2, unit: 'hectares' },
      category: ['farmer', 'landowner'],
      income: { max: null },
      age: { min: 18, max: null }
    },
    documents: ['Aadhaar Card', 'Land Records', 'Bank Account Details'],
    applicationProcess: 'Online through PM-KISAN portal or CSC centers',
    website: 'https://pmkisan.gov.in/',
    status: 'active'
  },
  
  'PM-FASAL-BIMA': {
    code: 'PM-FASAL-BIMA',
    name: 'Pradhan Mantri Fasal Bima Yojana',
    category: 'agriculture',
    description: 'Crop insurance scheme providing financial support to farmers',
    benefits: 'Insurance coverage for crop loss due to natural calamities',
    eligibility: {
      category: ['farmer', 'tenant_farmer', 'sharecropper'],
      landholding: { max: null, unit: 'hectares' },
      cropType: ['kharif', 'rabi', 'annual_commercial']
    },
    documents: ['Aadhaar Card', 'Land Records', 'Crop Details', 'Bank Account'],
    applicationProcess: 'Through banks, CSCs, or insurance companies',
    website: 'https://pmfby.gov.in/',
    status: 'active'
  },
  
  'MGNREGA': {
    code: 'MGNREGA',
    name: 'Mahatma Gandhi National Rural Employment Guarantee Act',
    category: 'employment',
    description: 'Guaranteed 100 days of wage employment to rural households',
    benefits: '100 days of guaranteed wage employment per household per year',
    eligibility: {
      location: 'rural',
      category: ['unskilled_worker'],
      age: { min: 18, max: null },
      household: 'rural'
    },
    documents: ['Aadhaar Card', 'Job Card', 'Bank Account Details'],
    applicationProcess: 'Apply at Gram Panchayat or online through MGNREGA website',
    website: 'https://nrega.nic.in/',
    status: 'active'
  },
  
  'PM-AWAS-GRAMIN': {
    code: 'PM-AWAS-GRAMIN',
    name: 'Pradhan Mantri Awaas Yojana - Gramin',
    category: 'housing',
    description: 'Housing assistance for rural poor',
    benefits: '₹1.20 lakh assistance for plain areas, ₹1.30 lakh for hilly areas',
    eligibility: {
      location: 'rural',
      housing: 'homeless_or_inadequate',
      income: { max: null },
      category: ['sc', 'st', 'minority', 'general']
    },
    documents: ['Aadhaar Card', 'Income Certificate', 'Caste Certificate', 'Bank Account'],
    applicationProcess: 'Through Gram Panchayat or online portal',
    website: 'https://pmayg.nic.in/',
    status: 'active'
  },
  
  'UJJWALA': {
    code: 'UJJWALA',
    name: 'Pradhan Mantri Ujjwala Yojana',
    category: 'energy',
    description: 'Free LPG connections to women from BPL households',
    benefits: 'Free LPG connection with first cylinder and stove',
    eligibility: {
      gender: 'female',
      category: ['bpl'],
      age: { min: 18, max: null },
      lpgConnection: false
    },
    documents: ['Aadhaar Card', 'BPL Certificate', 'Bank Account Details', 'Address Proof'],
    applicationProcess: 'Through LPG distributors or online',
    website: 'https://www.pmuy.gov.in/',
    status: 'active'
  },
  
  'MUDRA': {
    code: 'MUDRA',
    name: 'Pradhan Mantri MUDRA Yojana',
    category: 'finance',
    description: 'Micro-finance support for small businesses',
    benefits: 'Loans up to ₹10 lakh for micro enterprises',
    eligibility: {
      businessType: ['micro_enterprise', 'small_business'],
      loanAmount: { max: 1000000 },
      category: ['entrepreneur', 'self_employed']
    },
    subcategories: {
      'SHISHU': { max: 50000, description: 'Loans up to ₹50,000' },
      'KISHOR': { max: 500000, description: 'Loans from ₹50,001 to ₹5 lakh' },
      'TARUN': { max: 1000000, description: 'Loans from ₹5,00,001 to ₹10 lakh' }
    },
    documents: ['Aadhaar Card', 'Business Plan', 'Income Proof', 'Bank Statements'],
    applicationProcess: 'Through banks, NBFCs, MFIs',
    website: 'https://www.mudra.org.in/',
    status: 'active'
  },
  
  'SBM-G': {
    code: 'SBM-G',
    name: 'Swachh Bharat Mission - Gramin',
    category: 'sanitation',
    description: 'Individual household latrines in rural areas',
    benefits: '₹12,000 incentive for toilet construction',
    eligibility: {
      location: 'rural',
      toilet: false,
      category: ['rural_household']
    },
    documents: ['Aadhaar Card', 'Bank Account Details', 'Photograph of site'],
    applicationProcess: 'Through Gram Panchayat or Swachh Bharat Mission portal',
    website: 'https://sbm.gov.in/',
    status: 'active'
  },
  
  'PMGSY': {
    code: 'PMGSY',
    name: 'Pradhan Mantri Gram Sadak Yojana',
    category: 'infrastructure',
    description: 'Rural road connectivity program',
    benefits: 'All-weather road connectivity to unconnected villages',
    eligibility: {
      location: 'rural',
      population: { min: 500 },
      roadConnectivity: false
    },
    documents: ['Village Census Data', 'Population Certificate'],
    applicationProcess: 'Through State Rural Roads Development Agency',
    website: 'https://omms.nic.in/',
    status: 'active'
  }
};

/**
 * Check eligibility for government schemes
 */
const checkEligibility = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { userId, schemeCode, userProfile } = params;
    
    if (!userId && !userProfile) {
      throw new ValidationError('User ID or user profile is required');
    }

    // Get user profile from database if not provided
    let profile = userProfile;
    if (!profile && userId) {
      profile = await getUserProfile(userId, sakhiId);
    }

    if (!profile) {
      throw new ValidationError('User profile not found');
    }

    let eligibleSchemes = [];
    let schemesToCheck = [];

    // Check specific scheme or all schemes
    if (schemeCode) {
      if (!GOVERNMENT_SCHEMES[schemeCode]) {
        throw new ValidationError(`Scheme not found: ${schemeCode}`);
      }
      schemesToCheck = [GOVERNMENT_SCHEMES[schemeCode]];
    } else {
      schemesToCheck = Object.values(GOVERNMENT_SCHEMES);
    }

    // Check eligibility for each scheme
    for (const scheme of schemesToCheck) {
      const eligibilityResult = checkSchemeEligibility(profile, scheme);
      if (eligibilityResult.eligible) {
        eligibleSchemes.push({
          ...scheme,
          eligibilityScore: eligibilityResult.score,
          reasons: eligibilityResult.reasons
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.logDbOperation('scheme_eligibility_check', 'schemes', { userId, schemeCode }, duration);

    // Sort by eligibility score (most suitable first)
    eligibleSchemes.sort((a, b) => b.eligibilityScore - a.eligibilityScore);

    const message = generateEligibilityMessage(eligibleSchemes, schemeCode);

    return {
      success: true,
      message,
      data: {
        userId: userId || profile.userId,
        totalEligibleSchemes: eligibleSchemes.length,
        eligibleSchemes: eligibleSchemes.slice(0, 5), // Top 5 schemes
        checkedAt: new Date().toISOString(),
        profile: {
          location: profile.location,
          category: profile.category,
          occupation: profile.occupation
        }
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logDbOperation('scheme_eligibility_check', 'schemes', { userId: params.userId }, duration, error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new DatabaseError(`Eligibility check failed: ${error.message}`);
  }
};

/**
 * Get detailed scheme information
 */
const getSchemeDetails = async (sakhiId, params = {}) => {
  try {
    const { schemeCode, category } = params;
    
    if (schemeCode) {
      // Get specific scheme details
      const scheme = GOVERNMENT_SCHEMES[schemeCode];
      if (!scheme) {
        throw new ValidationError(`Scheme not found: ${schemeCode}`);
      }

      const message = `${scheme.name}: ${scheme.description}`;
      
      return {
        success: true,
        message,
        data: {
          scheme,
          applicationSteps: generateApplicationSteps(scheme),
          relatedSchemes: findRelatedSchemes(scheme.category)
        }
      };
    } else if (category) {
      // Get schemes by category
      const categorySchemes = Object.values(GOVERNMENT_SCHEMES)
        .filter(scheme => scheme.category === category);
        
      if (categorySchemes.length === 0) {
        throw new ValidationError(`No schemes found for category: ${category}`);
      }

      const message = `Found ${categorySchemes.length} schemes in ${category} category`;
      
      return {
        success: true,
        message,
        data: {
          category,
          schemes: categorySchemes,
          totalCount: categorySchemes.length
        }
      };
    } else {
      // Get all schemes
      const allSchemes = Object.values(GOVERNMENT_SCHEMES);
      const schemesByCategory = groupSchemesByCategory(allSchemes);
      
      return {
        success: true,
        message: `${allSchemes.length} government schemes available`,
        data: {
          totalSchemes: allSchemes.length,
          categories: Object.keys(schemesByCategory),
          schemesByCategory
        }
      };
    }

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new DatabaseError(`Failed to fetch scheme details: ${error.message}`);
  }
};

/**
 * Search schemes by keywords
 */
const searchSchemes = async (sakhiId, params = {}) => {
  try {
    const { query, category, maxResults = 10 } = params;
    
    if (!query) {
      throw new ValidationError('Search query is required');
    }

    const searchTerms = query.toLowerCase().split(' ');
    const allSchemes = Object.values(GOVERNMENT_SCHEMES);
    
    let filteredSchemes = allSchemes;
    
    // Filter by category if specified
    if (category) {
      filteredSchemes = filteredSchemes.filter(scheme => scheme.category === category);
    }
    
    // Search in scheme name, description, and benefits
    const matchedSchemes = filteredSchemes.map(scheme => {
      const searchText = `${scheme.name} ${scheme.description} ${scheme.benefits}`.toLowerCase();
      const matchScore = searchTerms.reduce((score, term) => {
        return score + (searchText.includes(term) ? 1 : 0);
      }, 0);
      
      return { ...scheme, matchScore };
    })
    .filter(scheme => scheme.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxResults);

    const message = `Found ${matchedSchemes.length} schemes for "${query}"`;

    return {
      success: true,
      message,
      data: {
        query,
        category,
        results: matchedSchemes,
        totalMatches: matchedSchemes.length
      }
    };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new DatabaseError(`Scheme search failed: ${error.message}`);
  }
};

/**
 * Get application status and tracking
 */
const getApplicationStatus = async (sakhiId, params = {}) => {
  try {
    const { userId, schemeCode, applicationId } = params;
    
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // In a real implementation, this would query an applications database
    // For now, we'll provide guidance on how to check status
    
    const scheme = GOVERNMENT_SCHEMES[schemeCode];
    if (!scheme) {
      throw new ValidationError(`Scheme not found: ${schemeCode}`);
    }

    const trackingInfo = getTrackingInformation(scheme);
    
    return {
      success: true,
      message: `Application status tracking information for ${scheme.name}`,
      data: {
        scheme: {
          code: scheme.code,
          name: scheme.name
        },
        trackingMethods: trackingInfo,
        helplineNumbers: getHelplineNumbers(scheme.category),
        statusCheckSteps: [
          'Visit the official scheme website',
          'Enter your application ID or Aadhaar number',
          'Check application status and progress',
          'Contact helpline if issues persist'
        ]
      }
    };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new DatabaseError(`Failed to get application status: ${error.message}`);
  }
};

/**
 * Helper function to get user profile from database
 */
const getUserProfile = async (userId, sakhiId) => {
  try {
    const User = mongoose.model('User');
    
    const user = await User.findOne({ 
      _id: userId, 
      sakhiId: sakhiId 
    }).select('personalInfo demographics location occupation category income landholding');
    
    if (!user) {
      return null;
    }

    // Transform database user to profile format
    return {
      userId: user._id,
      age: user.personalInfo?.age,
      gender: user.personalInfo?.gender,
      category: user.demographics?.category,
      location: user.location || 'rural',
      occupation: user.occupation,
      income: user.income?.monthly,
      landholding: user.landholding?.total,
      hasToilet: user.personalInfo?.hasToilet,
      hasLPGConnection: user.personalInfo?.hasLPGConnection,
      housing: user.personalInfo?.housingType
    };
    
  } catch (error) {
    logger.error('Error fetching user profile for scheme eligibility', { 
      userId, 
      sakhiId, 
      error: error.message 
    });
    return null;
  }
};

/**
 * Check eligibility for a specific scheme
 */
const checkSchemeEligibility = (profile, scheme) => {
  let eligible = true;
  let score = 0;
  const reasons = [];
  const eligibility = scheme.eligibility;

  // Check age criteria
  if (eligibility.age) {
    if (eligibility.age.min && profile.age < eligibility.age.min) {
      eligible = false;
      reasons.push(`Minimum age required: ${eligibility.age.min}`);
    } else if (eligibility.age.max && profile.age > eligibility.age.max) {
      eligible = false;
      reasons.push(`Maximum age limit: ${eligibility.age.max}`);
    } else {
      score += 10;
    }
  }

  // Check income criteria
  if (eligibility.income && eligibility.income.max && profile.income > eligibility.income.max) {
    eligible = false;
    reasons.push(`Income exceeds maximum limit: ₹${eligibility.income.max}`);
  } else if (eligibility.income) {
    score += 15;
  }

  // Check landholding criteria
  if (eligibility.landholding) {
    if (eligibility.landholding.max && profile.landholding > eligibility.landholding.max) {
      eligible = false;
      reasons.push(`Landholding exceeds limit: ${eligibility.landholding.max} ${eligibility.landholding.unit}`);
    } else {
      score += 20;
    }
  }

  // Check category criteria
  if (eligibility.category && !eligibility.category.includes(profile.category)) {
    eligible = false;
    reasons.push(`Category not eligible: ${profile.category}`);
  } else if (eligibility.category) {
    score += 15;
  }

  // Check location criteria
  if (eligibility.location && profile.location !== eligibility.location) {
    eligible = false;
    reasons.push(`Location requirement: ${eligibility.location}`);
  } else if (eligibility.location) {
    score += 10;
  }

  // Check gender criteria
  if (eligibility.gender && profile.gender !== eligibility.gender) {
    eligible = false;
    reasons.push(`Gender requirement: ${eligibility.gender}`);
  } else if (eligibility.gender) {
    score += 10;
  }

  // Check specific criteria
  if (eligibility.toilet === false && profile.hasToilet) {
    eligible = false;
    reasons.push('Already has toilet facility');
  }

  if (eligibility.lpgConnection === false && profile.hasLPGConnection) {
    eligible = false;
    reasons.push('Already has LPG connection');
  }

  return { eligible, score, reasons };
};

/**
 * Generate eligibility message
 */
const generateEligibilityMessage = (eligibleSchemes, schemeCode) => {
  if (schemeCode) {
    return eligibleSchemes.length > 0 
      ? `You are eligible for ${eligibleSchemes[0].name}`
      : `You are not eligible for the requested scheme`;
  }
  
  if (eligibleSchemes.length === 0) {
    return 'No schemes found matching your profile. Consider updating your information.';
  }
  
  if (eligibleSchemes.length === 1) {
    return `You are eligible for 1 government scheme: ${eligibleSchemes[0].name}`;
  }
  
  return `You are eligible for ${eligibleSchemes.length} government schemes`;
};

/**
 * Generate application steps
 */
const generateApplicationSteps = (scheme) => {
  return [
    'Gather required documents',
    'Visit the official website or nearest CSC center',
    'Fill the application form with accurate details',
    'Upload required documents',
    'Submit application and note the reference number',
    'Track application status regularly'
  ];
};

/**
 * Find related schemes by category
 */
const findRelatedSchemes = (category, limit = 3) => {
  return Object.values(GOVERNMENT_SCHEMES)
    .filter(scheme => scheme.category === category)
    .slice(0, limit)
    .map(scheme => ({
      code: scheme.code,
      name: scheme.name,
      benefits: scheme.benefits
    }));
};

/**
 * Group schemes by category
 */
const groupSchemesByCategory = (schemes) => {
  return schemes.reduce((groups, scheme) => {
    const category = scheme.category;
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(scheme);
    return groups;
  }, {});
};

/**
 * Get tracking information for schemes
 */
const getTrackingInformation = (scheme) => {
  const commonMethods = [
    'Official website application status page',
    'Mobile app (if available)',
    'SMS service with application ID',
    'Call center helpline'
  ];
  
  const schemeSpecific = {
    'PM-KISAN': ['PM-KISAN mobile app', 'pmkisan.gov.in status page'],
    'MGNREGA': ['MGNREGA website', 'Job card number tracking'],
    'MUDRA': ['Bank branch visit', 'MUDRA portal'],
    'UJJWALA': ['LPG distributor inquiry', 'PMUY website']
  };
  
  return {
    common: commonMethods,
    specific: schemeSpecific[scheme.code] || []
  };
};

/**
 * Get helpline numbers by category
 */
const getHelplineNumbers = (category) => {
  const helplines = {
    agriculture: ['PM-KISAN: 155261', 'Kisan Call Center: 1800-180-1551'],
    employment: ['MGNREGA: 1800-345-22-44'],
    housing: ['PM-AWAS: 1800-11-6446'],
    finance: ['MUDRA: 1800-180-11-11'],
    general: ['National Helpline: 14546']
  };
  
  return helplines[category] || helplines.general;
};

module.exports = {
  checkEligibility,
  getSchemeDetails,
  searchSchemes,
  getApplicationStatus,
  GOVERNMENT_SCHEMES // Export for testing
};