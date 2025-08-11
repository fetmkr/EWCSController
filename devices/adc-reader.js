// ADC Reader - Singleton Pattern
// Uses singleton because there is only one physical MCP SPI ADC chip on the hardware
// Multiple instances would conflict when accessing the same SPI device
// Simplified to match original ewcs.js pattern
import adc from 'mcp-spi-adc';

// Direct channel initialization - like original ewcs.js
const cs125CurrentADCChan = adc.open(0, {speedHz: 20000}, err => {
  if (err) throw err;
});

const iridiumCurrentADCChan = adc.open(1, {speedHz: 20000}, err => {
  if (err) throw err;
});

const cameraCurrentADCChan = adc.open(2, {speedHz: 20000}, err => {
  if (err) throw err;
});

const batteryVoltageADCChan = adc.open(3, {speedHz: 20000}, err => {
  if (err) throw err;
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
function readADC() {
  cs125CurrentADCChan.read((err, reading) => {
    if (err) throw err;
    adcData.cs125Current = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
  });
  
  iridiumCurrentADCChan.read((err, reading) => {
    if (err) throw err;
    adcData.iridiumCurrent = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
  });
  
  cameraCurrentADCChan.read((err, reading) => {
    if (err) throw err;
    adcData.cameraCurrent = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
  });
  
  batteryVoltageADCChan.read((err, reading) => {
    if (err) throw err;
    adcData.batteryVoltage = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024) * 46 / 10).toFixed(3));
  });
  
  adcData.lastUpdate = Date.now();
  return adcData;
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
  getChannelData: (channelNum) => {
    readADC(); // Update data first
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