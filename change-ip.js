import { changeCouchDbIp } from './ip.js';

console.log(process.env.IP);
changeCouchDbIp(process.env.IP);