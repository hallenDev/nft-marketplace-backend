import { BigNumber, ethers } from "ethers";
import { createConnection, getRepository, getConnection } from "typeorm";
import { setVXLUsdPrice } from "./utils/getVXLPrice";
import { CONTRACT, morlias_config, SK_COLLECTIONS, SEND_GRID, SOCKET_SERVER_URI, provider, REDIS_HOST } from "./config";
import * as marketplaceAbi from './core/abis/abi.json';
import * as cron from 'node-cron';
import { buyItemFunc, acceptItemFunc, addItemFunc } from './utils/getEventFunc';

import sgMail = require("@sendgrid/mail");
import { createClient } from 'redis';

const redisClient = createClient({
    url: REDIS_HOST
});

const contract = new ethers.Contract(CONTRACT.MARKETPLACE_CONTRACT_ADDR, marketplaceAbi, provider);

createConnection().then(async connection => {
    //create email handler
    sgMail.setApiKey(SEND_GRID.API_KEY);

    await setVXLUsdPrice();

    const getBuyItemEvent = async () => {
        let latestblockNumber = await provider.getBlockNumber() - 10;
        try {
            const res = await redisClient.get('buyItemBlock');
            if(res == null) {
                await redisClient.set('buyItemBlock', latestblockNumber);
            } else {
                latestblockNumber = parseInt(res);
            }
        } catch (e) {
            console.error("redis server error: ", e);
        }

        cron.schedule("*/5 * * * * *", async () => {
            try {
                let blockNumber = await provider.getBlockNumber();
                const events = await contract.queryFilter(
                    contract.filters.BuyItem(),
                    latestblockNumber,
                    blockNumber
                )
                if (events.length > 0) {
                    for (const ev of events) {
                        let key = 'buy_' + ev.transactionHash.toLowerCase();
                        let res = await redisClient.exists(key);
                        if(res === 1) {
                            continue;
                        } else {
                            await redisClient.set(key, 'true');
                        }
                        var collection = ev.args.collection;
                        var buyer = ev.args.buyer;
                        var seller = ev.args.seller;
                        var tokenId = ev.args.tokenId;
                        var price = ev.args.price;
                        var timestamp = ev.args.timestamp;
                        await buyItemFunc(collection, buyer, seller, tokenId, price, timestamp, ev);
                        await redisClient.del(key);
                    }
                }
                latestblockNumber = blockNumber;
                try {
                    await redisClient.set('buyItemBlock', blockNumber);
                } catch (e) {
                    console.error("redis server error: ", e);
                }
                
            } catch (e) {
                console.log("BuyItem event error: ", e);
            } 
            
        });
    }

    const getAcceptItemEvent = async () => {
        let latestblockNumber = await provider.getBlockNumber() - 10;
        try {
            const res = await redisClient.get('acceptItemBlock');
            if(res == null) {
                await redisClient.set('acceptItemBlock', latestblockNumber);
            } else {
                latestblockNumber = parseInt(res);
            }
        } catch (e) {
            console.error("redis server error: ", e);
        }
        cron.schedule("*/5 * * * * *", async () => {
            try {
                let blockNumber = await provider.getBlockNumber();
                const events = await contract.queryFilter(
                    contract.filters.AcceptItem(),
                    latestblockNumber,
                    blockNumber
                )
                if (events.length > 0) {
                    for (const ev of events) {
                        let key = 'accept_' + ev.transactionHash.toLowerCase();
                        let res = await redisClient.exists(key);
                        if(res === 1) {
                            continue;
                        } else {
                            await redisClient.set(key, 'true');
                        }
                        var collection = ev.args.collection;
                        var buyer = ev.args.buyer;
                        var seller = ev.args.seller;
                        var tokenId = ev.args.tokenId;
                        var price = ev.args.price;
                        var timestamp = ev.args.timestamp;
                        await acceptItemFunc(collection, buyer, seller, tokenId, price, timestamp, ev);
                        await redisClient.del(key);
                    }
                }
                latestblockNumber = blockNumber;
                try {
                    await redisClient.set('acceptItemBlock', blockNumber);
                } catch (e) {
                    console.error("redis server error: ", e);
                }
            } catch (e) {
                console.error("AcceptItem Event error: ", e);
            }
        })
    }

    const getAddItemEvent = async () => {
        let latestblockNumber = await provider.getBlockNumber() - 10;
        try {
            const res = await redisClient.get('addItemBlock');
            if(res == null) {
                await redisClient.set('addItemBlock', latestblockNumber);
            } else {
                latestblockNumber = parseInt(res);
            }
        } catch (e) {
            console.error("redis server error: ", e);
        }
        cron.schedule("*/5 * * * * *", async () => {
            try{
                let blockNumber = await provider.getBlockNumber();
                const events = await contract.queryFilter(
                    contract.filters.AddItem(),
                    latestblockNumber,
                    blockNumber
                )
                if (events.length > 0) {
                    for (const ev of events) {
                        let key = 'add_' + ev.transactionHash.toLowerCase();
                        let res = await redisClient.exists(key);
                        if(res === 1) {
                            continue;
                        } else {
                            await redisClient.set(key, 'true');
                        }
                        await addItemFunc(ev.args.tokenId, ev.transactionHash);
                        await redisClient.del(key);
                    }
                }
                latestblockNumber = blockNumber;
                try {
                    await redisClient.set('addItemBlock', blockNumber);
                } catch (e) {
                    console.error("redis server error: ", e);
                }
            } catch (e) {
                console.error("AddItem Event error: ", e);
            }
        });
    }

    try {
        await redisClient.connect();
    } catch (e) {
        console.error("redis server connection error: ", e);
    }    
    getBuyItemEvent();
    getAcceptItemEvent();
    getAddItemEvent();
});