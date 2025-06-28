// /src/chatbot/chatbotService/weatherService.js
const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { ExternalApiError, DatabaseError, ValidationError } = require('../utils/errorHandler');
const config = require('../config');

/**
 * Get weather forecast for user's location
 */
const getForecast = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { days = 3, location } = params;
    
    if (days < 1 || days > 7) {
      throw new ValidationError('Forecast days must be between 1 and 7');
    }

    // Get user location if not provided
    let userLocation = location;
    if (!userLocation) {
      userLocation = await getUserLocation(sakhiId);
    }

    if (!userLocation) {
      throw new ValidationError('Location not found. Please provide location or update your profile.');
    }

    // Call weather API
    const weatherData = await callWeatherAPI(userLocation, days);
    
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, 200);

    // Format forecast data
    const forecast = formatForecastData(weatherData, days);
    
    // Generate weather summary message
    const summary = generateWeatherSummary(forecast);

    return {
      success: true,
      message: summary,
      data: {
        location: {
          name: weatherData.city.name,
          country: weatherData.city.country,
          coordinates: {
            lat: weatherData.city.coord.lat,
            lon: weatherData.city.coord.lon
          }
        },
        forecast,
        requestedDays: days,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, null, error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ExternalApiError(
      `Weather service temporarily unavailable: ${error.message}`,
      'OpenWeatherMap'
    );
  }
};

/**
 * Check rain alert based on threshold
 */
const checkRainAlert = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { 
      threshold = config.RAIN_THRESHOLD_MM, 
      date = new Date().toISOString().split('T')[0] 
    } = params;

    if (threshold < 0) {
      throw new ValidationError('Rain threshold must be positive');
    }

    // Get user location
    const userLocation = await getUserLocation(sakhiId);
    if (!userLocation) {
      throw new ValidationError('Location not found. Please update your profile with location details.');
    }

    // Get weather forecast
    const weatherData = await callWeatherAPI(userLocation, 5); // Get 5-day forecast
    
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, 200);

    // Check for rain on specified date
    const targetDate = new Date(date);
    const alerts = checkRainInForecast(weatherData, targetDate, threshold);

    let message;
    if (alerts.rainExpected) {
      message = `Rain Alert! Expected ${alerts.maxRainfall}mm on ${date}. Threshold: ${threshold}mm`;
    } else {
      message = `No significant rain expected on ${date}. All clear!`;
    }

    return {
      success: true,
      message,
      data: {
        alertTriggered: alerts.rainExpected,
        threshold,
        targetDate: date,
        location: weatherData.city.name,
        rainfall: {
          expected: alerts.maxRainfall,
          probability: alerts.rainProbability,
          timeOfDay: alerts.timeOfDay
        },
        recommendations: generateRainRecommendations(alerts, threshold)
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, null, error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ExternalApiError(
      `Rain alert service temporarily unavailable: ${error.message}`,
      'OpenWeatherMap'
    );
  }
};

/**
 * Get current weather conditions
 */
const getCurrentWeather = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { location } = params;
    
    // Get user location if not provided
    let userLocation = location;
    if (!userLocation) {
      userLocation = await getUserLocation(sakhiId);
    }

    if (!userLocation) {
      throw new ValidationError('Location not found. Please provide location or update your profile.');
    }

    // Call current weather API
    const url = `${config.WEATHER_API_URL}/weather`;
    const response = await axios.get(url, {
      params: {
        q: userLocation,
        appid: config.WEATHER_API_KEY,
        units: 'metric'
      },
      timeout: 10000
    });

    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/weather', duration, response.status);

    const weather = response.data;
    const temperature = Math.round(weather.main.temp);
    const feelsLike = Math.round(weather.main.feels_like);
    const description = weather.weather[0].description;

    const message = `Current weather in ${weather.name}: ${temperature}°C, ${description}`;

    return {
      success: true,
      message,
      data: {
        location: {
          name: weather.name,
          country: weather.sys.country
        },
        current: {
          temperature,
          feelsLike,
          humidity: weather.main.humidity,
          pressure: weather.main.pressure,
          description,
          windSpeed: weather.wind.speed,
          visibility: weather.visibility / 1000 // Convert to km
        },
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/weather', duration, null, error);
    
    throw new ExternalApiError(
      `Current weather service temporarily unavailable: ${error.message}`,
      'OpenWeatherMap'
    );
  }
};

/**
 * Get agricultural weather advisory
 */
const getAgricultureAdvisory = async (sakhiId, params = {}) => {
  const startTime = Date.now();
  
  try {
    const { crop = 'general', season = 'current' } = params;
    
    // Get user location
    const userLocation = await getUserLocation(sakhiId);
    if (!userLocation) {
      throw new ValidationError('Location not found. Please update your profile with location details.');
    }

    // Get extended forecast for agricultural analysis
    const weatherData = await callWeatherAPI(userLocation, 7);
    
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, 200);

    // Analyze weather conditions for agriculture
    const advisory = generateAgricultureAdvisory(weatherData, crop, season);

    return {
      success: true,
      message: advisory.summary,
      data: {
        location: weatherData.city.name,
        crop,
        season,
        advisory: advisory.recommendations,
        weatherConditions: advisory.conditions,
        alerts: advisory.alerts,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logApiCall('OpenWeatherMap', '/forecast', duration, null, error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ExternalApiError(
      `Agriculture advisory service temporarily unavailable: ${error.message}`,
      'OpenWeatherMap'
    );
  }
};

/**
 * Helper function to get user location from database
 */
const getUserLocation = async (sakhiId) => {
  try {
    const User = mongoose.model('User');
    const AvaSakhi = mongoose.model('AvaSakhi');
    
    // First try to get location from AvaSakhi profile
    const avaSakhi = await AvaSakhi.findById(sakhiId).select('location address city state');
    
    if (avaSakhi && avaSakhi.location) {
      return avaSakhi.location;
    }
    
    if (avaSakhi && avaSakhi.city) {
      return `${avaSakhi.city}, ${avaSakhi.state || 'India'}`;
    }
    
    // Fallback to users under supervision (common location)
    const user = await User.findOne({ sakhiId }).select('location address city state');
    
    if (user && user.location) {
      return user.location;
    }
    
    if (user && user.city) {
      return `${user.city}, ${user.state || 'India'}`;
    }
    
    return null;
    
  } catch (error) {
    logger.error('Error fetching user location', { sakhiId, error: error.message });
    return null;
  }
};

/**
 * Call OpenWeatherMap API for forecast
 */
const callWeatherAPI = async (location, days) => {
  const url = `${config.WEATHER_API_URL}/forecast`;
  
  const response = await axios.get(url, {
    params: {
      q: location,
      appid: config.WEATHER_API_KEY,
      units: 'metric',
      cnt: days * 8 // 8 forecasts per day (3-hour intervals)
    },
    timeout: 10000
  });

  if (response.status !== 200) {
    throw new Error(`Weather API returned status ${response.status}`);
  }

  return response.data;
};

/**
 * Format forecast data for response
 */
const formatForecastData = (weatherData, days) => {
  const forecast = [];
  const dailyData = {};

  // Group forecasts by date
  weatherData.list.forEach(item => {
    const date = item.dt_txt.split(' ')[0];
    if (!dailyData[date]) {
      dailyData[date] = [];
    }
    dailyData[date].push(item);
  });

  // Process each day
  Object.keys(dailyData).slice(0, days).forEach(date => {
    const dayForecasts = dailyData[date];
    
    // Calculate daily aggregates
    const temperatures = dayForecasts.map(f => f.main.temp);
    const rainfall = dayForecasts.reduce((sum, f) => sum + (f.rain?.['3h'] || 0), 0);
    const humidity = dayForecasts.reduce((sum, f) => sum + f.main.humidity, 0) / dayForecasts.length;
    
    const dayForecast = {
      date,
      temperature: {
        min: Math.round(Math.min(...temperatures)),
        max: Math.round(Math.max(...temperatures)),
        avg: Math.round(temperatures.reduce((a, b) => a + b, 0) / temperatures.length)
      },
      weather: {
        description: dayForecasts[Math.floor(dayForecasts.length / 2)].weather[0].description,
        icon: dayForecasts[Math.floor(dayForecasts.length / 2)].weather[0].icon
      },
      rainfall: Math.round(rainfall * 10) / 10,
      humidity: Math.round(humidity),
      windSpeed: Math.round(dayForecasts[0].wind.speed * 10) / 10
    };

    forecast.push(dayForecast);
  });

  return forecast;
};

/**
 * Generate weather summary message
 */
const generateWeatherSummary = (forecast) => {
  if (forecast.length === 0) return 'No forecast data available';
  
  const today = forecast[0];
  let summary = `Today: ${today.temperature.max}°C/${today.temperature.min}°C, ${today.weather.description}`;
  
  // Check for rain
  const rainyDays = forecast.filter(day => day.rainfall > 5).length;
  if (rainyDays > 0) {
    summary += `. Rain expected on ${rainyDays} day(s)`;
  }
  
  return summary;
};

/**
 * Check for rain in forecast data
 */
const checkRainInForecast = (weatherData, targetDate, threshold) => {
  const targetDateStr = targetDate.toISOString().split('T')[0];
  let maxRainfall = 0;
  let rainProbability = 0;
  let timeOfDay = null;
  
  // Filter forecasts for target date
  const dayForecasts = weatherData.list.filter(item => {
    return item.dt_txt.startsWith(targetDateStr);
  });

  dayForecasts.forEach(forecast => {
    const rainfall = forecast.rain?.['3h'] || 0;
    if (rainfall > maxRainfall) {
      maxRainfall = rainfall;
      timeOfDay = new Date(forecast.dt * 1000).toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    }
    rainProbability = Math.max(rainProbability, forecast.pop * 100); // Probability of precipitation
  });

  return {
    rainExpected: maxRainfall >= threshold,
    maxRainfall: Math.round(maxRainfall * 10) / 10,
    rainProbability: Math.round(rainProbability),
    timeOfDay
  };
};

/**
 * Generate rain-based recommendations
 */
const generateRainRecommendations = (alerts, threshold) => {
  const recommendations = [];
  
  if (alerts.rainExpected) {
    recommendations.push(`Heavy rain expected (${alerts.maxRainfall}mm). Consider postponing outdoor work.`);
    
    if (alerts.maxRainfall > threshold * 2) {
      recommendations.push('Very heavy rainfall predicted. Ensure proper drainage and secure loose items.');
    }
    
    recommendations.push('Good time for rainwater harvesting if systems are in place.');
    recommendations.push('Check weather updates regularly for any changes.');
  } else {
    recommendations.push('Good weather for outdoor agricultural activities.');
    recommendations.push('Consider irrigation if needed as no significant rain expected.');
  }
  
  return recommendations;
};

/**
 * Generate agriculture-specific weather advisory
 */
const generateAgricultureAdvisory = (weatherData, crop, season) => {
  const forecast = formatForecastData(weatherData, 7);
  const conditions = analyzeAgricultureConditions(forecast);
  const recommendations = [];
  const alerts = [];
  
  // Temperature analysis
  if (conditions.avgTemp > 35) {
    alerts.push('High temperature alert - protect crops from heat stress');
    recommendations.push('Increase irrigation frequency during hot weather');
    recommendations.push('Consider shade nets for sensitive crops');
  } else if (conditions.avgTemp < 10) {
    alerts.push('Low temperature alert - protect crops from cold');
    recommendations.push('Cover sensitive plants during cold nights');
  }
  
  // Rainfall analysis
  if (conditions.totalRain > 50) {
    alerts.push('Heavy rainfall expected - ensure proper drainage');
    recommendations.push('Avoid pesticide/fertilizer application before heavy rain');
    recommendations.push('Harvest ready crops before rain if possible');
  } else if (conditions.totalRain < 5) {
    alerts.push('Low rainfall - irrigation may be needed');
    recommendations.push('Plan irrigation schedule for water-sensitive crops');
  }
  
  // Humidity analysis
  if (conditions.avgHumidity > 80) {
    alerts.push('High humidity - fungal disease risk');
    recommendations.push('Monitor crops for fungal infections');
    recommendations.push('Ensure good air circulation around plants');
  }
  
  // Crop-specific recommendations
  if (crop !== 'general') {
    recommendations.push(...getCropSpecificAdvice(crop, conditions, season));
  }
  
  const summary = generateAdvisorySummary(alerts, recommendations);
  
  return {
    summary,
    recommendations,
    alerts,
    conditions
  };
};

/**
 * Analyze weather conditions for agriculture
 */
const analyzeAgricultureConditions = (forecast) => {
  const totalRain = forecast.reduce((sum, day) => sum + day.rainfall, 0);
  const avgTemp = forecast.reduce((sum, day) => sum + day.temperature.avg, 0) / forecast.length;
  const avgHumidity = forecast.reduce((sum, day) => sum + day.humidity, 0) / forecast.length;
  const maxTemp = Math.max(...forecast.map(day => day.temperature.max));
  const minTemp = Math.min(...forecast.map(day => day.temperature.min));
  
  return {
    totalRain: Math.round(totalRain * 10) / 10,
    avgTemp: Math.round(avgTemp),
    avgHumidity: Math.round(avgHumidity),
    maxTemp,
    minTemp,
    rainyDays: forecast.filter(day => day.rainfall > 2).length
  };
};

/**
 * Get crop-specific advice
 */
const getCropSpecificAdvice = (crop, conditions, season) => {
  const advice = [];
  
  switch (crop.toLowerCase()) {
    case 'rice':
      if (conditions.totalRain > 30) {
        advice.push('Good conditions for rice cultivation');
        advice.push('Monitor water levels in fields');
      } else {
        advice.push('Ensure adequate water supply for rice fields');
      }
      break;
      
    case 'wheat':
      if (conditions.avgTemp > 30) {
        advice.push('High temperature may affect wheat grain filling');
      }
      if (conditions.totalRain > 20) {
        advice.push('Excess rain may cause wheat lodging - ensure drainage');
      }
      break;
      
    case 'cotton':
      if (conditions.avgHumidity > 85) {
        advice.push('High humidity increases bollworm risk in cotton');
      }
      if (conditions.totalRain < 10) {
        advice.push('Cotton needs regular irrigation during dry periods');
      }
      break;
      
    case 'sugarcane':
      if (conditions.totalRain > 40) {
        advice.push('Excess rain may delay sugarcane harvest');
      }
      advice.push('Maintain proper drainage in sugarcane fields');
      break;
      
    default:
      advice.push('Monitor crop-specific weather requirements');
  }
  
  return advice;
};

/**
 * Generate advisory summary
 */
const generateAdvisorySummary = (alerts, recommendations) => {
  if (alerts.length === 0) {
    return 'Weather conditions are favorable for agricultural activities';
  }
  
  const alertSummary = alerts.length === 1 ? '1 weather alert' : `${alerts.length} weather alerts`;
  return `${alertSummary} for your area. Check recommendations for detailed guidance.`;
};

module.exports = {
  getForecast,
  checkRainAlert,
  getCurrentWeather,
  getAgricultureAdvisory
};