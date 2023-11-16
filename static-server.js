import express from 'express';
import * as url from 'url';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default function StaticServer() {
    var router = express.Router();

    //router.use('/', express.static(__dirname + '/..'));
    router.use('/', express.static(__dirname +'web' ));
    //console.log("index.html goes to")
    //console.log(__dirname+'web');

    return router
}