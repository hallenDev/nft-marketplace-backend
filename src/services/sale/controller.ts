import { NextFunction, Request, Response } from "express";
import { getRepository, Brackets, getConnection, createConnection, getManager } from "typeorm";
import { Asset } from "../../entity/Asset";
import { Bid } from "../../entity/Bid";
import { SaleType } from "../../models/enums";
import { AUCTION_CONFIG } from "./../../config";
import { ethers } from "ethers";
import { CONTRACT, morlias_config, SK_COLLECTIONS, SEND_GRID, SOCKET_SERVER_URI, provider } from "../../config";
import * as marketplaceAbi from '../../core/abis/abi.json';
import { buyItemFunc, acceptItemFunc, addItemFunc } from "../../utils/getEventFunc";

import { createClient } from 'redis';
import { REDIS_HOST } from "./../../config";

import redisHandle from "./../../models/redis";

/*
const redisClient = createClient({
    url: REDIS_HOST
}); */

import sgMail = require("@sendgrid/mail");

const contract = new ethers.Contract(CONTRACT.MARKETPLACE_CONTRACT_ADDR, marketplaceAbi, provider);

export const acceptItem = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;

        let bidId = req.body.id;

        if(!bidId) {
            return res.status(400)
                .json({
                    msg: 'bidId is empty.'
                });
        }

        const bidRepo = getRepository(Bid);

        let _bid = await bidRepo
        .findOne({
            where: {
                id: bidId
            }, relations: ['asset']
        });

        if(_bid.asset.owner_of.toLowerCase() != publicAddress.toLowerCase()) {
            return res.json({
                'can_accept': false
            });
        }

        let cur_time = Math.floor(Date.now() / 1000);

        const assetRepo = getRepository(Asset);
        _bid.asset.price = _bid.price;

        await assetRepo.save(_bid.asset);

        if(_bid.asset.on_sale && 
           _bid.asset.sale_type == SaleType.Auction && 
           cur_time >= _bid.asset.auction_start_date &&
           cur_time <= _bid.asset.auction_end_date) {

            return res.json({
                'can_accept': false
            });
        }

        return res.json({
            'can_accept': true
        });
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                msg: 'Get error while accept item.'
            });
    }    
}

export const buyItem = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let assetId = req.body.id;
        
        if(!assetId) {
            return res.status(400)
                .json({
                    msg: 'assetId is empty.'
                });
        }

        const assetRepo = getRepository(Asset);
        
        const _asset = await assetRepo.findOne(assetId);
        if(!_asset) {
            return res.status(400)
                .json({
                    msg: 'assetId is empty.'
                });
        }

        let cur_time = Math.floor(Date.now() / 1000);

        // check if asset id can be sold
        if(_asset.on_sale && _asset.sale_type == SaleType.Fixed) {
            if(_asset.sale_end_date >= cur_time) {
                return res.json({
                    'can_buy': true
                });
            }
        }

        if(_asset.on_sale && _asset.sale_type == SaleType.Auction) {
            let bidId = req.body.bid_id;

            if(!bidId) {
                return res.status(400)
                        .json({
                            msg: 'bidId is empty.'
                        });
            }

            const bidRepo = getRepository(Bid);
            let _bid = await bidRepo.findOne(bidId);
            if(!_bid) {
                return res.status(400)
                .json({
                    msg: 'Bid is not valid.'
                });
            }

            _asset.price = _bid.price;

            await assetRepo.save(_asset);

            if(cur_time >= _asset.auction_end_date + AUCTION_CONFIG.FIVE && cur_time <= _asset.auction_end_date + AUCTION_CONFIG.SEVEN) {
                return res.json({
                    'can_buy': true
                });
            }
        }

        return res.json({
            'can_buy': false
        });
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                msg: 'Get error while buy item.'
            });
    }
}

export const registerBuyTxHash = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let txID = req.body.txID;
        if(txID == '0x0') {
            return res.status(500).json({msg: 'empty txID'});
        }

        let redisClient = redisHandle.getRedisClient();

        const key = 'buy_' + txID.toLowerCase();
        // await redisClient.connect();
        const reply = await redisClient.exists(key);
        console.log(reply);
        if(reply === 1) {
        //    await redisClient.disconnect();
            return res.json({'msg': 'register: already processing'});
        }
        let tx = await provider.getTransaction(txID);
        // validate tx hash
        if(tx.to != CONTRACT.MARKETPLACE_CONTRACT_ADDR || tx.blockNumber == null) {
            // await redisClient.disconnect();
            return res.status(500).json({msg: 'invalid txHash'});
        }

        const events = await contract.queryFilter(
            contract.filters.BuyItem(),
            tx.blockNumber,
            tx.blockNumber
        )
        let flg = 0;
        if(events.length > 0) {
            for (const ev of events) {
                if(ev.transactionHash == txID) {
                    flg = 1;
                    await redisClient.set(key, 'true');
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
        }

        // await redisClient.disconnect();

        if(flg == 1) {
            return res.json({'msg': 'register: success'});
        } else {
            return res.status(500).json({msg: 'invalid txHash'});
        }

    } catch (e) {
        console.log(e);
      //  await redisClient.disconnect();
        return res.status(500).json({msg: 'Get error while registration buy tx hash'});
    }
}

export const registerAcceptTxHash = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let txID = req.body.txID;
        if(txID == '0x0') {
            return res.status(500).json({msg: 'empty txID'});
        }

        let redisClient = redisHandle.getRedisClient();

        const key = 'accept_' + txID.toLowerCase();
        // await redisClient.connect();
        const reply = await redisClient.exists(key);
        if(reply === 1) {
            // await redisClient.disconnect();
            return res.json({'msg': 'register: already processing'});
        }
        let tx = await provider.getTransaction(txID);
        // validate tx hash
        if(tx.to != CONTRACT.MARKETPLACE_CONTRACT_ADDR || tx.blockNumber == null) {
            // await redisClient.disconnect();
            return res.status(500).json({msg: 'invalid txHash'});
        }

        const events = await contract.queryFilter(
            contract.filters.AcceptItem(),
            tx.blockNumber,
            tx.blockNumber
        )
        let flg = 0;
        if(events.length > 0) {
            for (const ev of events) {
                if(ev.transactionHash == txID) {
                    flg = 1;
                    await redisClient.set(key, 'true');
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
        }

        // await redisClient.disconnect();

        if(flg == 1) {
            return res.json({'msg': 'register: success'});
        } else {
            return res.status(500).json({msg: 'invalid txHash'});
        }

    } catch (e) {
        console.log(e);
        // await redisClient.disconnect();
        return res.status(500).json({msg: 'Get error while registration accept tx hash'});
    }
}

export const registerAddTxHash = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let txID = req.body.txID;

        if(txID == '0x0') {
            return res.status(500).json({msg: 'empty txID'});
        }

        let redisClient = redisHandle.getRedisClient();

        const key = 'add_' + txID.toLowerCase();
        // await redisClient.connect();
        const reply = await redisClient.exists(key);
        if(reply === 1) {
            // await redisClient.disconnect();
            return res.json({'msg': 'register: already processing'});
        }

        let tx = await provider.getTransaction(txID);
        // validate tx hash
        if(tx.to != CONTRACT.MARKETPLACE_CONTRACT_ADDR || tx.blockNumber == null) {
            // await redisClient.disconnect();
            return res.status(500).json({msg: 'invalid txHash'});
        }

        const events = await contract.queryFilter(
            contract.filters.AddItem(),
            tx.blockNumber,
            tx.blockNumber
        )
        let flg = 0;
        if(events.length > 0) {
            for (const ev of events) {
                if(ev.transactionHash == txID) {
                    flg = 1;
                    await redisClient.set(key, 'true');
                    await addItemFunc(ev.args.tokenId, ev.transactionHash);
                    await redisClient.del(key);
                }
            }
        }

        // await redisClient.disconnect();

        if(flg == 1) {
            return res.json({'msg': 'register: success'});
        } else {
            return res.status(500).json({msg: 'invalid txHash'});
        }

    } catch (e) {
        console.log(e);
        // await redisClient.disconnect();
        return res.status(500).json({msg: 'Get error while registration accept tx hash'});
    }
}