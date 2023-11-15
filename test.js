import { SerialPort, ReadlineParser  } from 'serialport';
import adc from 'mcp-spi-adc';
import SHT4X from 'sht4x';
import { Gpio } from 'onoff';
import fs from  'fs';
import modbus from 'modbus-serial'
import shell from 'shelljs'
import internal from 'stream';

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
    baudRate: 9600,
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

        }
        
    }
    

})

function shutdown(){
    shell.exec("sudo halt")
}

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



function uartTxTest(){
    // give me time    
    port0.write('T')
    port2.write('2')
    port3.write('3')
    rs485txEn.writeSync(1)
    //port5.write('5')
    writeModbus()
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
    readTempHumidity()
    readADC()
    readRPI4Temp()
    
}


setInterval(testEWCSController,1000);