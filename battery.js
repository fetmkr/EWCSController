import { SerialPort, ReadlineParser  } from 'serialport';
import { ByteLengthParser } from '@serialport/parser-byte-length'



import modbus from 'modbus-serial'
import crc16ccitt from 'crc/crc16ccitt';
import { crc16modbus } from 'crc';

// solar charger ID 11,12,13,14 (0x0B, 0x0C, 0x0D, 0x0E)
//rs485
const port5 = new SerialPort({
    path: '/dev/ttyACM0',
    baudRate: 115200,lock: false
})
const parser = port5.pipe(new ByteLengthParser({ length: 7 }))

// port5.on('data', function(data){
//     console.log("port5: ")
//     console.log(data)
// }) 

// something is wrong.. Serial port issues keeps coming
// lock: false를 open 할때 했더니 이상한 이슈 사라짐

async function getSolarBettery(id) {
    //8byte*90us = 720us ~=1ms
    
    // PV Voltage
    const PVVol = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x01])
    // PV Current
    const PVCur = Buffer.from([id, 0x04, 0x31, 0x01, 0x00, 0x01])
    // PV Power L
    const PVPowL = Buffer.from([id, 0x04, 0x31, 0x02, 0x00, 0x01])
    // PV Power H
    const PVPowH = Buffer.from([id, 0x04, 0x31, 0x03, 0x00, 0x01])

    // Battey status
    //Buffer.from([id, 0x04, 0x32, 0x00, 0x00, 0x02])



    console.log(Date())

    await writeAndRead(addCRC(PVVol))
    await writeAndRead(addCRC(PVCur))
    await writeAndRead(addCRC(PVPowL))
    await writeAndRead(addCRC(PVPowH))
}

function addCRC(buf)
{
    let crc16modBuff = Buffer.allocUnsafe(2)
    crc16modBuff.writeUInt16LE(Number(crc16modbus(buf)))
    
    buf = Buffer.concat([buf,Buffer.from([crc16modBuff[0],crc16modBuff[1]])])
    return buf
}

// 100ms 대기 함수
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeAndRead(dataToSend) {
    await delay(100)

    return new Promise((resolve, reject) => {
      // 한 번만 데이터를 받는 이벤트 리스너
      parser.once('data', (data) => {
        console.log('data received')
        console.log(data)
        console.log('')
        resolve(data); // 수신된 7바이트 데이터를 resolve
      });
  
      // 데이터를 시리얼 포트에 씀
      port5.write(dataToSend, (err) => {
        console.log('data sent')
        console.log(dataToSend)
        if (err) {
            
          reject(err); // 오류 발생 시 reject
        }
      });
    });
}




async function testEPEVER(){
    getSolarBettery(0x0B);
}

setInterval(testEPEVER,1000);