import "reflect-metadata";
import { createConnection } from "typeorm";
import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from 'cors';
import * as fs from 'fs';
import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import { services } from "./services";
import { getTempPath, setMailApiKey } from "./utils";
import { import_assets, import_collection } from "./cron";
import { setVXLUsdPrice } from "./utils/getVXLPrice";

import redisHandle from "./models/redis";

const port = 3001;

createConnection().then(async connection => {

    // Generate asset directories
    const tempPath = getTempPath();
    if (!fs.existsSync(tempPath)) {
        fs.mkdirSync(tempPath);
    }

    dotenv.config();

    // create express app
    const app = express();
    app.use(bodyParser.json());
    app.use(cors());
    app.use('/api', services);
    app.listen(port);

    setMailApiKey();

    // redis setting
    try {
        await redisHandle.init("txn");
        redisHandle.onConnect();
        redisHandle.onReady();
        redisHandle.onError();
    } catch (e) {
        
    }
    

    await setVXLUsdPrice();

    let bImportCollection = false;
    cron.schedule('* * * * *', (async () => {
        if (bImportCollection) {
            return;
        }

        bImportCollection = true;
        await import_collection();
        bImportCollection = false;
    }));

    let bImportAssets = false;
    cron.schedule('* * * * *', (async () => {
        if (bImportAssets) {
            return;
        }

        bImportAssets = true;
        await import_assets();
        bImportAssets = false;
    }));

    cron.schedule('* * * * *', (async () => {
        await setVXLUsdPrice();
    }));

    console.log("VoxelX server has started.");

}).catch(error => console.log(error));
