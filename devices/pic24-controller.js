import { SerialPort } from 'serialport';
  import { exec } from 'child_process';

  const EWCSPIC24 = {
      STX: 0x02,
      ETX: 0x03,
      ACK: 0x06,
      NACK: 0x15,
      MAX_DATA_SIZE: 64,
      MAX_PACKET_SIZE: 72,
      TIMEOUT_MS: 200,

      CMD: {
          RESET: 0x01,
          VOUT_CONTROL: 0x02,
          SEND_SYNC_DATA: 0x03,
          POWER_SAVE: 0x04,
          SAT_TX_START: 0x05,
          PING: 0x08,
          SHUTDOWN: 0x09,
          SET_ONOFF_SCHEDULE: 0x0A,
          GET_ONOFF_SCHEDULE: 0x0B,
          SET_SAT_SCHEDULE: 0x0C,
          GET_SAT_SCHEDULE: 0x0D,
          ACK_RESPONSE: 0xA0,
          NACK_RESPONSE: 0xA1,
          DATA_RESPONSE: 0xA2
      },

      VOUT: {
          '1_ON': 0x11,   '1_OFF': 0x10,
          '2_ON': 0x21,   '2_OFF': 0x20,
          '3_ON': 0x31,   '3_OFF': 0x30,
          '4_ON': 0x41,   '4_OFF': 0x40
      },

      POWER_SAVE: {
          ON: 0x01,
          OFF: 0x00
      }
  };

  function calculateCRC16MODBUS(data) {
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

  export default class PIC24Controller {
      constructor() {
          this.port = null;
          this.isConnected = false;
          this.lastError = null;
          this.rxBuffer = Buffer.alloc(0);
          this.pendingPromises = new Map();
          this.pendingDataResponse = null;  // DATA_RESPONSE 대기용
          this.sequenceCounter = 0;

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

      async initialize(portPath = '/dev/ttyAMA0', baudRate = 115200) {
          try {
              await this.connect(portPath, baudRate);
              this.isConnected = true;
              this.lastError = null;
              console.log('[PIC24] Controller initialized with EWCSPIC24 protocol');
              return { success: true };
          } catch (error) {
              this.lastError = error.message;
              console.error('[PIC24] Initialization failed:', error);
              return { success: false, error: error.message };
          }
      }

      async connect(portPath = '/dev/ttyAMA0', baudRate = 115200) {
          return new Promise((resolve, reject) => {
              this.port = new SerialPort({
                  path: portPath,
                  baudRate: baudRate,
                  dataBits: 8,
                  parity: 'none',
                  stopBits: 1
              });

              this.port.on('open', () => {
                  console.log(`Connected to ${portPath} at ${baudRate} baud`);
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
                          // 새 패킷 시작 - 완전 초기화
                          this.rxPacket = {
                              length: 0,
                              seq: 0,
                              total: 0,
                              cmd: 0,
                              data: Buffer.alloc(0),  // 빈 버퍼로 초기화
                              crc: 0
                          };
                          this.rxBytesRead = 0;
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

      sendACK(seq) {
          const packet = this.createPacket(EWCSPIC24.CMD.ACK_RESPONSE, Buffer.alloc(0), seq, 1);
          this.port.write(packet, (err) => {
              if (err) {
                  console.error('Error sending ACK:', err);
              } else {
                  //console.log(`ACK sent for sequence ${seq}`);
              }
          });
      }

      handleReceivedPacket() {
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

          //console.log(`Received packet: CMD=0x${this.rxPacket.cmd.toString(16)}, SEQ=${this.rxPacket.seq}, LEN=${this.rxPacket.length}`);

          // PING 명령 처리
          if (this.rxPacket.cmd === EWCSPIC24.CMD.PING) {
              //console.log('[PIC24] PING received from PIC, sending ACK');
              this.sendACK(this.rxPacket.seq);
              return;
          }

          // SHUTDOWN 명령 처리
          if (this.rxPacket.cmd === EWCSPIC24.CMD.SHUTDOWN) {
              console.log('[PIC24] SHUTDOWN command received');
              this.sendACK(this.rxPacket.seq);

              console.log('System will shutdown in 3 seconds...');
              setTimeout(() => {
                  console.log('Executing shutdown...');
                  exec('sudo shutdown -h now', (error, stdout, stderr) => {
                      if (error) {
                          console.error('Shutdown error:', error);
                      } else {
                          console.log('Shutdown initiated');
                      }
                  });
              }, 3000);
              return;
          }

          // DATA_RESPONSE 처리 (GET 명령의 응답)
          if (this.rxPacket.cmd === EWCSPIC24.CMD.DATA_RESPONSE) {
              console.log('[PIC24] Data response received, length:', this.rxPacket.data.length);
              if (this.pendingDataResponse) {
                  this.pendingDataResponse.resolve(this.rxPacket.data);
                  this.pendingDataResponse = null;
              }
              return;
          }

          // ACK/NACK 처리
          const promiseKey = `${EWCSPIC24.CMD.ACK_RESPONSE}-${this.rxPacket.seq}`;
          if (this.pendingPromises.has(promiseKey)) {
              const { resolve } = this.pendingPromises.get(promiseKey);
              this.pendingPromises.delete(promiseKey);

              if (this.rxPacket.cmd === EWCSPIC24.CMD.ACK_RESPONSE) {
                  console.log('Received ACK for sequence', this.rxPacket.seq);
                  resolve({ success: true });
              } else if (this.rxPacket.cmd === EWCSPIC24.CMD.NACK_RESPONSE) {
                  console.log('Received NACK for sequence', this.rxPacket.seq);
                  resolve({ success: false, error: 'NACK received' });
              }
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

      // GET 명령용 전용 메서드 (DATA_RESPONSE 대기)
      async sendDataCommand(cmd) {
          return new Promise((resolve, reject) => {
              const seq = this.sequenceCounter++;
              if (this.sequenceCounter > 255) this.sequenceCounter = 0;

              const packet = this.createPacket(cmd, Buffer.alloc(0), seq, 1);

              // DATA_RESPONSE 대기
              this.pendingDataResponse = { resolve, reject };

              // 타임아웃 설정
              setTimeout(() => {
                  if (this.pendingDataResponse) {
                      this.pendingDataResponse.reject(new Error('GET command timeout'));
                      this.pendingDataResponse = null;
                  }
              }, 2000);

              this.port.write(packet, (err) => {
                  if (err) {
                      this.pendingDataResponse = null;
                      reject(err);
                  }
              });
          });
      }

      createPacket(cmd, data, seq, total) {
          const dataLen = data.length;

          const headerData = Buffer.concat([
              Buffer.from([(dataLen >> 8) & 0xFF, dataLen & 0xFF]),
              Buffer.from([seq, total, cmd]),
              data
          ]);

          const crc = calculateCRC16MODBUS(headerData);

          const packet = Buffer.concat([
              Buffer.from([EWCSPIC24.STX]),
              headerData,
              Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]),
              Buffer.from([EWCSPIC24.ETX])
          ]);

          return packet;
      }

      async sendCommand(commandType, data = null) {
          if (!this.port || !this.isConnected) {
              throw new Error('PIC24 not connected');
          }

          try {
              let result;

              switch (commandType) {
                  case 'RESET':
                      result = await this.reset();
                      break;
                  case 'SEND_SYNC_DATA':
                      result = await this.sendSyncData();
                      break;
                  case 'SET_ONOFF_SCHEDULE':
                      result = await this.sendPacket(EWCSPIC24.CMD.SET_ONOFF_SCHEDULE, data);
                      break;
                  case 'GET_ONOFF_SCHEDULE':
                      result = await this.sendDataCommand(EWCSPIC24.CMD.GET_ONOFF_SCHEDULE);
                      break;
                  case 'SET_SAT_SCHEDULE':
                      result = await this.sendPacket(EWCSPIC24.CMD.SET_SAT_SCHEDULE, data);
                      break;
                  case 'GET_SAT_SCHEDULE':
                      result = await this.sendDataCommand(EWCSPIC24.CMD.GET_SAT_SCHEDULE);
                      break;
                  case 'POWER_SAVE_ON':
                      result = await this.setPowerSave(true);
                      break;
                  case 'POWER_SAVE_OFF':
                      result = await this.setPowerSave(false);
                      break;
                  case 'SAT_TX_START':
                      result = await this.startSatelliteTransmission();
                      break;
                  case 'VOUT1_ON':
                      result = await this.turnOnVOUT(1);
                      break;
                  case 'VOUT1_OFF':
                      result = await this.turnOffVOUT(1);
                      break;
                  case 'VOUT2_ON':
                      result = await this.turnOnVOUT(2);
                      break;
                  case 'VOUT2_OFF':
                      result = await this.turnOffVOUT(2);
                      break;
                  case 'VOUT3_ON':
                      result = await this.turnOnVOUT(3);
                      break;
                  case 'VOUT3_OFF':
                      result = await this.turnOffVOUT(3);
                      break;
                  case 'VOUT4_ON':
                      result = await this.turnOnVOUT(4);
                      break;
                  case 'VOUT4_OFF':
                      result = await this.turnOffVOUT(4);
                      break;
                  default:
                      throw new Error(`Unknown command type: ${commandType}`);
              }

              console.log(`[PIC24] Command sent: ${commandType}`);
              return result;
          } catch (error) {
              this.lastError = error.message;
              console.error(`[PIC24] Failed to send command ${commandType}:`, error);
              throw error;
          }
      }

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

      // SEND_SYNC_DATA - 시간 데이터 받기
      async sendSyncData() {
          console.log('Requesting sync data');
          const response = await this.sendDataCommand(EWCSPIC24.CMD.SEND_SYNC_DATA);
          if (response && response.length >= 6) {
              return {
                  year: 2000 + response[0],
                  month: response[1],
                  date: response[2],
                  hour: response[3],
                  min: response[4],
                  sec: response[5]
              };
          }
          return null;
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

      async sendPingToPIC() {
          console.log('Sending PING to PIC24');
          return this.sendPacket(EWCSPIC24.CMD.PING);
      }

      // ONOFF 스케줄 설정 (매시간 켜기/끄기)
      async setOnOffSchedule(onMin, offMin) {
          const data = Buffer.from([onMin, offMin]);
          return this.sendCommand('SET_ONOFF_SCHEDULE', data);
      }

      // ONOFF 스케줄 조회
      async getOnOffSchedule() {
          const response = await this.sendCommand('GET_ONOFF_SCHEDULE');
          if (response && response.length >= 2) {
              return {
                  onMin: response[0],
                  offMin: response[1],
                  description: `Every hour: ON at xx:${response[0].toString().padStart(2, '0')}, OFF at xx:${response[1].toString().padStart(2, '0')}`
              };
          }
          return null;
      }

      // 위성 스케줄 설정
      async setSatSchedule(hour, min) {
          const data = Buffer.from([hour, min]);
          return this.sendCommand('SET_SAT_SCHEDULE', data);
      }

      // 위성 스케줄 조회
      async getSatSchedule() {
          const response = await this.sendCommand('GET_SAT_SCHEDULE');
          if (response && response.length >= 2) {
              return {
                  hour: response[0],
                  min: response[1],
                  description: `Daily satellite transmission at ${response[0].toString().padStart(2, '0')}:${response[1].toString().padStart(2, '0')}`
              };
          }
          return null;
      }

      // 편의 메서드들
      async cameraOn() {
          return this.sendCommand('VOUT1_ON');
      }

      async cameraOff() {
          return this.sendCommand('VOUT1_OFF');
      }

      async cs125On() {
          return this.sendCommand('VOUT2_ON');
      }

      async cs125Off() {
          return this.sendCommand('VOUT2_OFF');
      }

      async heaterOn() {
          return this.sendCommand('VOUT3_ON');
      }

      async heaterOff() {
          return this.sendCommand('VOUT3_OFF');
      }

      async vout4On() {
          return this.sendCommand('VOUT4_ON');
      }

      async vout4Off() {
          return this.sendCommand('VOUT4_OFF');
      }

      async syncData() {
          return this.sendCommand('SEND_SYNC_DATA');
      }

      async enablePowerSave() {
          return this.sendCommand('POWER_SAVE_ON');
      }

      async disablePowerSave() {
          return this.sendCommand('POWER_SAVE_OFF');
      }

      getStatus() {
          return {
              connected: this.isConnected,
              lastError: this.lastError,
              portOpen: this.port ? this.port.isOpen : false
          };
      }

      async close() {
          try {
              if (this.port && this.port.isOpen) {
                  this.port.close();
              }
              this.isConnected = false;
              console.log('[PIC24] Controller closed');
          } catch (error) {
              console.error('[PIC24] Close error:', error);
          }
      }

      disconnect() {
          if (this.port && this.port.isOpen) {
              this.port.close();
              console.log('Disconnected from serial port');
          }
      }
  }




// import { SerialPort } from 'serialport';
//   import { exec } from 'child_process';

//   const EWCSPIC24 = {
//       STX: 0x02,
//       ETX: 0x03,
//       ACK: 0x06,
//       NACK: 0x15,
//       MAX_DATA_SIZE: 64,
//       MAX_PACKET_SIZE: 72,
//       TIMEOUT_MS: 200,

//       CMD: {
//           RESET: 0x01,
//           VOUT_CONTROL: 0x02,
//           SEND_SYNC_DATA: 0x03,
//           POWER_SAVE: 0x04,
//           SAT_TX_START: 0x05,
//           SET_SCHEDULE: 0x06,
//           GET_SCHEDULE: 0x07,
//           PING: 0x08,
//           SHUTDOWN: 0x09,
//           CMD_SET_ONOFF_SCHEDULE: 0x0A,
//           CMD_GET_ONOFF_SCHEDULE: 0x0B,
//           CMD_SET_SAT_SCHEDULE: 0x0C,
//           CMD_GET_SAT_SCHEDULE: 0x0D,
//           ACK_RESPONSE: 0xA0,
//           NACK_RESPONSE: 0xA1,
//           DATA_RESPONSE: 0xA2
//       },

//       VOUT: {
//           '1_ON': 0x11,   '1_OFF': 0x10,
//           '2_ON': 0x21,   '2_OFF': 0x20,
//           '3_ON': 0x31,   '3_OFF': 0x30,
//           '4_ON': 0x41,   '4_OFF': 0x40
//       },

//       POWER_SAVE: {
//           ON: 0x01,
//           OFF: 0x00
//       }
//   };

//   function calculateCRC16MODBUS(data) {
//       let crc = 0xFFFF;

//       for (let i = 0; i < data.length; i++) {
//           crc ^= data[i];
//           for (let j = 0; j < 8; j++) {
//               if (crc & 0x0001) {
//                   crc = (crc >> 1) ^ 0xA001;
//               } else {
//                   crc >>= 1;
//               }
//           }
//       }

//       return crc;
//   }

//   export default class PIC24Controller {
//     constructor() {
//       this.port = null;
//       this.isConnected = false;
//       this.lastError = null;
//       this.rxBuffer = Buffer.alloc(0);
//       this.pendingPromises = new Map();
//       this.sequenceCounter = 0;

//       this.rxState = 'WAIT_STX';
//       this.rxPacket = {
//           length: 0,
//           seq: 0,
//           total: 0,
//           cmd: 0,
//           data: Buffer.alloc(0),
//           crc: 0
//       };
//       this.rxBytesRead = 0;
//       this.rxTempCRC = Buffer.alloc(2);
//     }

//     async initialize(portPath = '/dev/ttyAMA0', baudRate = 115200) {
//       try {
//         await this.connect(portPath, baudRate);
//         this.isConnected = true;
//         this.lastError = null;
//         console.log('[PIC24] Controller initialized with EWCSPIC24 protocol');
//         return { success: true };
//       } catch (error) {
//         this.lastError = error.message;
//         console.error('[PIC24] Initialization failed:', error);
//         return { success: false, error: error.message };
//       }
//     }

//     async connect(portPath = '/dev/ttyAMA0', baudRate = 115200) {
//       return new Promise((resolve, reject) => {
//           this.port = new SerialPort({
//               path: portPath,
//               baudRate: baudRate,
//               dataBits: 8,
//               parity: 'none',
//               stopBits: 1
//           });

//           this.port.on('open', () => {
//               console.log(`Connected to ${portPath} at ${baudRate} baud`);
//               this.setupDataHandler();
//               resolve();
//           });

//           this.port.on('error', (err) => {
//               console.error('Serial port error:', err);
//               reject(err);
//           });
//       });
//     }

//     setupDataHandler() {
//       this.port.on('data', (data) => {
//           this.rxBuffer = Buffer.concat([this.rxBuffer, data]);
//           this.processReceivedData();
//       });
//     }

//     processReceivedData() {
//       while (this.rxBuffer.length > 0) {
//           const byte = this.rxBuffer[0];
//           this.rxBuffer = this.rxBuffer.slice(1);

//           switch (this.rxState) {
//               case 'WAIT_STX':
//                   if (byte === EWCSPIC24.STX) {
//                     // 새 패킷 시작 - 완전 초기화
//                       this.rxPacket = {
//                           length: 0,
//                           seq: 0,
//                           total: 0,
//                           cmd: 0,
//                           data: Buffer.alloc(0),  // 빈 버퍼로 초기화
//                           crc: 0
//                       };
//                       this.rxBytesRead = 0;
//                       this.rxState = 'READ_LEN_H';
//                   }
//                   break;

//               case 'READ_LEN_H':
//                   this.rxPacket.length = byte << 8;
//                   this.rxState = 'READ_LEN_L';
//                   break;

//               case 'READ_LEN_L':
//                   this.rxPacket.length |= byte;
//                   if (this.rxPacket.length > EWCSPIC24.MAX_DATA_SIZE) {
//                       this.rxState = 'WAIT_STX';
//                   } else {
//                       this.rxState = 'READ_SEQ';
//                   }
//                   break;

//               case 'READ_SEQ':
//                   this.rxPacket.seq = byte;
//                   this.rxState = 'READ_TOTAL';
//                   break;

//               case 'READ_TOTAL':
//                   this.rxPacket.total = byte;
//                   this.rxState = 'READ_CMD';
//                   break;

//               case 'READ_CMD':
//                   this.rxPacket.cmd = byte;
//                   //console.log('After READ_CMD, data length:', this.rxPacket.data ? this.rxPacket.data.length : 'undefined');
//                   this.rxBytesRead = 0;
//                   if (this.rxPacket.length > 0) {
//                       this.rxPacket.data = Buffer.alloc(this.rxPacket.length);
//                       this.rxState = 'READ_DATA';
//                   } else {
//                       this.rxState = 'READ_CRC_H';
//                   }
//                   break;

//               case 'READ_DATA':
//                   if (this.rxBytesRead < this.rxPacket.length) {
//                       this.rxPacket.data[this.rxBytesRead] = byte;
//                       this.rxBytesRead++;

//                       if (this.rxBytesRead >= this.rxPacket.length) {
//                           this.rxState = 'READ_CRC_H';
//                       }
//                   } else {
//                       this.rxState = 'WAIT_STX';
//                   }
//                   break;

//               case 'READ_CRC_H':
//                   this.rxTempCRC[0] = byte;
//                   this.rxState = 'READ_CRC_L';
//                   break;

//               case 'READ_CRC_L':
//                   this.rxTempCRC[1] = byte;
//                   this.rxPacket.crc = (this.rxTempCRC[0] << 8) | this.rxTempCRC[1];
//                   this.rxState = 'WAIT_ETX';
//                   break;

//               case 'WAIT_ETX':
//                   if (byte === EWCSPIC24.ETX) {
//                       this.handleReceivedPacket();
//                   }
//                   this.rxState = 'WAIT_STX';
//                   break;

//               default:
//                   this.rxState = 'WAIT_STX';
//                   break;
//           }
//       }
//     }

//     sendACK(seq) {
//       const packet = this.createPacket(EWCSPIC24.CMD.ACK_RESPONSE, Buffer.alloc(0), seq, 1);
//       this.port.write(packet, (err) => {
//           if (err) {
//               console.error('Error sending ACK:', err);
//           } else {
//               // console.log(`ACK sent for sequence ${seq}`);
//           }
//       });
//     }

//     handleReceivedPacket() {
//       const crcData = Buffer.concat([
//           Buffer.from([(this.rxPacket.length >> 8) & 0xFF, this.rxPacket.length & 0xFF]),
//           Buffer.from([this.rxPacket.seq, this.rxPacket.total, this.rxPacket.cmd]),
//           this.rxPacket.data
//       ]);

//        // 디버그 출력 추가
//       //console.log('=== PING CRC DEBUG ===');
//       // console.log('Length:', this.rxPacket.length);
//       // console.log('Seq:', this.rxPacket.seq);
//       // console.log('Total:', this.rxPacket.total);
//       // console.log('Cmd:', this.rxPacket.cmd, '(0x' + this.rxPacket.cmd.toString(16) + ')');
//       // console.log('Data length:', this.rxPacket.data.length);
//       // console.log('CRC Data:', Array.from(crcData).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
//       // console.log('Received CRC:', this.rxPacket.crc, '(0x' + this.rxPacket.crc.toString(16).padStart(4, '0') + ')');

//       const calculatedCRC = calculateCRC16MODBUS(crcData);
//       // console.log('Calculated CRC:', calculatedCRC, '(0x' + calculatedCRC.toString(16).padStart(4, '0') + ')');
//       // console.log('=====================');

//       if (calculatedCRC !== this.rxPacket.crc) {
//           console.error('CRC mismatch:', calculatedCRC, 'vs', this.rxPacket.crc);
//           return;
//       }


//       //console.log(`Received packet: CMD=0x${this.rxPacket.cmd.toString(16)}, SEQ=${this.rxPacket.seq}, LEN=${this.rxPacket.length}`);

//       // PING 명령 처리 - 즉시 ACK 응답
//       if (this.rxPacket.cmd === EWCSPIC24.CMD.PING) {
//           //console.log('[PIC24] PING received from PIC, sending ACK');
//           this.sendACK(this.rxPacket.seq);
//           return;
//       }

//       // SHUTDOWN 명령 처리 - ACK 보내고 시스템 종료
//       if (this.rxPacket.cmd === EWCSPIC24.CMD.SHUTDOWN) {
//           console.log('[PIC24] SHUTDOWN command received');
//           this.sendACK(this.rxPacket.seq);

//           console.log('System will shutdown in 3 seconds...');
//           setTimeout(() => {
//               console.log('Executing shutdown...');
//               exec('sudo shutdown -h now', (error, stdout, stderr) => {
//                   if (error) {
//                       console.error('Shutdown error:', error);
//                   } else {
//                       console.log('Shutdown initiated');
//                   }
//               });
//           }, 3000);
//           return;
//       }

//       const promiseKey = `${this.rxPacket.cmd}-${this.rxPacket.seq}`;
//       if (this.pendingPromises.has(promiseKey)) {
//           const { resolve } = this.pendingPromises.get(promiseKey);
//           this.pendingPromises.delete(promiseKey);
//           resolve(this.rxPacket);
//       }

//       if (this.rxPacket.cmd === EWCSPIC24.CMD.ACK_RESPONSE) {
//           console.log('Received ACK for sequence', this.rxPacket.seq);
//       } else if (this.rxPacket.cmd === EWCSPIC24.CMD.NACK_RESPONSE) {
//           console.log('Received NACK for sequence', this.rxPacket.seq);
//       } else if (this.rxPacket.cmd === EWCSPIC24.CMD.DATA_RESPONSE) {
//           console.log('Received data response:', this.rxPacket.data.toString());
//       }
//     }

//     sendPacket(cmd, data = Buffer.alloc(0), waitForResponse = true) {
//       return new Promise((resolve, reject) => {
//           const seq = this.sequenceCounter++;
//           if (this.sequenceCounter > 255) this.sequenceCounter = 0;

//           const packet = this.createPacket(cmd, data, seq, 1);

//           if (waitForResponse) {
//               const promiseKey = `${EWCSPIC24.CMD.ACK_RESPONSE}-${seq}`;
//               this.pendingPromises.set(promiseKey, { resolve, reject });

//               setTimeout(() => {
//                   if (this.pendingPromises.has(promiseKey)) {
//                       this.pendingPromises.delete(promiseKey);
//                       reject(new Error('Timeout waiting for response'));
//                   }
//               }, EWCSPIC24.TIMEOUT_MS);
//           }

//           this.port.write(packet, (err) => {
//               if (err) {
//                   reject(err);
//               } else if (!waitForResponse) {
//                   resolve();
//               }
//           });
//       });
//     }

//     createPacket(cmd, data, seq, total) {
//       const dataLen = data.length;

//       const headerData = Buffer.concat([
//           Buffer.from([(dataLen >> 8) & 0xFF, dataLen & 0xFF]),
//           Buffer.from([seq, total, cmd]),
//           data
//       ]);

//       const crc = calculateCRC16MODBUS(headerData);

//       const packet = Buffer.concat([
//           Buffer.from([EWCSPIC24.STX]),
//           headerData,
//           Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]),
//           Buffer.from([EWCSPIC24.ETX])
//       ]);

//       return packet;
//     }

//     async sendCommand(commandType, data = null) {
//       if (!this.port || !this.isConnected) {
//         throw new Error('PIC24 not connected');
//       }

//       try {
//         let result;

//         switch (commandType) {
//           case 'RESET':
//             result = await this.reset();
//             break;
//           case 'SEND_SYNC_DATA':
//             result = await this.sendSyncData();
//             break;
//           case 'GET_SCHEDULE':
//             result = await this.getSchedule();
//             break;
//           case 'SET_SCHEDULE':
//             result = await this.setSchedule(data);
//             break;
//           case 'POWER_SAVE_ON':
//             result = await this.setPowerSave(true);
//             break;
//           case 'POWER_SAVE_OFF':
//             result = await this.setPowerSave(false);
//             break;
//           case 'SAT_TX_START':
//             result = await this.startSatelliteTransmission();
//             break;
//           case 'VOUT1_ON':
//             result = await this.turnOnVOUT(1);
//             break;
//           case 'VOUT1_OFF':
//             result = await this.turnOffVOUT(1);
//             break;
//           case 'VOUT2_ON':
//             result = await this.turnOnVOUT(2);
//             break;
//           case 'VOUT2_OFF':
//             result = await this.turnOffVOUT(2);
//             break;
//           case 'VOUT3_ON':
//             result = await this.turnOnVOUT(3);
//             break;
//           case 'VOUT3_OFF':
//             result = await this.turnOffVOUT(3);
//             break;
//           case 'VOUT4_ON':
//             result = await this.turnOnVOUT(4);
//             break;
//           case 'VOUT4_OFF':
//             result = await this.turnOffVOUT(4);
//             break;
//           default:
//             throw new Error(`Unknown command type: ${commandType}`);
//         }

//         console.log(`[PIC24] Command sent: ${commandType}`);
//         return result;
//       } catch (error) {
//         this.lastError = error.message;
//         console.error(`[PIC24] Failed to send command ${commandType}:`, error);
//         throw error;
//       }
//     }

//     async reset() {
//       console.log('Sending reset command');
//       return this.sendPacket(EWCSPIC24.CMD.RESET);
//     }

//     async turnOnVOUT(channel) {
//       const voutCmd = {
//           1: EWCSPIC24.VOUT['1_ON'],
//           2: EWCSPIC24.VOUT['2_ON'],
//           3: EWCSPIC24.VOUT['3_ON'],
//           4: EWCSPIC24.VOUT['4_ON']
//       }[channel];

//       if (!voutCmd) {
//           throw new Error('Invalid VOUT channel');
//       }

//       console.log(`Turning ON VOUT ${channel}`);
//       return this.sendPacket(EWCSPIC24.CMD.VOUT_CONTROL, Buffer.from([voutCmd]));
//     }

//     async turnOffVOUT(channel) {
//       const voutCmd = {
//           1: EWCSPIC24.VOUT['1_OFF'],
//           2: EWCSPIC24.VOUT['2_OFF'],
//           3: EWCSPIC24.VOUT['3_OFF'],
//           4: EWCSPIC24.VOUT['4_OFF']
//       }[channel];

//       if (!voutCmd) {
//           throw new Error('Invalid VOUT channel');
//       }

//       console.log(`Turning OFF VOUT ${channel}`);
//       return this.sendPacket(EWCSPIC24.CMD.VOUT_CONTROL, Buffer.from([voutCmd]));
//     }

//     async sendSyncData() {
//       console.log('Requesting sync data');
//       return this.sendPacket(EWCSPIC24.CMD.SEND_SYNC_DATA);
//     }

//     async setPowerSave(enable) {
//       const powerCmd = enable ? EWCSPIC24.POWER_SAVE.ON : EWCSPIC24.POWER_SAVE.OFF;
//       console.log(`Setting power save mode: ${enable ? 'ON' : 'OFF'}`);
//       return this.sendPacket(EWCSPIC24.CMD.POWER_SAVE, Buffer.from([powerCmd]));
//     }

//     async startSatelliteTransmission() {
//       console.log('Starting satellite transmission');
//       return this.sendPacket(EWCSPIC24.CMD.SAT_TX_START);
//     }

//     async setSchedule(scheduleCommand) {
//       console.log(`Setting schedule: ${scheduleCommand}`);
//       const data = Buffer.from(scheduleCommand, 'utf8');
//       return this.sendPacket(EWCSPIC24.CMD.SET_SCHEDULE, data);
//     }

//     async getSchedule() {
//       console.log('Getting schedule');
//       return this.sendPacket(EWCSPIC24.CMD.GET_SCHEDULE);
//     }

//     async sendPingToPIC() {
//       console.log('Sending PING to PIC24');
//       return this.sendPacket(EWCSPIC24.CMD.PING);
//     }

//     async cameraOn() {
//       return this.sendCommand('VOUT1_ON');
//     }

//     async cameraOff() {
//       return this.sendCommand('VOUT1_OFF');
//     }

//     async cs125On() {
//       return this.sendCommand('VOUT2_ON');
//     }

//     async cs125Off() {
//       return this.sendCommand('VOUT2_OFF');
//     }

//     async heaterOn() {
//       return this.sendCommand('VOUT3_ON');
//     }

//     async heaterOff() {
//       return this.sendCommand('VOUT3_OFF');
//     }

//     async vout4On() {
//       return this.sendCommand('VOUT4_ON');
//     }

//     async vout4Off() {
//       return this.sendCommand('VOUT4_OFF');
//     }

//     async syncData() {
//       return this.sendCommand('SEND_SYNC_DATA');
//     }

//     async enablePowerSave() {
//       return this.sendCommand('POWER_SAVE_ON');
//     }

//         // ONOFF 스케줄 설정 (매시간 켜기/끄기)
//     async setOnOffSchedule(onMin, offMin) {
//         const data = Buffer.from([onMin, offMin]);
//         return this.sendCommand(EWCSPIC24.CMD_SET_ONOFF_SCHEDULE, data);
//     }

//     // ONOFF 스케줄 조회
//     async getOnOffSchedule() {
//         const response = await this.sendCommand(EWCSPIC24.CMD_GET_ONOFF_SCHEDULE);
//         if (response && response.length >= 2) {
//             return {
//                 onMin: response[0],
//                 offMin: response[1],
//                 description: `Every hour: ON at xx:${response[0].toString().padStart(2, '0')}, OFF at xx:${response[1].toString().padStart(2, '0')}`
//             };
//         }
//         return null;
//     }

//     // 위성 스케줄 설정
//     async setSatSchedule(hour, min) {
//         const data = Buffer.from([hour, min]);
//         return this.sendCommand(EWCSPIC24.CMD_SET_SAT_SCHEDULE, data);
//     }

//     // 위성 스케줄 조회
//     async getSatSchedule() {
//         const response = await this.sendCommand(EWCSPIC24.CMD_GET_SAT_SCHEDULE);
//         if (response && response.length >= 2) {
//             return {
//                 hour: response[0],
//                 min: response[1],
//                 description: `Daily satellite transmission at ${response[0].toString().padStart(2, '0')}:${response[1].toString().padStart(2, '0')}`
//             };
//         }
//         return null;
//     }


//     async disablePowerSave() {
//       return this.sendCommand('POWER_SAVE_OFF');
//     }

//     getStatus() {
//       return {
//         connected: this.isConnected,
//         lastError: this.lastError,
//         portOpen: this.port ? this.port.isOpen : false
//       };
//     }

//     async close() {
//       try {
//         if (this.port && this.port.isOpen) {
//           this.port.close();
//         }
//         this.isConnected = false;
//         console.log('[PIC24] Controller closed');
//       } catch (error) {
//         console.error('[PIC24] Close error:', error);
//       }
//     }

//     disconnect() {
//       if (this.port && this.port.isOpen) {
//           this.port.close();
//           console.log('Disconnected from serial port');
//       }
//     }
//   }
