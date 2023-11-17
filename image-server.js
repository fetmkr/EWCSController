import express from 'express';
import * as url from 'url';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
import fs from 'fs';
//import glob from 'glob';
import { DB } from './db.js';


export default function ImageServer(ewcsImageData) {
    var router = express.Router();

    router.use('/', express.static(__dirname + './ewcs-image'));
 
    router.get('/last/:size', async function (req, res) {
        const size = req.params.size

        const start = Date.now() - size * 100 * 1000;
        //console.log(size)
        const query = {  
            selector:{
              timestamp: {
                "$gte": start
              }
            },
            limit: 100
        };
        const  results = await new DB().find(ewcsImageData, query);


        // const newestFiles = glob.sync('./ewcsimage/*.jpg')
        //         .map(name => ({name, ctime: fs.statSync(name).ctime}))
        //         .sort((a, b) => a.ctime - b.ctime).slice(-16)
        //console.log(results)
        //var response = result.map(f => '/image/'+f.name.replace('./ewcsimage/',''))
        const response = results.docs.map(
            result => ({
              ...result
        }));
        let fileNameArr = [];
        for(var i=0;i<response.length;i++)
        {
            fileNameArr.push(parseInt(response[i].timestamp));
            //console.log(response[i].timestamp);
        }

        fileNameArr = fileNameArr.sort().reverse();

        for (let i = 0; i < fileNameArr.length;i++)
        {
            fileNameArr[i] = "/image/" + fileNameArr[i].toString()+".jpg"
        }
        // const response = results.docs.map(
        //     result => ({
        //       ...result
        //     }));

        res.status(200).json(fileNameArr).end();
    });

    return router;
}   