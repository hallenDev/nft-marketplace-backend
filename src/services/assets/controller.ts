import { NextFunction, Request, Response } from "express";
import { getRepository, Brackets, getConnection } from "typeorm";
import axios from 'axios';
import * as fs from 'fs';
import * as FormData from 'form-data';
import { bufferToHex } from 'ethereumjs-util';
import { recoverPersonalSignature } from 'eth-sig-util';

import { Asset } from "../../entity/Asset";
import { Collection } from "../../entity/Collection";
import { getTempPath, multerToFileObj, paginateExplorer, 
        isImageAsset, extendResponse, 
        convertNotifyMsg, paginateExplorerGetMany, generateUserName } from "../../utils";
import { pinata_config, AUCTION_CONFIG,REDIS_HOST } from "../../config";
import { AWSFileUploader } from "../upload/aws";
import { AssetActivity } from "../../entity/AssetActivity";
import { AssetView } from "../../entity/AssetView";
import { ActivityType, SaleType } from "../../models/enums";
import { User } from "../../entity/User";
import { getVXLUsdPrice } from "./../../utils/getVXLPrice";
import { AssetFavourite } from "../../entity/AssetFavourite";
import { Admin } from "../../entity/Admin";
import { Notify } from "../../entity/Notify";
import { Slider } from "../../entity/Slider";
import { Trait } from "../../entity/Trait";
import { Bid } from "../../entity/Bid";
import { Texture } from "../../entity/Texture";
import { getAddress } from "ethers/lib/utils";
import { morlias_config } from "../../config";
import { createClient } from 'redis';
import * as cron from 'node-cron';

const redisClient = createClient({
    url: REDIS_HOST
});

export const get_user_get_assets = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const userRepo = getRepository(User);

        let already_subquery = false;

        const userId = (req as any).user.payload.id;
        const publicAddress = (req as any).user.payload.publicAddress;

        const _user = await userRepo.findOne(userId);
        if(!_user) {
            return res.status(400)
                .json({
                    msg: 'User is not valid.'
                })
        }

        let builder = getRepository(Asset).createQueryBuilder("asset");

        builder.leftJoinAndSelect("asset.collection", "collection");

        builder.addSelect("fav_tb.fav_cnt as fav_cnt");
        builder.addSelect("asset_favourite.id as fav_id");
        let sub_query1 = getConnection()
        .createQueryBuilder()
        .select('asset.id as id')
        .addSelect('count(asset_favourite.id) as fav_cnt')
        .from(Asset, "asset")
        .leftJoin('asset.favs', 'asset_favourite')
        .groupBy('asset.id');

        builder.leftJoin('(' + sub_query1.getQuery() + ')', "fav_tb", 'asset.id = fav_tb.id');
        builder.leftJoin(AssetFavourite, "asset_favourite", `asset_favourite.assetId = asset.id and asset_favourite.userid = ${userId}`);

        builder.leftJoin(User, "user_tb", "LOWER(asset.owner_of) = LOWER(user_tb.public_address)");

        builder.addSelect('user_tb.id as user_tb_id');
        builder.addSelect('user_tb.avatar as user_tb_avatar');
        builder.addSelect('user_tb.verified as user_tb_verified');

        if(req.query.search_key) {
            builder.leftJoin(User, "user_creator", "asset.creatorId = user_creator.id")
        }

        if(req.query.order_type) {
            let order_type = req.query.order_type.toString();
            if(order_type == '1') { // recently listed
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset_activity.assetId as activity_id')
                                .addSelect('max(asset_activity.create_date) as max_date')
                                .from(AssetActivity, "asset_activity")
                                .where("asset_activity.activity = 'list'")
                                .orWhere("asset_activity.activity = 'auction'")
                                .groupBy('asset_activity.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "asset.id = tb.activity_id");
            }
            else if(order_type == '2') { // recently sold
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset_activity.assetId as activity_id')
                                .addSelect('max(asset_activity.create_date) as max_date')
                                .from(AssetActivity, "asset_activity")
                                .where("asset_activity.activity = 'sale'")
                                .groupBy('asset_activity.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "asset.id = tb.activity_id");
            }
            else if(order_type == '3') { // lowest price

                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");

                builder.addSelect("price_asset.price");

                already_subquery = true;
            }
            else if(order_type == '4') { // highest price

                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");

                builder.addSelect("price_asset.price");

                already_subquery = true;
            }
            else if(order_type == '5') { // most viewed
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset.id as id')
                                .addSelect('count(asset_view.id) as cnt')
                                .from(Asset, "asset")
                                .leftJoin('asset.views', 'asset_view')
                                .groupBy('asset.id');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", 'asset.id = tb.id');
            }
            else if(order_type == '6') { // most popular
            }
            else if(order_type == '7') { // ending soon
                builder.leftJoin(Asset, "ending_asset", "asset.id = ending_asset.id and ending_asset.on_sale = 1 and ending_asset.sale_type = '2' and ending_asset.auction_end_process = 0");
            }
        }

        const per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        const page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;
        const sort_by: string = req.query.sort_by ? req.query.sort_by.toString() : "created_at";
        const order: string = req.query.order ? req.query.order.toString() : "DESC";

        builder.where({
            synced: true
        });

        if(!_user.is_sensitive) {
            builder.andWhere({
                is_sensitive: false
            });
        }

        if (req.query.search_key) { // header search box
            builder.andWhere(new Brackets(qb => {
                qb.where('`asset`.`name` like :item_name or `collection`.`name` like :collection_name \
                or `user_creator`.`username` like :creator_name or `user_tb`.`username` like :owner_name', {
                    item_name: '%' + req.query.search_key + '%',
                    collection_name: '%' + req.query.search_key + '%',
                    creator_name: '%' + req.query.search_key + '%',
                    owner_name: '%' + req.query.search_key + '%',
                });
            }))
        }

        if (req.query.creator) { // Created Tab in public page
            builder.andWhere({
                creator: req.query.creator.toString()
            });
        }

        if (req.query.onsale) { // On Sale Tab in public page
            const owner = await userRepo.findOne({
                id: parseInt(req.query.onsale.toString())
            });

            if(owner) {
                builder.andWhere("LOWER(owner_of) = LOWER(:public_address)", {public_address: owner.public_address});
                builder.andWhere({
                    on_sale: true
                });
            }
            else {
                return res.status(500)
                    .json({
                        msg: 'Owner not valid.'
                    });
            }
        }

        if (req.query.owner) { // Collected Tab in public page
            const owner = await userRepo.findOne({
                id: parseInt(req.query.owner.toString())
            });
            if (owner) {
                builder.andWhere({
                    owner_of: owner.public_address
                });
            }
            else {
                return res.status(500)
                    .json({
                        msg: 'Owner not valid.'
                    });
            }
        }

        if (req.query.collection) {
            const collections = req.query.collection.toString().split(',');
            builder.andWhere("collectionId IN (:...collections)", { collections: collections });
        }

        if (req.query.sale_type) {
            const sale_type = parseInt(req.query.sale_type.toString());

            if (sale_type == 1) {
                builder.andWhere({
                    sale_type: 1
                });

                builder.andWhere({
                    on_sale: true
                });
            }
            else if (sale_type == 2) {
                builder.andWhere({
                    sale_type: 2
                });

                builder.andWhere({
                    on_sale: true
                });

                builder.andWhere({
                    auction_end_process: false
                });
            }
            // Check offers relation db, for now, just 3
            else if (sale_type == 3) {
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('bid.assetId as bid_id')
                                .addSelect('max(bid.create_date) as max_date')
                                .from(Bid, "bid")
                                .groupBy('bid.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tbtb", "asset.id = tbtb.bid_id");

                builder.andWhere('tbtb.max_date > 0');

                builder.andWhere({
                    auction_end_process: false
                });
            }
        }

        if (req.query.category) {
            const categoryId = parseInt(req.query.category.toString());
            builder.andWhere("collection.categoryId = " + categoryId);
        }

        let vxltoUsdPrice = getVXLUsdPrice();

        if (req.query.min_price) {
            let currency_type = req.query.currency_type ? req.query.currency_type.toString() : '1';
            let minPrice = parseFloat(req.query.min_price.toString());

            if(currency_type == '1') { // VXL
                minPrice = vxltoUsdPrice == 0 ? 0 : (minPrice * vxltoUsdPrice);
            }

            if (minPrice > 0) {
                if(!already_subquery) {
                    let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                    builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");
                    builder.addSelect("price_asset.price");

                    already_subquery = true;
                }
                builder.andWhere("price_asset.price >=" + minPrice);
            }
        }
        if (req.query.max_price) {
            let currency_type = req.query.currency_type ? req.query.currency_type.toString() : '1';
            let maxPrice = parseFloat(req.query.max_price.toString());

            if(currency_type == '1') { // VXL
                maxPrice = vxltoUsdPrice == 0 ? 0 : (maxPrice * vxltoUsdPrice);
            }

            if (maxPrice > 0) {

                if(!already_subquery) {
                    let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                    builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");
                    builder.addSelect("price_asset.price");

                    already_subquery = true;
                }

                builder.andWhere(`(price_asset.price <= ${maxPrice} OR price_asset.price IS NULL)`);
            }
        }

        if (req.query.liked) { // Liked Tab in public page
            const like_userId = parseInt(req.query.liked.toString());
            builder.leftJoin("asset.favs", "favs");
            builder.andWhere('`favs`.`userId` = ' + like_userId)
        }

        if(req.query.order_type) {
            let order_type = req.query.order_type.toString();
            if(order_type == '1') { // recently listed
                builder.addSelect("tb.max_date");
                builder.orderBy("tb.max_date", "DESC");
            }
            else if(order_type == '2') { // recently sold
                builder.addSelect("tb.max_date");
                builder.orderBy("tb.max_date", "DESC");
            }
            else if(order_type == '3') { // lowest price
                 builder.addSelect("price_asset.price");
                 builder.orderBy("asset.on_sale", "DESC");
                 builder.addOrderBy("price_asset.price", "ASC");
             }
             else if(order_type == '4') { // highest price
                 builder.addSelect("price_asset.price");
                 builder.orderBy("asset.on_sale", "DESC");
                 builder.addOrderBy("price_asset.price", "DESC");
            }
            else if(order_type == '5') { // most viewed
                builder.addSelect("tb.cnt as cnt");
                builder.orderBy("tb.cnt", "DESC");
            }
            else if(order_type == '6') { // most popular
                builder.orderBy("fav_tb.fav_cnt", "DESC");
            }
            else if(order_type == '7') {
                builder.addSelect("ending_asset.auction_end_date");
                builder.orderBy("asset.on_sale", "DESC");
                builder.addOrderBy("asset.sale_type", "DESC");
                builder.addOrderBy("asset.auction_end_process", "ASC");
                builder.addOrderBy("ending_asset.auction_end_date", "ASC");
            }
        }

        // default orderby
        if (sort_by
            && (order === 'ASC' || order === 'DESC')) {
            const sort_field = 'asset.' + sort_by;

            if (sort_by === 'created_at'
                || sort_by === 'updated_at') {
              builder.addSelect(sort_field);
            }

            if(req.query.order_type) {
                builder.addOrderBy(sort_field, order);
            }
            else {
                builder.orderBy(sort_field, order);
            }
        }

        let data = await paginateExplorer(builder, page, per_page);
                return res.status(200)
                    .json(extendResponse(data)); 
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                msg: 'Get error while list assets.'
            });
    }
}

/*
order_type
1: recently listed
2: recently sold
3: lowest price
4: highest price
5: most viewed
*/
export const get_assets = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userRepo = getRepository(User);

        let already_subquery = false;

        let builder = getRepository(Asset).createQueryBuilder("asset");

        builder.leftJoinAndSelect("asset.collection", "collection");

        builder.addSelect("fav_tb.fav_cnt as fav_cnt");
        let sub_query1 = getConnection()
                .createQueryBuilder()
                .select('asset.id as id')
                .addSelect('count(asset_favourite.id) as fav_cnt')
                .from(Asset, "asset")
                .leftJoin('asset.favs', 'asset_favourite')
                .groupBy('asset.id');

        builder.leftJoin('(' + sub_query1.getQuery() + ')', "fav_tb", 'asset.id = fav_tb.id');
        builder.leftJoin(User, "user_tb", "LOWER(asset.owner_of) = LOWER(user_tb.public_address)");

        builder.addSelect('user_tb.id as user_tb_id');
        builder.addSelect('user_tb.avatar as user_tb_avatar');
        builder.addSelect('user_tb.verified as user_tb_verified');

        if(req.query.search_key) {
            builder.leftJoin(User, "user_creator", "asset.creatorId = user_creator.id")
        }

        if(req.query.order_type) {
            let order_type = req.query.order_type.toString();
            if(order_type == '1') { // recently listed
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset_activity.assetId as activity_id')
                                .addSelect('max(asset_activity.create_date) as max_date')
                                .from(AssetActivity, "asset_activity")
                                .where("asset_activity.activity = 'list'")
                                .orWhere("asset_activity.activity = 'auction'")
                                .groupBy('asset_activity.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "asset.id = tb.activity_id");
            }
            else if(order_type == '2') { // recently sold
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset_activity.assetId as activity_id')
                                .addSelect('max(asset_activity.create_date) as max_date')
                                .from(AssetActivity, "asset_activity")
                                .where("asset_activity.activity = 'sale'")
                                .groupBy('asset_activity.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", "asset.id = tb.activity_id");                
            }
            else if(order_type == '3') { // lowest price

                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");

                builder.addSelect("price_asset.price");

                already_subquery = true;
            }
            else if(order_type == '4') { // highest price

                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");

                builder.addSelect("price_asset.price");

                already_subquery = true;
            }
            else if(order_type == '5') { // most viewed
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('asset.id as id')
                                .addSelect('count(asset_view.id) as cnt')
                                .from(Asset, "asset")
                                .leftJoin('asset.views', 'asset_view')
                                .groupBy('asset.id');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tb", 'asset.id = tb.id');
            }
            else if(order_type == '6') { // most popular
            }
            else if(order_type == '7') { // ending soon
                builder.leftJoin(Asset, "ending_asset", "asset.id = ending_asset.id and ending_asset.on_sale = 1 and ending_asset.sale_type = '2' and ending_asset.auction_end_process = 0");
            }
        }

        const per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        const page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;
        
        const sort_by: string = req.query.sort_by ? req.query.sort_by.toString() : "created_at";
        const order: string = req.query.order ? req.query.order.toString() : "DESC";

        builder.where({
            synced: true
        });

        builder.andWhere({
            is_sensitive: false
        });

        if (req.query.search_key) { // header search box
            builder.andWhere(new Brackets(qb => {
                qb.where('`asset`.`name` like :item_name or `collection`.`name` like :collection_name \
                or `user_creator`.`username` like :creator_name or `user_tb`.`username` like :owner_name', {
                    item_name: '%' + req.query.search_key.toString() + '%',
                    collection_name: '%' + req.query.search_key.toString() + '%',
                    creator_name: '%' + req.query.search_key.toString() + '%',
                    owner_name: '%' + req.query.search_key.toString() + '%',
                });
            }))
        }

        if (req.query.creator) { // Created Tab in public page
            builder.andWhere({
                creator: req.query.creator.toString()
            });
        }

        if (req.query.onsale) { // On Sale Tab in public page
            const owner = await userRepo.findOne({
                id: parseInt(req.query.onsale.toString())
            });

            if(owner) {
                builder.andWhere("LOWER(owner_of) = LOWER(:public_address)", {public_address: owner.public_address});
                builder.andWhere({
                    on_sale: true
                });
            }
            else {
                return res.status(500)
                    .json({
                        msg: 'Owner not valid.'
                    });
            }
        }

        if (req.query.owner) { // Collected Tab in public page
            const owner = await userRepo.findOne({
                id: parseInt(req.query.owner.toString())
            });
            if (owner) {
                builder.andWhere({
                    owner_of: owner.public_address
                });
            }
            else {
                return res.status(500)
                    .json({
                        msg: 'Owner not valid.'
                    });
            }
        }

        if (req.query.collection) {
            const collections = req.query.collection.toString().split(',');
            builder.andWhere("collectionId IN (:...collections)", { collections: collections });
        }

        if (req.query.sale_type) {
            const sale_type = parseInt(req.query.sale_type.toString());

            if (sale_type == 1) { // BuyNow
                builder.andWhere({
                    sale_type: 1
                });
                builder.andWhere({
                    on_sale: true
                });
            }
            else if (sale_type == 2) { // Auction
                builder.andWhere({
                    sale_type: 2
                });

                builder.andWhere({
                    on_sale: true
                });

                builder.andWhere({
                    auction_end_process: false
                });
            }
            // Check offers relation db, for now, just 3
            else if (sale_type == 3) {
                let sub_query = getConnection()
                                .createQueryBuilder()
                                .select('bid.assetId as bid_id')
                                .addSelect('max(bid.create_date) as max_date')
                                .from(Bid, "bid")
                                .groupBy('bid.assetId');

                builder.leftJoin('(' + sub_query.getQuery() + ')', "tbtb", "asset.id = tbtb.bid_id");

                builder.andWhere('tbtb.max_date > 0');

                builder.andWhere({
                    auction_end_process: false
                });
            }
        }

        if (req.query.category) {
            const categoryId = parseInt(req.query.category.toString());
            builder.andWhere("collection.categoryId = " + categoryId);
        }

        let vxltoUsdPrice = getVXLUsdPrice();

        if (req.query.min_price) {
            let currency_type = req.query.currency_type ? req.query.currency_type.toString() : '1';
            let minPrice = parseFloat(req.query.min_price.toString());

            if(currency_type == '1') { // VXL
                minPrice = vxltoUsdPrice == 0 ? 0 : (minPrice * vxltoUsdPrice);
            }

            if (minPrice > 0) {
                if(!already_subquery) {
                    let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                    builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");
                    builder.addSelect("price_asset.price");

                    already_subquery = true;
                }
                builder.andWhere("price_asset.price >=" + minPrice);
            }
        }
        if (req.query.max_price) {
            let currency_type = req.query.currency_type ? req.query.currency_type.toString() : '1';
            let maxPrice = parseFloat(req.query.max_price.toString());

            if(currency_type == '1') { // VXL
                maxPrice = vxltoUsdPrice == 0 ? 0 : (maxPrice * vxltoUsdPrice);
            }

            if (maxPrice > 0) {

                if(!already_subquery) {
                    let sub_query = getConnection()
                                .createQueryBuilder()
                                .select("asset.id as id")
                                .addSelect("IF(asset.price < asset.top_bid, asset.top_bid, asset.price) as price")
                                .from(Asset, "asset")
                                .where("asset.on_sale = 1")
                                .andWhere(new Brackets(qb => {
                                    qb.where("asset.sale_type = '1' or asset.sale_type = '2'")
                                }));

                    builder.leftJoin('(' + sub_query.getQuery() + ')', "price_asset", "asset.id = price_asset.id");
                    builder.addSelect("price_asset.price");

                    already_subquery = true;
                }

                builder.andWhere(`(price_asset.price <= ${maxPrice} OR price_asset.price IS NULL)`);
            }
        }

        if (req.query.liked) { // Liked Tab in public page
            const like_userId = parseInt(req.query.liked.toString());
            builder.leftJoin("asset.favs", "favs");
            builder.andWhere('`favs`.`userId` = ' + like_userId)
        }


        if(req.query.order_type) {
            let order_type = req.query.order_type.toString();
            if(order_type == '1') { // recently listed
                builder.addSelect("tb.max_date");
                builder.orderBy("tb.max_date", "DESC");
            }
            else if(order_type == '2') { // recently sold
                builder.addSelect("tb.max_date");
                builder.orderBy("tb.max_date", "DESC");
            }
            else if(order_type == '3') { // lowest price
                builder.orderBy("asset.on_sale", "DESC");
                builder.addOrderBy("price_asset.price", "ASC");
            }
            else if(order_type == '4') { // highest price
                builder.orderBy("asset.on_sale", "DESC");
                builder.addOrderBy("price_asset.price", "DESC");
            }
            else if(order_type == '5') { // most viewed
                builder.addSelect("tb.cnt as cnt");
                builder.orderBy("tb.cnt", "DESC");
            }
            else if(order_type == '6') { // most popular
                builder.orderBy("fav_tb.fav_cnt", "DESC");
            }
            else if(order_type == '7') {
                builder.addSelect("ending_asset.auction_end_date");
                builder.orderBy("asset.on_sale", "DESC");
                builder.addOrderBy("asset.sale_type", "DESC");
                builder.addOrderBy("asset.auction_end_process", "ASC");
                builder.addOrderBy("ending_asset.auction_end_date", "ASC");
            }
        }

        // default orderby
        if (sort_by
            && (order === 'ASC' || order === 'DESC')) {
            const sort_field = 'asset.' + sort_by;

            if (sort_by === 'created_at'
                || sort_by === 'updated_at') {
              builder.addSelect(sort_field);
            }

            if(req.query.order_type) {
                builder.addOrderBy(sort_field, order);
            }
            else {
                builder.orderBy(sort_field, order);
            }
        }   

        let data = await paginateExplorer(builder, page, per_page);
        return res.status(200)
                .json(extendResponse(data));   
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                msg: 'Get error whilte list assets.'
            });
    }

}

export const getMoreItemsInCollection = async function (req: Request, res: Response, next: NextFunction) {
    try {
        if(!req.body.collection_id) {
            return res.status(400)
                .json({
                    msg: 'Collection id is invalid'
                })
        }

        const collectionId = req.body.collection_id;

        let data = await getRepository(Asset).createQueryBuilder('asset')
        .addSelect('user.id as user_id')
        .addSelect('user.avatar as user_avatar')
        .addSelect('user.verified as user_verified')
        .leftJoinAndSelect("asset.collection", "collection")
        .leftJoin(User, "user", "LOWER(asset.owner_of) = LOWER(user.public_address)")
        .where("asset.collectionId = :collectionId", {collectionId})
        .orderBy('RAND()')
        .offset(0)
        .limit(5)
        .getRawMany();

        let ret_data = [];

        for(let i = 0; i < data.length; i ++) {
            let _item: {[k: string]: any} = {};

            let _favs = await getRepository(AssetFavourite).createQueryBuilder('asset_favourite')
                                .addSelect("user.id")
                                .addSelect('user.public_address')
                                .addSelect('user.username')
                                .leftJoin('asset_favourite.user', 'user')
                                .where('asset_favourite.assetId=:assetId', {assetId: data[i].asset_id})
                                .getMany();

            _item = {
                asset: {
                    id: data[i].asset_id,
                    name: data[i].asset_name,
                    description: data[i].asset_description,
                    price: data[i].asset_price,
                    onSale: data[i].asset_on_sale,
                    saleType: data[i].asset_sale_type,
                    image: data[i].asset_image,
                    image_preview: data[i].asset_image_preview,
                    saleEndDate: data[i].asset_sale_end_date,
                    auctionStartDate: data[i].asset_auction_start_date,
                    auctionEndDate: data[i].asset_auction_end_date,
                    ownerOf: data[i].asset_owner_of,

                    asset_type: data[i].asset_asset_type,
                    auction_end_process: data[i].asset_auction_end_process,
                    bid_method: data[i].asset_bid_method,
                    status: data[i].asset_status,
                    top_bid: data[i].asset_top_bid,
                    token_id: data[i].asset_token_id,
                    token_uri: data[i].asset_token_uri,
                    is_sensitive: data[i].asset_is_sensitive,
                    has_unlockable_content: data[i].asset_has_unlockable_content,
                    unlockable_content: data[i].asset_unlockable_content,

                    owner_id: data[i].user_id,
                    owner_avatar: data[i].user_avatar,
                    owner_verified: data[i].user_verified
                },
                collection: {
                    id: data[i].collection_id,
                    name: data[i].collection_name,
                    symbol: data[i].collection_symbol,
                    avatar: data[i].collection_avatar,
                    verified: data[i].collection_verified
                },
                favs: _favs
            };

            ret_data.push(_item);
        }
        
        return res.json({
            data: ret_data
        });
    }
    catch (err) {
        console.log("getMoreItemsInCollection Err: ", err);
        return res.status(500)
            .json({
                msg: 'Get error whilte get more items.'
            });
    }
}

export const getTrendingItems = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let data = await getRepository(Asset).createQueryBuilder('asset')
        .addSelect('owner.id as owner_id')
        .addSelect('owner.username as owner_username')
        .addSelect('owner.avatar as owner_avatar')
        .addSelect('owner.verified as owner_verified')
        .leftJoin(User, "owner", "LOWER(asset.owner_of) = LOWER(owner.public_address)")
        .where("is_trend = :is_trend", {is_trend: true})
        .getRawMany();    

        let ret_data = [];

        for(let i = 0; i < data.length; i ++) {
            let _item: {[k: string]: any} = {};
            _item = {
                assetId: data[i].asset_id,
                image: data[i].asset_image,
                name: data[i].asset_name,
                description: data[i].asset_description,
                price: data[i].asset_price,
                currency: data[i].asset_currency,
                onSale: data[i].asset_on_sale,
                saleType: data[i].asset_sale_type,
                saleEndDate: data[i].asset_sale_end_date,
                auctionStartDate: data[i].asset_auction_start_date,
                auctionEndDate: data[i].asset_auction_end_date,
                owner: {
                    id: data[i].owner_id,
                    username: data[i].owner_username,
                    avatar: data[i].owner_avatar,
                    verified: data[i].owner_verified,
                    public_address: data[i].asset_owner_of
                }
            }
            ret_data.push(_item);
        }

        return res.json(extendResponse({
            data: ret_data
        }));
    }
    catch (err) {
        console.log("getTrendingItems Err: ", err);
        return res.status(500)
            .json({
                msg: 'Get error whilte get trending items.'
            });
    }
}

export const getNewItems = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let data = await getRepository(Asset).createQueryBuilder('asset')
        .addSelect('user.id as user_id')
        .addSelect('user.avatar as user_avatar')
        .addSelect('user.verified as user_verified')
        .leftJoinAndSelect('asset.collection', 'collection')
        .leftJoin(User, "user", "LOWER(asset.owner_of) = LOWER(user.public_address)")
        .orderBy('asset.id', 'DESC')
        .offset(0)
        .limit(6)
        .getRawMany();

        let ret_data = [];

        for(let i = 0; i < data.length; i ++) {
            let _item: {[k: string]: any} = {};

            let _favs = await getRepository(AssetFavourite).createQueryBuilder('asset_favourite')
                                .addSelect("user.id")
                                .addSelect('user.public_address')
                                .addSelect('user.username')
                                .leftJoin('asset_favourite.user', 'user')
                                .where('asset_favourite.assetId=:assetId', {assetId: data[i].asset_id})
                                .getMany()

            _item = {
                assetId: data[i].asset_id,
                image_preview: data[i].asset_image_preview,
                image: data[i].asset_image,
                name: data[i].asset_name,
                description: data[i].asset_description,
                price: data[i].asset_price,
                currency: data[i].asset_currency,
                onSale: data[i].asset_on_sale,
                saleType: data[i].asset_sale_type,
                collectionName: data[i].collection_name,
                collectionAvatar: data[i].collection_avatar,
                collectionId: data[i].collection_id,
                owner_of: data[i].asset_owner_of,
                favs: _favs,

                token_id: data[i].asset_token_id,
                token_uri: data[i].asset_token_uri,
                asset_type: data[i].asset_asset_type,
                top_bid: data[i].asset_top_bid,
                is_trend: data[i].asset_is_trend,
                bid_method: data[i].asset_bid_method,
                sale_end_date: data[i].asset_sale_end_date,
                auction_start_date: data[i].asset_auction_start_date,
                auction_end_date: data[i].asset_auction_end_date,
                auction_end_process: data[i].asset_auction_end_process,
                status: data[i].asset_status,
                is_sensitive: data[i].asset_is_sensitive,
                has_unlockable_content: data[i].asset_has_unlockable_content,
                unlockable_content: data[i].asset_unlockable_content,
                owner_id: data[i].user_id,
                owner_avatar: data[i].user_avatar,
                owner_verified: data[i].user_verified
            }
                
            ret_data.push(_item);            
        }

        return res.json(
            extendResponse(
            {
            data: ret_data
            })
        );
    }
    catch (err) {
        console.log("getNewItems Err: ", err);
        return res.status(500)
            .json({
                msg: 'Get error whilte get new items.'
            });
    }
}

export const getUserAsset = async function (req: Request, res: Response, next: NextFunction) {
    try {

        const userId = (req as any).user.payload.id;
        const publicAddress = (req as any).user.payload.publicAddress;

        const assetRepository = getRepository(Asset);
        const userRepo = getRepository(User);
        const viewRepo = getRepository(AssetView);

        const _user = await userRepo.findOne(userId);
        if(!_user) {
            return res.status(400)
                .json({
                    msg: 'User is not valid.'
                })
        }

        const assetId = req.params.id.toString();

        if (!assetId) {
            return res.status(400)
                .json({
                    msg: 'You need to include asset id.'
                });
        }

        let view = await viewRepo.createQueryBuilder('asset_view')
        .where("userId = :userId and assetId = :assetId", {userId: userId, assetId: assetId})
        .getOne();

        const _asset = await assetRepository.findOne(assetId);
            
        if (!_asset) {
                return res.status(400)
                    .json({
                        msg: 'Asset is not valid.'
                    })
        }

        if(!_user.is_sensitive && _asset.is_sensitive) {
            return res.status(400)
                    .json({
                        msg: 'Asset is not valid.'
                    })
        }

        if(!view) {
            view = await viewRepo.save({
                asset: _asset,
                user: _user
            });
        }

        const asset = await assetRepository
        .findOne({
            where: {
                id: assetId,
                synced: true
            }, relations: ['creator', 'owner', 'traits', 'textures', 'favs', 'favs.user', 'collection', 'collection.category', 'views']
        })

        if (asset) {
            asset['usdPrice'] = await getVXLUsdPrice();

            let cur_time = Math.floor(Date.now() / 1000);

            if(asset.sale_type == SaleType.Fixed) {
                if(cur_time <= asset.sale_end_date) {
                    asset['sale_status'] = true;
                }
            }

            if(asset.sale_type == SaleType.Auction) {

                asset['auction_pay_end_date'] = asset.auction_end_date + AUCTION_CONFIG.SEVEN;
                asset['auction_buyer_pay_start_date'] = asset.auction_end_date + AUCTION_CONFIG.FIVE;

                if(cur_time >= asset.auction_start_date
                && cur_time <= asset.auction_end_date) {
                    asset['auction_status'] = true; // item is on auction status
                }

                if(cur_time > asset.auction_end_date
                    && cur_time <= asset.auction_end_date + AUCTION_CONFIG.SEVEN) {
                    asset['auction_pay'] = true;
                }

                if(cur_time > asset.auction_end_date + AUCTION_CONFIG.FIVE
                    && cur_time <= asset.auction_end_date + AUCTION_CONFIG.SEVEN) {
                    asset['auction_buyer_pay'] = true;
                }
            }

            if(_user.public_address.toLowerCase() != asset.owner_of.toLowerCase()) {
                delete asset['unlockable_content'];
            }

            return res.json({
                asset: asset
            });
        }
        else {
            return res.status(400)
                .json({
                    msg: 'Asset not exists.'
                });
        }
    }
    catch(err) {
        return res.status(500)
            .json({
                msg: 'Get error whilte get asset.'
            });
    }
}

export const get_asset = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const assetRepository = getRepository(Asset);

        const assetId = req.params.id.toString();
        if (!assetId) {
            return res.status(400)
                .json({
                    msg: 'You need to include asset id.'
                });
        }

        /*
        set read to notification
        */


        const asset = await assetRepository
        .findOne({
            where: {
                id: assetId,
                synced: true
            }, relations: ['creator', 'owner', 'traits', 'textures', 'favs', 'favs.user', 'collection', 'collection.category', 'views']
        })

        if (asset) {
            asset['usdPrice'] = await getVXLUsdPrice();


            let cur_time = Math.floor(Date.now() / 1000);

            if(asset.sale_type == SaleType.Fixed) {
                if(cur_time <= asset.sale_end_date) {
                    asset['sale_status'] = true;
                }
            }

            if(asset.sale_type == SaleType.Auction) {

                asset['auction_pay_end_date'] = asset.auction_end_date + AUCTION_CONFIG.SEVEN;
                asset['auction_buyer_pay_start_date'] = asset.auction_end_date + AUCTION_CONFIG.FIVE;

                if(cur_time >= asset.auction_start_date
                && cur_time <= asset.auction_end_date) {
                    asset['auction_status'] = true; // item is on auction status
                }

                if(cur_time > asset.auction_end_date
                    && cur_time <= asset.auction_end_date + AUCTION_CONFIG.SEVEN) {
                    asset['auction_pay'] = true;
                }

                if(cur_time > asset.auction_end_date + AUCTION_CONFIG.FIVE
                    && cur_time <= asset.auction_end_date + AUCTION_CONFIG.SEVEN) {
                    asset['auction_buyer_pay'] = true;
                }
            }

            delete asset['has_unlockable_content'];
            delete asset['unlockable_content'];


            /*
            get warning count    -> owner,  
            */
            

            return res.json({
                asset: asset
            });
        }
        else {
            return res.status(400)
                .json({
                    msg: 'Asset not exists.'
                });
        }

    }
    catch(err) {

        console.log("error======>", err);

        return res.status(500)
            .json({
                msg: 'Get error whilte get asset.'
            });
    }

}

/*
properties: [
    {

    }
]
*/

export const uploadAsset = async function (req: Request, res: Response, next: NextFunction) {
    try {       
        let _urls = [];

        if(req.files) {
            if (req.files['asset']) {

                const awsUploader = new AWSFileUploader();
                const timestamp = Date.now();
                
                for(let i = 0; i < req.files['asset'].length; i ++) {

                    // console.log("console log=====>", req.files['asset'][i]);
                    // continue;

                    let assetFile: Express.Multer.File;
                    assetFile = req.files['asset'][i];
                    let uploadFile = multerToFileObj(assetFile);        
                    
                    // uploadFile.name = `temp_change/asset_${i + 1}`;
                    uploadFile.name = `temp_change/${timestamp}/${req.files['asset'][i]['originalname']}`;
                    
                    const result = await awsUploader.upload_temp(uploadFile);

                    _urls.push(result['path']);
                }
            }
        }

        return res.json({
            upload_url: _urls
        });
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                'msg': 'Get error while upload asset.'
            });
    }
}

export const save_asset = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;
        const publicAddress = (req as any).user.payload.publicAddress;

        const assetRepository = getRepository(Asset);
        const colRepository = getRepository(Collection);
        const activityRepo = getRepository(AssetActivity);

        let title = req.body.title;
        let description = req.body.description;
        let raw_image = req.body.raw_image;

        let raw_animation = req.body.raw_animation;

        let price = req.body.price;
        let type = req.body.type;
        let assetId = req.body.item_id;
        let isSensitive = req.body.is_sensitive=="true" ? true : false;
        
        let has_unlockable_content = req.body.has_unlockable_content == "true" ? true : false;
        let unlockable_content = req.body.unlockable_content;

        if (!type
            || (type != 'create'
                && type != 'update')) {
            return res.status(500)
                .json({ 
                    'msg': 'You need to identify post action.'
                });
        }

        if (type == 'update'
            && !assetId) {
            return res.status(500)
                .json({
                    'msg': 'You need to post item id.'
                });
        }

        if(has_unlockable_content && !unlockable_content) {
            return res.status(500)
                .json({
                    'msg': 'You need to post unlockable content if unlockable content flag is true.'
                });
        }

        if(req.body.asset_type) {
            if(req.files)  {
                if(req.files['isTextureForm']) {
                    let _textures = req.body.raw_animation_texture;
                    let _addingUrls = req.body.isTextureFormAddingUrl;
                    //isTextureFormAddingUrl
                    if(!Array.isArray(_textures)) {
                        return res.status(500)
                            .json({
                                'msg': 'Texture file error.'
                            });
                    }
                    else if(!Array.isArray(_addingUrls)) {
                        return res.status(500)
                            .json({
                                'msg': 'Texture file error.'
                            });
                    }
                    else {
                        if(_textures.length != req.files['isTextureForm'].length) {
                            return res.status(500)
                                .json({
                                    'msg': 'Texture file error.'
                                });
                        }
                    }
                }
            }
        }

        // get user information
        const userRepo = getRepository(User);
        let user = await userRepo.findOne(userId);

        if(!user) {
            return res.status(400)
                .send({
                    'msg': 'Your account not exists.'
                });
        }

        let assetFile: Express.Multer.File;
        let previewFile: Express.Multer.File;
        let assetPreviewFile: Express.Multer.File;

        if(req.files) {
            if (req.files['asset']) {
                assetFile = req.files['asset'][0];
            }
            
            if (req.files['preview']) {
                previewFile = req.files['preview'][0];
            }

            if (req.files['asset_preview']) {
                assetPreviewFile = req.files['asset_preview'][0];
            }
        }

        if(type == 'create') {
            if (!title) {
                return res.status(400)
                    .json({
                        'msg': 'You must input title for create item.'
                    });
            }

            if (!assetFile
                || !raw_image) {
                return res.status(400)
                    .json({
                        'msg': "You need to include image for create item."
                    });
            }
        }

        let collection: Collection;
        if (!req.body.collection) {
            collection = await colRepository.findOne({
                creator: userId,
                is_voxel: true
            });

            if (!collection) {
                let lastCollection = await colRepository.findOne({
                    where: {
                        is_voxel: true
                    },
                    order: {
                        id: "DESC"
                    }
                });
                
                let lastColId = 0;
                if (!lastCollection) {
                    lastColId = lastCollection.id;
                }
                
                collection = new Collection();
                collection.is_721 = true;

                // collection.name = "Untitled Collection #" + (lastColId + 1);
               /* if(user.username) {

                }
                else {
                    await userRepo.save(user);
                } */
                
                if(!user.username) {
                    user.username = generateUserName();
                    await userRepo.save(user);
                }
                
                collection.name = user.username + " Collection";
                
                collection.creator = userId;
                collection.is_voxel = true;
                collection.synced = true;
                await colRepository.save(collection);
            }   
        }
        else {
            collection = await colRepository.findOne({
                creator: userId,
                is_voxel: true,
                id: req.body.collection.toString()
            });

            if (!collection) {
                return res.status(400)
                    .json({
                        'msg': "You can't use this collection."
                    });
            }
        }

        let asset: Asset;

        if(type == 'create') {

            let assets_num = user.token_count;

            let token_id = publicAddress + Number(assets_num + 1).toString(16).padStart(8, '0');
            
            asset = new Asset();
            asset.name = title;
            asset.description = description;
            asset.raw_image = raw_image;
            asset.creator = userId;
            asset.owner_of = publicAddress;
            asset.token_uri = "";
            asset.token_id = token_id;
            asset.collection = collection;
            asset.synced = true;
            asset.status = "pending";
            asset.is_voxel = true;   

            asset.is_sensitive = isSensitive;

            asset.has_unlockable_content = has_unlockable_content;
            if(has_unlockable_content)
                asset.unlockable_content = unlockable_content;
            else
                asset.unlockable_content = '';

            if (price) {
                asset.price = price;
            }

            if (raw_animation) {
                asset.raw_animation = raw_animation;
            }

            asset.activities = [];
            asset.activities.push(activityRepo.create({
                to: asset.owner_of,
                activity: ActivityType.Mint,
                quantity: 1,
                create_date: Math.floor(Date.now() / 1000)
            }));

            /*
            req.body.properties
            req.body.levels
            req.body.stats
            */
            let traits = new Array<Trait>();

            if(Array.isArray(req.body.properties_trait_type) && req.body.properties_trait_type.length > 0
            && Array.isArray(req.body.properties_value) && req.body.properties_value.length > 0
            && req.body.properties_trait_type.length == req.body.properties_value.length) {

                for(let i = 0; i < req.body.properties_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.properties_trait_type[i];
                    trait.value = req.body.properties_value[i];
                    traits.push(trait);
                }

            }

            if(Array.isArray(req.body.levels_trait_type) && req.body.levels_trait_type.length > 0
            && Array.isArray(req.body.levels_value) && req.body.levels_value.length > 0
            && Array.isArray(req.body.levels_max_value) && req.body.levels_max_value.length > 0
            && req.body.levels_trait_type.length == req.body.levels_value.length
            && req.body.levels_value.length == req.body.levels_max_value.length) {

                for(let i = 0; i < req.body.levels_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.levels_trait_type[i];
                    trait.value = req.body.levels_value[i];
                    trait.display_type = 'progress';
                    trait.max_value = req.body.levels_max_value[i];
                    traits.push(trait);
                }

            }

            if(Array.isArray(req.body.stats_trait_type) && req.body.stats_trait_type.length > 0
            && Array.isArray(req.body.stats_value) && req.body.stats_value.length > 0
            && Array.isArray(req.body.stats_max_value) && req.body.stats_max_value.length > 0
            && req.body.stats_trait_type.length == req.body.stats_value.length
            && req.body.stats_value.length == req.body.stats_max_value.length) {

                for(let i = 0; i < req.body.stats_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.stats_trait_type[i];
                    trait.value = req.body.stats_value[i];
                    trait.display_type = 'number';
                    trait.max_value = req.body.stats_max_value[i];
                    traits.push(trait);
                }

            }

            asset.traits = traits;

            await assetRepository.save(asset);

            user.token_count = assets_num + 1;
            await userRepo.save(user);
        }
        else if(type == 'update') {

            asset = await assetRepository.findOne(assetId, {
                relations: ['collection']
            });

            if (!asset) {
                return res.status(404)
                    .json({
                        'msg': 'Your asset not exists.'
                    });
            }

            const traitRepo = getRepository(Trait);
            // delete traits 
            await traitRepo.createQueryBuilder("trait")
            .where("assetId = :assetId", {assetId: asset.id})
            .delete()
            .execute();

            asset.name = title;
            asset.description = description;
            asset.collection = collection;
            asset.raw_image = raw_image;
            asset.is_sensitive = isSensitive;

            asset.has_unlockable_content = has_unlockable_content;
            if(has_unlockable_content)
                asset.unlockable_content = unlockable_content;
            else
                asset.unlockable_content = '';
            
            if (price) {
                asset.price = price;
            }

            if (raw_animation) {
                asset.raw_animation = raw_animation;
            }

            let traits = new Array<Trait>();

            if(Array.isArray(req.body.properties_trait_type) && req.body.properties_trait_type.length > 0
            && Array.isArray(req.body.properties_value) && req.body.properties_value.length > 0
            && req.body.properties_trait_type.length == req.body.properties_value.length) {

                for(let i = 0; i < req.body.properties_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.properties_trait_type[i];
                    trait.value = req.body.properties_value[i];
                    traits.push(trait);
                }

            }

            if(Array.isArray(req.body.levels_trait_type) && req.body.levels_trait_type.length > 0
            && Array.isArray(req.body.levels_value) && req.body.levels_value.length > 0
            && Array.isArray(req.body.levels_max_value) && req.body.levels_max_value.length > 0
            && req.body.levels_trait_type.length == req.body.levels_value.length
            && req.body.levels_value.length == req.body.levels_max_value.length) {

                for(let i = 0; i < req.body.levels_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.levels_trait_type[i];
                    trait.value = req.body.levels_value[i];
                    trait.display_type = 'progress';
                    trait.max_value = req.body.levels_max_value[i];
                    traits.push(trait);
                }

            }

            if(Array.isArray(req.body.stats_trait_type) && req.body.stats_trait_type.length > 0
            && Array.isArray(req.body.stats_value) && req.body.stats_value.length > 0
            && Array.isArray(req.body.stats_max_value) && req.body.stats_max_value.length > 0
            && req.body.stats_trait_type.length == req.body.stats_value.length
            && req.body.stats_value.length == req.body.stats_max_value.length) {

                for(let i = 0; i < req.body.stats_trait_type.length; i ++) {
                    let trait = new Trait();
                    trait.trait_type = req.body.stats_trait_type[i];
                    trait.value = req.body.stats_value[i];
                    trait.display_type = 'number';
                    trait.max_value = req.body.stats_max_value[i];
                    traits.push(trait);
                }

            }

            asset.traits = traits;
            

            await assetRepository.save(asset);
        }

        if( assetFile || previewFile || assetPreviewFile ) {
            const awsUploader = new AWSFileUploader();

            if(assetPreviewFile) {
                let uploadFile = multerToFileObj(assetPreviewFile);
                uploadFile.name = `assets/${collection.id}/${asset.token_id}/asset_preview`;
                
                if(asset.image_preview)
                    await awsUploader.deleteFile(asset.image_preview, 4);

                const result = await awsUploader.upload(uploadFile);
                if(result['path']) {
                    asset.image_preview = result['path'];
                }
            }

            if(assetFile) {
                asset.asset_type = assetFile.mimetype;
                let uploadFile = multerToFileObj(assetFile);
                uploadFile.name = `assets/${collection.id}/${asset.token_id}/asset`;

                if(isImageAsset(assetFile.mimetype)) {
                    if(asset.image) 
                        await awsUploader.deleteFile(asset.image, 4);    
                    const result = await awsUploader.upload(uploadFile);
                    if(result['path']) {
                        asset.image = result['path'];
                    }
                }
                else {
                    if(asset.animation)
                        await awsUploader.deleteFile(asset.animation, 4);
                    const result = await awsUploader.upload(uploadFile);
                    if(result['path']) {
                        asset.animation = result['path'];
                    }
                }
            }

            if(previewFile) {
                let uploadFile = multerToFileObj(previewFile);
                uploadFile.name = `assets/${collection.id}/${asset.token_id}/preview`;

                if(asset.image) 
                    await awsUploader.deleteFile(asset.image, 4);

                const result = await awsUploader.upload(uploadFile);
                if(result['path']) {
                    asset.image = result['path'];
                }
            }

            await assetRepository.save(asset);
        }

        if(req.body.asset_type) {

            if(req.body.raw_animation_type) {
                asset.raw_animation_type = req.body.raw_animation_type;
            }

            if(req.body.raw_animation_mtl) {
                asset.raw_animation_mtl = req.body.raw_animation_mtl;
            }

            asset.asset_type = req.body.asset_type;

            if(req.files) {
                const awsUploader = new AWSFileUploader();
                if(req.files['isMTLForm']) {
                    let assetFile: Express.Multer.File;
                    assetFile = req.files['isMTLForm'][0];
                    let uploadFile = multerToFileObj(assetFile);
                    // uploadFile.name = `assets/${collection.id}/${asset.token_id}/mtl`;
                    uploadFile.name = `assets/${collection.id}/${asset.token_id}/${req.files['isMTLForm'][0]['originalname']}`;

                    if(asset.isMTLForm)
                        await awsUploader.deleteFile(asset.isMTLForm, 4);

                    const result = await awsUploader.upload_temp(uploadFile);
                    if(result['path']) {
                        asset.isMTLForm = result['path'];
                    }
                }

                if(req.files['isTextureForm']) {
                    let __urls = [];

                    //_addingUrls

                    for(let i = 0; i < req.files['isTextureForm'].length; i ++) {
                        let assetFile: Express.Multer.File;
                        assetFile = req.files['isTextureForm'][i];
                        let uploadFile = multerToFileObj(assetFile);   
                        
                        // if(req.body.isTextureFormAddingUrl[i])

                        if(req.body.isTextureFormAddingUrl[i] == ""){
                            uploadFile.name = `assets/${collection.id}/${asset.token_id}/${req.files['isTextureForm'][i]['originalname']}`;
                        }
                        else {
                            uploadFile.name = `assets/${collection.id}/${asset.token_id}/${req.body.isTextureFormAddingUrl[i]}/${req.files['isTextureForm'][i]['originalname']}`;
                        }

                        const result = await awsUploader.upload_temp(uploadFile);
                        __urls.push(result['path']);
                    }

                    let textures = new Array<Texture>();
                    
                    for(let i = 0; i < __urls.length; i ++) {
                        let _texture = new Texture();
                        _texture.isTextureForm = __urls[i];
                        _texture.raw_animation_texture = req.body.raw_animation_texture[i];
                        textures.push(_texture);
                    }

                    asset.textures = textures;
                }


            }
            await assetRepository.save(asset);
        }

        return res.status(200)
            .json(asset);
    }
    catch (e) {
        console.log(e);
        return res.status(500)
            .json({
                'msg': 'Get error while create asset.'
            });
    }

}

export const featured_assets = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const assetRepo = getRepository(Asset);
        const assets = await assetRepo
            .createQueryBuilder('asset')
            .leftJoinAndSelect("asset.creator", "creator")
            .leftJoinAndSelect("asset.owner", "owner")
            .leftJoinAndSelect("asset.collection", "collection")
            .where("asset.synced = 1")
            .orderBy("RAND()")
            .take(5)
            .getMany();

        return res.json({
            assets: assets
        });
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                msg: 'Get error while fetch assets.'
            })
    }
}

export const updateOwner = async function (req: Request, res: Response, next: NextFunction) {
    try {
        
        let assetId = req.body.assetId;
        let owner = req.body.owner;

        await getConnection()
            .createQueryBuilder()
            .update(Asset)
            .set({
                owner_of: owner
            })
            .where("id = :id", {id: assetId})
            .execute();

            /*
        axios({
                url: "https://d730-188-43-235-177.ngrok.io/Socket_Api?userAcc=0x6623251447ab7afeB0442Aa1Ed4D48FD6Eeb55Fa",
                method: "GET"
        }).then(function (response) {
            // handle success
            console.log("handle success");
        })
        .catch(function (error) {
            // handle error
            console.log(error);
        }); */

        /* let assetId = req.body.assetId;
        let query123 = `select max(price) as max_price from bid where bid.assetId = ${assetId}`;
        const entityManager = getManager();
        let max_query = await entityManager.query(query123);

        console.log("max_query===============>", max_query, max_query[0].max_price); */

        /*
        const assetRepo = getRepository(Asset);

        let data = await getRepository(Asset).createQueryBuilder('asset')
        .getMany();

        for(let i = 0; i < data.length; i ++) {
            let _item : Asset;
            _item = data[i];

            _item.description = _item.description1;

            await assetRepo.save(_item);
        } */

        return res.status(200)
            .send({
                'msg': "success."
            });
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                msg: 'Get error while update owner'
            })
    }  
} 

export const getBanners = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let data = await getRepository(Slider)
        .createQueryBuilder('slider')
        .where('slider.visible = :visible', {visible: true})
        .orderBy('slider.order', 'ASC')
        .orderBy('slider.updated_at', 'DESC')
        .getMany();

        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};

            _item = {
                small_header: item.small_header,
                big_header: item.big_header,
                description: item.description,
                button_text: item.button,
                banner: item.banner,
                redirect_link: item.redirect_link,
                class_name: item.class_name
            }

            ret_data.push(_item);
        });        

        return res.json({
            data: ret_data
        });
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                msg: 'Get error while get Banners'
            })
    }
}

export const addCategory = async function (req: Request, res: Response, next: NextFunction) {
    try {

        const adminRepo = getRepository(Admin);

        let admin: Admin;
        admin = new Admin();
        admin.create_date = Math.floor(Date.now() / 1000);
        admin.update_date = Math.floor(Date.now() / 1000);
        admin.login_id = 'admin';
        admin.password = 'password';

        await adminRepo.save(admin);

        return res.status(200)
            .send({
                'msg': "Insert Success."
            });
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                msg: 'Get error while add category'
            })
    }
} 

export const getHistory = async function (req: Request, res: Response, next: NextFunction) {
    try {

        if (!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include asset id.'
                })
        }

        const assetId = parseInt(req.body.id.toString());

        let data = 
            await getRepository(AssetActivity)
            .createQueryBuilder('asset_activity')
            .leftJoinAndSelect(User, "user_from", "LOWER(asset_activity.from) = LOWER(user_from.public_address)")
            .leftJoinAndSelect(User, "user_to", "LOWER(asset_activity.to) = LOWER(user_to.public_address)")
            .where('asset_activity.assetId = :assetId', {assetId})
            .orderBy('asset_activity.id', 'DESC')
            .getRawMany();

        
        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};
            _item = {
                from: {
                    address: item.asset_activity_from,
                    user_id: item.user_from_id,
                    user_name: item.user_from_username,
                    user_avatar: item.user_from_avatar
                },
                to: {
                    address: item.asset_activity_to,
                    user_id: item.user_to_id,
                    user_name: item.user_to_username,
                    user_avatar: item.user_to_avatar
                },
                activity: item.asset_activity_activity,
                quantity: item.asset_activity_quantity,
                price: item.asset_activity_price,
                other_price: item.asset_activity_other_price,
                time: (item.asset_activity_create_date == 0) ? ( Math.floor((new Date(item.asset_activity_created_at)).getTime() / 1000) ) : item.asset_activity_create_date
            }
            ret_data.push(_item);
        });

        return res.json({
            data: ret_data
        });        
    }
    catch (ex) {
        console.log(ex);

        return res.status(500)
            .json({
                msg: 'Get error while get Assets history'
            })
    }
}

export const mint_asset = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;

        if (!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include asset id.'
                })
        }

        const assetId = parseInt(req.body.id.toString());

        const assetRepo = getRepository(Asset);
        let asset = await assetRepo.findOne({
            id: assetId,
            creator: userId,
            status: "pending"
        });

        if (!asset) {
            return res.status(400)
                .json({
                    msg: 'Your asset not valid or you are not creator of this asset.'
                })
        }

        if (!asset.token_uri) {

            const metadata = {
                name: asset.name,
                description: asset.description,
                image: asset.raw_image
            };

            const filename = asset.token_id + ".json";
            const path = getTempPath(filename);
            let stream = fs.createWriteStream(path);
            stream.write(JSON.stringify(metadata, null, 4));
            stream.close();

            let formdata = new FormData();
            formdata.append('file', fs.createReadStream(path));

            const pinMetadata = JSON.stringify({
                name: filename
            });
            formdata.append('pinataMetadata', pinMetadata);

            const { data } = await axios.post(`https://api.pinata.cloud/pinning/pinFileToIPFS`,
                formdata,
                {
                    maxBodyLength: 1024 * 1024 * 10,
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${formdata.getBoundary()}`,
                        pinata_api_key: pinata_config.apiKey,
                        pinata_secret_api_key: pinata_config.apiSecret
                    }
                });
            if (!data.IpfsHash) {
                res.status(404)
                    .send({
                        'msg': 'Get error while upload metadata.'
                    });
            }
            fs.unlinkSync(path);

            asset.token_uri = "ipfs://" + data.IpfsHash;
            await assetRepo.save(asset);
        }

        return res.status(200)
            .send({
                tokenId: asset.token_id,
                tokenUri: asset.token_uri,
                deadline: Math.floor(Date.now() / 1000) + 30
            })
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while mint asset.'
            });
    }

}

export const cancelList = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;
        const assetId = parseInt(req.body.id.toString());

        const assetRepo = getRepository(Asset);

        let asset = await assetRepo.createQueryBuilder("asset")
        .where("LOWER(asset.owner_of) = LOWER(:publicAddress) \
            and id = :assetId and on_sale = true", { publicAddress, assetId })
        .getOne();

        if (!asset) {
            return res.status(400)
                .json({
                    msg: 'Your asset not valid or you are not owner of this asset.'
                })
        }

        let price = asset.price;
        let sale_end_date = asset.sale_end_date;

        if(asset.sale_type == SaleType.Fixed && sale_end_date < Math.floor(Date.now() / 1000)) {
            return res.status(400)
                .json({
                    msg: 'The sales period has already passed.'
                })
        }

        if(asset.sale_type == SaleType.Auction && asset.auction_end_date < Math.floor(Date.now() / 1000)) {
            return res.status(400)
                .json({
                    msg: 'The auction period has already passed.'
                })
        }

        let _saleType = asset.sale_type;

        asset.on_sale = false;
        asset.sale_type = SaleType.Default;
        asset.sale_end_date = 0;
        asset.auction_start_date = 0;
        asset.auction_end_date = 0;
        asset.price = 0;
        asset.top_bid = 0;

        await assetRepo.save(asset);

        // delete bids
        await getRepository(Bid).createQueryBuilder("bid")
        .where("assetId = :assetId", {assetId: asset.id})
        .delete()
        .execute();

        const activityRepo = getRepository(AssetActivity);
        await activityRepo.save(activityRepo.create({
            asset: assetRepo.create({
                id: assetId
            }),
            from: asset.owner_of,
            activity: _saleType == SaleType.Fixed ? ActivityType.Cancel : ActivityType.CancelAuction,
            quantity: 1,
            price: price,
            create_date: Math.floor(Date.now() / 1000)
        }));

        return res.status(200)
            .send({
                'msg': "List asset cancelled."
            });
    }   
    catch(ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while cancel list asset.'
            });
    }
}

export const changePrice = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;
        if (!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include asset id.'
                })
        }
        
        const assetId = parseInt(req.body.id.toString());

        const assetRepo = getRepository(Asset);

        let asset = await assetRepo.createQueryBuilder("asset")
        .where("LOWER(asset.owner_of) = LOWER(:publicAddress) \
            and id = :assetId and on_sale = true", { publicAddress, assetId })
        .getOne();

        if (!asset) {
            return res.status(400)
                .json({
                    msg: 'Your asset not valid or you are not owner of this asset.'
                })
        }

        let tokenId = asset.token_id;

        let signature = req.body.signature;
        let price = req.body.price;
        let sale_end_date = req.body.sale_end_date;

        if (!signature
            || !price
            ) {
            return res.status(400)
                .json({
                    msg: 'You need to include signature and price.'
                })
        }

        let signMsg = '';

        if(!sale_end_date) {
            signMsg = `Wallet address:${publicAddress} TokenId:${tokenId} Price:${price}`;
        }
        else {
            signMsg = `Wallet address:${publicAddress} TokenId:${tokenId} Price:${price} End Date:${sale_end_date}`;
        }

        const msgBufferHex = bufferToHex(Buffer.from(signMsg, 'utf8'));
        const address = recoverPersonalSignature({
            data: msgBufferHex,
            sig: signature,
        });

        if (address.toLowerCase() !== publicAddress.toLowerCase()) {
            return res.status(401).send({
                error: 'Signature verification failed',
            });
        }

        if(price > asset.price) {
            return res.status(400)
                .json({
                    msg: 'You can only set lower price for this item.'
                })
        }

        asset.price = price;

        if(sale_end_date)
            asset.sale_end_date = sale_end_date;

        await assetRepo.save(asset);

        const activityRepo = getRepository(AssetActivity);
        await activityRepo.save(activityRepo.create({
            asset: assetRepo.create({
                id: assetId
            }),
            from: asset.owner_of,
            activity: ActivityType.List,
            quantity: 1,
            price: price,
            create_date: Math.floor(Date.now() / 1000)
        }));

        return res.status(200)
            .send({
                'msg': "Change price successed."
            });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while change price.'
            });
    }
} 

export const auctionItem = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;
        
        if(!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include asset id.'
                })
        }

        const assetId = parseInt(req.body.id.toString());
        const assetRepo = getRepository(Asset);

        let asset = await assetRepo.createQueryBuilder("asset")
                    .where("LOWER(asset.owner_of) = LOWER(:publicAddress) \
                    and id = :assetId and on_sale = false", { publicAddress, assetId })
                    .getOne();
        
        if(!asset) {
            return res.status(400)
                    .json({
                        msg: 'Your asset not valid or you are not creator of this asset.'
                    })              
        }

        let tokenId = asset.token_id;
        let signature = req.body.signature;
        let price = req.body.start_price;
        let auction_start_date = req.body.auction_start_date;
        let auction_end_date = req.body.auction_end_date;
        let method = req.body.method;

        if(!signature
            || !price
            || !auction_start_date
            || !auction_end_date
            || !method) {

            return res.status(400)
            .json({
                msg: 'Invalid params for signature, price, auction duration, method'
            })

        }

        let signMsg = `Wallet address:${publicAddress} TokenId:${tokenId} StartPrice:${price} Auction Start Date:${auction_start_date} Auction End Date:${auction_end_date} Method:${method}`;

        const msgBufferHex = bufferToHex(Buffer.from(signMsg, 'utf8'));
        const address = recoverPersonalSignature({
            data: msgBufferHex,
            sig: signature,
        });      

        if (address.toLowerCase() !== publicAddress.toLowerCase()) {
            return res.status(401).send({
                error: 'Signature verification failed',
            });
        }

        asset.price = price;
        asset.on_sale = true;
        asset.sale_type = SaleType.Auction;
        asset.auction_end_process = false;
        asset.auction_start_date = auction_start_date;
        asset.auction_end_date = auction_end_date;
        asset.bid_method = method;
        await assetRepo.save(asset);

        const activityRepo = getRepository(AssetActivity);
        await activityRepo.save(activityRepo.create({
            asset: assetRepo.create({
                id: assetId
            }),
            from: asset.owner_of,
            activity: ActivityType.Auction,
            quantity: 1,
            price: price,
            create_date: Math.floor(Date.now() / 1000)
        }));

        // delete made offer for current assetId
        await getRepository(Bid).createQueryBuilder("bid")
                        .where("assetId = :assetId", {assetId: assetId})
                        .delete()
                        .execute();

        return res.status(200)
            .send({
                'msg': "Make Auction Item success"
            });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while set auction item.'
            });
    }
}

export const getNotifications = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;


        let notifies = await getRepository(Notify)
        .createQueryBuilder("notify")
        .addSelect('user.avatar as user_avatar')
        .addSelect('user.public_address as user_public_address')
        .leftJoin(User, "user", "LOWER(notify.from) = LOWER(user.public_address)")
        .where("LOWER(notify.user) = LOWER(:publicAddress) and unread=true", {publicAddress})
        .getRawMany();

        let ret_data = [];

        let vxltoUsdPrice = getVXLUsdPrice();

        notifies.forEach(function(item) {
            let _item: {[k: string]: any} = {};

            let priceText = '';
            let _calcPrice = item.notify_price ? item.notify_price : 0;

            if(item.notify_type == 'sale') {
                let usdPrice = vxltoUsdPrice == 0 ? 0 : (_calcPrice * vxltoUsdPrice).toFixed(2);
                priceText = `${_calcPrice} VXL (${usdPrice} USD)`;
            }
            else {
                let vxlPrice = vxltoUsdPrice == 0 ? 0 : (_calcPrice / vxltoUsdPrice).toFixed(2);
                priceText = `${vxlPrice} VXL (${_calcPrice} USD)`;
            }

            _item = {
                id: item.notify_id,
                date: item.notify_create_date,
                msg: convertNotifyMsg(item.notify_msg, {price: priceText}),
                type: item.notify_type,
                link: item.notify_link,
                avatar: item.user_avatar,
                public_address: item.user_public_address
            }

            ret_data.push(_item);
        });

        return res.json({
            data: ret_data
        });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while get notifications.'
            });
    }
}

export const removeAllNotification = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const publicAddress = (req as any).user.payload.publicAddress;

        const notifyRepo = getRepository(Notify);

        await notifyRepo.createQueryBuilder("notify")
        .where("LOWER(user) = LOWER(:publicAddress)", {publicAddress})
        .delete()
        .execute();

        return res.status(200)
            .send({
                'msg': "Remove all notifications successed."
            });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while remove notification.'
            });
    }
}

export const removeNotification = async function (req: Request, res: Response, next: NextFunction) {
    try {
        if (!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include notification id.'
                })
        }

        const notifyId = parseInt(req.body.id.toString());

        const notifyRepo = getRepository(Notify);

        await notifyRepo.createQueryBuilder("notify")
        .where("id = :id", {id: notifyId})
        .delete()
        .execute();

        return res.status(200)
            .send({
                'msg': "Remove notification successed."
            });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while remove notification.'
            });
    }
}

export const list_asset = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const publicAddress = (req as any).user.payload.publicAddress;

        if (!req.body.id) {
            return res.status(500)
                .json({
                    msg: 'You need to include asset id.'
                })
        }

        const assetId = parseInt(req.body.id.toString());

       const assetRepo = getRepository(Asset);

       let asset = await assetRepo.createQueryBuilder("asset")
        .where("LOWER(asset.owner_of) = LOWER(:publicAddress) \
            and id = :assetId and on_sale = false", { publicAddress, assetId })
        .getOne();

        if (!asset) {
            return res.status(400)
                .json({
                    msg: 'Your asset not valid or you are not creator of this asset.'
                })
        }

        let tokenId = asset.token_id;

        let signature = req.body.signature;
        let price = req.body.price;
        let sale_end_date = req.body.sale_end_date;
        if (!signature
            || !price
            || !sale_end_date) {
            return res.status(400)
                .json({
                    msg: 'You need to include signature and price.'
                })
        }

        let signMsg = `Wallet address:${publicAddress} TokenId:${tokenId} Price:${price} End Date:${sale_end_date}`;

       const msgBufferHex = bufferToHex(Buffer.from(signMsg, 'utf8'));
        const address = recoverPersonalSignature({
            data: msgBufferHex,
            sig: signature,
        });

        if (address.toLowerCase() !== publicAddress.toLowerCase()) {
            return res.status(401).send({
                error: 'Signature verification failed',
            });
        }

        asset.price = price;
        asset.on_sale = true;
        asset.sale_type = SaleType.Fixed;
        asset.sale_end_date = sale_end_date;
        await assetRepo.save(asset);

        const activityRepo = getRepository(AssetActivity);
        await activityRepo.save(activityRepo.create({
            asset: assetRepo.create({
                id: assetId
            }),
            from: asset.owner_of,
            activity: ActivityType.List,
            quantity: 1,
            price: price,
            create_date: Math.floor(Date.now() / 1000)
        }));

        return res.status(200)
            .send({
                'msg': "List asset successed."
            });
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .send({
                'msg': 'Get error while list asset.'
            });
    }

}

export const upload_ipfs = async function (req: Request, res: Response, next: NextFunction) {

    try {
        let file = req.file;
        if (!file) {
            return res.status(404);
        }

        const filename = file.filename ? file.filename : file.originalname;
        const path = getTempPath(filename);
        let stream = fs.createWriteStream(path);
        stream.write(file.buffer);
        stream.close();

        let data = new FormData();
        data.append('file', fs.createReadStream(path));

        const metadata = JSON.stringify({
            name: filename
        });
        data.append('pinataMetadata', metadata);

        axios.post(`https://api.pinata.cloud/pinning/pinFileToIPFS`,
            data,
            {
                maxBodyLength: 1024 * 1024 * 10,
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${data.getBoundary()}`,
                    pinata_api_key: pinata_config.apiKey,
                    pinata_secret_api_key: pinata_config.apiSecret
                }
            })
            .then(resp => {
                fs.unlinkSync(path);
                let cid = resp.data.IpfsHash;
                res.json({
                    'cid': cid
                });
            })
            .catch(err => {
                res.status(400)
                    .send({
                        'msg': 'Get error while upload file to ipfs.'
                    });
            });
    }
    catch (ex) {
        res.status(500)
            .send({
                'msg': 'Get error.'
            });
    }

}

const parseMetadata = function (asset: Asset, metadata: any) {

    if (!metadata) {
        return asset;
    }

    if (metadata['name']) {
        asset.name = metadata['name'];
    }
    if (metadata['description']) {
        asset.description = metadata['description'];
    }
    if (metadata['image']
        || metadata['image_url']) {
        asset.raw_image = metadata['image'] || metadata['image_url'];
    }
    if (metadata['animation']
        || metadata['animation_url']) {
        asset.raw_animation = metadata['animation'] || metadata['animation_url'];
    }

    if (metadata['attributes']) {
        let traits = new Array<Trait>();
        const attributes = metadata['attributes'];
        for (const attribute of attributes) {
            let trait = new Trait();
            trait.trait_type = attribute['trait_type'];
            trait.value = attribute['value'];
            traits.push(trait);
        }

        asset.traits = traits;
    }

    return asset;
}

const cron_moralis_request = async function (tokenId , collectionId , collectionAddr , chainId) {
    
    

    
}

export const refreshItem = async function (req: Request, res: Response, next: NextFunction) {
    
    const assetRepository = getRepository(Asset);
    const collectionRepo = getRepository(Collection);
    

    
    if(!req.body.assetId) {
        return res.status(500).json({msg: 'refresh Item: invalid request param.'});
    }

    const ID = req.body.assetId; 
    
    let asset = await assetRepository.createQueryBuilder('asset')
        .where('asset.id = :ID', {ID: ID})
        .getOne();
    if(!asset) {
        return res.status(500).json({msg: 'refresh Item: unregistered item'});
    }
    const tokenId = asset.token_id ;
    const collectionId = asset.collection ;
    let collectionAsset = await collectionRepo.createQueryBuilder('collection')
        .where('collection.id = :ID', {ID: collectionId})
        .getOne();
    if(!collectionAsset) {
        return res.status(500).json({msg: 'refresh Item: unregistered collection'});
    }
    const collectionAddr = collectionAsset.contract_address ;
    const chainId = collectionAsset.chain_id ;
    // await redisClient.set('tokenId',tokenId) ;
    // await redisClient.set('collectionId',collectionId) ;
    // await redisClient.set('collectionAddr',collectionAddr) ;
    // await redisClient.set('chainId',chainId) ;

    cron.schedule('*/10 * * * * *', (async () => {
        // cron_moralis_request(tokenId , collectionId , collectionAddr , chainId) ;
        try {
            
           
            const requestUrl = `https://deep-index.moralis.io/api/v2/nft/${collectionAddr}/${tokenId}/metadata/resync?chain=0x${chainId.toString(16)}`;
            const resp = await axios({
                url: requestUrl,
                method: "GET",
                headers: {
                    "X-API-Key": morlias_config.apiKey
                }
            });
        
            if(resp.status != 200 && resp.status != 202) {
                return res.status(500).json({msg: 'refresh Item: failed refresh.'});
            }
        
            let metadataUrl = `https://deep-index.moralis.io/api/v2/nft/${collectionAddr}/${tokenId}/owners?chain=0x${chainId.toString(16)}&format=decimal`;
            const metadataResp = await axios({
                url: metadataUrl,
                method: "GET",
                headers: {
                    "X-API-Key": morlias_config.apiKey
                }
            });
            // console.log(metadataResp ,'metamask data')
            if(metadataResp.status != 200) {
                return res.status(500).json({msg: 'refresh Item: failed update metadata.'});
            }
        
            let asset = await assetRepository.createQueryBuilder('asset')
                .where('asset.id = :ID', {ID: ID})
                .getOne();
            if(!asset) {
                return res.status(500).json({msg: 'refresh Item: unregistered item'});
            }
            if(metadataResp.data['result'].length == 0) {
                return res.status(500).json({msg: 'invalid result'});
            }
            const nftData = metadataResp.data['result'][0];
            // console.log(nftData['metadata'],'metadata updated') ;
            if (nftData['metadata']) {
                const metadata = JSON.parse(nftData['metadata']);
                asset = parseMetadata(asset, metadata);
            }
            assetRepository.save(asset);
        
            return res.status(200).json({status: true});
        } catch (e) {
            console.error('refresh item error: ', e);
            return res.status(500).json({msg: 'refresh item operation error'});
        }
    }));

    // try {
    //     if(!req.body.tokenId || !req.body.collectionId || !req.body.collectionAddr || !req.body.chainId) {
    //         return res.status(500).json({msg: 'refresh Item: invalid request param.'});
    //     }
       
    
    //     const requestUrl = `https://deep-index.moralis.io/api/v2/nft/${collectionAddr}/${tokenId}/metadata/resync?chain=0x${chainId.toString(16)}`;
    //     const resp = await axios({
    //         url: requestUrl,
    //         method: "GET",
    //         headers: {
    //             "X-API-Key": morlias_config.apiKey
    //         }
    //     });
    
    //     if(resp.status != 200) {
    //         return res.status(500).json({msg: 'refresh Item: failed refresh.'});
    //     }
    
    //     let metadataUrl = `https://deep-index.moralis.io/api/v2/nft/${collectionAddr}/${tokenId}/owners?chain=0x${chainId.toString(16)}&format=decimal`;
    //     const metadataResp = await axios({
    //         url: metadataUrl,
    //         method: "GET",
    //         headers: {
    //             "X-API-Key": morlias_config.apiKey
    //         }
    //     });
    //     if(metadataResp.status != 200) {
    //         return res.status(500).json({msg: 'refresh Item: failed update metadata.'});
    //     }
    
    //     const assetRepository = getRepository(Asset);
    //     let asset = await assetRepository.createQueryBuilder('asset')
    //         .where('asset.token_id = :tokenId and asset.collectionId = :collectionId', {tokenId: tokenId, collectionId: collectionId})
    //         .getOne();
    //     if(!asset) {
    //         return res.status(500).json({msg: 'refresh Item: unregistered item'});
    //     }
    //     if(metadataResp.data['result'].length == 0) {
    //         return res.status(500).json({msg: 'invalid result'});
    //     }
    //     const nftData = metadataResp.data['result'][0];
    //     console.log(nftData['metadata'],'metadata updated') ;
    //     if (nftData['metadata']) {
    //         const metadata = JSON.parse(nftData['metadata']);
    //         asset = parseMetadata(asset, metadata);
    //     }
    //     assetRepository.save(asset);
    
    //     return res.status(200).json({status: true});
    // } catch (e) {
    //     console.error('refresh item error: ', e);
    //     return res.status(500).json({msg: 'refresh item operation error'});
    // }
    
}