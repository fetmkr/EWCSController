import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const portPath = '/dev/ttyAMA0';
const baudRate = 115200;

const port = new SerialPort({
  path: portPath,
  baudRate: baudRate,
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// Function to send a command to pic24 according to the protocol
function sendPic24Command(dataString) {
  // Define protocol bytes
  const STX = 0x02; // Start of Text
  const ETX = 0x0A; // Newline character for End of Text

  // Convert data string to a Buffer
  const dataBuffer = Buffer.from(dataString, 'utf8');
  const dataLength = dataBuffer.length;

  // Create the message buffer
  // STX (1 byte) + Length (1 byte) + Data (dataLength bytes) + ETX (1 byte)
  const messageBuffer = Buffer.alloc(1 + 1 + dataLength + 1);

  let offset = 0;
  messageBuffer.writeUInt8(STX, offset++); // Write STX
  messageBuffer.writeUInt8(dataLength, offset++); // Write Length

  dataBuffer.copy(messageBuffer, offset); // Copy Data
  offset += dataLength;

  messageBuffer.writeUInt8(ETX, offset++); // Write ETX

  console.log('Sending message (hex):', messageBuffer.toString('hex'));
  console.log('Sending message (ASCII):', messageBuffer.toString('ascii'));

  port.write(messageBuffer, (err) => {
    if (err) {
      return console.error('Error on write: ', err.message);
    }
    console.log(`Sent command: "${dataString}"`);
  });
}

port.on('open', () => {
  console.log(`Serial port ${portPath} opened at ${baudRate} baud.`);

  // Example usage: Send a test command
  sendPic24Command('TurnOff_1'); // You can change this string to test different commands
});

parser.on('data', (data) => {
  console.log('Received data:', data);
  // You can add logic here to process the response from pic24
});

port.on('error', (err) => {
  console.error('Error:', err.message);
});

port.on('close', () => {
  console.log('Serial port closed.');
});

// Close the port after a few seconds for testing purposes
setTimeout(() => {
  if (port.isOpen) {
    port.close((err) => {
      if (err) {
        console.error('Error closing port:', err.message);
      }
    });
  }
}, 1000); // Close after 5 seconds
