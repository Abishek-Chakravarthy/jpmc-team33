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
      timeOfDay = forecast.dt