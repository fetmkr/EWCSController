import adc from 'mcp-spi-adc';
import { EventEmitter } from 'events';
import config from '../config/app-config.js';

class ADCReader extends EventEmitter {
  constructor() {
    super();
    
    this.config = config.get('adc');
    this.channels = new Map();
    this.isInitialized = false;
    
    // Reading intervals
    this.readingIntervals = new Map();
    
    // Channel configurations
    this.channelConfigs = {
      // Channel 0: CS125 current
      0: {
        name: 'cs125_current',
        speedHz: this.config.speedHz || 1000000,
        conversionFactor: this.config.conversionFactor || 20,
        unit: 'A',
        description: 'CS125 Sensor Current'
      },
      // Channel 1: Available for other sensors
      1: {
        name: 'spare_1',
        speedHz: this.config.speedHz || 1000000,
        conversionFactor: 1,
        unit: 'V',
        description: 'Spare Channel 1'
      },
      // Channel 2: Camera current
      2: {
        name: 'camera_current',
        speedHz: this.config.speedHz || 1000000,
        conversionFactor: this.config.conversionFactor || 20,
        unit: 'A',
        description: 'Camera Current'
      }
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize configured ADC channels
      for (const [channelNum, channelConfig] of Object.entries(this.channelConfigs)) {
        await this.initializeChannel(parseInt(channelNum), channelConfig);
      }
      
      this.isInitialized = true;
      console.log('ADC Reader initialized with', this.channels.size, 'channels');
      
    } catch (error) {
      console.error('ADC Reader initialization failed:', error);
      throw error;
    }
  }

  async initializeChannel(channelNum, channelConfig) {
    return new Promise((resolve, reject) => {
      const adcChannel = adc.open(channelNum, 
        { speedHz: channelConfig.speedHz }, 
        (err) => {
          if (err) {
            console.error(`ADC channel ${channelNum} initialization error:`, err);
            reject(err);
            return;
          }

          this.channels.set(channelNum, {
            adc: adcChannel,
            config: channelConfig,
            data: {
              rawValue: 0,
              voltage: 0,
              convertedValue: 0,
              lastReading: 0,
              readingCount: 0
            },
            status: {
              errorCount: 0,
              lastError: null
            }
          });

          console.log(`ADC channel ${channelNum} (${channelConfig.name}) initialized`);
          resolve();
        });
    });
  }

  async readChannel(channelNum) {
    const channel = this.channels.get(channelNum);
    if (!channel) {
      throw new Error(`ADC channel ${channelNum} not found`);
    }

    return new Promise((resolve, reject) => {
      channel.adc.read((err, reading) => {
        if (err) {
          console.error(`ADC channel ${channelNum} read error:`, err);
          channel.status.errorCount++;
          channel.status.lastError = err.message;
          this.emit('error', { channel: channelNum, error: err });
          reject(err);
          return;
        }

        try {
          // Calculate voltage
          const voltage = (reading.rawValue * this.config.vref) / this.config.resolution;
          
          // Apply conversion factor
          const convertedValue = parseFloat((voltage * channel.config.conversionFactor).toFixed(3));

          // Update channel data
          channel.data.rawValue = reading.rawValue;
          channel.data.voltage = parseFloat(voltage.toFixed(3));
          channel.data.convertedValue = convertedValue;
          channel.data.lastReading = Date.now();
          channel.data.readingCount++;

          // Reset error count on successful reading
          if (channel.status.errorCount > 0) {
            channel.status.errorCount = 0;
            channel.status.lastError = null;
          }

          const result = {
            channel: channelNum,
            name: channel.config.name,
            rawValue: channel.data.rawValue,
            voltage: channel.data.voltage,
            value: convertedValue,
            unit: channel.config.unit,
            timestamp: channel.data.lastReading
          };

          this.emit('reading', result);
          resolve(result);

        } catch (conversionError) {
          console.error(`ADC channel ${channelNum} conversion error:`, conversionError);
          channel.status.errorCount++;
          channel.status.lastError = conversionError.message;
          reject(conversionError);
        }
      });
    });
  }

  async readAllChannels() {
    const results = {};
    const readPromises = [];

    for (const channelNum of this.channels.keys()) {
      readPromises.push(
        this.readChannel(channelNum)
          .then(result => {
            results[channelNum] = result;
          })
          .catch(error => {
            results[channelNum] = { error: error.message, channel: channelNum };
          })
      );
    }

    await Promise.all(readPromises);
    return results;
  }

  startContinuousReading(channelNum, interval = 5000) {
    if (!this.channels.has(channelNum)) {
      throw new Error(`ADC channel ${channelNum} not found`);
    }

    // Stop existing interval if running
    this.stopContinuousReading(channelNum);

    const readingInterval = setInterval(() => {
      this.readChannel(channelNum).catch(error => {
        console.error(`Continuous reading error on channel ${channelNum}:`, error);
      });
    }, interval);

    this.readingIntervals.set(channelNum, readingInterval);
    
    console.log(`Started continuous reading on channel ${channelNum} every ${interval}ms`);
    
    // Initial reading
    this.readChannel(channelNum).catch(error => {
      console.error(`Initial reading error on channel ${channelNum}:`, error);
    });
  }

  stopContinuousReading(channelNum) {
    const interval = this.readingIntervals.get(channelNum);
    if (interval) {
      clearInterval(interval);
      this.readingIntervals.delete(channelNum);
      console.log(`Stopped continuous reading on channel ${channelNum}`);
    }
  }

  startAllContinuousReading(interval = 5000) {
    for (const channelNum of this.channels.keys()) {
      this.startContinuousReading(channelNum, interval);
    }
  }

  stopAllContinuousReading() {
    for (const channelNum of this.readingIntervals.keys()) {
      this.stopContinuousReading(channelNum);
    }
  }

  getChannelData(channelNum) {
    const channel = this.channels.get(channelNum);
    if (!channel) {
      return null;
    }

    return {
      channel: channelNum,
      name: channel.config.name,
      description: channel.config.description,
      data: { ...channel.data },
      status: { ...channel.status },
      config: { ...channel.config }
    };
  }

  getAllChannelData() {
    const data = {};
    for (const channelNum of this.channels.keys()) {
      data[channelNum] = this.getChannelData(channelNum);
    }
    return data;
  }

  getChannelByName(name) {
    for (const [channelNum, channel] of this.channels) {
      if (channel.config.name === name) {
        return this.getChannelData(channelNum);
      }
    }
    return null;
  }

  // Convenience methods for specific channels
  async getCS125Current() {
    try {
      const result = await this.readChannel(0);
      return result.value; // Current in Amps
    } catch (error) {
      console.error('CS125 current read error:', error);
      return 0;
    }
  }

  async getCameraCurrent() {
    try {
      const result = await this.readChannel(2);
      return result.value; // Current in Amps
    } catch (error) {
      console.error('Camera current read error:', error);
      return 0;
    }
  }

  // Add new channel dynamically
  async addChannel(channelNum, channelConfig) {
    if (this.channels.has(channelNum)) {
      throw new Error(`ADC channel ${channelNum} already exists`);
    }

    await this.initializeChannel(channelNum, channelConfig);
    return { success: true, channel: channelNum };
  }

  // Update channel configuration
  updateChannelConfig(channelNum, newConfig) {
    const channel = this.channels.get(channelNum);
    if (!channel) {
      throw new Error(`ADC channel ${channelNum} not found`);
    }

    // Update configuration
    channel.config = { ...channel.config, ...newConfig };
    console.log(`Updated config for ADC channel ${channelNum}`);
    
    return { success: true, channel: channelNum, config: channel.config };
  }

  getFullStatus() {
    return {
      isInitialized: this.isInitialized,
      totalChannels: this.channels.size,
      activeIntervals: this.readingIntervals.size,
      channels: this.getAllChannelData(),
      lastUpdate: Date.now()
    };
  }

  async close() {
    try {
      // Stop all continuous readings
      this.stopAllContinuousReading();

      // Close all ADC channels
      for (const [channelNum, channel] of this.channels) {
        try {
          // Close ADC channel if the library supports it
          if (channel.adc && typeof channel.adc.close === 'function') {
            channel.adc.close();
          }
        } catch (closeError) {
          console.warn(`ADC channel ${channelNum} close warning:`, closeError.message);
        }
      }

      this.channels.clear();
      this.isInitialized = false;
      console.log('ADC Reader closed');
      
    } catch (error) {
      console.error('ADC Reader close error:', error);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    let totalErrors = 0;
    let healthyChannels = 0;
    const now = Date.now();

    for (const [channelNum, channel] of this.channels) {
      totalErrors += channel.status.errorCount;
      
      // Consider channel healthy if it has recent data and low error count
      const dataAge = now - channel.data.lastReading;
      if (channel.status.errorCount < 3 && dataAge < 60000) { // 1 minute max age
        healthyChannels++;
      }
    }

    return {
      healthy: this.isInitialized && 
               totalErrors < 10 && 
               healthyChannels === this.channels.size,
      totalChannels: this.channels.size,
      healthyChannels: healthyChannels,
      totalErrors: totalErrors,
      activeIntervals: this.readingIntervals.size
    };
  }
}

// Singleton instance
const adcReader = new ADCReader();

export default adcReader;
export { ADCReader };