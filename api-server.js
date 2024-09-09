import express from 'express';
import { DB } from './db.js';
import { iridiumOn,iridiumOff , powerSaveOn, powerSaveOff,setStationName, getStationName, cs125On, cs125Off, CS125HoodHeaterOn, CS125HoodHeaterOff, CS125GetStatus,cameraOn,cameraOff,setMode,getMode,getCs125OnStatus,getCs125HoodHeaterStatus, getCameraOnStatus,getIridiumOnStatus,setCameraIpAddress, getCameraIpAddress, ewcsDataNow,ewcsStatusNow, setDataSavePeriod,getDataSavePeriod,setImageSavePeriod,getImageSavePeriod,timeSyncRequest } from './ewcs.js';
import { reboot } from './reboot.js';
import { changeSystemIp, changeCouchDbIp, getPublicIp,getLocalIp} from './ip.js';
import {solarChargerDataNow} from './battery.js'


export default function ApiServer(ewcsData, ewcsImageData) {
  var router = express.Router();
  
  router.get('/data/history', async function (req, res) {
    const start = +req.query.start;
    const end = +req.query.end;
    const query = {  
      selector:{
        timestamp: {
          "$gte": start,
          "$lte": end
        }
      },
      limit: 100,
      sort: [{timestamp: "desc"}]
    }


    //console.log("query ",query);
    const states = await new DB().find(ewcsData, query);
    //console.log("result", states);
    
    var response = states.docs.map(
      state => ({
        ...state
      }));
      
      res.status(200).json(response).end();
    });
    
    router.get('/image/history', async function (req, res){ 
      const start = +req.query.start;
      const end = +req.query.end;
      
      const query = {  
        selector:{
          timestamp: {
            "$gte": start,
            "$lte": end
          }
        },
        limit: 100,
        sort: [{timestamp: "desc"}]
      }
      const states = await new DB().find(ewcsImageData, query);
      
      var response = states.docs.map(
        state => ({
          ...state
        }));
        
        res.status(200).json(response).end();
      });

      router.get('/set/cs125', async function (req, res) {
        const onData = req.query.on;

        console.log(onData);
        if (onData === '1') {
          cs125On();

        }
        else if(onData === '0') {
          cs125Off();

        }
        
        const response = { "result": onData }
       
          res.status(200).json(response).end();
      });

      router.get('/set/cs125/heater', async function (req, res) {
        const onData = req.query.on;
        
        console.log(onData);
        if (onData === '1') {
          CS125HoodHeaterOn();

        }
        else if(onData === '0') {
          CS125HoodHeaterOff();

        }
        
        const response = { "result": onData }
       
          res.status(200).json(response).end();
      });

      router.get('/get/cs125/heater/status', async function(req,res){
        //const status = getCs125HoodHeaterStatus();
        const status = await CS125GetStatus();
        return res.json({cs125HoodHeaterStatus: status});
      });

      // router.get('/set/poe/reset', async function (req, res) {
      //   const result = poeReset();
      //   return res.json({poereset: result});
      // });

      



      router.get('/set/iridium', async function (req, res) {
        const onData = req.query.on;
        console.log(onData);
        if (onData === '1') {
          iridiumOn();

        }
        else if(onData === '0') {
          iridiumOff();

        }
        
        const response = { "result": onData }
       
          res.status(200).json(response).end();
      });

      router.get('/set/camera', async function (req, res) {
        const onData = req.query.on;
        console.log(onData);
        if (onData === '1') {
          cameraOn();

        }
        else if(onData === '0') {
          cameraOff();

        }
        
        const response = { "result": onData }
       
          res.status(200).json(response).end();
      });

      router.get('/set/powersave', async function (req, res) {
        const onData = req.query.on;
        console.log(onData);
        if (onData === '1') {
          powerSaveOn();

        }
        else if(onData === '0') {
          powerSaveOff();

        }
        
        const response = { "powersave": onData }
       
          res.status(200).json(response).end();
      });



      router.get('/get/cs125/status', async function(req,res){
        const status = getCs125OnStatus();
        return res.json({cs125OnStatus: status});
      });

      router.get('/get/camera/status', async function(req,res){
        const status = getCameraOnStatus();
        return res.json({cameraOnStatus: status});
      });

      router.get('/get/iridium/status', async function(req,res){
        const status = getIridiumOnStatus();
        return res.json({iridiumOnStatus: status});
      });

      

      router.get('/get/now/ewcsdata', async function(req,res){
        
        const data = ewcsDataNow();
        return res.json({ewcsdata: data});
      });

      router.get('/get/now/ewcsstatus', async function(req,res){
        const status = ewcsStatusNow();
        return res.json({ewcsstatus: status});
      });

      router.get('/get/now/solarchargerdata', async function(req,res){
        const data = solarChargerDataNow();
        return res.json({solarchargerdata: data});
      });

      
      router.get('/reboot', function(req, res) {
          const result = reboot();
        return res.json({ result: `request reboot of raspberry pi is ${result}` })
      });

      router.get('/set/ip', function(req, res) {
        const ip = req.query.ip
        const gateway = req.query.gateway
        let result1 = false;
        //let result2 = false;
        console.log("asked to set ip address to "+ip);
        console.log("asked to set gateway to "+gateway);
        if (ip && gateway) {
          result1 = changeSystemIp(`${ip}`, `${gateway}`);
          //Not using ths time. Only local address is needed
          //result2 = changeCouchDbIp(`${ip}`);
          //if (result1 && result2) reboot();
        }
      return res.json({ result: `new raspberry pi is ip & gateway set = ${result1}` })
     });

     router.get('/set/camera/ip', function(req, res) {
        const ip = req.query.ip
        let result = false;
        console.log("asked to set camera ip address to "+ip);
        if (ip) {
          result = setCameraIpAddress(`${ip}`);
        }
        return res.json({ result: `new camera ip is ${result}`})
      });

      router.get('/get/camera/ip',  function(req, res) {
        const ip =  getCameraIpAddress();
          return res.json({cameraip: `${ip}`});
      });

      router.get('/set/period/data', function(req, res) {
        const period = req.query.period
        let result = false;
        console.log("asked to set data save period "+period);
        if (period) {
          result = setDataSavePeriod(`${period}`);
        }
        return res.json({ result: `new data save period is set ${result}`})
      });

      router.get('/get/period/data',  function(req, res) {
        const period =  getDataSavePeriod();
          return res.json({dataSavePeriod: `${period}`});
      });

      router.get('/set/period/image', function(req, res) {
        const period = req.query.period
        let result = false;
        console.log("asked to set data save period "+period);
        if (period) {
          result = setImageSavePeriod(`${period}`);
        }
        return res.json({ result: `new image save period is set ${result}`})
      });

      router.get('/get/period/image',  function(req, res) {
        const period =  getImageSavePeriod();
          return res.json({imageSavePeriod: `${period}`});
      });
 
     router.get('/get/ip/public', async function(req, res) {
      const ip = await getPublicIp();
        return res.json({ip: `${ip}`});
     });

    router.get('/get/ip/local',  function(req, res) {
      const ip =  getLocalIp();
        return res.json({ip: `${ip}`});
    });

      router.get('/set/station', async function (req, res) {
        const name = req.query.name;
        setStationName(name);
        const response = { "result": name }
      
          res.status(200).json(response).end();
      });

      router.get('/get/station/name', async function (req, res) {
        const stationName = getStationName();
        return res.json({station: `${stationName}`});
      });

      router.get('/set/station/mode', async function (req, res) {
        const val = req.query.val;
        let mode;
        if(val == 0) {mode = "normal"}
        else if (val == 1) {mode = "emergency"}

        setMode(mode);
        const response = { "result": mode }
      
          res.status(200).json(response).end();
      });

      router.get('/get/station/mode', async function (req, res) {
        const mode = getMode();
        return res.json({mode: `${mode}`});
      });

      router.get('/set/synctime', async function (req, res) {
        
        const val = timeSyncRequest();
        
        return res.json({'time sync requested': `${val}`});
        
      
      });



      return router;
    }