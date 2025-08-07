
// import path from 'path'
// function test() {
//     const now = new Date();
//     const year = now.getUTCFullYear();
//     const month = String(now.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    
  

//     const timestamp = Date.now(); // Epoch timestamp in UTC
//     const urlPath = path.join(`${year}-${month}`,`${timestamp}.jpg`)
//     console.log(urlPath)
// }
// test()

import { SerialPort, ReadlineParser  } from 'serialport';

// solar charger ID 11,12,13,14 (0x0B, 0x0C, 0x0D, 0x0E)
//rs485
const port5 = new SerialPort({
    path: '/dev/ttyAMA5',
    baudRate: 115200,
})

port5.on('data', function(data){
    console.log("port5: ")
    console.log(data)
}) 


function getSolarBettery(id) {
    //8byte*90us = 720us ~=1ms
    
    // voltage
    // let buff = Buffer.from([id, 0x04, 0x33, 0x1A, 0x00, 0x01])
    // Battey status
    let buff = Buffer.from([id, 0x04, 0x32, 0x00, 0x00, 0x02])
    let crc16modBuff = Buffer.allocUnsafe(2)
    crc16modBuff.writeUInt16LE(Number(crc16modbus(buff)))
    buff = Buffer.concat([buff,Buffer.from([crc16modBuff[0],crc16modBuff[1]])])


    console.log('writing 485 data')
    rs485txEn.writeSync(1)
    port5.write(buff)
    //setTimeout(()=>{rs485txEn.writeSync(0)},1)
    //await new Promise(resolve => setTimeout(resolve, 1))
    

}

function testEWCSController(){
    //console.log("");
    //console.log("**** EWCS Controller Board Function Test")
    //toggleLED()
    //uartTxTest()
    //timeSyncRequest()
    //readTempHumidity()
    //readADC()
    //readRPI4Temp()
    //captureImage()
    getSolarBettery(11)
}

setInterval(testEWCSController,1000);