import { BigNumber, ethers } from "ethers";
import { CONTRACT, morlias_config, SK_COLLECTIONS, SEND_GRID, SOCKET_SERVER_URI, provider } from "./config";
import {addItemFunc, buyItemFunc, acceptItemFunc} from './utils/getEventFunc';
import * as marketplaceAbi from './core/abis/marketAbi.json';
import * as cron from 'node-cron';
import axios from 'axios';

import sgMail = require("@sendgrid/mail");

const contract = new ethers.Contract(CONTRACT.MARKETPLACE_CONTRACT_ADDR, marketplaceAbi, provider);


export const handleItemEvents = () =>{

    //create email handler
    sgMail.setApiKey(SEND_GRID.API_KEY);


    let buyItemTimeStamp = BigNumber.from(0);
    let acceptItemTimeStamp = BigNumber.from(0);

    const getAddItemEvent = async ()=>{
        let latestblockNumber = await provider.getBlockNumber()-10;
            cron.schedule("*/5 * * * * *", async () => {
                let blockNumber = await provider.getBlockNumber();
                const events = await contract.queryFilter(
                    contract.filters.AddItem(),
                    latestblockNumber,
                    blockNumber
                )
                if (events.length > 0) {
                    for (const ev of events) {
                        addItemFunc(ev.args.tokenId, ev.transactionHash)
                    }
                }
                latestblockNumber = blockNumber;
            });
    }

        const getBuyItemEvent = async () =>{
            let latestblockNumber = await provider.getBlockNumber()-10;
            cron.schedule("*/5 * * * * *", async () => {

                let blockNumber = await provider.getBlockNumber();
                const events = await contract.queryFilter(
                    contract.filters.BuyItem(),
                    latestblockNumber,
                    blockNumber
                )
                if (events.length > 0) {
                    for (const ev of events) {
                        var collection = ev.args.collection;
                        var buyer = ev.args.buyer;
                        var seller = ev.args.seller;
                        var tokenId = ev.args.tokenId;
                        var price = ev.args.price;
                        var timestamp = ev.args.timestamp;
                        buyItemFunc(collection, buyer, seller, tokenId, price, timestamp, ev);
                    }
                }
                latestblockNumber = blockNumber;
            });
        }

        const getAcceptItemEvent = async ()=>{
            let latestblockNumber = await provider.getBlockNumber()-10;
                cron.schedule("*/5 * * * * *", async () => {
                    let blockNumber = await provider.getBlockNumber();
                    const events = await contract.queryFilter(
                        contract.filters.AcceptItem(),
                        latestblockNumber,
                        blockNumber
                    )
                    console.log(events);
                    if (events.length > 0) {
                        for (const ev of events) {
                            var collection = ev.args.collection;
                            var buyer = ev.args.buyer;
                            var seller = ev.args.seller;
                            var tokenId = ev.args.tokenId;
                            var price = ev.args.price;
                            var timestamp = ev.args.timestamp;
                            acceptItemFunc(collection, buyer, seller, tokenId, price, timestamp, ev)
                        }
                    }
                    latestblockNumber = blockNumber;
                })
            }
   

    getAddItemEvent();
    getBuyItemEvent();
    getAcceptItemEvent();
}