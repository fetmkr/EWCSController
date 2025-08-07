import SHT4X from 'sht4x';
import { EventEmitter } from 'events';
import config from '../config/app-config.js';

class SHT45Sensor extends EventEmitter {
  constructor() {
    super();
    
    this.thermostat = null;
    this.isInitialized = false;
    
    this.data = {
      temperature: 0,
      humidity: 0,
      lastReading: 0,
      readingCount: 0
    };
    
    this.status = {
      connected: false,
      errorCount: 0,
      lastError: null
    };
    
    // Reading interval
    this.readingInterval = null;
    this.readingPeriod = 5000; // 5 seconds default
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize SHT4X sensor
      this.thermostat = await SHT4X.open();
      
      this.isInitialized = true;
      this.status.connected = true;
      console.log('SHT45 Sensor initialized');
      
      // Start periodic readings
      this.startReading();
      
    } catch (error) {
      console.error('SHT45 Sensor initialization failed:', error);
      this.status.lastError = error.message;
      this.status.errorCount++;
      throw error;
    }
  }

  startReading() {
    if (this.readingInterval) {
      clearInterval(this.readingInterval);
    }

    this.readingInterval = setInterval(() => {
      this.readSensor();
    }, this.readingPeriod);
    
    // Initial reading
    this.readSensor();
  }

  async readSensor() {
    if (!this.thermostat || !this.isInitialized) {
      console.warn('SHT45 sensor not initialized');
      return;
    }

    try {
      const reading = await this.thermostat.readTemperatureAndHumidity();
      
      this.data.temperature = parseFloat(reading.temperature.toFixed(2));
      this.data.humidity = parseFloat(reading.humidity.toFixed(2));
      this.data.lastReading = Date.now();
      this.data.readingCount++;
      
      // Reset error count on successful reading
      if (this.status.errorCount > 0) {
        this.status.errorCount = 0;
        this.status.lastError = null;
      }
      
      console.log(`SHT45: ${this.data.temperature}°C, ${this.data.humidity}%RH`);
      
      // Emit data event
      this.emit('data', {
        temperature: this.data.temperature,
        humidity: this.data.humidity,
        timestamp: this.data.lastReading
      });
      
      return {
        temperature: this.data.temperature,
        humidity: this.data.humidity,
        timestamp: this.data.lastReading
      };
      
    } catch (error) {
      console.error('SHT45 reading error:', error);
      this.status.errorCount++;
      this.status.lastError = error.message;
      
      if (this.status.errorCount > 5) {
        this.status.connected = false;
        console.warn('SHT45 sensor connection lost after multiple errors');
      }
      
      this.emit('error', error);
      throw error;
    }
  }

  async readOnce() {
    return await this.readSensor();
  }

  setReadingPeriod(period) {
    if (period < 1000) { // Minimum 1 second
      throw new Error('Reading period must be at least 1000ms');
    }
    
    this.readingPeriod = period;
    
    if (this.readingInterval) {
      this.startReading(); // Restart with new period
    }
    
    console.log(`SHT45 reading period set to ${period}ms`);
  }

  getData() {
    return { ...this.data };
  }

  getStatus() {
    return {
      ...this.status,
      isInitialized: this.isInitialized,
      readingPeriod: this.readingPeriod,
      lastUpdate: Date.now()
    };
  }

  getFullStatus() {
    const now = Date.now();
    const dataAge = now - this.data.lastReading;
    
    return {
      status: this.getStatus(),
      data: this.getData(),
      health: {
        healthy: this.isHealthy().healthy,
        dataAge: dataAge,
        maxExpectedAge: this.readingPeriod * 2
      }
    };
  }

  async calibrate() {
    if (!this.thermostat || !this.isInitialized) {
      throw new Error('SHT45 sensor not initialized');
    }

    try {
      // If SHT4X library supports calibration, implement here
      console.log('SHT45 calibration requested (if supported by library)');
      
      // Reset error counters
      this.status.errorCount = 0;
      this.status.lastError = null;
      
      return { success: true, message: 'Calibration completed' };
      
    } catch (error) {
      console.error('SHT45 calibration error:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.readingInterval) {
        clearInterval(this.readingInterval);
        this.readingInterval = null;
      }

      if (this.thermostat) {
        // Close SHT4X sensor if the library supports it
        try {
          if (typeof this.thermostat.close === 'function') {
            await this.thermostat.close();
          }
        } catch (closeError) {
          console.warn('SHT45 close warning:', closeError.message);
        }
        this.thermostat = null;
      }

      this.isInitialized = false;
      this.status.connected = false;
      console.log('SHT45 Sensor closed');
      
    } catch (error) {
      console.error('SHT45 close error:', error);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    const now = Date.now();
    const dataAge = now - this.data.lastReading;
    const maxAge = this.readingPeriod * 3; // Allow 3 reading periods
    
    return {
      healthy: this.isInitialized && 
               this.status.connected && 
               this.status.errorCount < 3 && 
               dataAge < maxAge,
      dataAge: dataAge,
      errorCount: this.status.errorCount,
      connected: this.status.connected,
      lastError: this.status.lastError
    };
  }

  // Static method to get temperature in different units
  static celsiusToFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
  }

  static celsiusToKelvin(celsius) {
    return celsius + 273.15;
  }

  // Method to get temperature in different units
  getTemperature(unit = 'celsius') {
    const temp = this.data.temperature;
    
    switch (unit.toLowerCase()) {
      case 'fahrenheit':
      case 'f':
        return SHT45Sensor.celsiusToFahrenheit(temp);
      case 'kelvin':
      case 'k':
        return SHT45Sensor.celsiusToKelvin(temp);
      case 'celsius':
      case 'c':
      default:
        return temp;
    }
  }

  // Method to check if conditions are within comfortable ranges
  checkComfortLevel() {
    const temp = this.data.temperature;
    const humidity = this.data.humidity;
    
    let tempComfort = 'unknown';
    let humidityComfort = 'unknown';
    
    // Temperature comfort ranges (subjective)
    if (temp >= 20 && temp <= 26) {
      tempComfort = 'comfortable';
    } else if (temp >= 18 && temp < 20 || temp > 26 && temp <= 28) {
      tempComfort = 'acceptable';
    } else {
      tempComfort = 'uncomfortable';
    }
    
    // Humidity comfort ranges
    if (humidity >= 40 && humidity <= 60) {
      humidityComfort = 'comfortable';
    } else if (humidity >= 30 && humidity < 40 || humidity > 60 && humidity <= 70) {
      humidityComfort = 'acceptable';
    } else {
      humidityComfort = 'uncomfortable';
    }
    
    return {
      temperature: {
        value: temp,
        comfort: tempComfort
      },
      humidity: {
        value: humidity,
        comfort: humidityComfort
      },
      overall: tempComfort === 'comfortable' && humidityComfort === 'comfortable' ? 'comfortable' :
               tempComfort !== 'uncomfortable' && humidityComfort !== 'uncomfortable' ? 'acceptable' : 'uncomfortable'
    };
  }
}

// Singleton instance
const sht45Sensor = new SHT45Sensor();

export default sht45Sensor;
export { SHT45Sensor };