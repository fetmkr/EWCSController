import { SerialPort } from 'serialport';
import { exec } from 'child_process';
import gpioController from './gpio-controller.js';

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
        GET_SENSOR_DATA: 0x0E,
        SENSOR_DATA: 0x0F,
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
    constructor(appInstance = null) {
        this.appInstance = appInstance;
        this.port = null;
        this.isConnected = false;
        this.lastError = null;
        this.rxBuffer = Buffer.alloc(0);
        this.pendingPromises = new Map();
        this.pendingDataResponse = null;
        this.sequenceCounter = 0;
        this.ledState = false;

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
                        this.rxPacket = {
                            length: 0,
                            seq: 0,
                            total: 0,
                            cmd: 0,
                            data: Buffer.alloc(0),
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
            }
        });
    }

    async sendMultiPacket(cmd, data) {
        const chunkSize = EWCSPIC24.MAX_DATA_SIZE;
        const totalPackets = Math.ceil(data.length / chunkSize);

        console.log(`[PIC24] Sending multi-packet: ${totalPackets} packets, ${data.length} bytes total`);

        for (let i = 0; i < totalPackets; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, data.length);
            const chunk = data.slice(start, end);

            // 멀티패킷에서는 SEQ를 0부터 시작
            const seq = i;
            const packet = this.createPacket(cmd, chunk, seq, totalPackets);

            // 패킷 전송
            this.port.write(packet);
            console.log(`[PIC24] Sent packet ${i + 1}/${totalPackets}, size: ${chunk.length} bytes, SEQ=${seq}`);

            // 마지막 패킷이 아니면 ACK 대기
            if (i < totalPackets - 1) {
                try {
                    await this.waitForACK(seq);
                    console.log(`[PIC24] Received ACK for packet ${i + 1}, sending next packet`);
                } catch (error) {
                    console.error(`[PIC24] ACK timeout for packet ${i + 1}:`, error);
                    return false;
                }
            }
        }
        return true;
    }

    waitForACK(seq) {
        return new Promise((resolve, reject) => {
            const promiseKey = `${EWCSPIC24.CMD.ACK_RESPONSE}-${seq}`;
            this.pendingPromises.set(promiseKey, { resolve, reject });

            setTimeout(() => {
                if (this.pendingPromises.has(promiseKey)) {
                    this.pendingPromises.delete(promiseKey);
                    reject(new Error('ACK timeout'));
                }
            }, 1000); // 1초 ACK 대기
        });
    }

    async collectSensorData() {
        // 최신 센서 데이터 수집
        if (this.appInstance && this.appInstance.runDataCollectionOnce) {
            try {
                await this.appInstance.runDataCollectionOnce();
                console.log('[PIC24] Fresh sensor data collected before sending to PIC24');
            } catch (error) {
                console.error('[PIC24] Failed to collect fresh sensor data:', error);
            }
        }

        // app.js의 실제 데이터가 있으면 사용, 없으면 기본값 사용
        const ewcsData = this.appInstance?.ewcsData || {};

        console.log('[PIC24] appInstance exists:', !!this.appInstance);
        console.log('[PIC24] ewcsData timestamp:', ewcsData.timestamp);
        console.log('[PIC24] ewcsData sample values:', {
            stationName: ewcsData.stationName,
            cs125Current: ewcsData.cs125Current,
            chan1Current: ewcsData.chan1Current,
            PVVol: ewcsData.PVVol
        });

        const sensorData = {
            stationName: ewcsData.stationName || "KOPRI_STATION_01",
            timestamp: Math.floor((ewcsData.timestamp || Date.now()) / 1000),
            powerSaveMode: ewcsData.powerSaveMode === "save" ? 1 : 0,  // 0=normal, 1=save

            // CS125 센서 데이터
            cs125Current: ewcsData.cs125Current || 0,
            cs125Visibility: ewcsData.cs125Visibility || 0,
            cs125SYNOP: ewcsData.cs125SYNOP || 0,
            cs125Temp: ewcsData.cs125Temp || 0,
            cs125Humidity: ewcsData.cs125Humidity || 0,

            // 환경 센서 데이터
            SHT45Temp: ewcsData.SHT45Temp || 0,
            SHT45Humidity: ewcsData.SHT45Humidity || 0,
            rpiTemp: ewcsData.rpiTemp || 0,

            // ADC 전력 모니터링 데이터
            chan1Current: ewcsData.chan1Current || 0,
            chan2Current: ewcsData.chan2Current || 0,
            chan3Current: ewcsData.chan3Current || 0,
            chan4Current: ewcsData.chan4Current || 0,

            // 태양광 충전기 데이터
            PVVol: ewcsData.PVVol || 0,
            PVCur: ewcsData.PVCur || 0,
            LoadVol: ewcsData.LoadVol || 0,
            LoadCur: ewcsData.LoadCur || 0,
            BatTemp: ewcsData.BatTemp || 0,
            DevTemp: ewcsData.DevTemp || 0,
            ChargEquipStat: ewcsData.ChargEquipStat || 0,
            DischgEquipStat: ewcsData.DischgEquipStat || 0

            // 스케줄 정보는 제외 (PIC24에서만 관리)
        };

        const buffer = this.structToBuffer(sensorData);
        console.log(`[PIC24] Sensor data collected: ${buffer.length} bytes`);
        return buffer;
    }

    structToBuffer(data) {
        // RPi에서 PIC24로 보내는 센서 데이터 (스케줄 정보 제외, 95 bytes)
        const buffer = Buffer.alloc(95);
        let offset = 0;

        // stationName[16] - 16 bytes (null-terminated string)
        const stationBytes = Buffer.from(data.stationName.slice(0, 15), 'utf8');
        stationBytes.copy(buffer, offset);
        // 나머지 바이트는 0으로 패딩 (Buffer.alloc으로 이미 0으로 초기화됨)
        offset += 16;

        // timestamp - 4 bytes (uint32_t)
        buffer.writeUInt32LE(data.timestamp, offset);
        offset += 4;

        // powerSaveMode - 1 byte (uint8_t: 0=normal, 1=save)
        buffer.writeUInt8(data.powerSaveMode, offset);
        offset += 1;

        // CS125 센서 데이터
        buffer.writeFloatLE(data.cs125Current, offset); offset += 4;
        buffer.writeFloatLE(data.cs125Visibility, offset); offset += 4;
        buffer.writeUInt16LE(data.cs125SYNOP, offset); offset += 2;
        buffer.writeFloatLE(data.cs125Temp, offset); offset += 4;
        buffer.writeFloatLE(data.cs125Humidity, offset); offset += 4;

        // 환경 센서 데이터 (SHT45)
        buffer.writeFloatLE(data.SHT45Temp, offset); offset += 4;
        buffer.writeFloatLE(data.SHT45Humidity, offset); offset += 4;
        buffer.writeFloatLE(data.rpiTemp, offset); offset += 4;

        // 전력 모니터링 데이터 (ADC 채널)
        buffer.writeFloatLE(data.chan1Current, offset); offset += 4;
        buffer.writeFloatLE(data.chan2Current, offset); offset += 4;
        buffer.writeFloatLE(data.chan3Current, offset); offset += 4;
        buffer.writeFloatLE(data.chan4Current, offset); offset += 4;

        // 태양광 충전기 데이터
        buffer.writeFloatLE(data.PVVol, offset); offset += 4;
        buffer.writeFloatLE(data.PVCur, offset); offset += 4;
        buffer.writeFloatLE(data.LoadVol, offset); offset += 4;
        buffer.writeFloatLE(data.LoadCur, offset); offset += 4;
        buffer.writeFloatLE(data.BatTemp, offset); offset += 4;
        buffer.writeFloatLE(data.DevTemp, offset); offset += 4;
        buffer.writeUInt16LE(data.ChargEquipStat, offset); offset += 2;
        buffer.writeUInt16LE(data.DischgEquipStat, offset); offset += 2;

        // 스케줄 정보는 RPi에서 보내지 않음 (PIC24에서만 관리)

        console.log(`[PIC24] structToBuffer: Created ${offset} bytes (expected 95)`);
        return buffer; // 정확히 95바이트 반환
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

        if (this.rxPacket.cmd === EWCSPIC24.CMD.PING) {
            this.ledState = !this.ledState;
            gpioController.setLED(this.ledState);
            this.sendACK(this.rxPacket.seq);
            return;
        }

        if (this.rxPacket.cmd === EWCSPIC24.CMD.GET_SENSOR_DATA) {
            console.log('[PIC24] Sensor data request received from PIC24');
            this.sendACK(this.rxPacket.seq);

            // 백그라운드에서 센서 데이터 수집 및 전송
            this.collectSensorData().then(async (sensorData) => {
                try {
                    await this.sendMultiPacket(EWCSPIC24.CMD.SENSOR_DATA, sensorData);
                    console.log('[PIC24] Multi-packet sensor data sent successfully');
                } catch (error) {
                    console.error('[PIC24] Error sending multi-packet sensor data:', error);
                }
            }).catch((error) => {
                console.error('[PIC24] Error collecting sensor data:', error);
            });
            return;
        }

        if (this.rxPacket.cmd === EWCSPIC24.CMD.SHUTDOWN) {
            console.log('[PIC24] SHUTDOWN command received');
            this.sendACK(this.rxPacket.seq);

            console.log('System will shutdown in 3 seconds...');
            console.log('[PIC24] Turning off all VOUT channels...');
            this.turnOffVOUT(1).catch(err => console.error('Failed to turn off VOUT1:', err));
            this.turnOffVOUT(2).catch(err => console.error('Failed to turn off VOUT2:', err));
            this.turnOffVOUT(3).catch(err => console.error('Failed to turn off VOUT3:', err));
            this.turnOffVOUT(4).catch(err => console.error('Failed to turn off VOUT4:', err));

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

        if (this.rxPacket.cmd === EWCSPIC24.CMD.DATA_RESPONSE) {
            console.log('[PIC24] Data response received, length:', this.rxPacket.data.length);
            if (this.pendingDataResponse) {
                this.pendingDataResponse.resolve(this.rxPacket.data);
                this.pendingDataResponse = null;
            }
            return;
        }

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

    async sendDataCommand(cmd) {
        return new Promise((resolve, reject) => {
            const seq = this.sequenceCounter++;
            if (this.sequenceCounter > 255) this.sequenceCounter = 0;

            const packet = this.createPacket(cmd, Buffer.alloc(0), seq, 1);

            this.pendingDataResponse = { resolve, reject };

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

    async sendSyncData() {
        console.log('Requesting sync data');
        const response = await this.sendDataCommand(EWCSPIC24.CMD.SEND_SYNC_DATA);
        if (response && response.length >= 6) {
            const timeData = {
                year: 2000 + response[0],
                month: response[1],
                date: response[2],
                hour: response[3],
                min: response[4],
                sec: response[5]
            };

            console.log(`[PIC24] Time received: ${timeData.year}-${String(timeData.month).padStart(2,'0')}-${String(timeData.date).padStart(2,'0')} ${String(timeData.hour).padStart(2,'0')}:${String(timeData.min).padStart(2,'0')}:${String(timeData.sec).padStart(2,'0')}`);

            const receivedDate = new Date(timeData.year, timeData.month - 1, timeData.date);
            const validThreshold = new Date(2024, 11, 1);

            if (receivedDate >= validThreshold) {
                console.log('[PIC24] Valid time data, updating system time...');

                const dateString = `${timeData.year}-${String(timeData.month).padStart(2,'0')}-${String(timeData.date).padStart(2,'0')} ${String(timeData.hour).padStart(2,'0')}:${String(timeData.min).padStart(2,'0')}:${String(timeData.sec).padStart(2,'0')}`;

                exec(`sudo date -s "${dateString}"`, (error, stdout, stderr) => {
                    if (error) {
                        console.error('[PIC24] Failed to set system time:', error);
                    } else {
                        console.log('[PIC24] System time updated successfully to:', dateString);

                        exec('date "+%Y-%m-%d %H:%M:%S"', (err, currentTime) => {
                            if (!err) {
                                console.log('[PIC24] Verification - Current system time:', currentTime.trim());
                            }
                        });
                    }
                });
            } else {
                console.log('[PIC24] Invalid time data (before 2024-12), ignoring...');
            }

            return timeData;
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

    // 유연한 ON/OFF 스케줄 설정 (모드 포함)
    async setOnOffScheduleFlexible(mode, onMin, offMin) {
        const data = Buffer.from([mode, onMin, offMin]);
        return this.sendCommand('SET_ONOFF_SCHEDULE', data);
    }

    // 유연한 ON/OFF 스케줄 조회 (모드 포함)
    async getOnOffScheduleFlexible() {
        const response = await this.sendCommand('GET_ONOFF_SCHEDULE');
        if (response && response.length >= 3) {
            const mode = response[0];
            const onMin = response[1];
            const offMin = response[2];

            let description = '';
            switch(mode) {
                case 1:
                    description = `Every hour: ON at xx:${onMin.toString().padStart(2, '0')}, OFF at xx:${offMin.toString().padStart(2, '0')}`;
                    break;
                case 2:
                    description = `Every 10 minutes: ON at x${onMin}, OFF at x${offMin} (e.g., ${onMin},${10+onMin},${20+onMin}... and ${offMin},${10+offMin},${20+offMin}...)`;
                    break;
                default:
                    description = `Invalid mode ${mode} (valid: 1=hourly, 2=every10min)`;
            }

            return {
                mode: mode,
                onMin: onMin,
                offMin: offMin,
                description: description
            };
        }
        return null;
    }

    // 레거시 호환성 함수들 (기존 코드와 호환)
    async setOnOffSchedule(onMin, offMin) {
        // 기본적으로 매시간 모드(1) 사용
        return this.setOnOffScheduleFlexible(1, onMin, offMin);
    }

    async getOnOffSchedule() {
        const response = await this.getOnOffScheduleFlexible();
        if (response) {
            return {
                onMin: response.onMin,
                offMin: response.offMin,
                description: response.description
            };
        }
        return null;
    }

    // 편의 함수들 - 일반적인 스케줄 패턴들
    async setHourlySchedule(onMin, offMin) {
        console.log(`Setting hourly schedule: ON at xx:${onMin.toString().padStart(2, '0')}, OFF at xx:${offMin.toString().padStart(2, '0')}`);
        return this.setOnOffScheduleFlexible(1, onMin, offMin);
    }

    async setEvery10MinSchedule(onMin, offMin) {
        if (onMin >= 10 || offMin >= 10) {
            throw new Error('Every 10min schedule requires minutes 0-9');
        }
        console.log(`Setting every 10min schedule: ON at x${onMin}, OFF at x${offMin}`);
        return this.setOnOffScheduleFlexible(2, onMin, offMin);
    }

    async disableSchedule() {
        console.log('Disabling ON/OFF schedule (use setPowerSave(false) instead)');
        throw new Error('Use setPowerSave(false) to disable scheduler, not disableSchedule()');
    }

    async setSatSchedule(hour, min) {
        const data = Buffer.from([hour, min]);
        return this.sendCommand('SET_SAT_SCHEDULE', data);
    }

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

    async cameraOn() {
        return this.sendCommand('VOUT2_ON');
    }

    async cameraOff() {
        return this.sendCommand('VOUT2_OFF');
    }

    async cs125On() {
        return this.sendCommand('VOUT1_ON');
    }

    async cs125Off() {
        return this.sendCommand('VOUT1_OFF');
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

