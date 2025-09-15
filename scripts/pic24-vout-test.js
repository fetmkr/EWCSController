import { SerialPort } from 'serialport';

  // Protocol constants
  const EWCSPIC24_STX = 0x02;
  const EWCSPIC24_ETX = 0x03;
  const EWCSPIC24_ACK = 0x06;
  const EWCSPIC24_NACK = 0x15;
  const EWCSPIC24_CMD_VOUT_CONTROL = 0x02;

  // VOUT control subcodes
  const VOUT_1_ON = 0x11;
  const VOUT_1_OFF = 0x10;
  const VOUT_2_ON = 0x21;
  const VOUT_2_OFF = 0x20;
  const VOUT_3_ON = 0x31;
  const VOUT_3_OFF = 0x30;
  const VOUT_4_ON = 0x41;
  const VOUT_4_OFF = 0x40;

  // CRC16-MODBUS calculation
  function calculateCRC16(data) {
      let crc = 0xFFFF;
      for (let i = 0; i < data.length; i++) {
          crc ^= data[i];
          for (let j = 0; j < 8; j++) {
              if (crc & 0x0001) {
                  crc = (crc >> 1) ^ 0xA001;
              } else {
                  crc = crc >> 1;
              }
          }
      }
      return crc;
  }

  // Create packet
  function createPacket(cmd, data = []) {
      const packet = [
          EWCSPIC24_STX,
          (data.length >> 8) & 0xFF,  // Length high
          data.length & 0xFF,         // Length low
          0x00,                       // Sequence
          0x01,                       // Total packets
          cmd,                        // Command
          ...data                     // Data
      ];

      const crc = calculateCRC16(packet.slice(1));
      packet.push((crc >> 8) & 0xFF, crc & 0xFF, EWCSPIC24_ETX);

      return Buffer.from(packet);
  }

  // Send VOUT command
  function sendVOUT(port, cmd, name) {
      const packet = createPacket(EWCSPIC24_CMD_VOUT_CONTROL, [cmd]);
      console.log(`${name}: ${packet.toString('hex').toUpperCase()}`);
      port.write(packet);
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function test() {
      console.log('EWCS PIC24 VOUT Test - ttyAMA0\n');

      const port = new SerialPort({
          path: '/dev/ttyAMA0',   
          baudRate: 115200
      });

      port.on('data', data => {
          console.log(`RX: ${data.toString('hex').toUpperCase()}`);
          if (data.includes(EWCSPIC24_ACK)) console.log('✓ ACK');
          if (data.includes(EWCSPIC24_NACK)) console.log('✗ NACK');
      });

      await new Promise(resolve => port.on('open', resolve));
      console.log('Port opened\n');

      // Turn ON 1-4
      console.log('=== TURNING ON ===');
      sendVOUT(port, VOUT_1_ON, 'VOUT1 ON');
      await sleep(1000);
      sendVOUT(port, VOUT_2_ON, 'VOUT2 ON');
      await sleep(1000);
      sendVOUT(port, VOUT_3_ON, 'VOUT3 ON');
      await sleep(1000);
      sendVOUT(port, VOUT_4_ON, 'VOUT4 ON');
      await sleep(2000);

      // Turn OFF 1-4
      console.log('\n=== TURNING OFF ===');
      sendVOUT(port, VOUT_1_OFF, 'VOUT1 OFF');
      await sleep(1000);
      sendVOUT(port, VOUT_2_OFF, 'VOUT2 OFF');
      await sleep(1000);
      sendVOUT(port, VOUT_3_OFF, 'VOUT3 OFF');
      await sleep(1000);
      sendVOUT(port, VOUT_4_OFF, 'VOUT4 OFF');
      await sleep(1000);

      console.log('\nTest completed!');
      port.close();
  }

  test().catch(console.error);
