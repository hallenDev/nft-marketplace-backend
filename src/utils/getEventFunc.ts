import { BigNumber, ethers } from "ethers";
import { createConnection, getRepository, getConnection } from "typeorm";
import { User } from "../entity/User";
import { Asset } from "../entity/Asset";
import { AssetActivity } from "../entity/AssetActivity";
import { ActivityType } from "../models/enums";
import { Notify } from "../entity/Notify";
import { Bid } from "../entity/Bid";
import { Collection } from "../entity/Collection";
import { CONTRACT, morlias_config, SK_COLLECTIONS, SEND_GRID, SOCKET_SERVER_URI, provider } from "../config";
import { getBuyMailContent, getAcceptMailContent, getBuyerEmailContent } from "../utils/getMailContent";
import * as marketplaceAbi from '../core/abis/abi.json';
import * as cron from 'node-cron';
import axios from 'axios';

import sgMail = require("@sendgrid/mail");

const contract = new ethers.Contract(CONTRACT.MARKETPLACE_CONTRACT_ADDR, marketplaceAbi, provider);

function checkInSKCollection(collection) {
    for(let i = 0; i < SK_COLLECTIONS.length; i ++) {
        if(collection.toLowerCase() == SK_COLLECTIONS[i].toLowerCase()) {
            return true;
        }
    }

    return false;
}

export const buyItemFunc = async(collection, buyer, seller, tokenId, price, timestamp, event) => {
    try {
        // if tx is already registered, return
        const activityRepo = getRepository(AssetActivity);
        let registered = await activityRepo.createQueryBuilder('asset_activity')
        .where("LOWER(transaction_hash) = LOWER(:txhash)", {txhash: event.transactionHash}).getOne();

        if(registered) {
            console.log("same txhash while registering BuyItem Event");
            return;
        }

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
}

export const acceptItemFunc = async (collection, seller, buyer, tokenId, price, timestamp, event) => {
    try {
        
        // if tx is already registered, return
        const activityRepo = getRepository(AssetActivity);
        let registered = await activityRepo.createQueryBuilder('asset_activity')
        .where("LOWER(transaction_hash) = LOWER(:txhash)", {txHash: event.transactionHash}).getOne();
        if(registered) {
            return;
        }
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
}

export const addItemFunc = async (tokenId, txHash) => {
    try {
        let _tokenId = tokenId.toHexString();

        const assetRepository = getRepository(Asset);
        let asset: Asset;
        // if already added, skip
        asset = await assetRepository.findOne({
            token_id: _tokenId,
            is_voxel: true,
            status: 'pending'
        });

        if(asset) {
            asset.status = 'active';
            await assetRepository.save(asset);
        }
    }
    catch(e) {
        console.error("AddItem Event Err: ", e);
    }
}