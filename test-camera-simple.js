#!/usr/bin/env node
import { SerialPort } from 'serialport';
import fs from 'fs';

// 카메라 변수들 (기존 코드와 동일)
let captureState = 0;
let packetCounter = 0;
let packetSize = 768;
let packetNum = 0;
let snapshotSize = 0;
let dataBuffer = Buffer.alloc(0);
let imageBuffer = Buffer.alloc(0);
let started = false;
let remainingBytesSize = 0;
let isSaved = false;
let packetCaptureIntervalID = 0;
let cameraTryCount = 0;

// 카메라 포트 설정
const portCamera = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 115200,
});

// 데이터 수신 핸들러 (기존 코드와 동일)
portCamera.on('data', function(data){
    dataBuffer = Buffer.concat([dataBuffer, data]);
    
    // Check for start sequence 0x90, 0xEB, 0x01, 0x49 if not started
    if (!started) {
        for (let i = 0; i < dataBuffer.length - 3; i++) {
            if (dataBuffer[i] === 0x90 && dataBuffer[i + 1] === 0xEB && dataBuffer[i + 2] === 0x01 && dataBuffer[i + 3] === 0x49) {
                started = true;
                dataBuffer = dataBuffer.slice(i);
                break;
            }
        }
    }
    
    // If started, check if we have read at least 776 bytes
    if (started && dataBuffer.length >= packetSize + 8) {
        let receivedData = dataBuffer.slice(0, packetSize + 8);
        let requiredData = dataBuffer.slice(6, packetSize + 6);

        imageBuffer = Buffer.concat([imageBuffer, requiredData]);
        console.log("packet counter / packet num: " + packetCounter + " / " + packetNum);

        dataBuffer = dataBuffer.slice(packetSize + 8);

        // count packet counter
        if (packetCounter < packetNum - 1) {
            packetCounter++;
            captureState = 1;
        }
        else if(packetCounter == packetNum - 1) {
            packetCounter++;
            packetSize = remainingBytesSize;
            captureState = 1;
        }
        else if(packetCounter >= packetNum) {
            packetSize = 768;
            captureState = 3;
        }

        started = false;
    }
  
    // capture ready
    if(data[0] == 0x90 && data[1] == 0xeb && data[3] == 0x40 && data.length == 19 && captureState == 0) {
        packetCounter = 0;
        console.log("Capture ready signal received");
        
        snapshotSize = data.readInt32LE(7);
        console.log("snapshot size: " + snapshotSize);
        
        remainingBytesSize = (snapshotSize % packetSize);
        packetNum = Math.floor(snapshotSize / packetSize);
        console.log("Packets: " + packetNum);
        console.log("remainingBytes size: " + remainingBytesSize);

        captureState = 1;
    }
});

// 이미지 저장 함수
function saveImage(imageBuffer) {
    try {
        console.log("saving image..");
        
        let now = Date.now();
        let fileName = `${now}.jpg`;
        let filePath = `./images/${fileName}`;
        
        // Ensure directory exists
        if (!fs.existsSync('./images')) {
            fs.mkdirSync('./images', { recursive: true });
        }
        
        fs.writeFile(filePath, imageBuffer, function (err) {
            if (err) {
                console.log(err);
                captureState = 0;
                return; 
            }
            console.log("image saved!");
            captureState = 0;
            isSaved = true;
            
            // 테스트 완료
            console.log("\n=== Test completed successfully ===");
            process.exit(0);
        });

    } catch (e) {
        console.log(e);
    }
}

// 이미지 캡처 함수
function captureImage() {
    console.log(`Camera capture attempt ${cameraTryCount + 1}, state: ${captureState}`);

    if(captureState == 0) {
        cameraTryCount++;

        if (cameraTryCount > 5) {
            cameraTryCount = 0;
            clearInterval(packetCaptureIntervalID);
            console.log("check serial camera connection");
            process.exit(1);
            return;
        }   
        
        imageBuffer = Buffer.alloc(0);
        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x40, 0x04, 0x00, 0x00, 0x02, 0x05, 0x05, 0xc1, 0xc2]);
        console.log("Sending capture command:", cmd.toString('hex'));
        portCamera.write(cmd);
    }
    else if (captureState == 1) {
        isSaved = false;

        let startAddr = packetCounter * 768;
        let addrBuf = Buffer.allocUnsafe(4);
        addrBuf.writeInt32LE(Number(startAddr));
        
        let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x48, 0x06, 0x00]);
        cmd = Buffer.concat([cmd, addrBuf, Buffer.from([0x00, 0x03, 0xc1, 0xc2])]);
        portCamera.write(cmd);
        captureState = 2;
    }
    else if (captureState == 2) {
        // wait to get subpacket
    }
    else if (captureState == 3) {
        // write file
        console.log("snapshot size " + snapshotSize);
        console.log("image buffer length " + imageBuffer.length);
        
        if(isSaved == false) {
            clearInterval(packetCaptureIntervalID);
            if(snapshotSize == imageBuffer.length) {
                console.log("Image complete, saving...");
                saveImage(imageBuffer);
            }
            else {
                console.log("serial camera image save failed - size mismatch");
                process.exit(1);
            }
        }
    }
}

// 포트 열림 이벤트
portCamera.on('open', () => {
    console.log('Camera serial port opened: /dev/ttyUSB0');
    console.log('Starting capture in 3 seconds...\n');
    
    // 3초 후에 캡처 시작
    setTimeout(() => {
        console.log("Starting image capture...");
        cameraTryCount = 0;
        packetCaptureIntervalID = setInterval(captureImage, 100);
    }, 3000);
});

portCamera.on('error', (err) => {
    console.error('Camera serial port error:', err);
    process.exit(1);
});

console.log('=== Simple Camera Test - Capture One Image ===');
console.log('Opening camera port...');