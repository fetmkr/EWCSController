// GPIO Controller - Singleton Pattern
// Uses singleton because there is only one set of physical GPIO pins on the hardware
// Simplified to match original ewcs.js pattern - only LED control
import { Gpio } from 'onoff';

// Simple LED control like original ewcs.js
const LED = new Gpio(16, 'out');

// LED control functions
function ledOn() {
  LED.writeSync(1);
  console.log('LED turned ON');
}

function ledOff() {
  LED.writeSync(0);
  console.log('LED turned OFF');
}

function setLED(state) {
  LED.writeSync(state ? 1 : 0);
  console.log(`LED set to ${state ? 'ON' : 'OFF'}`);
}

// Cleanup on exit
function close() {
  try {
    LED.unexport();
    console.log('GPIO cleaned up');
  } catch (error) {
    console.error('GPIO cleanup error:', error);
  }
}

// Setup cleanup handlers
process.on('SIGINT', () => {
  close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  close();
  process.exit(0);
});

// Simple GPIO controller object
const gpioController = {
  ledOn,
  ledOff,
  setLED,
  close,
  // Compatibility method for app.js
  initialize: async () => {
    console.log('GPIO Controller initialized (LED on pin 16)');
    return Promise.resolve();
  }
};

export default gpioController;