import { SerialPort, ReadlineParser  } from 'serialport';
import { ByteLengthParser } from '@serialport/parser-byte-length'
import crc16ccitt from 'crc/crc16ccitt';
import { crc16modbus } from 'crc';

// solar charger ID 11,12,13,14 (0x0B, 0x0C, 0x0D, 0x0E)
//rs485
const port5 = new SerialPort({
    path: '/dev/ttyACM0',
    baudRate: 115200,lock: false
})

port5.on('data', function(data){
    console.log("port5: ")
    console.log(data)
}) 

// something is wrong.. Serial port issues keeps coming
// lock: false를 open 할때 했더니 이상한 이슈 사라짐

function getSolarBettery(id) {
    //8byte*90us = 720us ~=1ms
    
    // voltage
    //let buff = Buffer.from([id, 0x04, 0x33, 0x1A, 0x00, 0x01])
    // Battey status
    let buff = Buffer.from([id, 0x04, 0x32, 0x00, 0x00, 0x02])
    let crc16modBuff = Buffer.allocUnsafe(2)
    crc16modBuff.writeUInt16LE(Number(crc16modbus(buff)))
    buff = Buffer.concat([buff,Buffer.from([crc16modBuff[0],crc16modBuff[1]])])

    console.log(buff)

    console.log('writing 485 data')
    port5.write(buff) 

}

function testEPEVER(){
    getSolarBettery(0x0B);
}

setInterval(testEPEVER,2000);