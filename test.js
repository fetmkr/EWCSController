import { SerialPort, ReadlineParser  } from 'serialport';
import { ByteLengthParser } from '@serialport/parser-byte-length'
import adc from 'mcp-spi-adc';
import SHT4X from 'sht4x';
import { Gpio } from 'onoff';
import fs from  'fs';
import modbus from 'modbus-serial'
import shell from 'shelljs'
import internal from 'stream';
import crc16ccitt from 'crc/crc16ccitt';

let utcTime = 0




const client = new modbus()
client.connectAsciiSerial("/dev/ttyAMA5",{baudRate:9600})
function writeModbus() {
    client.setID(1);

    // write the values 0, 0xffff to registers starting at address 5
    // on device number 1.
    client.writeRegisters(5, [0 , 0xffff])
        .then(read);
}

function read() {
    // read the 2 registers starting at address 5
    // on device number 1.
    client.readHoldingRegisters(5, 2)
        .then(console.log);
}

const LED = new Gpio(16, 'out')
const rs485txEn = new Gpio(23, 'out')

const thermostat = await SHT4X.open();

// to PIC controller
const port0 = new SerialPort({
    path: '/dev/ttyAMA0',
    baudRate: 115200,
})
port0.on('data', function(data){
    console.log("port0: "+ data)

    if(data.length == 1){
    if(data == 'Q')
        {
            console.log("RPI shutting down in 5 secs");
            setTimeout(shutdown,5000);
        }

        if(data == 'O')
        {
            // RPI is already on
            port0.write('O')
        }

    }else{
        console.log("time data")
        // 'T' = 84
        if(data[0] == 84 ){
            // for(let i = 0; i< data.length ; i++){
            //     console.log(data[i])
            // }
            console.log(new Date(data[1]+2000,data[2],data[3],data[4],data[5],data[6]))
            console.log(new Date(data[1]+2000,data[2],data[3],data[4],data[5],data[6]).getTime())
            let timeCommand = "sudo timedatectl set-time '"+(data[1]+2000).toString()+"-"+ data[2].toString()+"-"+data[3].toString()+" "+data[4].toString()+":"+data[5].toString()+":"+data[6].toString()+"'"
            console.log(timeCommand)
            shell.exec(timeCommand)

            // setSystemTime(year, month, date, hour, min, sec);

        }
        
    }
    

})

function shutdown(){
    shell.exec("sudo halt")
}

// function setSystemTime(year, month, date, hour, min, sec){
//     let timeCommand = "sudo timedatectl set-time '"+ year.toString()+"-"+ month.toString()+"-"+ date.toString()+" "+hour.toString()+":"+min.toString()+":"+sec.toString()+"'"
//     shell.exec(timeCommand)
// }

// CS125
const port2 = new SerialPort({
    path: '/dev/ttyAMA2',
    baudRate: 9600,
})
port2.on('data', function(data){
    console.log("port2: "+ data)
})

// Iridium
const port3 = new SerialPort({
    path: '/dev/ttyAMA3',
    baudRate: 9600,
})
port3.on('data', function(data){
    console.log("port3: "+ data)
})

// rs485
// const port5 = new SerialPort({
//     path: '/dev/ttyAMA5',
//     baudRate: 9600,
// })
// port5.on('data', function(data){
//     console.log("port5: "+  data)
// })





const cs125CurrentADCChan = adc.open(0, {speedHz: 20000}, err => {
    if (err) throw err;
});

const iridiumCurrentADCChan = adc.open(1, {speedHz: 20000}, err => {
    if (err) throw err;
});

const poeCurrentADCChan = adc.open(2, {speedHz: 20000}, err => {
    if (err) throw err;
});

const batteryVoltageADCChan = adc.open(3, {speedHz: 20000}, err => {
    if (err) throw err;
});

function timeSyncRequest()
{
    // time sync request    
    port0.write('T')
    console.log("Time Sync Requested")
}

function uartTxTest(){
    

    port2.write('2')
    port3.write('3')
    // rs485txEn.writeSync(1)
    // port5.write('5')
    // writeModbus()
 
}

let imageArray = new Array();

imageArray = [];

let captureState = 0
let packetCounter = 0
let packetSize = 768 // hard coded as 0x00, 0x03 
let snapshotSize = 0

let dataBuffer = Buffer.alloc(0)
let started = false

const portCamera = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 115200,
})


portCamera.on('data', function(data){
    dataBuffer = Buffer.concat([dataBuffer,data])
    
    // Check for start sequence 0x90, 0xEB, 0x01, 0x49 if not started
    if (!started) {
        for (let i = 0; i < dataBuffer.length - 3; i++) {
        if (dataBuffer[i] === 0x90 && dataBuffer[i + 1] === 0xEB && dataBuffer[i + 2] === 0x01 && dataBuffer[i + 3] === 0x49) {
            started = true;
            dataBuffer = dataBuffer.slice(i); // Start from the sequence
            break;
        }
        }
    }
    // If started, check if we have read at least 778 bytes
    if (started && dataBuffer.length >= 776) {
        // Process your 768 bytes here
        let receivedData = dataBuffer.slice(0, 776);
        let requiredData = dataBuffer.slice(6, 768);
        console.log("Received 778 bytes starting with 0x90, 0xEB, 0x01, 0x49: ", receivedData);
        console.log("Sliced 768 bytes starting with 0x90, 0xEB, 0x01, 0x49: ", requiredData);

        // Reset for the next message
        dataBuffer = dataBuffer.slice(776);
        started = false;
    }
  
    // capture ready
    if(data[0] == 0x90 && data[1] == 0xeb && data[3] == 0x40 && data.length ==19 && captureState == 0 ){
        console.log(data)
        
        snapshotSize = data.readInt32LE(7)
        console.log(snapshotSize)
        
        captureState = 1
    }
   

    //console.log(data)
})

function captureImage(){
    if(captureState == 0){
        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x40, 0x04, 0x00, 0x00, 0x02, 0x05, 0x01,0xc1,0xc2])
        portCamera.write(cmd)
    }
    else if (captureState == 1)
    {

        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x48, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00,0x00,0x03,0xc1,0xc2])
        portCamera.write(cmd)
        captureState = 2
    }
    else if (captureState == 2)
    {

    }
}

function getImage(){
    

}


function readADC() {
    cs125CurrentADCChan.read((err, reading) => {
        if (err) throw err;
        const val = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
        console.log('cs125 Current: '+ val + ' A');
    });
    iridiumCurrentADCChan.read((err, reading) => {
        if (err) throw err;
        const val = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
        console.log('iridium Current: '+ val + ' A');
    });
    poeCurrentADCChan.read((err, reading) => {
        if (err) throw err;
        const val = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024)*20000/1000).toFixed(3));
        console.log('poe Current: '+ val + ' A');

    });
    batteryVoltageADCChan.read((err, reading) => {
        if (err) throw err;
        const val = parseFloat(parseFloat((reading.rawValue * 3.3 / 1024) * 46 / 10).toFixed(3));
        console.log('Input Voltage: ' + val +' V');
    });
    

}   

function readRPI4Temp() {
    let temp = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp");
    let temp_c = temp/1000;
    console.log("RPI CPU temp: "+temp_c);
}

function ledOn(){
    LED.writeSync(1);
}

function ledOff(){
    LED.writeSync(0);
}
function toggleLED() {
    if (LED.readSync() === 0) {
        LED.writeSync(1); //set output to 1 i.e turn led on
      } else {
        LED.writeSync(0); //set output to 0 i.e. turn led off 
    
     }
}
async function readTempHumidity(){
    //console.log(await thermostat.serialNumber());
    const val = await thermostat.measurements()
    
    console.log("SHT45 humidity: "+ val.humidity);
    console.log("SHT45 temperature: "+ (val.temperature-32)*5/9);
}

function testEWCSController(){
    console.log("");
    console.log("**** EWCS Controller Board Function Test")
    toggleLED()
    uartTxTest()
    //timeSyncRequest()
    readTempHumidity()
    readADC()
    readRPI4Temp()
    captureImage()
}


setInterval(testEWCSController,1000);