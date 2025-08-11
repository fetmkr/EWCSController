// SHT45 Sensor - Singleton Pattern
// Uses singleton because there is only one physical SHT45 temperature/humidity sensor on the hardware  
// Multiple instances would conflict when accessing the same I2C device
// Simplified to match original ewcs.js pattern
import SHT4X from 'sht4x';

// Open SHT45 sensor like original ewcs.js
const thermostat = await SHT4X.open();

// Simple data storage
let sht45Data = {
  temperature: 0,
  humidity: 0,
  lastReading: 0
};

// Simple SHT45 reading function - exactly like original ewcs.js
async function updateSHT45() {
  try {
    const val = await thermostat.measurements();
    sht45Data.temperature = parseFloat(((val.temperature - 32) * 5/9).toFixed(3));
    sht45Data.humidity = parseFloat(val.humidity.toFixed(3));
    sht45Data.lastReading = Date.now();
    
    return {
      temperature: sht45Data.temperature,
      humidity: sht45Data.humidity
    };
  } catch (error) {
    console.error('SHT45 reading error:', error);
    throw error;
  }
}

// Get current data
function getSHT45Data() {
  return { ...sht45Data };
}

// Simple connection check with timeout
async function checkConnection() {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('I2C timeout')), 1000)
    );
    
    const measurementPromise = thermostat.measurements();
    const val = await Promise.race([measurementPromise, timeoutPromise]);
    
    return val && typeof val.temperature === 'number' && typeof val.humidity === 'number';
  } catch (error) {
    console.error('[SHT45] Connection check failed:', error.message);
    return false;
  }
}

// Simple SHT45 sensor object
const sht45Sensor = {
  updateSHT45,
  getSHT45Data,
  checkConnection,
  // Compatibility methods
  readSensor: updateSHT45,
  getData: getSHT45Data,
  initialize: async () => {
    console.log('SHT45 Sensor initialized');
    return Promise.resolve();
  }
};

export default sht45Sensor;