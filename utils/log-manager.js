import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class LogManager {
  constructor() {
    this.logPath = path.join(__dirname, '../data/ewcs_logs.json');
    this.logs = this.loadLogs();
  }

  loadLogs() {
    try {
      if (fs.existsSync(this.logPath)) {
        const data = fs.readFileSync(this.logPath, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.recent_events || [];
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    }

    return [];
  }

  saveLogs() {
    try {
      const logData = { recent_events: this.logs };
      fs.writeFileSync(this.logPath, JSON.stringify(logData, null, 2));
    } catch (error) {
      console.error('Failed to save logs:', error);
    }
  }


  addEvent(event, error = null) {
    const eventData = {
      timestamp: new Date().toISOString(),
      event: event
    };

    if (error) {
      eventData.error = error;
    }

    this.logs.unshift(eventData);

    // Keep only last 100 events
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(0, 100);
    }

    this.saveLogs();
  }

  getRecentEvents(limit = 10) {
    return this.logs.slice(0, limit);
  }

  // Convenience methods for common logging
  logCS125Power(on) {
    this.addEvent(`CS125 power ${on ? 'ON' : 'OFF'}`);
  }

  logCameraPower(on) {
    this.addEvent(`Camera power ${on ? 'ON' : 'OFF'}`);
  }

  logHeaterPower(on) {
    this.addEvent(`CS125 hood heater ${on ? 'ON' : 'OFF'}`);
  }

  logIridiumPower(on) {
    this.addEvent(`Iridium modem ${on ? 'ON' : 'OFF'}`);
  }


  logError(component, error) {
    this.addEvent(`Error in ${component}`, error.toString());
  }

  logSystemStart() {
    this.addEvent('System started');
  }

  logSystemShutdown() {
    this.addEvent('System shutdown');
  }

}

// Singleton instance
const logManager = new LogManager();

export default logManager;
export { LogManager };