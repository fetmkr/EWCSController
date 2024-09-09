import { SerialPort, ReadlineParser  } from 'serialport';
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



// something is wrong.. Serial port issues keeps coming
// lock: false를 open 할때 했더니 이상한 이슈 사라짐




async function getSolarBettery(id) {
    
    // PV Voltage
    //const PVVol = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x01])
    


    // PV Real Time Data
    // PV array data
    // 0x3100 부터 4개 데이터들 한번에 받기
    const PVArrayData = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x04])

    // Load data
    // 0x310C 부터 4개 데이터 한번에 받기
    const PVLoadData = Buffer.from([id, 0x04, 0x31, 0x0C, 0x00, 0x04])

    // Temp data
    // 0x3110 부터 2개 데이터 한번에 받기
    const PVTempData = Buffer.from([id, 0x04, 0x31, 0x10, 0x00, 0x02])

    // Battery SOC
    // 0x311A 부터 1개 데이터 한번에 받기
    const PVBatSOC = Buffer.from([id, 0x04, 0x31, 0x1A, 0x00, 0x01])  

    // Battery real reated voltage
    // 0x311D 부터 1개 데이터 한번에 받기
    const PVBatRated = Buffer.from([id, 0x04, 0x31, 0x1D, 0x00, 0x01])

    // Status
    // 0x3200 부터 3개 데이터 한번에 받기
    const PVStatusData = Buffer.from([id, 0x04, 0x32, 0x00, 0x00, 0x03]) 

    
    // Consumption
    // 0x3302 부터 18개 데이터들 한번에 받기
    const PVConData = Buffer.from([id, 0x04, 0x33, 0x02, 0x00, 0x12])

    // Real time
    // 0x331A 부터 3개 데이터 한번에 받기
    const PVBatRealTime = Buffer.from([id, 0x04, 0x33, 0x1A, 0x00, 0x03]) 


    // console.log(Date())

    // await writeAndRead(addCRC(PVVol))
    const response1 = await writeAndRead(addCRC(PVArrayData))
    // console.log(response1)
    const data1 = response1.slice(3,-2)
    solarChargerData.PVVol = data1.readUInt16BE(0) / 100
    solarChargerData.PVCur = data1.readUInt16BE(2) / 100
    solarChargerData.PVPower = (data1.readUInt16BE(4) | (data1.readUInt16BE(6)<<16) )/100
    await delay(50)

    const response2 = await writeAndRead(addCRC(PVLoadData))
    // console.log(response2)
    const data2 = response2.slice(3,-2)
    solarChargerData.LoadVol = data2.readUInt16BE(0) / 100
    solarChargerData.LoadCur = data2.readUInt16BE(2) / 100
    solarChargerData.LoadPower = (data2.readUInt16BE(4) | (data2.readUInt16BE(6)<<16) )/100
    await delay(50)

    const response3 = await writeAndRead(addCRC(PVTempData))
    // console.log(response3)
    const data3 = response3.slice(3,-2)
    solarChargerData.BatTemp = data3.readUInt16BE(0) / 100
    solarChargerData.DevTemp = data3.readUInt16BE(2) / 100

    await delay(50)

    const response4 = await writeAndRead(addCRC(PVBatSOC))
    // console.log(response4)
    const data4 = response4.slice(3,-2)
    solarChargerData.BatSOC = data4.readUInt16BE(0)
    await delay(50)

    const response5 = await writeAndRead(addCRC(PVBatRated))
    // console.log(response5)
    const data5 = response5.slice(3,-2)
    solarChargerData.BatRatedVol = data5.readUInt16BE(0) / 100

    await delay(50)

    const response6 = await writeAndRead(addCRC(PVStatusData))
    // console.log(response6)
    const data6 = response6.slice(3,-2)
    solarChargerData.BatStat = data6.readUInt16BE(0)
    solarChargerData.ChargEquipStat = data6.readUInt16BE(2)
    solarChargerData.DischgEquipStat = data6.readUInt16BE(4)

    await delay(50)

    const response7 = await writeAndRead(addCRC(PVConData))
    // console.log(response7)
    const data7 = response7.slice(3,-2)
    solarChargerData.BatMaxVolToday = data7.readUInt16BE(0) / 100
    solarChargerData.BatMinVolToday = data7.readUInt16BE(2) / 100
    solarChargerData.ConEnergyToday = (data7.readUInt16BE(4) | (data7.readUInt16BE(6)<<16) )/100
    solarChargerData.ConEnergyMonth = (data7.readUInt16BE(8) | (data7.readUInt16BE(10)<<16) )/100
    solarChargerData.ConEnergyYear = (data7.readUInt16BE(12) | (data7.readUInt16BE(14)<<16) )/100
    solarChargerData.ConEnergyTotal = (data7.readUInt16BE(16) | (data7.readUInt16BE(18)<<16) )/100
    solarChargerData.GenEnergyToday = (data7.readUInt16BE(20) | (data7.readUInt16BE(22)<<16) )/100
    solarChargerData.GenEnergyMonth = (data7.readUInt16BE(24) | (data7.readUInt16BE(26)<<16) )/100
    solarChargerData.GenEnergyYear = (data7.readUInt16BE(28) | (data7.readUInt16BE(30)<<16) )/100
    solarChargerData.GenEnergyTotal = (data7.readUInt16BE(32) | (data7.readUInt16BE(34)<<16) )/100    
    await delay(50)

    const response8 = await writeAndRead(addCRC(PVBatRealTime))
    // console.log(response8)
    const data8 = response8.slice(3,-2)
    solarChargerData.BatVol = data8.readUInt16BE(0) / 100
    solarChargerData.BatCur = (data8.readUInt16BE(2) | (data8.readUInt16BE(4)<<16) )/100

    await delay(50)

    //console.log(solarChargerData)

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



// 데이터를 보내고, 응답을 읽는 함수
async function writeAndRead(dataToSend) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    // 데이터를 쓴 후 응답을 기다림
    port5.write(dataToSend, (err) => {
      if (err) {
        return reject(err);
      }

      // 데이터가 들어오면 호출되는 이벤트
      const onData = (data) => {
        buffer = Buffer.concat([buffer, data]);

        // 3번째 바이트가 도착했는지 확인
        if (buffer.length >= 3) {
          const lengthByte = buffer[2]; // 3번째 바이트 값
          const totalPacketLength = 3 + lengthByte + 2; // 3바이트(헤더) + 데이터 길이 + 2바이트(CRC)

          // 필요한 패킷의 전체 길이가 도착했는지 확인
          if (buffer.length >= totalPacketLength) {
            port5.off('data', onData); // 데이터 수신 이벤트 리스너 제거
            const packet = buffer.slice(0, totalPacketLength); // 패킷 추출
            resolve(packet); // 패킷 처리 완료
          }
        }
      };

      // 데이터를 수신할 때마다 이벤트 발생
      port5.on('data', onData);
    });
  });
}

export function solarChargerDataNow(){
  return solarChargerData
}



async function testEPEVER(){
    getSolarBettery(0x0B);
}

setInterval(testEPEVER,1000);