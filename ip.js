import { readFile, writeFile } from 'fs';
import { publicIpv4 } from 'public-ip';
import localIpAddress from 'local-ip-address';
import { setIpAddress } from './ewcs.js';

export const changeSystemIp = (ip, gateway) => {
  // Change IP and Gateway in /etc/dhcpcd.conf 
  readFile('/etc/dhcpcd.conf', 'utf-8', function (err, contents) {
    if (err) {
      console.log(err);
      return false
    }
    let replaced = contents.replace(/static ip_address=.*/, `static ip_address=${ip}/24`);
    replaced = replaced.replace(/static routers=.*/, `static routers=${gateway}`);
    replaced = replaced.replace(/static domain_name_servers=.*/, `static domain_name_servers=${gateway} 8.8.8.8`);

    writeFile('/etc/dhcpcd.conf', replaced, 'utf-8', function (err) {
      if (err) {
        console.log(err);
        return false
      }
    });
  });
  setIpAddress(ip,gateway)

  return true
};

// Not using 2023 version
export const changeCouchDbIp = (ip) => {
  readFile('../index.html', 'utf-8', function (err, contents) {
    if (err) {
      console.log(err);
      return false
    }
    let replaced = contents.replace(/CouchDB.*/, `CouchDB("http://${ip}:5984/openmct"));`);

    writeFile('../index.html', replaced, 'utf-8', function (err) {
      if (err) {
        console.log(err);
        return false
      }
    });
  });
  return true
};

export const getPublicIp = async () => {
  const ip = await publicIpv4();
  console.log(ip);
  return ip;
}

export function getLocalIp() {
  return localIpAddress();
};

//changeSystemIp('192.168.0.119', '192.168.0.1')
//import dotenv from "dotenv";
//dotenv.config();
//console.log(process.env.IP)
//changeCouchDbIp(process.env.IP)