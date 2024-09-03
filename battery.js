import { SerialPort, ReadlineParser  } from 'serialport';
import { ByteLengthParser } from '@serialport/parser-byte-length'



import modbus from 'modbus-serial'
import crc16ccitt from 'crc/crc16ccitt';
import { crc16modbus } from 'crc';

let solarChargerData = {
  PVVol:0,
  PVCur:0,
  PVPower:0,
  LoadVol:0,
  LoadCur:0,
  LoadPower:0, 
  BatTemp:0,
  DevTemp:0,
  BatSOC:0,
  BatRatedVol:0,
  BatStat:0,
  ChargEquipStat:0,
  DischgEquipStat:0,
  BatMaxVolToday:0,
  BatMinVolToday:0,
  ConEnergyToday:0,
  ConEnergyMonth:0,
  ConEnergyYear:0,
  ConEnergyTotal:0,
  GenEnergyToday:0,
  GenEnergyMonth:0,
  GenEnergyYear:0,
  GenEnergyTotal:0,
  BatVol:0,
  BatCur:0
}

// solar charger ID 11,12,13,14 (0x0B, 0x0C, 0x0D, 0x0E)
//rs485
const port5 = new SerialPort({
    path: '/dev/ttyACM0',
    baudRate: 115200,lock: false
})

// data를 36개 받기위한 파서 36*2 + 5 = 77
// epever 문서 참조
// 한번에 길게 받을라고 하는데 파서가 잘되서
// 18개씩 2번 받아야할듯
// 18*2 + 5 = 41
const parser = port5.pipe(new ByteLengthParser({ length: 41 }))

// port5.on('data', function(data){
//     console.log("port5: ")
//     console.log(data)
// }) 

// something is wrong.. Serial port issues keeps coming
// lock: false를 open 할때 했더니 이상한 이슈 사라짐

async function getSolarBettery(id) {
    //8byte*90us = 720us ~=1ms
    
    // PV Voltage
    //const PVVol = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x01])
    


    // PV Real Time Data
    // 0x3100 부터 18개 데이터들 한번에 받기
    const PVRTData1 = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x12])

    // 0x3305 부터 18개 데이터들 한번에 받기
    const PVRTData2 = Buffer.from([id, 0x04, 0x33, 0x05, 0x00, 0x12])


    console.log(Date())

    // await writeAndRead(addCRC(PVVol))
    await writeAndRead(addCRC(PVRTData1))
    await delay(100)

    await writeAndRead(addCRC(PVRTData2))
    await delay(100)


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

    return new Promise((resolve, reject) => {

      // 보내는 주소 추출
      const addrBytes = dataToSend.slice(2,4)
      // 한 번만 데이터를 받는 이벤트 리스너
      parser.once('data', (data) => {

        if(addrBytes.equals(Buffer.from([0x31,0x00]))){
          console.log('first data')
          const dataBytes = data.slice(3,-2)
          solarChargerData.PVVol = dataBytes.readUInt16BE(0) / 100
          solarChargerData.PVCur = dataBytes.readUInt16BE(2) / 100
          solarChargerData.PVPower = (dataBytes.readUInt16BE(4) | (dataBytes.readUInt16BE(6)<<16) )/100
          solarChargerData.LoadVol = dataBytes.readUInt16BE(8) / 100
          solarChargerData.LoadCur = dataBytes.readUInt16BE(10) / 100
          solarChargerData.LoadPower = (dataBytes.readUInt16BE(12) | (dataBytes.readUInt16BE(14)<<16) )/100
          solarChargerData.BatTemp = dataBytes.readUInt16BE(16) / 100
          solarChargerData.DevTemp = dataBytes.readUInt16BE(18) / 100
          solarChargerData.BatSOC = dataBytes.readUInt16BE(20)
          solarChargerData.BatRatedVol = dataBytes.readUInt16BE(22) / 100
          solarChargerData.BatStat = dataBytes.readUInt16BE(24)
          solarChargerData.ChargEquipStat = dataBytes.readUInt16BE(26)
          solarChargerData.DischgEquipStat = dataBytes.readUInt16BE(28)
          solarChargerData.BatMaxVolToday = dataBytes.readUInt16BE(30) / 100
          solarChargerData.BatMinVolToday = dataBytes.readUInt16BE(32) / 100
          solarChargerData.ConEnergyToday = dataBytes.readUInt16BE(34) 
      

        } else if (addrBytes.equals(Buffer.from([0x33,0x05]))){
          console.log('second data')
          const dataBytes = data.slice(3,-2)
          solarChargerData.ConEnergyToday = (solarChargerData.ConEnergyToday | (dataBytes.readUInt16BE(0)<<16) )/100
          solarChargerData.ConEnergyMonth = (dataBytes.readUInt16BE(2) | (dataBytes.readUInt16BE(4)<<16) )/100
          solarChargerData.ConEnergyYear = (dataBytes.readUInt16BE(6) | (dataBytes.readUInt16BE(8)<<16) )/100
          solarChargerData.ConEnergyTotal = (dataBytes.readUInt16BE(10) | (dataBytes.readUInt16BE(12)<<16) )/100
          solarChargerData.GenEnergyToday = (dataBytes.readUInt16BE(14) | (dataBytes.readUInt16BE(16)<<16) )/100
          solarChargerData.GenEnergyMonth = (dataBytes.readUInt16BE(18) | (dataBytes.readUInt16BE(20)<<16) )/100
          solarChargerData.GenEnergyYear = (dataBytes.readUInt16BE(22) | (dataBytes.readUInt16BE(24)<<16) )/100
          solarChargerData.GenEnergyTotal = (dataBytes.readUInt16BE(26) | (dataBytes.readUInt16BE(28)<<16) )/100
          solarChargerData.BatVol = dataBytes.readUInt16BE(30) / 100
          solarChargerData.BatCur = (dataBytes.readUInt16BE(32) | (dataBytes.readUInt16BE(34)<<16) )/100
        }
        console.log('data received')
        console.log(data)
        console.log('')

        console.log(solarChargerData)
        console.log('')

        
        resolve(data); // 수신된 41바이트 데이터를 resolve
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

setInterval(testEPEVER,3000);