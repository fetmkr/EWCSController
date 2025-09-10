// ADC Reader - Singleton Pattern
// Uses singleton because there is only one physical MCP SPI ADC chip on the hardware
// Multiple instances would conflict when accessing the same SPI device
// Simplified to match original ewcs.js pattern
import adc from 'mcp-spi-adc';

// Direct channel initialization - like original ewcs.js
const cs125CurrentADCChan = adc.open(0, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 0 (cs125CurrentADCChan):', err);
  }
});

const iridiumCurrentADCChan = adc.open(1, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 1 (iridiumCurrentADCChan):', err);
  }
});

const cameraCurrentADCChan = adc.open(2, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 2 (cameraCurrentADCChan):', err);
  }
});

const batteryVoltageADCChan = adc.open(3, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 3 (batteryVoltageADCChan):', err);
  }
});

// Current ADC data storage
let adcData = {
  cs125Current: 0,
  iridiumCurrent: 0,
  cameraCurrent: 0,
  batteryVoltage: 0,
  lastUpdate: 0
};

// Simple ADC reading function - exactly like original ewcs.js
async function readADC() {
  return new Promise((resolve, reject) => {
    const readings = {};
    let completedReads = 0;
    const totalReads = 4;

    const readChannel = (channel, name, conversionFactor) => {
      channel.read((err, reading) => {
        if (err) {
          console.error(`ADC Read Error on ${name}:`, err);
          // Do not reject the whole promise immediately, try to get other readings
          readings[name] = 0; // Set to 0 on error
        } else {
          console.log(`[ADC] Raw value for ${name}: ${reading.rawValue}`);
          readings[name] = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024) * conversionFactor).toFixed(3));
        }
        completedReads++;
        if (completedReads === totalReads) {
          adcData.cs125Current = readings.cs125Current || 0;
          adcData.iridiumCurrent = readings.iridiumCurrent || 0;
          adcData.cameraCurrent = readings.cameraCurrent || 0;
          adcData.batteryVoltage = readings.batteryVoltage || 0;
          adcData.lastUpdate = Date.now();
          resolve(adcData);
        }
      });
    };

    readChannel(cs125CurrentADCChan, 'cs125Current', 20000/1000);
    readChannel(iridiumCurrentADCChan, 'iridiumCurrent', 20000/1000);
    readChannel(cameraCurrentADCChan, 'cameraCurrent', 20000/1000);
    readChannel(batteryVoltageADCChan, 'batteryVoltage', 46/10);
  });
}

// Simple connection check using direct channel access
function checkConnection() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 1000);
    
    cs125CurrentADCChan.read((err, reading) => {
      clearTimeout(timeout);
      resolve(!err && reading && typeof reading.rawValue === 'number');
    });
  });
}

// Simple data getter
function getADCData() {
  return { ...adcData };
}

// Simple ADC reader object to maintain compatibility
const adcReader = {
  readADC,
  checkConnection,
  getADCData,
  // Compatibility methods for existing code
  getData: getADCData,
  isHealthy: () => ({ healthy: true, lastUpdate: adcData.lastUpdate }),
  initialize: async () => {
    console.log('ADC Reader initialized (4 channels)');
    return Promise.resolve();
  },
  // Compatibility method for app.js data collection
  getChannelData: async (channelNum) => {
    await readADC(); // Update data first
    const channelNames = ['cs125_current', 'iridium_current', 'camera_current', 'battery_voltage'];
    const values = [adcData.cs125Current, adcData.iridiumCurrent, adcData.cameraCurrent, adcData.batteryVoltage];
    return {
      channel: channelNum,
      name: channelNames[channelNum] || 'unknown',
      data: {
        convertedValue: values[channelNum] || 0
      }
    };
  }
};

// Export functions and singleton object
export { readADC, checkConnection, getADCData };
export default adcReader;