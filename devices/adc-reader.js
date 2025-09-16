// ADC Reader - Singleton Pattern
// Uses singleton because there is only one physical MCP SPI ADC chip on the hardware
// Multiple instances would conflict when accessing the same SPI device
// Simplified to match original ewcs.js pattern
import adc from 'mcp-spi-adc';

// Direct channel initialization - like original ewcs.js
const chan1ADCChan = adc.open(0, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 0 (chan1ADCChan):', err);
  }
});

const chan2ADCChan = adc.open(1, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 1 (chan2ADCChan):', err);
  }
});

const chan3ADCChan = adc.open(2, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 2 (chan3ADCChan):', err);
  }
});

const chan4ADCChan = adc.open(3, {speedHz: 20000}, err => {
  if (err) {
    console.error('Error opening ADC channel 3 (chan4ADCChan):', err);
  }
});

// Current ADC data storage
let adcData = {
  chan1Current: 0,
  chan2Current: 0,
  chan3Current: 0,
  chan4Current: 0,
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
          adcData.chan1Current = readings.chan1Current || 0;
          adcData.chan2Current = readings.chan2Current || 0;
          adcData.chan3Current = readings.chan3Current || 0;
          adcData.chan4Current = readings.chan4Current || 0;
          adcData.lastUpdate = Date.now();
          resolve(adcData);
        }
      });
    };

    readChannel(chan1ADCChan, 'chan1Current', 1000);  // MAX4376 gain=50, Rsense=20mΩ, output in mA
    readChannel(chan2ADCChan, 'chan2Current', 1000);  // MAX4376 gain=50, Rsense=20mΩ, output in mA
    readChannel(chan3ADCChan, 'chan3Current', 1000);   // MAX4376 gain=50, Rsense=20mΩ, output in mA
    readChannel(chan4ADCChan, 'chan4Current', 1000);  // MAX4376 gain=50, Rsense=20mΩ, output in mA
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
    const channelNames = ['chan1_current', 'chan2_current', 'chan3_current', 'chan4_current'];
    const values = [adcData.chan1Current, adcData.chan2Current, adcData.chan3Current, adcData.chan4Current];
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