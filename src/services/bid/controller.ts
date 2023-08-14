import { NextFunction, Request, Response } from "express";
import { morlias_config, CONTRACT, SEND_GRID, SOCKET_SERVER_URI } from './../../config';
import axios from 'axios';
import { ethers } from "ethers";
import { getConnection, getManager, getRepository, Not, Raw } from "typeorm";
import { Asset } from "../../entity/Asset";
import { AssetActivity } from "../../entity/AssetActivity";
import { ActivityType, SaleType } from "../../models/enums";
import { Bid } from "../../entity/Bid";
import { User } from "../../entity/User";
import { Notify } from "../../entity/Notify";
import { getMailHandle, extendResponse } from "./../../utils/index";
import { getOfferMailContent, getBidMailContent, getOutbidMailContent } from "./../../utils/getMailContent"
import { getVXLUsdPrice } from "./../../utils/getVXLPrice";

export const assetSellList = async function (req: Request, res: Response, next: NextFunction) {
    try {
        if(!req.body.owner) {
            return res.status(500)
                .json({
                    msg: 'Public address is invalid'
                })            
        }

        const publicAddress = req.body.owner;

        let builder = getRepository(Bid).createQueryBuilder("bid");
        builder.addSelect("tb.max_bid as max_bid");
        builder.leftJoinAndSelect("bid.asset", "asset");

        let sub_query = getConnection()
                        .createQueryBuilder()
                        .select('bid.assetId as bid_asset_id')
                        .addSelect('max(bid.price) as max_bid')
                        .from(Bid, "bid")
                        .groupBy("bid.assetId");

        builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "bid.assetId = tb.bid_asset_id");

        builder.where("LOWER(asset.owner_of) = LOWER(:owner)", {owner: publicAddress});
        builder.orderBy("bid.create_date", "DESC");

        let data = await builder.getRawMany();

        let ret_data = [];

        data.forEach(function(_item) {
            let item: {[k: string]: any} = {};

            item = {
                asset: {
                    id: _item.asset_id,
                    image: _item.asset_image,
                    name: _item.asset_name,
                    auction_start_date: _item.asset_auction_start_date,
                    auction_end_date: _item.asset_auction_end_date,
                    sale_end_date: _item.asset_sale_end_date,
                    on_sale: _item.asset_on_sale,
                    sale_type: _item.asset_sale_type
                },
                bid_date: _item.bid_create_date,
                bid_amount: _item.bid_price,
                highest_bid: _item.max_bid
            }

            ret_data.push(item);
        })

        return res.status(200)
            .json(extendResponse({data: ret_data}));
    }
    catch(ex) {
        console.log(ex);
        return res.status(500).json({
            msg: 'Get error while assetSellList'
        })
    }
}

export const assetBidList = async function (req: Request, res: Response, next: NextFunction) {
    try {

        if(!req.body.owner) {
            return res.status(500)
                .json({
                    msg: 'Public address is invalid'
                })            
        }

        const publicAddress = req.body.owner;

        let builder = getRepository(Bid).createQueryBuilder("bid");
        builder.addSelect("tb.max_bid as max_bid");
        builder.leftJoinAndSelect("bid.asset", "asset");

        let sub_query = getConnection()
                        .createQueryBuilder()
                        .select('bid.assetId as bid_asset_id')
                        .addSelect('max(bid.price) as max_bid')
                        .from(Bid, "bid")
                        .groupBy("bid.assetId");

        builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "bid.assetId   = tb.bid_asset_id");

        builder.where("LOWER(bid.bidder) = LOWER(:bidder)", {bidder: publicAddress});

        builder.orderBy("bid.create_date", "DESC");
        
        let data = await builder.getRawMany();


        let ret_data = [];

        data.forEach(function(_item) {
            let item: {[k: string]: any} = {};

            item = {
                asset: {
                    id: _item.asset_id,
                    image: _item.asset_image,
                    name: _item.asset_name,
                    auction_start_date: _item.asset_auction_start_date,
                    auction_end_date: _item.asset_auction_end_date,
                    sale_end_date: _item.asset_sale_end_date,
                    on_sale: _item.asset_on_sale,
                    sale_type: _item.asset_sale_type
                },
                bid_date: _item.bid_create_date,
                bid_amount: _item.bid_price,
                highest_bid: _item.max_bid
            }

            ret_data.push(item);
        })

        return res.status(200)
            .json(extendResponse({data: ret_data}));
    }
    catch(ex) {
        console.log(ex);
        return res.status(500).json({
            msg: 'Get error while assetBidList'
        })
    }
}

export const getBidsForAsset = async function (req: Request, res: Response, next: NextFunction) {
    try {

        if(!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'asset id is invalid'
                })            
        }

        const assetId = parseInt(req.body.id.toString());
        
        let data = await getRepository(Bid)
            .createQueryBuilder('bid')
            .leftJoinAndSelect(User, "user", "LOWER(bid.bidder) = LOWER(user.public_address)")
            .where('bid.assetId = :assetId', {assetId})
            .orderBy('bid.price', 'DESC')
            .addOrderBy('bid.created_at', 'DESC')
            .getRawMany();

        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};

            _item = {
                id: item.bid_id,
                time: item.bid_create_date,
                bidder: {
                    address: item.user_public_address,
                    id: item.user_id,
                    name: item.user_username,
                    avatar: item.user_avatar,
                    warning_badge: item.user_warning_badge  
                },
                price: item.bid_price
            };

            if(item.bid_is_auction) {
                let _balance = ethers.BigNumber.from(item.user_vxl_balance);
                let bid_amount = ethers.utils.parseEther(item.bid_price.toString());
                if(_balance.lt(bid_amount)) {
                    _item['disable_accept'] = true;
                }
            }
            
            ret_data.push(_item);
        }); 

        return res.json({
            data: ret_data
        });
    }
    catch(ex) {
        console.log(ex);
        return res.status(500).json({
            msg: 'Get error while place Bid'
        })
    }
}

export const cancelBid = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;

        if(!req.body.id) {
            return res.status(400)
            .json({
                msg: 'offer id is invalid'
            });
        }

        const bidId = req.body.id;

        const bidRepo = getRepository(Bid);

        const _bid = await bidRepo.findOne({
            where: {
                id: bidId
            }, relations: ['asset']
        });

        if( !_bid ) {
            return res.status(400)
                    .json({
                        msg: 'Bid is not valid.'
                    })
        }

        if(_bid.bidder.toLowerCase() != publicAddress.toLowerCase()) {
            return res.status(400)
                    .json({
                        msg: "This is not your bid."
                    })
        }

        let _cur_time = Math.floor(Date.now() / 1000);

        // if auction is ended
        if(_bid.asset.sale_type == SaleType.Auction) {
            if(_bid.asset.auction_end_date < _cur_time) {
                return res.status(400)
                    .json({
                        msg: "You can't cancel your bid now."
                    })       
            }
        }

        await bidRepo.createQueryBuilder('bid')
        .where("id = :bidId", {bidId})
        .delete()
        .execute();

        const activityRepo = getRepository(AssetActivity);
        const assetRepo = getRepository(Asset);

        if(_bid.asset.sale_type == SaleType.Auction) {
            let __query = `select max(price) as max_price from bid where bid.assetId = ${_bid.asset.id}`;
            
            const entityManager = getManager();
            let max_query = await entityManager.query(__query);

            let temp_asset: Asset;
            temp_asset = _bid.asset;

            if(max_query[0]['max_price'] == null) {
                temp_asset.top_bid = 0;
            }
            else {
                temp_asset.top_bid = max_query[0]['max_price'];
            }

            await assetRepo.save(temp_asset);
        }

        if(_bid.is_auction) {
            await activityRepo.save(activityRepo.create({
                asset: assetRepo.create({
                    id: _bid.asset.id
                }),
                from: publicAddress,
                activity: ActivityType.CancelBid,
                quantity: 1,
                price: _bid.price,
                create_date: Math.floor(Date.now() / 1000)
            }));
        }
        else {
            await activityRepo.save(activityRepo.create({
                asset: assetRepo.create({
                    id: _bid.asset.id
                }),
                from: publicAddress,
                activity: ActivityType.CancelOffer,
                quantity: 1,
                price: _bid.price,
                create_date: Math.floor(Date.now() / 1000)
            }));
        }

        return res.status(200)
        .send({
            'msg': "Bid successed."
        });
    }
    catch(ex) {
        console.log(ex);   
        return res.status(500)
                .json({
                    msg: 'Get error while cancel Bid'
                })
    }
}

export const placeBid = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;

        if(!req.body.id) {
            return res.status(400)
            .json({
                msg: 'asset id is invalid'
            });
        }

        if(!req.body.price) {
            return res.status(400)
            .json({
                msg: 'price is invalid'
            });
        }

        const assetId = parseInt(req.body.id.toString());
        const assetRepo = getRepository(Asset);
        const bidRepo = getRepository(Bid);

        let asset = await assetRepo.findOne(assetId);

        if(!asset) {
            return res.status(500)
                .json({
                    msg: 'Your asset not exists.'
                })
        }

        if(asset.sale_type != SaleType.Auction) {
            if(!req.body.expiration_date) {
                return res.status(400)
                .json({
                    msg: 'Expiration Date is invalid'
                });
            }
        }


        // code here
        let vxlUsdPrice = getVXLUsdPrice();

        // check auction_date
        if(asset.sale_type == SaleType.Auction) {
            let cur_time = Math.floor(Date.now() / 1000);
            if( !(cur_time >= asset.auction_start_date
                && cur_time <= asset.auction_end_date) ) {
                    return res.status(400)
                    .json({
                        msg: 'You can only bid during the auction period.'
                    }); 
            }
        }

        // check bid price logic start
        // logic here ******************
        if(asset.sale_type == SaleType.Auction) {
            const entityManager = getManager();
            let query123 = `select max(price) as max_price from bid where bid.assetId = ${asset.id}`;
            let max_query = await entityManager.query(query123);
            let max_price = max_query[0]['max_price'] == null ? 0 : max_query[0]['max_price'];

            if(max_price == 0) {
                //first bid
                if(req.body.price < asset.price) {

                    let assetPriceVXL = vxlUsdPrice == 0 ? 0 : ( (asset.price / vxlUsdPrice).toFixed(2) );

                    return res.status(400)
                    .json({
                        'msg': `Bid price should be more than ${assetPriceVXL} VXL.`
                    });
                }
            }
            else {
                if(req.body.price <= max_price) {

                    let maxPriceVXL = vxlUsdPrice == 0 ? 0 : ( (max_price / vxlUsdPrice).toFixed(2) );

                    return res.status(400)
                    .json({
                        'msg': `Bid price should be more than ${maxPriceVXL} VXL.`
                    });
                }
            }
        }
        // check bid price logic end

        const userRepo = getRepository(User);
        const user = await userRepo.findOne({
            where: {
                public_address: Raw(alias => `LOWER(${alias}) = '${publicAddress.toLowerCase()}'`)
            }
        });

        if (!user) {
            return res.status(500)
                .json({
                    'msg': 'User not exists.'
                });
        }

        let url = `https://deep-index.moralis.io/api/v2/${publicAddress}/erc20?chain=rinkeby&token_addresses=${CONTRACT.VXL_TOKEN_ADDR}`

        const resp = await axios({
            url: url,
            method: "GET",
            headers: {
                "X-API-Key": morlias_config.apiKey
            }
        });

        if(resp.status != 200) {
            return res.status(500)
                .json({
                    msg: 'Get error while get user vxl balance'
                })
        }

        let yourBalance = ethers.BigNumber.from(resp.data.length == 0 ? "0" : resp.data[0].balance);

        let vxlTokenAmount = vxlUsdPrice == 0 ? 0 : (req.body.price / vxlUsdPrice);
        let price = ethers.utils.parseEther(vxlTokenAmount.toString());

        if(yourBalance.lt(price)) {
            return res.status(500)
                .json({
                    msg: 'Your vxl balance is not enough for bid'
                })
        }

        let bid: Bid;

        bid = new Bid();

        if(asset.sale_type == SaleType.Auction) {
            bid.is_auction = true;
        }

        bid.asset = asset;
        bid.price = req.body.price;
        bid.bidder = publicAddress;
        bid.create_date = bid.update_date = Math.floor(Date.now() / 1000);

        if(asset.sale_type != SaleType.Auction) {
            bid.expiration_date = req.body.expiration_date;
        }
        await bidRepo.save(bid);

        const activityRepo = getRepository(AssetActivity);

        if(asset.sale_type == SaleType.Auction) {
            await activityRepo.save(activityRepo.create({
                asset: assetRepo.create({
                    id: assetId
                }),
                from: publicAddress,
                activity: ActivityType.Bid,
                quantity: 1,
                price: req.body.price,
                create_date: Math.floor(Date.now() / 1000)
            }));
        }
        else {
            await activityRepo.save(activityRepo.create({
                asset: assetRepo.create({
                    id: assetId
                }),
                from: publicAddress,
                activity: ActivityType.Offer,
                quantity: 1,
                price: req.body.price,
                create_date: Math.floor(Date.now() / 1000)
            }));
        }

        const notifyRepo = getRepository(Notify);

        let notify: Notify;
        notify = new Notify();
        notify.create_date = Math.floor(Date.now() / 1000);
        notify.link = asset.id.toString();
        notify.type = 'bid';
        notify.unread = true;
        notify.user = asset.owner_of;
        notify.from = publicAddress;
        notify.price = req.body.price;

        if(asset.sale_type == SaleType.Auction) {
            notify.msg = (user.username == '' ? user.public_address : user.username) + ` placed a bid of {price} on '${asset.name}'`;
        }
        else {
            notify.msg = (user.username == '' ? user.public_address : user.username) + ` made a offer of {price} on '${asset.name}'`;
        }

        await notifyRepo.save(notify);

        //send email
        const userRepository = getRepository(User);
        //1. get seller
        let _sellerInfo = await userRepository.createQueryBuilder('user')
                        .where("LOWER(public_address) = LOWER(:seller)", {seller: asset.owner_of}).getOne();

        if(_sellerInfo && _sellerInfo.email && _sellerInfo.email_notification) {
            let _sellerName = _sellerInfo.username ? _sellerInfo.username : _sellerInfo.public_address;
            let _bidderName = '';

            let _bidderInfo = await userRepository.createQueryBuilder('user')
            .where("LOWER(public_address) = LOWER(:bidder)", {bidder: publicAddress}).getOne();

            if(!_bidderInfo) {
                _bidderName = publicAddress;
            }
            else {
                _bidderName = _bidderInfo.username ? _bidderInfo.username : _bidderInfo.public_address;
            }

            let sgMail = getMailHandle();
            let _msgContent = '';
            let _subject = '';

            if(asset.sale_type == SaleType.Auction) {
                _msgContent = getBidMailContent(_sellerName, _bidderName, asset.name, `http://18.209.240.51/ItemDetail/${asset.id}`, req.body.price, asset.id);
                _subject = `New bid on ${asset.name}`;
            }
            else {
                _msgContent = getOfferMailContent(_sellerName, _bidderName, asset.name, `http://18.209.240.51/ItemDetail/${asset.id}`, req.body.price, asset.id);
                _subject = `New offer on ${asset.name}`;
            }

            const msg = {
                to: _sellerInfo.email,
                from: SEND_GRID.EMAIL,
                subject: _subject,
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

        if(_sellerInfo) {

            axios({
                url: `${SOCKET_SERVER_URI}?userAcc=${asset.owner_of}`,
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
        //end send mail

        /* outbid */
        if(asset.sale_type == SaleType.Auction) {

            let _outbidQuery = "SELECT `user`.* FROM `bid`  \
            LEFT JOIN `user`    \
            ON LOWER(`user`.public_address) = LOWER(`bid`.`bidder`)   \
            where `bid`.assetId = " + asset.id + " \
            and `bid`.price < " + req.body.price + " \
            group by `user`.`id`";

            const entityManager = getManager();
            let _bidderList = await entityManager.query(_outbidQuery);

            console.log("_bidderList: ", _bidderList);

            let sgMail = getMailHandle();
            let _msgContent = '';
            let _subject = '';            

            for(let i = 0; i < _bidderList.length; i ++) {
                
                if(_bidderList[i]['public_address'] == publicAddress) 
                    continue;
                //notify
                let notify: Notify;
                notify = new Notify();
                notify.create_date = Math.floor(Date.now() / 1000);
                notify.link = asset.id.toString();
                notify.type = 'outbid';
                notify.unread = true;
                notify.user = _bidderList[i]['public_address'];
                notify.from = publicAddress;
                notify.price = 0;

                // buyer
                let _bidderName = '';
                let _bidderInfo = await userRepository.createQueryBuilder('user')
                .where("LOWER(public_address) = LOWER(:bidder)", {bidder: publicAddress}).getOne();

                if(!_bidderInfo) {
                    _bidderName = publicAddress;
                }
                else {
                    _bidderName = _bidderInfo.username ? _bidderInfo.username : _bidderInfo.public_address;
                }

                notify.msg = `You have been outbid on ${asset.name} by ${_bidderName}`;
                await notifyRepo.save(notify);

                //_bidderList[i]
                if(_bidderList[i]['email'] && _bidderList[i]['email_notification']) {
                    _subject = `You have been outbid on ${asset.name}`;
                    _msgContent = getOutbidMailContent( _bidderList[i]['username']?_bidderList[i]['username']:_bidderList[i]['public_address'], asset.name, asset.id, _bidderName);

                    const msg = {
                        to: _bidderList[i]['email'],
                        from: SEND_GRID.EMAIL,
                        subject: _subject,
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
                    url: `${SOCKET_SERVER_URI}?userAcc=${_bidderList[i]['public_address']}`,
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
        /* end */

        if(asset.sale_type == SaleType.Auction) {
            asset.top_bid = req.body.price;
        }

        await assetRepo.save(asset);

        return res.status(200)
            .send({
                'msg': "Bid successed."
            });
    }
    catch(ex) {
        console.log(ex);
        
        return res.status(500)
                .json({
                    msg: 'Get error while place Bid'
                })
    }
}

