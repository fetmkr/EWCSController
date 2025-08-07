import { Gpio } from 'onoff';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';

class GPIOController extends EventEmitter {
  constructor() {
    super();
    
    this.config = config.get('gpio');
    this.pins = new Map();
    this.isInitialized = false;
    
    // Default pin configurations
    this.pinConfigs = {
      led: {
        pin: this.config.led || 16,
        direction: 'out',
        activeLow: false
      }
      // Add more pins as needed
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize configured pins
      for (const [name, pinConfig] of Object.entries(this.pinConfigs)) {
        await this.initializePin(name, pinConfig);
      }
      
      this.isInitialized = true;
      console.log('GPIO Controller initialized');
      
      // Set up cleanup handlers
      this.setupCleanupHandlers();
      
    } catch (error) {
      console.error('GPIO Controller initialization failed:', error);
      throw error;
    }
  }

  async initializePin(name, pinConfig) {
    try {
      const gpio = new Gpio(
        pinConfig.pin, 
        pinConfig.direction, 
        pinConfig.edge || 'none',
        {
          activeLow: pinConfig.activeLow || false,
          reconfigureDirection: false
        }
      );

      this.pins.set(name, {
        gpio: gpio,
        config: pinConfig,
        lastValue: null,
        lastUpdate: 0
      });

      console.log(`GPIO pin ${name} (${pinConfig.pin}) initialized as ${pinConfig.direction}`);
      
      // Set up interrupt handling for input pins
      if (pinConfig.direction === 'in' && pinConfig.edge && pinConfig.edge !== 'none') {
        this.setupInterrupt(name);
      }

    } catch (error) {
      console.error(`Failed to initialize GPIO pin ${name}:`, error);
      throw error;
    }
  }

  setupInterrupt(pinName) {
    const pinData = this.pins.get(pinName);
    if (!pinData || pinData.config.direction !== 'in') return;

    pinData.gpio.watch((err, value) => {
      if (err) {
        console.error(`GPIO interrupt error on ${pinName}:`, err);
        this.emit('error', { pin: pinName, error: err });
        return;
      }

      const now = Date.now();
      pinData.lastValue = value;
      pinData.lastUpdate = now;

      console.log(`GPIO ${pinName} changed to ${value}`);
      
      this.emit('pinChange', {
        pin: pinName,
        value: value,
        timestamp: now
      });
    });
  }

  async writePin(pinName, value) {
    const pinData = this.pins.get(pinName);
    if (!pinData) {
      throw new Error(`GPIO pin '${pinName}' not found`);
    }

    if (pinData.config.direction !== 'out') {
      throw new Error(`GPIO pin '${pinName}' is not configured as output`);
    }

    try {
      pinData.gpio.writeSync(value ? 1 : 0);
      pinData.lastValue = value ? 1 : 0;
      pinData.lastUpdate = Date.now();
      
      console.log(`GPIO ${pinName} set to ${value}`);
      
      this.emit('pinWrite', {
        pin: pinName,
        value: value,
        timestamp: pinData.lastUpdate
      });
      
      return { success: true, pin: pinName, value: value };
      
    } catch (error) {
      console.error(`GPIO write error on ${pinName}:`, error);
      throw error;
    }
  }

  readPin(pinName) {
    const pinData = this.pins.get(pinName);
    if (!pinData) {
      throw new Error(`GPIO pin '${pinName}' not found`);
    }

    try {
      const value = pinData.gpio.readSync();
      pinData.lastValue = value;
      pinData.lastUpdate = Date.now();
      
      return {
        pin: pinName,
        value: value,
        timestamp: pinData.lastUpdate
      };
      
    } catch (error) {
      console.error(`GPIO read error on ${pinName}:`, error);
      throw error;
    }
  }

  // Convenience methods for LED control
  async setLED(state) {
    return await this.writePin('led', state);
  }

  async ledOn() {
    return await this.setLED(true);
  }

  async ledOff() {
    return await this.setLED(false);
  }

  async toggleLED() {
    const pinData = this.pins.get('led');
    if (!pinData) {
      throw new Error('LED pin not configured');
    }
    
    const currentValue = pinData.lastValue;
    return await this.setLED(!currentValue);
  }

  // Add new pin dynamically
  async addPin(name, pinConfig) {
    if (this.pins.has(name)) {
      throw new Error(`GPIO pin '${name}' already exists`);
    }

    await this.initializePin(name, pinConfig);
    return { success: true, pin: name };
  }

  // Remove pin
  async removePin(name) {
    const pinData = this.pins.get(name);
    if (!pinData) {
      throw new Error(`GPIO pin '${name}' not found`);
    }

    try {
      pinData.gpio.unexport();
      this.pins.delete(name);
      console.log(`GPIO pin ${name} removed`);
      return { success: true, pin: name };
    } catch (error) {
      console.error(`Failed to remove GPIO pin ${name}:`, error);
      throw error;
    }
  }

  getPinStatus(pinName) {
    const pinData = this.pins.get(pinName);
    if (!pinData) {
      return null;
    }

    return {
      name: pinName,
      pin: pinData.config.pin,
      direction: pinData.config.direction,
      value: pinData.lastValue,
      lastUpdate: pinData.lastUpdate,
      config: pinData.config
    };
  }

  getAllPinsStatus() {
    const status = {};
    for (const [name, pinData] of this.pins) {
      status[name] = this.getPinStatus(name);
    }
    return status;
  }

  getFullStatus() {
    return {
      isInitialized: this.isInitialized,
      totalPins: this.pins.size,
      pins: this.getAllPinsStatus(),
      lastUpdate: Date.now()
    };
  }

  setupCleanupHandlers() {
    const cleanup = () => {
      console.log('Cleaning up GPIO pins...');
      this.close();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => {
      this.close();
    });
  }

  close() {
    try {
      for (const [name, pinData] of this.pins) {
        try {
          pinData.gpio.unexport();
          console.log(`GPIO pin ${name} unexported`);
        } catch (error) {
          console.error(`Error unexporting GPIO pin ${name}:`, error);
        }
      }
      
      this.pins.clear();
      this.isInitialized = false;
      console.log('GPIO Controller closed');
      
    } catch (error) {
      console.error('GPIO Controller close error:', error);
    }
  }

  // Health check method
  isHealthy() {
    return {
      healthy: this.isInitialized && this.pins.size > 0,
      totalPins: this.pins.size,
      initialized: this.isInitialized
    };
  }
}

// Singleton instance
const gpioController = new GPIOController();

export default gpioController;
export { GPIOController };