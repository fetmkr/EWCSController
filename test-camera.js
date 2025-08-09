import { SerialPort } from 'serialport';
import fs from 'fs';

// 원래 ewcs.js에서 그대로 복사한 카메라 변수들
let captureState = 0
let packetCounter = 0
let packetSize = 768 // hard coded as 0x00, 0x03 
let packetNum = 0
let snapshotSize = 0

let dataBuffer = Buffer.alloc(0)
let imageBuffer = Buffer.alloc(0)
let started = false
let remainingBytesSize = 0;
let isSaved = false

let packetCaptureIntervalID = 0;
let cameraTryCount = 0

// 원래 ewcs.js와 동일한 카메라 포트 설정
const portCamera = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 115200,
})

// 원래 ewcs.js와 정확히 동일한 데이터 핸들러
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
    if (started && dataBuffer.length >= packetSize + 8) {
        // Process your 768 bytes here
        let receivedData = dataBuffer.slice(0, packetSize +8);
        let requiredData = dataBuffer.slice(6, packetSize+6);

        imageBuffer = Buffer.concat([imageBuffer, requiredData])
        console.log("snapshot size "+snapshotSize)
        console.log("image buffer length "+imageBuffer.length)
        
        console.log("packet counter / packet num "+ packetCounter +" / "+ packetNum)

        // Reset for the next message
        dataBuffer = dataBuffer.slice(packetSize+8);

        // count packet counter
        // get the last remaining one
        if (packetCounter < packetNum-1){
            
            packetCounter++;
            captureState = 1
        }
        else if(packetCounter == packetNum-1){
            // time to get the remaining bytes
            packetCounter++;
            packetSize = remainingBytesSize
            captureState = 1
        }
        else if(packetCounter >= packetNum){
            //finish getting subpacket 
            //go to write file state
            packetSize = 768
            captureState = 3
        }

        started = false;
    }
  
    // capture ready
    if(data[0] == 0x90 && data[1] == 0xeb && data[3] == 0x40 && data.length ==19 && captureState == 0 ){
        packetCounter=0;
        console.log("Capture ready signal received");
        console.log(data)
        
        snapshotSize = data.readInt32LE(7)
        console.log("snapshot size: "+snapshotSize)
        
        remainingBytesSize = (snapshotSize % packetSize)
        packetNum = Math.floor(snapshotSize / packetSize)
        console.log("Packets: "+packetNum)
        console.log("remainingBytes size: "+remainingBytesSize)

        captureState = 1
    }
});

// 원래 ewcs.js와 정확히 동일한 saveImage 함수
function saveImage(imageBuffer) {
    
    try{
        console.log("saving image..");
        
        let now = Date.now()
        let fileName = `${now}.jpg`
        let filePath = `./images/${fileName}`
        
        // Ensure directory exists
        if (!fs.existsSync('./images')) {
            fs.mkdirSync('./images', { recursive: true });
        }
        
        fs.writeFile(filePath, imageBuffer, async function (err) {
            
            if (err) {
                console.log(err);
                captureState =0
                return; 
            }
            console.log("image saved!");
            captureState =0
            isSaved = true

        });

        console.log("ewcs image saved at: ", Date(Date.now()));
    }  catch (e) {
        console.log(e);
    }
}

// 원래 ewcs.js와 정확히 동일한 captureImage 함수
function captureImage(){
    //115200bps
    //11520 bytes/s
    // ~90 us per byte
    // if command + return subpacket = ~ 800 bytes -> 800x90 us = 72000us = 72ms

    console.log(`Camera capture attempt ${cameraTryCount + 1}, state: ${captureState}`);

    if(captureState == 0){
        cameraTryCount++

         if (cameraTryCount > 5){
            cameraTryCount = 0
            clearInterval(packetCaptureIntervalID);
            console.log("check serial camera connection")
            return;
         }   
        imageBuffer= Buffer.alloc(0)
        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x40, 0x04, 0x00, 0x00, 0x02, 0x05, 0x05,0xc1,0xc2])
        console.log("Sending capture command:", cmd.toString('hex'));
        portCamera.write(cmd)

        // if takes too long to get ready reply then stop 
    }
    else if (captureState == 1)
    {
        isSaved = false

        let startAddr = packetCounter * 768
        let addrBuf = Buffer.allocUnsafe(4);
        console.log("start address: "+startAddr )
        addrBuf.writeInt32LE(Number(startAddr))
        
        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x48, 0x06, 0x00]) 
        cmd = Buffer.concat([cmd, addrBuf,Buffer.from([0x00, 0x03, 0xc1, 0xc2])])
        console.log("Requesting packet", packetCounter, "cmd:", cmd.toString('hex'));
        portCamera.write(cmd)
        captureState = 2
    }
    else if (captureState == 2)
    {
        // wait to get subpacket
        console.log("Waiting for subpacket...");
    }
    else if (captureState == 3){
        // write file

        console.log("snapshot size "+snapshotSize)
        console.log("image buffer length "+imageBuffer.length)
        if(isSaved == false){
            clearInterval(packetCaptureIntervalID);
            if(snapshotSize == imageBuffer.length)
            {
                console.log("Image complete, saving...");
                saveImage(imageBuffer)
            }
            else{
                console.log("serial camera image save failed - size mismatch")
            }
        }

    }
}

// 원래 ewcs.js와 정확히 동일한 startImageSaveTimer 함수
function startImageSaveTimer(){
    const interval = 10 * 1000; // 10초마다 테스트

    console.log("ewcs image saving.. ")
    cameraTryCount = 0
    
    packetCaptureIntervalID = setInterval(captureImage,100);
    
    setTimeout(startImageSaveTimer, interval);
}

portCamera.on('open', () => {
    console.log('Camera serial port opened: /dev/ttyUSB0');
    
    // 테스트를 위해 5초 후에 시작
    setTimeout(() => {
        startImageSaveTimer();
    }, 5000);
});

portCamera.on('error', (err) => {
    console.error('Camera serial port error:', err);
});

console.log('Starting camera capture test...');