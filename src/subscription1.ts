import { BigNumber, ethers } from "ethers";
import { createConnection, getRepository, getConnection } from "typeorm";
import { Asset } from "./entity/Asset";
import { User } from "./entity/User";
import { Notify } from "./entity/Notify";
import { AssetActivity } from "./entity/AssetActivity";
import { Collection } from "./entity/Collection";
import { CONTRACT, morlias_config, SK_COLLECTIONS, SEND_GRID, SOCKET_SERVER_URI } from "./config";
import { ActivityType } from "./models/enums";
import { Bid } from "./entity/Bid";
import { getBuyMailContent, getAcceptMailContent, getBuyerEmailContent } from "./utils/getMailContent";
import { setVXLUsdPrice } from "./utils/getVXLPrice";
import * as cron from 'node-cron';

import axios from 'axios';

import sgMail = require("@sendgrid/mail");

const marketplaceAbi = [{"inputs":[{"internalType":"address","name":"_vxlToken","type":"address"},{"internalType":"address","name":"_signer","type":"address"},{"internalType":"address","name":"_skTeamWallet","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"collection","type":"address"},{"indexed":false,"internalType":"address","name":"seller","type":"address"},{"indexed":false,"internalType":"address","name":"buyer","type":"address"},{"indexed":false,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"quantity","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"price","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"timestamp","type":"uint256"}],"name":"AcceptItem","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"collection","type":"address"},{"indexed":false,"internalType":"address","name":"from","type":"address"},{"indexed":false,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"quantity","type":"uint256"},{"indexed":false,"internalType":"string","name":"tokenURI","type":"string"},{"indexed":false,"internalType":"uint256","name":"timestamp","type":"uint256"}],"name":"AddItem","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"newCollection","type":"address"}],"name":"AddSKCollection","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"collection","type":"address"},{"indexed":false,"internalType":"address","name":"buyer","type":"address"},{"indexed":false,"internalType":"address","name":"seller","type":"address"},{"indexed":false,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"quantity","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"price","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"timestamp","type":"uint256"}],"name":"BuyItem","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"collection","type":"address"}],"name":"RemoveSKCollection","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"newVxlToken","type":"address"}],"name":"SetVxlTokenAddress","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"collection","type":"address"},{"indexed":false,"internalType":"address","name":"from","type":"address"},{"indexed":false,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"string","name":"tokenURI","type":"string"},{"indexed":false,"internalType":"uint256","name":"timestamp","type":"uint256"}],"name":"UpdateItemMetaData","type":"event"},{"inputs":[],"name":"ACCEPTITEM_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"ADDITEM_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"BUYITEM_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"UPDATEITEMMETADATA_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_collection","type":"address"},{"internalType":"address","name":"_buyer","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"uint256","name":"_quantity","type":"uint256"},{"internalType":"uint256","name":"_price","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"acceptItem","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_collection","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"uint256","name":"_supply","type":"uint256"},{"internalType":"string","name":"_tokenURI","type":"string"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"addItem","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_newCollection","type":"address"}],"name":"addSKCollection","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"addTrusted","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_collection","type":"address"},{"internalType":"address","name":"_seller","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"uint256","name":"_quantity","type":"uint256"},{"internalType":"uint256","name":"_price","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"buyItem","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_newVxlToken","type":"address"}],"name":"changeVxlToken","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"domainName","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getSKTeamWallet","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getServiceFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getSigner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"paused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_collection","type":"address"}],"name":"removeSKCollection","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"removeTrusted","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_skTeamWallet","type":"address"}],"name":"setSKTeamWallet","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_serviceFee","type":"uint256"}],"name":"setServiceFee","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_signer","type":"address"}],"name":"setSigner","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"skCollection","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"unpause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_collection","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"string","name":"_tokenURI","type":"string"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"updateItemMetaData","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}];

const webSocketProvider = new ethers.providers.WebSocketProvider(morlias_config.providerUrl, morlias_config.network);
const contract = new ethers.Contract(CONTRACT.MARKETPLACE_CONTRACT_ADDR, marketplaceAbi, webSocketProvider);

// function check
function checkInSKCollection(collection) {
    for(let i = 0; i < SK_COLLECTIONS.length; i ++) {
        if(collection.toLowerCase() == SK_COLLECTIONS[i].toLowerCase()) {
            return true;
        }
    }

    return false;
}

createConnection().then(async connection => {

    //create email handler
    sgMail.setApiKey(SEND_GRID.API_KEY);

    let buyItemTimeStamp = BigNumber.from(0);
    let acceptItemTimeStamp = BigNumber.from(0);

    await setVXLUsdPrice();
    
    contract.on("AddItem", async (collection, from, tokenId, quantity, tokenURI, timestamp, event) => { 
        try {
            let _tokenId = tokenId.toHexString();

            const assetRepository = getRepository(Asset);
            let asset: Asset;
            asset = await assetRepository.findOne({
                token_id: _tokenId,
                is_voxel: true
            });

            if(asset) {
                asset.status = 'active';
                await assetRepository.save(asset);
            }
        }
        catch(e) {
            console.error("AddItem Event Err: ", e);
        }
    });

    contract.on("BuyItem", async (collection, buyer, seller, tokenId, quantity, price, timestamp, event) => {
        try {
            
            if(buyItemTimeStamp.eq(timestamp)) {
                return;
            }

            buyItemTimeStamp = timestamp;

            if(checkInSKCollection(collection)) {   
                let _tokenId = tokenId.toHexString();
                //voxel contract
                const assetRepo = getRepository(Asset);
                let asset: Asset;
                asset = await assetRepo.findOne({
                    where: {
                        token_id: _tokenId,
                        is_voxel: true
                    }, relations: ['collection']
                });
                
                if(asset) {
                    let _tempPrice = parseFloat(ethers.utils.formatEther(price));   // this is vxl price from contract
                    let _otherPrice = asset.price;   // this is usd price

                    asset.price = 0;
                    asset.top_bid = 0;
                    asset.sale_end_date=  0;
                    asset.on_sale = false;
                    asset.sale_type = 0;
                    asset.owner_of = buyer;
                    await assetRepo.save(asset);

                    const activityRepo = getRepository(AssetActivity);
                    
                    await activityRepo.save(activityRepo.create({
                        asset: assetRepo.create({
                            id: asset.id
                        }),
                        from: seller,
                        to: buyer,
                        activity: ActivityType.Sale,
                        quantity: 1,
                        price: _otherPrice,
                        other_price: _tempPrice,
                        create_date: Math.floor(Date.now() / 1000),
                        transaction_hash: event.transactionHash
                    }));

                    const userRepository = getRepository(User);

                    // add Notify
                    let notify: Notify;
                    notify = new Notify();
                    notify.create_date = Math.floor(Date.now() / 1000);
                    notify.link = asset.id.toString();
                    notify.type = 'sale';
                    notify.unread = true;
                    notify.user = seller;
                    notify.from = buyer;
                    notify.price = _tempPrice; //sale vxl
                    // get Buyer
                    const notifyRepo = getRepository(Notify);
                    let _buyerInfo = await userRepository.createQueryBuilder('user')
                    .where("LOWER(public_address) = LOWER(:buyer)", {buyer}).getOne();

                    let _buyerName = '';

                    if(_buyerInfo) {
                        if(_buyerInfo.username == "")
                            _buyerName = buyer;
                        else
                            _buyerName = _buyerInfo.username;
                    }
                    else {
                        _buyerName = buyer;
                    }

                    notify.msg = `${asset.name} was sold to ${_buyerName} for ${_tempPrice} VXL (${_otherPrice} USD)`;

                    await notifyRepo.save(notify);

                    // get Seller 
                    let _sellerInfo = await userRepository.createQueryBuilder('user')
                    .where("LOWER(public_address) = LOWER(:seller)", {seller}).getOne();

                    if(_sellerInfo) {
                        if(_sellerInfo.email && _sellerInfo.email_notification) {
                            let _msgContent = getBuyMailContent(_sellerInfo.username ? _sellerInfo.username : _sellerInfo.public_address, _buyerName, asset.name, _tempPrice, _otherPrice, asset.id);

                            const msg = {
                                to: _sellerInfo.email,
                                from: SEND_GRID.EMAIL,
                                subject: 'Item sold on SuperKluster.io',
                                html: _msgContent   
                            }
                            
                            sgMail.send(msg)
                            .then(() => {}, error => {
                                console.error(error);
                                if (error.response) {
                                    console.error(error.response.body)
                                }
                            });
                        }

                        if(_buyerInfo.email && _buyerInfo.email_notification) {
                            let _msgContent = getBuyerEmailContent(_sellerInfo.username ? _sellerInfo.username : _sellerInfo.public_address, _buyerName, asset.name, _tempPrice, asset.id, _otherPrice);
                        
                            const msg = {
                                to: _buyerInfo.email,
                                from: SEND_GRID.EMAIL,
                                subject: 'Item purchased on SuperKluster.io',
                                html: _msgContent   
                            }
                            
                            sgMail.send(msg)
                            .then(() => {}, error => {
                                console.error(error);
                                if (error.response) {
                                    console.error(error.response.body)
                                }
                            });
                        }

                        axios({
                            url: `${SOCKET_SERVER_URI}?userAcc=${seller}`,
                            method: "GET"
                        }).then(function (response) {
                            // handle success
                            console.log("handle success");
                        })
                        .catch(function (error) {
                            // handle error
                            console.log(error);
                        });
                    }

                    // delete bids
                    await getRepository(Bid).createQueryBuilder("bid")
                    .where("assetId = :assetId", {assetId: asset.id})
                    .delete()
                    .execute();
                }
            }
            else {
                //import contract
                const collectionRepo = getRepository(Collection);
                let _collection = await collectionRepo.createQueryBuilder('collection')
                .where("is_voxel = false and LOWER(contract_address) = LOWER(:collection_address)", { collection_address: collection })
                .getOne();
                
                if(_collection) {
                    let _tokenId = tokenId.toString();
                    const assetRepo = getRepository(Asset);
                    let asset: Asset;
                    asset = await assetRepo.createQueryBuilder('asset')
                    .where("collectionId = :collectionId and token_id = :tokenId", 
                        { collectionId: _collection.id, tokenId: _tokenId }
                    ).getOne();

                    if(asset)  {
                        let _tempPrice = parseFloat(ethers.utils.formatEther(price)); // vxl price
                        let _otherPrice = asset.price;   // this is usd price

                        asset.price = 0;
                        asset.top_bid = 0;
                        asset.sale_end_date=  0;
                        asset.sale_type = 0;
                        asset.on_sale = false;
                        asset.owner_of = buyer;

                        await assetRepo.save(asset);

                        const activityRepo = getRepository(AssetActivity);

                        await activityRepo.save(activityRepo.create({
                            asset: assetRepo.create({
                                id: asset.id
                            }),
                            from: seller,
                            to: buyer,
                            activity: ActivityType.Sale,
                            quantity: 1,
                            price: _otherPrice,
                            other_price: _tempPrice,
                            create_date: Math.floor(Date.now() / 1000),
                            transaction_hash: event.transactionHash
                        }));

                        const userRepository = getRepository(User);
                        // add Notify
                        let notify: Notify;
                        notify = new Notify();
                        notify.create_date = Math.floor(Date.now() / 1000);
                        notify.link = asset.id.toString();
                        notify.type = 'sale';
                        notify.unread = true;
                        notify.user = seller;
                        notify.from = buyer;
                        notify.price = _tempPrice; //sale vxl

                        let _buyerName = '';

                        //get Buyer
                        const notifyRepo = getRepository(Notify);
                        let _buyerInfo = await userRepository.createQueryBuilder('user')
                        .where("LOWER(public_address) = LOWER(:buyer)", {buyer}).getOne();

                        if(_buyerInfo) {
                            if(_buyerInfo.username == "")
                                _buyerName = buyer;
                            else
                                _buyerName = _buyerInfo.username;
                        }
                        else {
                            _buyerName = buyer;
                        }

                        notify.msg = `${asset.name} was sold to ${_buyerName} for ${_tempPrice} VXL (${_otherPrice} USD)`;

                        await notifyRepo.save(notify);
                        
                        // get Seller
                        let _sellerInfo = await userRepository.createQueryBuilder('user')
                        .where("LOWER(public_address) = LOWER(:seller)", {seller}).getOne();

                        if(_sellerInfo) {
                            if(_sellerInfo.email && _sellerInfo.email_notification) {
                                let _msgContent = getBuyMailContent(_sellerInfo.username ? _sellerInfo.username : _sellerInfo.public_address, _buyerName, asset.name, _tempPrice, _otherPrice, asset.id);

                                const msg = {
                                    to: _sellerInfo.email,
                                    from: SEND_GRID.EMAIL,
                                    subject: 'Item sold on SuperKluster.io',
                                    html: _msgContent
                                }

                                sgMail.send(msg)
                                .then(() => {}, error => {
                                    console.error(error);
                                    if (error.response) {
                                      console.error(error.response.body)
                                    }
                                });
                            }

                            if(_buyerInfo.email && _buyerInfo.email_notification) {
                                let _msgContent = getBuyerEmailContent(_sellerInfo.username ? _sellerInfo.username : _sellerInfo.public_address, _buyerName, asset.name, _tempPrice, asset.id, _otherPrice);
                            
                                const msg = {
                                    to: _buyerInfo.email,
                                    from: SEND_GRID.EMAIL,
                                    subject: 'Item purchased on SuperKluster.io',
                                    html: _msgContent   
                                }
                                
                                sgMail.send(msg)
                                .then(() => {}, error => {
                                    console.error(error);
                                    if (error.response) {
                                        console.error(error.response.body)
                                    }
                                });
                            }

                            axios({
                                url: `${SOCKET_SERVER_URI}?userAcc=${seller}`,
                                method: "GET"
                            }).then(function (response) {
                                // handle success
                                console.log("handle success");
                            })
                            .catch(function (error) {
                                // handle error
                                console.log(error);
                            });
                        }

                        // delete bids
                        await getRepository(Bid).createQueryBuilder("bid")
                        .where("assetId = :assetId", {assetId: asset.id})
                        .delete()
                        .execute();
                    }
                }
            }
        }
        catch(e) { 
            console.error("BuyItem Event Err: ", e);
        }
    });

    contract.on("AcceptItem", async (collection, seller, buyer, tokenId, quantity, price, timestamp, event) => {
        try {

            if(acceptItemTimeStamp.eq(timestamp)) {
                return;
            }

            acceptItemTimeStamp = timestamp;
            
            if(checkInSKCollection(collection)) {   
                let _tokenId = tokenId.toHexString();
                //voxel contract
                const assetRepo = getRepository(Asset);
                let asset: Asset;
                asset = await assetRepo.findOne({
                    where: {
                        token_id: _tokenId,
                        is_voxel: true
                    }, relations: ['collection']
                });
                
                if(asset) {
                    let _tempPrice = parseFloat(ethers.utils.formatEther(price)); // vxl price
                    let _otherPrice = asset.price;   // this is usd price

                    asset.price = 0;
                    asset.top_bid = 0;
                    asset.sale_end_date=  0;
                    asset.on_sale = false;
                    asset.sale_type = 0;
                    asset.owner_of = buyer;
                    await assetRepo.save(asset);

                    const activityRepo = getRepository(AssetActivity);
                    
                    await activityRepo.save(activityRepo.create({
                        asset: assetRepo.create({
                            id: asset.id
                        }),
                        from: seller,
                        to: buyer,
                        activity: ActivityType.Sale,
                        quantity: 1,
                        price: _otherPrice,
                        other_price: _tempPrice,
                        create_date: Math.floor(Date.now() / 1000),
                        transaction_hash: event.transactionHash
                    }));

                    const userRepository = getRepository(User);

                    // add Notify
                    let notify: Notify;
                    notify = new Notify();
                    notify.create_date = Math.floor(Date.now() / 1000);
                    notify.link = asset.id.toString();
                    notify.type = 'sale';
                    notify.unread = true;
                    notify.user = buyer;
                    notify.from = seller;
                    notify.price = _tempPrice;
                    
                    const notifyRepo = getRepository(Notify);
                    let _sellerInfo = await userRepository.createQueryBuilder('user')
                    .where("LOWER(public_address) = LOWER(:seller)", {seller}).getOne();

                    let _sellerName = '';

                    if(_sellerInfo) {
                        if(_sellerInfo.username == "")
                            _sellerName = seller;
                        else
                            _sellerName = _sellerInfo.username;
                    }
                    else {
                        _sellerName = seller;
                    }

                    notify.msg = `Your bid of ${_tempPrice} VXL (${_otherPrice} USD) on ${asset.name} was accepted by ${_sellerName}`;

                    await notifyRepo.save(notify);

                    if(_sellerInfo) {
                        // get Buyer
                        let _buyerInfo = await userRepository.createQueryBuilder('user')
                        .where("LOWER(public_address) = LOWER(:buyer)", {buyer}).getOne();

                        if(_buyerInfo && _buyerInfo.email && _buyerInfo.email_notification) {
                            let _msgContent = getAcceptMailContent(_sellerName, _buyerInfo.username ? _buyerInfo.username : _buyerInfo.public_address, asset.name, _tempPrice, asset.id, _otherPrice);
                            
                            const msg = {
                                to: _buyerInfo.email,
                                from: SEND_GRID.EMAIL,
                                subject: 'Bid accepted on SuperKluster.io',
                                html: _msgContent
                            }

                            sgMail.send(msg)
                            .then(() => {}, error => {
                                console.error(error);
                                if (error.response) {
                                  console.error(error.response.body)
                                }
                            });
                        }

                        if(_buyerInfo) {
                            axios({
                                url: `${SOCKET_SERVER_URI}?userAcc=${buyer}`,
                                method: "GET"
                            }).then(function (response) {
                                // handle success
                                console.log("handle success");
                            })
                            .catch(function (error) {
                                // handle error
                                console.log(error);
                            });
                        }
                    }

                    // delete bids
                    await getRepository(Bid).createQueryBuilder("bid")
                        .where("assetId = :assetId", {assetId: asset.id})
                        .delete()
                        .execute();
                }
            }
            else {
                //import contract
                const collectionRepo = getRepository(Collection);
                let _collection = await collectionRepo.createQueryBuilder('collection')
                .where("is_voxel = false and LOWER(contract_address) = LOWER(:collection_address)", { collection_address: collection })
                .getOne();
                
                if(_collection) {
                    let _tokenId = tokenId.toString();
                    const assetRepo = getRepository(Asset);
                    let asset: Asset;
                    asset = await assetRepo.createQueryBuilder('asset')
                    .where("collectionId = :collectionId and token_id = :tokenId", 
                        { collectionId: _collection.id, tokenId: _tokenId }
                    ).getOne();

                    if(asset)  {
                        let _tempPrice = parseFloat(ethers.utils.formatEther(price)); // vxl price
                        let _otherPrice = asset.price;   // this is usd price

                        asset.price = 0;
                        asset.top_bid = 0;
                        asset.sale_end_date=  0;
                        asset.on_sale = false;
                        asset.sale_type = 0;
                        asset.owner_of = buyer;

                        await assetRepo.save(asset);

                        const activityRepo = getRepository(AssetActivity);

                        await activityRepo.save(activityRepo.create({
                            asset: assetRepo.create({
                                id: asset.id
                            }),
                            from: seller,
                            to: buyer,
                            activity: ActivityType.Sale,
                            quantity: 1,
                            price: _otherPrice,
                            other_price: _tempPrice,
                            create_date: Math.floor(Date.now() / 1000),
                            transaction_hash: event.transactionHash
                        }));

                        const userRepository = getRepository(User);
                        // add Notify
                        let notify: Notify;
                        notify = new Notify();
                        notify.create_date = Math.floor(Date.now() / 1000);
                        notify.link = asset.id.toString();
                        notify.type = 'sale';
                        notify.unread = true;
                        notify.user = buyer;
                        notify.from = seller;
                        notify.price = _tempPrice;
                        //get Buyer
                        const notifyRepo = getRepository(Notify);
                        let _sellerInfo = await userRepository.createQueryBuilder('user')
                        .where("LOWER(public_address) = LOWER(:seller)", {seller}).getOne();
                        
                        let _sellerName = '';
                        if(_sellerInfo) {
                            if(_sellerInfo.username == "")
                                _sellerName = seller;
                            else
                                _sellerName = _sellerInfo.username;
                        }
                        else {
                            _sellerName = seller;
                        }

                        notify.msg = `Your bid of ${_tempPrice} VXL (${_otherPrice} USD) on ${asset.name} was accepted by ${_sellerName}`;

                        await notifyRepo.save(notify);

                        if(_sellerInfo) {
                            // get Buyer
                            let _buyerInfo = await userRepository.createQueryBuilder('user')
                            .where("LOWER(public_address) = LOWER(:buyer)", {buyer}).getOne();

                            if(_buyerInfo && _buyerInfo.email && _buyerInfo.email_notification) {
                                let _msgContent = getAcceptMailContent(_sellerName, _buyerInfo.username ? _buyerInfo.username : _buyerInfo.public_address, asset.name, _tempPrice, asset.id, _otherPrice);

                                const msg = {
                                    to: _buyerInfo.email,
                                    from: SEND_GRID.EMAIL,
                                    subject: 'Bid accepted on SuperKluster.io',
                                    html: _msgContent
                                }

                                sgMail.send(msg)
                                .then(() => {}, error => {
                                    console.error(error);
                                    if (error.response) {
                                    console.error(error.response.body)
                                    }
                                });   
                            }

                            if(_buyerInfo) {
                                axios({
                                    url: `${SOCKET_SERVER_URI}?userAcc=${buyer}`,
                                    method: "GET"
                                }).then(function (response) {
                                    // handle success
                                    console.log("handle success");
                                })
                                .catch(function (error) {
                                    // handle error
                                    console.log(error);
                                });
                            }
                        }

                        // delete bids
                        await getRepository(Bid).createQueryBuilder("bid")
                        .where("assetId = :assetId", {assetId: asset.id})
                        .delete()
                        .execute();
                    }
                }
            }
        }
        catch(e) { 
            console.error("AcceptItem Event Err: ", e);
        }
    });

    cron.schedule('* * * * *', (async () => {
        await setVXLUsdPrice();
    }));
})