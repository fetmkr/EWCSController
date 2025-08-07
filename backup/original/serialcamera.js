import { SerialPort, ReadlineParser  } from 'serialport';


const portCamera = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 115200,
})

portCamera.on('data', function(data){
    console.log("portCamera: "+ data)
})
