  import { SerialPort } from 'serialport';

  // EWCSPIC24 Protocol Constants
  export const EWCSPIC24 = {
      STX: 0x02,
      ETX: 0x03,
      ACK: 0x06,
      NACK: 0x15,
      MAX_DATA_SIZE: 64,
      MAX_PACKET_SIZE: 72,
      TIMEOUT_MS: 200,

      // Command codes
      CMD: {
          RESET: 0x01,
          VOUT_CONTROL: 0x02,
          SEND_SYNC_DATA: 0x03,
          POWER_SAVE: 0x04,
          SAT_TX_START: 0x05,
          SET_SCHEDULE: 0x06,
          GET_SCHEDULE: 0x07,
          ACK_RESPONSE: 0xA0,
          NACK_RESPONSE: 0xA1,
          DATA_RESPONSE: 0xA2
      },

      // VOUT control subcodes
      VOUT: {
          '1_ON': 0x11,   '1_OFF': 0x10,
          '2_ON': 0x21,   '2_OFF': 0x20,
          '3_ON': 0x31,   '3_OFF': 0x30,
          '4_ON': 0x41,   '4_OFF': 0x40
      },

      // Power save subcodes
      POWER_SAVE: {
          ON: 0x01,
          OFF: 0x00
      }
  };

  // CRC16-MODBUS calculation
  export function calculateCRC16MODBUS(data) {
      let crc = 0xFFFF;

      for (let i = 0; i < data.length; i++) {
          crc ^= data[i];
          for (let j = 0; j < 8; j++) {
              if (crc & 0x0001) {
                  crc = (crc >> 1) ^ 0xA001;
              } else {
                  crc >>= 1;
              }
          }
      }

      return crc;
  }

  export class EWCSPIC24Client {
      constructor(portPath = '/dev/ttyUSB0', baudRate = 115200) {
          this.portPath = portPath;
          this.baudRate = baudRate;
          this.port = null;
          this.rxBuffer = Buffer.alloc(0);
          this.pendingPromises = new Map();
          this.sequenceCounter = 0;

          // Receive state machine
          this.rxState = 'WAIT_STX';
          this.rxPacket = {
              length: 0,
              seq: 0,
              total: 0,
              cmd: 0,
              data: Buffer.alloc(0),
              crc: 0
          };
          this.rxBytesRead = 0;
          this.rxTempCRC = Buffer.alloc(2);
      }

      async connect() {
          return new Promise((resolve, reject) => {
              this.port = new SerialPort({
                  path: this.portPath,
                  baudRate: this.baudRate,
                  dataBits: 8,
                  parity: 'none',
                  stopBits: 1
              });

              this.port.on('open', () => {
                  console.log(`Connected to ${this.portPath} at ${this.baudRate} baud`);
                  this.setupDataHandler();
                  resolve();
              });

              this.port.on('error', (err) => {
                  console.error('Serial port error:', err);
                  reject(err);
              });
          });
      }

      setupDataHandler() {
          this.port.on('data', (data) => {
              this.rxBuffer = Buffer.concat([this.rxBuffer, data]);
              this.processReceivedData();
          });
      }

      processReceivedData() {
          while (this.rxBuffer.length > 0) {
              const byte = this.rxBuffer[0];
              this.rxBuffer = this.rxBuffer.slice(1);

              switch (this.rxState) {
                  case 'WAIT_STX':
                      if (byte === EWCSPIC24.STX) {
                          this.rxState = 'READ_LEN_H';
                      }
                      break;

                  case 'READ_LEN_H':
                      this.rxPacket.length = byte << 8;
                      this.rxState = 'READ_LEN_L';
                      break;

                  case 'READ_LEN_L':
                      this.rxPacket.length |= byte;
                      if (this.rxPacket.length > EWCSPIC24.MAX_DATA_SIZE) {
                          this.rxState = 'WAIT_STX';
                      } else {
                          this.rxState = 'READ_SEQ';
                      }
                      break;

                  case 'READ_SEQ':
                      this.rxPacket.seq = byte;
                      this.rxState = 'READ_TOTAL';
                      break;

                  case 'READ_TOTAL':
                      this.rxPacket.total = byte;
                      this.rxState = 'READ_CMD';
                      break;

                  case 'READ_CMD':
                      this.rxPacket.cmd = byte;
                      this.rxBytesRead = 0;
                      if (this.rxPacket.length > 0) {
                          this.rxPacket.data = Buffer.alloc(this.rxPacket.length);
                          this.rxState = 'READ_DATA';
                      } else {
                          this.rxState = 'READ_CRC_H';
                      }
                      break;

                  case 'READ_DATA':
                      if (this.rxBytesRead < this.rxPacket.length) {
                          this.rxPacket.data[this.rxBytesRead] = byte;
                          this.rxBytesRead++;

                          if (this.rxBytesRead >= this.rxPacket.length) {
                              this.rxState = 'READ_CRC_H';
                          }
                      } else {
                          this.rxState = 'WAIT_STX';
                      }
                      break;

                  case 'READ_CRC_H':
                      this.rxTempCRC[0] = byte;
                      this.rxState = 'READ_CRC_L';
                      break;

                  case 'READ_CRC_L':
                      this.rxTempCRC[1] = byte;
                      this.rxPacket.crc = (this.rxTempCRC[0] << 8) | this.rxTempCRC[1];
                      this.rxState = 'WAIT_ETX';
                      break;

                  case 'WAIT_ETX':
                      if (byte === EWCSPIC24.ETX) {
                          this.handleReceivedPacket();
                      }
                      this.rxState = 'WAIT_STX';
                      break;

                  default:
                      this.rxState = 'WAIT_STX';
                      break;
              }
          }
      }

      handleReceivedPacket() {
          // Verify CRC
          const crcData = Buffer.concat([
              Buffer.from([(this.rxPacket.length >> 8) & 0xFF, this.rxPacket.length & 0xFF]),
              Buffer.from([this.rxPacket.seq, this.rxPacket.total, this.rxPacket.cmd]),
              this.rxPacket.data
          ]);

          const calculatedCRC = calculateCRC16MODBUS(crcData);
          if (calculatedCRC !== this.rxPacket.crc) {
              console.error('CRC mismatch:', calculatedCRC, 'vs', this.rxPacket.crc);
              return;
          }

          console.log(`Received packet: CMD=0x${this.rxPacket.cmd.toString(16)}, SEQ=${this.rxPacket.seq}, LEN=${this.rxPacket.length}`);

          // Handle responses
          const promiseKey = `${this.rxPacket.cmd}-${this.rxPacket.seq}`;
          if (this.pendingPromises.has(promiseKey)) {
              const { resolve } = this.pendingPromises.get(promiseKey);
              this.pendingPromises.delete(promiseKey);
              resolve(this.rxPacket);
          }

          // Handle specific responses
          if (this.rxPacket.cmd === EWCSPIC24.CMD.ACK_RESPONSE) {
              console.log('Received ACK for sequence', this.rxPacket.seq);
          } else if (this.rxPacket.cmd === EWCSPIC24.CMD.NACK_RESPONSE) {
              console.log('Received NACK for sequence', this.rxPacket.seq);
          } else if (this.rxPacket.cmd === EWCSPIC24.CMD.DATA_RESPONSE) {
              console.log('Received data response:', this.rxPacket.data.toString());
          }
      }

      sendPacket(cmd, data = Buffer.alloc(0), waitForResponse = true) {
          return new Promise((resolve, reject) => {
              const seq = this.sequenceCounter++;
              if (this.sequenceCounter > 255) this.sequenceCounter = 0;

              const packet = this.createPacket(cmd, data, seq, 1);

              if (waitForResponse) {
                  const promiseKey = `${EWCSPIC24.CMD.ACK_RESPONSE}-${seq}`;
                  this.pendingPromises.set(promiseKey, { resolve, reject });

                  setTimeout(() => {
                      if (this.pendingPromises.has(promiseKey)) {
                          this.pendingPromises.delete(promiseKey);
                          reject(new Error('Timeout waiting for response'));
                      }
                  }, EWCSPIC24.TIMEOUT_MS);
              }

              this.port.write(packet, (err) => {
                  if (err) {
                      reject(err);
                  } else if (!waitForResponse) {
                      resolve();
                  }
              });
          });
      }

      createPacket(cmd, data, seq, total) {
          const dataLen = data.length;

          // Create packet without CRC and ETX first
          const headerData = Buffer.concat([
              Buffer.from([(dataLen >> 8) & 0xFF, dataLen & 0xFF]), // LEN
              Buffer.from([seq, total, cmd]),                        // SEQ, TOTAL, CMD
              data                                                   // DATA
          ]);

          // Calculate CRC
          const crc = calculateCRC16MODBUS(headerData);

          // Create final packet
          const packet = Buffer.concat([
              Buffer.from([EWCSPIC24.STX]),                         // STX
              headerData,                                           // LEN + SEQ + TOTAL + CMD + DATA
              Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]),        // CRC
              Buffer.from([EWCSPIC24.ETX])                          // ETX
          ]);

          return packet;
      }

      // Command functions
      async reset() {
          console.log('Sending reset command');
          return this.sendPacket(EWCSPIC24.CMD.RESET);
      }

      async turnOnVOUT(channel) {
          const voutCmd = {
              1: EWCSPIC24.VOUT['1_ON'],
              2: EWCSPIC24.VOUT['2_ON'],
              3: EWCSPIC24.VOUT['3_ON'],
              4: EWCSPIC24.VOUT['4_ON']
          }[channel];

          if (!voutCmd) {
              throw new Error('Invalid VOUT channel');
          }

          console.log(`Turning ON VOUT ${channel}`);
          return this.sendPacket(EWCSPIC24.CMD.VOUT_CONTROL, Buffer.from([voutCmd]));
      }

      async turnOffVOUT(channel) {
          const voutCmd = {
              1: EWCSPIC24.VOUT['1_OFF'],
              2: EWCSPIC24.VOUT['2_OFF'],
              3: EWCSPIC24.VOUT['3_OFF'],
              4: EWCSPIC24.VOUT['4_OFF']
          }[channel];

          if (!voutCmd) {
              throw new Error('Invalid VOUT channel');
          }

          console.log(`Turning OFF VOUT ${channel}`);
          return this.sendPacket(EWCSPIC24.CMD.VOUT_CONTROL, Buffer.from([voutCmd]));
      }

      async sendSyncData() {
          console.log('Requesting sync data');
          return this.sendPacket(EWCSPIC24.CMD.SEND_SYNC_DATA);
      }

      async setPowerSave(enable) {
          const powerCmd = enable ? EWCSPIC24.POWER_SAVE.ON : EWCSPIC24.POWER_SAVE.OFF;
          console.log(`Setting power save mode: ${enable ? 'ON' : 'OFF'}`);
          return this.sendPacket(EWCSPIC24.CMD.POWER_SAVE, Buffer.from([powerCmd]));
      }

      async startSatelliteTransmission() {
          console.log('Starting satellite transmission');
          return this.sendPacket(EWCSPIC24.CMD.SAT_TX_START);
      }

      async setSchedule(scheduleCommand) {
          console.log(`Setting schedule: ${scheduleCommand}`);
          const data = Buffer.from(scheduleCommand, 'utf8');
          return this.sendPacket(EWCSPIC24.CMD.SET_SCHEDULE, data);
      }

      async getSchedule() {
          console.log('Getting schedule');
          return this.sendPacket(EWCSPIC24.CMD.GET_SCHEDULE);
      }

      disconnect() {
          if (this.port && this.port.isOpen) {
              this.port.close();
              console.log('Disconnected from serial port');
          }
      }
  }

  // Test script - only runs when directly executed
  if (process.argv[1] === new URL(import.meta.url).pathname) {
      async function testEWCSPIC24() {
          const client = new EWCSPIC24Client('/dev/ttyUSB0', 115200);

          try {
              await client.connect();

              // Test commands
              console.log('\n=== Testing EWCSPIC24 Protocol ===');

              await new Promise(resolve => setTimeout(resolve, 1000));

              await client.reset();
              await new Promise(resolve => setTimeout(resolve, 500));

              await client.turnOnVOUT(1);
              await new Promise(resolve => setTimeout(resolve, 500));

              await client.turnOffVOUT(1);
              await new Promise(resolve => setTimeout(resolve, 500));

              await client.sendSyncData();
              await new Promise(resolve => setTimeout(resolve, 500));

              await client.setPowerSave(false);
              await new Promise(resolve => setTimeout(resolve, 500));

              console.log('\n=== All tests completed ===');

          } catch (error) {
              console.error('Test error:', error);
          } finally {
              client.disconnect();
          }
      }

      testEWCSPIC24();
  }




//   {
//     "name": "ewcspic24-protocol",
//     "version": "1.0.0",
//     "description": "Node.js ES6 client for EWCSPIC24 protocol",
//     "type": "module",
//     "main": "ewcspic24-client.js",
//     "scripts": {
//       "test": "node ewcspic24-client.js",
//       "start": "node ewcspic24-client.js"
//     },
//     "dependencies": {
//       "serialport": "^12.0.0"
//     },
//     "engines": {
//       "node": ">=16.0.0"
//     }
//   }

//   사용법:
//   1. ewcspic24-client.js와 package.json 저장
//   2. npm install 실행
//   3. node ewcspic24-client.js 또는 다른 파일에서 import:

//   import { EWCSPIC24Client, EWCSPIC24 } from './ewcspic24-client.js';

//   const client = new EWCSPIC24Client('/dev/ttyUSB0');
//   await client.connect();
//   await client.reset();
