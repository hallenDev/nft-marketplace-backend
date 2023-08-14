import axios from "axios";
import { getAddress } from "ethers/lib/utils";
import { NextFunction, Request, Response } from "express";
import { getRepository, getManager, getConnection, Raw } from "typeorm";
import { ETHERSCAN_API_KEY, morlias_config } from "../../config";
import { Asset } from "../../entity/Asset";
import { AssetActivity } from "../../entity/AssetActivity";
import { Category } from "../../entity/Category";
import { Collection } from "../../entity/Collection";
import { User } from "../../entity/User";
import { multerToFileObj, paginate, extendResponse } from "../../utils";
import { AWSFileUploader } from "../upload/aws";


export const getActivity = async function (req: Request, res: Response, next: NextFunction) {
    try {

        const colRepository = getRepository(Collection);

        const collectionId = req.params.id.toString();
        if(!collectionId) {
            return res.status(400)
                .json({
                    msg: 'You need to include collection id.'
                });
        }            
        
        let collection = await colRepository.findOne(collectionId);
        
        if(!collection) {
            return res.status(400)
                .json({
                    msg: 'Your collection not exists.'
                });
        }

        let per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        let page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;

        let builder = getRepository(AssetActivity)
        .createQueryBuilder("asset_activity")
        .addSelect('from.id as from_id')
        .addSelect('from.username as from_username')
        .addSelect('to.id as to_id')
        .addSelect('to.username as to_username')
        .leftJoinAndSelect("asset_activity.asset", "asset")
        .leftJoin(User, "from", "LOWER(asset_activity.from) = LOWER(from.public_address)")
        .leftJoin(User, "to", "LOWER(asset_activity.to) = LOWER(to.public_address)")
        .where("asset.collectionId = :collectionId", {collectionId});

        if(req.query.search && 
            req.query.search['filterTypes'] && 
            Array.isArray(req.query.search['filterTypes']) &&
            req.query.search['filterTypes'].length > 0) {

                let _filterTypes = [];
                for(let i = 0; i < req.query.search['filterTypes'].length; i ++)
                    _filterTypes.push(req.query.search['filterTypes'][i].toString());
                /* 
                list, offer, bid, likes, sale
                */
                if(_filterTypes.includes('bid')) 
                    _filterTypes.push('offer')

                builder.andWhere("asset_activity.activity IN (:...activities)", 
                { activities: _filterTypes });
        }

        let total = 0;
        let from = 0;
        let to = 0;
        
        if(page < 1) {
            page = 1;
        }

        if (per_page > 100) {
            per_page = 100;
        }

        from = per_page * (page - 1) + 1;

        total = await builder.getCount();

        let data = await builder
        .orderBy("asset_activity.create_date", "DESC")
        .offset(from - 1)
        .limit(per_page)
        .getRawMany();

        to = from + data.length - 1;

        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};

            let _activityType = 'Mint';

            switch(item.asset_activity_activity) {
                case 'mint':
                    _activityType = 'Mint'
                    break;
                case 'list':
                    _activityType = 'Listing'
                    break;
                case 'offer':
                    _activityType = 'Offer'
                    break;
                case 'transfer':
                    _activityType = 'Transfer'
                    break;
                case 'cancel':
                    _activityType = 'Cancel Listing'
                    break;
                case 'sale':
                    _activityType = 'Sale'
                    break;
                case 'auction':
                    _activityType = 'Auction'
                    break;
                case 'bid':
                    _activityType = 'Bid'
                    break;
                case 'cancel_bid':
                    _activityType = 'Cancel Bid'
                    break;
            }
            _item = {
                asset: {
                    image: item.asset_image,
                    name: item.asset_name,
                    id: item.asset_id,
                    auction_start_date: item.asset_auction_start_date,
                    auction_end_date: item.asset_auction_end_date,
                    sale_end_date: item.asset_sale_end_date,
                    on_sale: item.asset_on_sale,
                    sale_type: item.asset_sale_type
                },
                activity: _activityType,
                price: item.asset_activity_price,
                other_price: item.asset_activity_other_price,
                quantity: item.asset_activity_quantity,
                from: {
                    address: item.asset_activity_from,
                    id: item.from_id,
                    username: item.from_username,
                },
                to: {
                    address: item.asset_activity_to,
                    id: item.to_id,
                    username: item.to_username
                },
                create_date: item.asset_activity_create_date,
                tx_hash: item.asset_activity_transaction_hash
            }
            ret_data.push(_item); 
        });

        return res.json(
            extendResponse(
                {
                    data: ret_data,
                    meta: {
                        page: page,
                        per_page: per_page,
                        total: total,
                        from: from,
                        to: to
                    }
                })
        );
    }
    catch(err) {
        console.log(err);
        return res.status(500)
            .json({
                'msg': 'Get error while get collection activity.'
            });
    }
}

export const getRanking = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const entityManager = getManager();

        let query = " \
        select B.collectionId, B.name, B.avatar, sum(B.volume) as volume,  sum(B.floor_price) as floor_price,  sum(B.owners) as owners, sum(B.assets) as assets \
        from (select collection.id as `collectionId` , collection.`name` , collection.avatar , collection.categoryId, sum(asset_activity.other_price) as volume , 0 as floor_price , 0 as owners , 0 as assets \
        from collection \
        left join asset \
        on collection.id = asset.collectionId \
        left join asset_activity \
        on asset_activity.assetId = asset.id \
        where asset_activity.activity='sale' ";

        if(req.body.start_date) {
            query += " \
            and asset_activity.create_date >= " + req.body.start_date + " \
            ";
        }

        query += "\
        GROUP BY collection.id \
        union  \
        select collection.id as `collectionId` , collection.`name`, collection.avatar, collection.categoryId, 0 as volume  , min(asset.price) as floor_price , 0 as owners , 0 as assets \
        from collection \
        left join asset \
        on collection.id = asset.collectionId \
        where asset.on_sale = true \
        GROUP BY collection.id \
        union  \
        select collection.id as `collectionId` , collection.`name`, collection.avatar, collection.categoryId, 0 as volume  , 0 as floor_price , count(DISTINCT asset.owner_of) as owners , count(asset.id) as assets \
        from collection \
        left join asset \
        on collection.id = asset.collectionId \
        GROUP BY collection.id \
        ) as B ";

        if(req.body.category) {
            query += "\
            where B.categoryId = " + req.body.category + " \
            ";
        }

        query += "\
        group by B.collectionId \
        order by sum(B.volume) desc \
        ";

        const someQuery = await entityManager.query(query);

        let ret_data = [];

        someQuery.forEach(function(item) {
            let _item: {[k: string]: any} = {};
            _item = {
                collectionId: item.collectionId,
                collectionName: item.name,
                collectionAvatar: item.avatar,
                volume: item.volume,
                floor_price: item.floor_price,
                owners: item.owners,
                assets: item.assets
            }
            ret_data.push(_item);
        });

        return res.json(
            extendResponse(
                {
                    data: ret_data
                }
            )
        );
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while get ranking.'
            });
    }
}

export const get_collections = async function (req: Request, res: Response, next: NextFunction) {
    try {

        const creator_id: number = req.query.creator ? parseInt(req.query.creator.toString()) : null;
        const category_id: number = req.query.category ? parseInt(req.query.category.toString()) : null;
        let per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        let page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;

        const entityManager = getManager();
        let query = "select * ";

        let global_query = " \
        from \
        ( \
            select  \
                collection.id as collection_id,  \
                collection.name as collection_name,     \
                collection.symbol as collection_symbol, \
                collection.description as collection_description,   \
                collection.avatar as collection_avatar, \
                collection.banner as collection_banner, \
                collection.featured as collection_featured, \
                collection.contract_address as collection_contract_address, \
                collection.chain_id as collection_chain_id, \
                collection.synced as collection_synced, \
                collection.is_1155 as collection_is_1155,   \
                collection.is_721 as collection_is_721, \
                collection.is_voxel as collection_is_voxel, \
                collection.website as collection_website,   \
                collection.twitter as collection_twitter,   \
                collection.instagram as collection_instagram,   \
                collection.telegram as collection_telegram, \
                collection.discord as collection_discord,   \
                collection.volume as collection_volume, \
                user.id as creator_id,  \
                user.public_address as creator_public_address,  \
                user.username as creator_username,  \
                user.bio as creator_bio,    \
                user.email as creator_email,    \
                user.avatar as creator_avatar,  \
                user.banner as creator_banner,  \
                user.link_twitter as creator_link_twitter,  \
                user.link_instagram as creator_link_instagram,  \
                user.link_external as creator_link_external,    \
                user.verify_type as creator_verify_type,    \
                user.project_name as creator_project_name,  \
                user.telegram_id as creator_telegram_id,    \
                user.kyc as creator_kyc,    \
                user.verified as creator_verified,  \
                user.saleSum as creator_saleSum, \
                category.id as category_id, \
                category.name as category_name, \
                category.label as category_label,   \
                count(asset.id) as nft_count \
            from collection \
            left join user on user.id = collection.creatorId \
            left join category on category.id = collection.categoryId \
            left join asset on asset.collectionId = collection.id \
            group by collection.id \ ) as TB \
        where TB.nft_count > 0 \
        ";

        if(creator_id) {
            query = query + ` \
                and TB.creatorId = ${creator_id}
            `;
        }

        if(category_id) {
            query = query + ` \
                and TB.categoryId = ${category_id}
            `;
        }

        let count_query = " \
            select count(TB.collection_id) as cnt    \
        " + global_query;   

        const count_result = await entityManager.query(count_query);

        let total = 0;
        let from = 0;
        let to = 0;

        if (page < 1) {
            page = 1;
        }
        if (per_page > 100) {
            per_page = 100;
        }

        from = per_page * (page - 1) + 1;

        total = count_result[0]['cnt'];

        let main_query = `select * ${global_query} limit ${from-1},${per_page}`;
        let ret_data = await entityManager.query(main_query);
        
        let data = [];

        for(let i = 0; i < ret_data.length; i ++) {
            let item = {
                "id": ret_data[i]['collection_id'],
                "name": ret_data[i]['collection_name'],
                "symbol": ret_data[i]['collection_symbol'],
                "description": ret_data[i]['collection_description'],
                "avatar": ret_data[i]['collection_avatar'],
                "banner": ret_data[i]['collection_banner'],
                "featured": ret_data[i]['collection_featured'],
                "contract_address": ret_data[i]['collection_contract_address'],
                "chain_id": ret_data[i]['collection_chain_id'],
                "synced": ret_data[i]['collection_synced'],
                "is_1155": ret_data[i]['collection_is_1155'],
                "is_721": ret_data[i]['collection_is_721'],
                "is_voxel": ret_data[i]['collection_is_voxel'],
                "website": ret_data[i]['collection_website'],
                "twitter": ret_data[i]['collection_twitter'],
                "instagram": ret_data[i]['collection_instagram'],
                "telegram": ret_data[i]['collection_telegram'],
                "discord": ret_data[i]['collection_discord'],
                "volume": ret_data[i]['collection_volume'],
                "creator": {
                    "id": ret_data[i]['creator_id'],
                    "public_address": ret_data[i]['creator_public_address'],
                    "username": ret_data[i]['creator_username'],
                    "bio": ret_data[i]['creator_bio'],
                    "email": ret_data[i]['creator_email'],
                    "avatar": ret_data[i]['creator_avatar'],
                    "banner": ret_data[i]['creator_banner'],
                    "link_twitter": ret_data[i]['creator_link_twitter'],
                    "link_instagram": ret_data[i]['creator_link_instagram'],
                    "link_external": ret_data[i]['creator_link_external'],
                    "verify_type": ret_data[i]['creator_verify_type'],
                    "project_name": ret_data[i]['creator_project_name'],
                    "telegram_id": ret_data[i]['creator_telegram_id'],
                    "kyc": ret_data[i]['creator_kyc'],
                    "verified": ret_data[i]['creator_verified'],
                    "saleSum": ret_data[i]['creator_saleSum']
                },
                "category": {
                    "id": ret_data[i]['category_id'],
                    "name": ret_data[i]['category_name'],
                    "label": ret_data[i]['category_label']
                },
                "nft_count": ret_data[i]['nft_count']
            };

            data.push(item);
        }
        
        return res.status(200)
            .json(
                extendResponse(
                    {
                        'data': data,
                        'meta': {
                            'page': page,
                            'per_page': per_page,
                            'total': total,
                            'from': from,
                            'to': to
                        }
                    }
                ));
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while list collections.'
            });
    }
}

export const get_collection = async function (req: Request, res: Response, next: NextFunction) {

    try {

        const colRepository = getRepository(Collection);
        const assetRepository = getRepository(Asset);

        const colId = req.params.id.toString();
        if (!colId) {
            return res.status(400)
                .json({
                    msg: 'You need to include collection id.'
                });
        }

        let collection = await colRepository.findOne({
            where: {
                id: colId
            },
            relations: ['creator', 'category']
        });
        if (collection) {

            const total_assets = await assetRepository.count({
                collection: collection,
                synced: true
            });

            const total_owners = await assetRepository.createQueryBuilder('asset')
                .select('COUNT(asset.owner_of) as `OWNER_COUNT`')
                .where('asset.collectionId = ' + collection.id)
                .andWhere('asset.synced = 1')
                .groupBy('asset.owner_of')
                .getRawMany();

            const floor_asset = await assetRepository.createQueryBuilder('asset')
                .where('asset.collectionId = ' + collection.id)
                .andWhere('asset.synced = 1')
                .andWhere('asset.price IS NOT NULL')
                .andWhere('asset.on_sale = 1')
                .orderBy('asset.price', 'ASC')
                .take(1)
                .getOne();
            const floor_price = floor_asset ? floor_asset.price : '0';

            const ceil_asset = await assetRepository.createQueryBuilder('asset')
                .where('asset.collectionId = ' + collection.id)
                .andWhere('asset.synced = 1')
                .andWhere('asset.price IS NOT NULL')
                .andWhere('asset.on_sale = 1')
                .orderBy('asset.price', 'DESC')
                .take(1)
                .getOne();
            const ceil_price = ceil_asset ? ceil_asset.price : '0';

            const volume_traded = await getConnection()
                                    .createQueryBuilder()
                                    .select('sum(asset_activity.other_price) as volume_traded')
                                    .from(AssetActivity, "asset_activity")
                                    .leftJoinAndSelect("asset_activity.asset", "asset")
                                    .where("asset.collectionId = :collectionId", {collectionId: collection.id})
                                    .andWhere("asset_activity.activity='sale'")
                                    .getRawOne();

            collection['total_assets'] = total_assets;
            collection['total_owners'] = total_owners.length;
            collection['floor_price'] = floor_price;
            collection['ceil_price'] = ceil_price;
            collection['volume_traded'] = (volume_traded['volume_traded'] ? volume_traded['volume_traded'] : 0);

            return res.status(200)
                .json(extendResponse(collection));
        }
        else {
            return res.status(404)
                .json({
                    msg: 'Your collection not exists.'
                });
        }
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while fetch collection.'
            });
    }
}

export const search_collections = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const collections = await getRepository(Collection)
            .createQueryBuilder()
            .select("id, name")
            .getRawMany();

        return res.status(200)
            .json(collections);

    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while search collections.'
            });
    }
}

export const save_collection = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;

        let featuredFile: Express.Multer.File;
        let bannerFile: Express.Multer.File;
        let avatarFile: Express.Multer.File;
        if (req.files) {
            if (req.files['featured']) {
                featuredFile = req.files['featured'][0];
            }
            if (req.files['banner']) {
                bannerFile = req.files['banner'][0];
            }
            if (req.files['avatar']) {
                avatarFile = req.files['avatar'][0];
            }
        }

        let name = req.body.name; // collection name
        let description = req.body.description;
        let twitter = req.body.twitter;
        let instagram = req.body.instagram;
        let discord = req.body.discord;
        let telegram = req.body.telegram;
        let website = req.body.website;
        let categoryId = req.body.category;
        let collectionId = req.body.collection_id;
        let type = req.body.type;

        if (!name
            || !type
            || (type != 'create'
                && type != 'update')) {
            return res.status(500)
                .json({
                    'msg': 'You need to post correct fields.'
                });
        }

        if (type == 'update'
            && !collectionId) {
            return res.status(500)
                .json({
                    'msg': 'You need to post collection id.'
                });
        }

        const colRepository = getRepository(Collection);
        const categoryRepo = getRepository(Category);

        // check duplicate collection name
        let _collection = await colRepository.findOne({
            where: {
                name: Raw(alias => `LOWER(${alias}) = '${name.toLowerCase()}'`)
            }
        });

        if(_collection && _collection.id != collectionId) {
            return res.status(400)
                .send({
                    'msg': 'The collection name is already taken.'
                });
        }

        let collection: Collection;

        if (type == 'create') {
            collection = new Collection();
            collection.name = name;
            collection.description = description;
            collection.twitter = twitter;
            collection.instagram = instagram;
            collection.discord = discord;
            collection.telegram = telegram;
            collection.website = website;
            collection.creator = userId;
            collection.is_voxel = true;
            collection.synced = true;

            if (categoryId) {
                const category = await categoryRepo.findOne(categoryId);
                if (category) {
                    collection.category = category;
                }
            }

            await colRepository.save(collection);
        }
        else if (type == 'update') {
            collection = await colRepository.findOne(collectionId, {
                relations: ['creator']
            });
            if (!collection) {
                return res.status(404)
                    .json({
                        'msg': 'Your collection not exists.'
                    });
            }

            if (collection.creator.id != userId) {
                return res.status(401)
                    .json({
                        'msg': 'Your have no permission to edit this collection.'
                    });
            }

            collection.name = name;
            collection.description = description;
            collection.twitter = twitter;
            collection.instagram = instagram;
            collection.discord = discord;
            collection.telegram = telegram;
            collection.website = website;

            if (categoryId) {
                const category = await categoryRepo.findOne(categoryId);
                if (category) {
                    collection.category = category;
                }
            }

            await colRepository.save(collection);
        }

        // Upload images
        if (avatarFile || featuredFile || bannerFile) {
            const awsUploader = new AWSFileUploader();

            if (avatarFile) {
                let uploadFile = multerToFileObj(avatarFile);
                uploadFile.name = `collections/${collection.id}/avatar`;

                if(collection.avatar)
                    await awsUploader.deleteFile(collection.avatar, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    collection.avatar = result['path'];
                }
            }
            if (featuredFile) {
                let uploadFile = multerToFileObj(featuredFile);
                uploadFile.name = `collections/${collection.id}/featured`;

                if(collection.featured)
                    await awsUploader.deleteFile(collection.featured, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    collection.featured = result['path'];
                }
            }
            if (bannerFile) {
                let uploadFile = multerToFileObj(bannerFile);
                uploadFile.name = `collections/${collection.id}/banner`;

                if(collection.banner)
                    await awsUploader.deleteFile(collection.banner, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    collection.banner = result['path'];
                }
            }

            await colRepository.save(collection);
        }

        res.status(200)
            .json(collection);
    }
    catch (ex) {

        return res.status(500)
            .json({
                'msg': 'Get error while save collection.'
            });

    }
}

export const requestVerify = async function (req: Request, res: Response, next: NextFunction) {
    try {

        const userId = (req as any).user.payload.id;

        if( !req.body.id ) {
            return res.status(400)
                .send({
                    'msg': 'You need to put colleciton id into params.'
                });            
        }

        const collectRepo = getRepository(Collection);
        
        let collection = await collectRepo.findOne({
            where: {
                id: req.body.id
            },
            relations: ['creator']
        });

        if(collection.creator.id != userId) {
            return res.status(400)
                .send({
                    'msg': 'You are not owend this collection.'
                });
        }

        collection.verify_request = 1;

        await collectRepo.save(collection);

        return res.status(200)
            .send({
                'msg': "Request verify collection success."
            });        
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while request verify.'
            });
    }
}

export const import_collection = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;
        const publicAddress = (req as any).user.payload.publicAddress;

        if (!req.body.contract_address
            || !req.body.chain_id) {
            return res.status(400)
                .send({
                    'msg': 'You need to put address into params.'
                });
        }

        const chainId = parseInt(req.body.chain_id.toString());
        const contractAddress = req.body.contract_address.toString();
        const colRepository = getRepository(Collection);
        const userRepo = getRepository(User);
        const categoryRepo = getRepository(Category);

        let collection = await colRepository.createQueryBuilder('collection')
            .leftJoinAndSelect('collection.category', 'category')
            .leftJoinAndSelect('collection.creator', 'creator')
            .where(`LOWER(contract_address) = '${contractAddress.toLowerCase()}'`)
            .getOne();
        if (!collection) {
            try {

                let apiEndpoint = '';

                if (chainId == 1) {
                    apiEndpoint = 'api.etherscan.io';
                }
                else if (chainId == 3) {
                    apiEndpoint = 'api-ropsten.etherscan.io';
                }
                else if (chainId == 4) {
                    apiEndpoint = 'api-rinkeby.etherscan.io';
                }
                else if (chainId == 5) {
                    apiEndpoint = 'api-goerli.etherscan.io';
                }
                else if (chainId == 42) {
                    apiEndpoint = 'api-kovan.etherscan.io';
                }

                const apiKey = ETHERSCAN_API_KEY;
                const etherscanResp = await axios({
                    url: `https://${apiEndpoint}/api?module=account&action=txlist&address=${contractAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${apiKey}`
                });

                const deployer = etherscanResp.data.result[0].from;
                console.log(deployer);
                if (deployer.toLowerCase() !== publicAddress.toLowerCase()) {
                    return res.status(401)
                        .send({
                            'msg': 'Your address is not deployer.'
                        });
                }


                const contractResp = await axios({
                    url: `https://deep-index.moralis.io/api/v2/nft/${contractAddress}/metadata?chain=0x${chainId.toString(16)}`,
                    method: "GET",
                    headers: {
                        "X-API-Key": morlias_config.apiKey
                    }
                });

                const contractData = contractResp.data;

                let _collection = new Collection();
                _collection.chain_id = chainId;
                _collection.name = contractData['name'];
                _collection.symbol = contractData['symbol'];
                _collection.contract_address = getAddress(contractData['token_address']);
                _collection.creator = await userRepo.findOne(userId);
                _collection.is_1155 = contractData['contract_type'] === 'ERC1155';
                _collection.is_721 = contractData['contract_type'] === 'ERC721';
                _collection.is_voxel = false;
                _collection.category = await categoryRepo.findOne(1);
                collection = await colRepository.save(_collection);
            }
            catch {
                return res.status(500)
                    .send({
                        'msg': 'Not found contract address.'
                    });
            }
        }

        return res.send({
            collection: collection
        });
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while import assets.'
            });
    }
}

export const getHotCollections = async function (req: Request, res: Response, next: NextFunction) {
    try {
        let data = await getRepository(Collection).createQueryBuilder('collection')
        .leftJoinAndSelect('collection.creator', 'user')
        .orderBy('collection.volume', 'DESC')
        .offset(0)
        .limit(6)
        .getRawMany();

        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};
            
            _item = {
                collectionId: item.collection_id,
                collectionImg: item.collection_featured,
                collectionName: item.collection_name,
                collectionDesc: item.collection_description,
                creatorAvatar: item.user_avatar,
                creatorName: item.user_username,
                creatorId: item.user_id,
                creatorVerified: item.user_verified,
                collectionVerified: item.collection_verified
            }

            ret_data.push(_item);
        });        

        return res.json(
            extendResponse(
                {
                    data: ret_data
                }
            ));
    }
    catch (err) {
        console.log("getHotCollections Err: ", err);
    }
}