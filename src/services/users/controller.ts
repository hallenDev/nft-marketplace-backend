import { NextFunction, Request, Response } from "express";
import { getConnection, getRepository, Raw } from "typeorm";
import { isAddress } from "web3-utils";
import { User } from "../../entity/User";
import { getNonce, multerToFileObj, paginate, extendResponse } from "../../utils";
import { Asset } from "../../entity/Asset";
import { Collection } from "../../entity/Collection";
import { Notification } from "../../entity/Notification";
import { AssetFavourite } from "../../entity/AssetFavourite";
import { AWSFileUploader } from "../upload/aws";
import { UserFollower } from "../../entity/UserFollower";
import { morlias_config, CONTRACT } from './../../config';
import axios from 'axios';
import { AssetActivity } from "../../entity/AssetActivity";

export const updateBalance = async function (req: Request, res: Response, next: NextFunction) {
    try {
            const public_address = req.query.public_address.toString();

            const userRepository = getRepository(User);

            const user = await userRepository.findOne({
                where: {
                    public_address: Raw(alias => `LOWER(${alias}) = '${public_address.toLowerCase()}'`)
                }
            });

            let url = `https://deep-index.moralis.io/api/v2/${public_address}/erc20?chain=rinkeby&token_addresses=${CONTRACT.VXL_TOKEN_ADDR}`

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
            user.vxl_balance = (resp.data.length == 0 ? "0" : resp.data[0].balance);

            await userRepository.save(user);
            
            return res.status(200)
            .send({
                'msg': "Update successed."
            });
    }
    catch(ex) {
        console.log(ex);
        return res.status(500)
                .json({
                    msg: 'Get error while update balance'
                })
    }
}

export const get_user = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const public_address = req.query.public_address ? req.query.public_address.toString() : "";
        if (!public_address) {
            return res.status(404)
                .json({
                    'msg': 'You need to include public address.'
                });
        }

        const userRepository = getRepository(User);
        const user = await userRepository.findOne({
            where: {
                public_address: Raw(alias => `LOWER(${alias}) = '${public_address.toLowerCase()}'`)
            }
        });

        if (!user) {
            return res.status(404)
                .json({
                    'msg': 'User not exists.'
                });
        }

        let assetRepository = getRepository(Asset);
        user['assets_count'] = await assetRepository.count({
            creator: user,
            synced: true
        });

        let colRepository = getRepository(Collection);
        user['collections_count'] = await colRepository.count({
            creator: user
        });

        let followRepo = getRepository(UserFollower);
        

        let _followers = await followRepo.createQueryBuilder("user_follower")
        .where("userId = :userId", {userId: user.id})
        .getMany();

        user['followers'] = [];

        _followers.forEach(function(item) {
            user['followers'].push({
                "follower": item.followerId
            });
        });

        return res.json(user);
    }
    catch {
        return res.status(500)
            .json({
                'msg': 'Get error while retrieve user.'
            });
    }

}

export const connect = async function (req: Request, res: Response, next: NextFunction) {

    if (!req.query.public_address) {
        res.status(400)
            .send({
                'msg': 'You need to put address into params.'
            });
        return null;
    }

    let publicAddress = req.query.public_address.toString();
    if (!isAddress(publicAddress)) {
        res.status(400)
            .send({
                'msg': 'Your address not valid.'
            });
        return null;
    }

    const userRepository = getRepository(User);

    // Find existing public address
    let _user = await userRepository.createQueryBuilder('user')
        .select(['id', 'public_address', 'nonce', 'username', 'avatar', 'banner', 'status'])
        .where({
            public_address: publicAddress
        })
        .getRawOne();
    if (_user) {
        if(_user.status == 'active')
            return res.json(_user);
        else  
        {   
            res.status(400)
            .send({
                'msg': 'Your account is ban'
            });
            return null;
        }

    }

    // Get last user for unique name
    let userId = 1;
    let lastUser = await userRepository.findOne({
        order: {
            id: 'DESC'
        }
    });
    if (lastUser) {
        userId = lastUser.id + 1;
    }

    // Create new user
    let user = new User();
    user.public_address = publicAddress;
    user.nonce = getNonce();

    // get balance
    let url = `https://deep-index.moralis.io/api/v2/${publicAddress}/erc20?chain=rinkeby&token_addresses=${CONTRACT.VXL_TOKEN_ADDR}`
    const resp = await axios({
        url: url,
        method: "GET",
        headers: {
            "X-API-Key": morlias_config.apiKey
        }
    });

    if(resp.status != 200) {
        user.vxl_balance = "0";
    }
    else {
        user.vxl_balance = (resp.data.length == 0 ? "0" : resp.data[0].balance);
    }

    userRepository.save(user)
        .then((user: User) => {
            res.json(user);
        })
        .catch(err => {
            console.log(err);
            res.status(500)
                .json({
                    'msg': 'Get error while save user.'
                });
        });
}

export const get_profile = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;

        const userRepository = getRepository(User);
        const assetRepository = getRepository(Asset);
        const colRepository = getRepository(Collection);

        const user = await userRepository
            .findOne({
                where: {
                    id: userId
                },
                relations: ['notification']
            });

        user['assets_count'] = await assetRepository.count({
            creator: user,
            synced: true
        });

        user['collections_count'] = await colRepository.count({
            creator: user
        });

        return res.json(user);
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while retrieve user.'
            });
    }

}

export const duplicateCheck = async function (req: Request, res: Response, next: NextFunction) {
    try {
        if( !(req.body.type && req.body.value) ) {
            return res.status(400)
                .send({
                    'msg': 'Invalid parameter'
                });
        }

        const userRepository = getRepository(User);

        let _user: User;

        if(req.body.type == 'username') {
            _user = await userRepository.findOne({
                where: {
                    username: req.body.value
                }
            });
        }
        else if(req.body.type == 'email') {
            _user = await userRepository.findOne({
                where: {
                    email: req.body.value
                }
            });
        }
        else {
            return res.status(400)
                .send({
                    'msg': 'Invalid parameter'
                });
        }

        if(_user) {
            return res.status(200)
            .json({ duplicate: true });
        }

        return res.status(200)
            .json({ duplicate: false });
    }
    catch(err) {
        console.error("duplicateCheck: ", err);
    }
}

export const verify_request = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.payload.id;
        const userRepository = getRepository(User);

        let user = await userRepository.findOne(userId);
        if (!user) {
            return res.status(400)
                .send({
                    'msg': 'Your account not exists.'
                });
        }
        
        
        if(!req.body.verify_type) {
            return res.status(400)
                .send({
                    'msg': 'You need to choose verify type.'
                });   
        }

        if(req.body.verify_type == 1 && !(req.body.project_name && req.body.telegram_id)) {
            return res.status(400)
                .send({
                    'msg': 'You need to send project name and telegram id.'
                });       
        }

        let kycFile: Express.Multer.File;
        if (req.files) {
            if(req.body.verify_type == 2 && !req.files['kyc']) {
                return res.status(400)
                .send({
                    'msg': 'You need to upload kyc file.'
                });
            }

            if(req.files['kyc']) {
                kycFile = req.files['kyc'][0];
            }
        }

        user.verify_type = req.body.verify_type;
        user.verify_request = 1;
        if(req.body.verify_type == 1) {
            user.project_name = req.body.project_name;
            user.telegram_id = req.body.telegram_id;
        }
        else {
            if (kycFile) {
                const awsUploader = new AWSFileUploader();
                let uploadFile = multerToFileObj(kycFile);
                uploadFile.name = `users/${user.id}/kyc`;

                if(user.kyc) 
                    await awsUploader.deleteFile(user.kyc, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    user.kyc = result['path'];
                }
            }
        }

        await userRepository.save(user);

        return res.json(user);
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while verify request'
            });
    }
}

export const update_profile = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;

        const userRepository = getRepository(User);
        let user = await userRepository.findOne(userId);
        if (!user) {
            return res.status(400)
                .send({
                    'msg': 'Your account not exists.'
                });
        }

        let bannerFile: Express.Multer.File;
        let avatarFile: Express.Multer.File;
    
        if (req.files) {
            if (req.files['banner']) {
                bannerFile = req.files['banner'][0];
            }

            if (req.files['avatar']) {
                avatarFile = req.files['avatar'][0];
            }
        }

        if (!req.body.username) {
            return res.status(400)
                .send({
                    'msg': 'You need to input username.'
                });
        }

        const username: string = req.body.username;
        let _user = await userRepository.findOne({
            where: {
                username: Raw(alias => `LOWER(${alias}) = '${username.toLowerCase()}'`)
            }
        });
        if (_user && _user.id != userId) {
            return res.status(400)
                .send({
                    'msg': 'The username is already taken.'
                });
        }
        user.username = username;

        if(req.body.email) {
            const email = req.body.email;
            _user = await userRepository.findOne({
                where: {
                    email: Raw(alias => `LOWER(${alias}) = '${email.toLowerCase()}'`)
                }
            });
            if (_user && _user.id != userId) {
                return res.status(400)
                    .send({
                        'msg': 'The email address is already taken.'
                    });
            }
            user.email = email;
        }

        if (req.body.bio) {
            user.bio = req.body.bio;
        }

        if (req.body.link_external) {
            user.link_external = req.body.link_external;
        }

        if (req.body.link_instagram) {
            user.link_instagram = req.body.link_instagram;
        }

        if (req.body.link_twitter) {
            user.link_twitter = req.body.link_twitter;
        }

        user.is_sensitive = req.body.is_sensitive == 'true' ? true : false;

        user.email_notification = req.body.email_notification == 'true' ? true : false;

        await userRepository.save(user);

        if (avatarFile || bannerFile) {
            const awsUploader = new AWSFileUploader();

            if (avatarFile) {
                let uploadFile = multerToFileObj(avatarFile);
                uploadFile.name = `users/${user.id}/avatar`;

                if(user.avatar)
                    await awsUploader.deleteFile(user.avatar, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    user.avatar = result['path'];
                }
            }

            if (bannerFile) {
                let uploadFile = multerToFileObj(bannerFile);
                uploadFile.name = `users/${user.id}/banner`;

                if(user.banner)
                    await awsUploader.deleteFile(user.banner, 3);

                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    user.banner = result['path'];
                }
            }
            
            await userRepository.save(user);
        }

        return res.json(user);
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while update profile.'
            });
    }

}

export const update_notification = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;

        const userRepository = getRepository(User);
        let user = await userRepository
            .findOne({
                where: {
                    id: userId
                },
                relations: ['notification']
            });
        if (!user) {
            return res.status(400)
                .send({
                    'msg': 'Your account not exists.'
                });
        }

        const notificationRepo = getRepository(Notification);

        let notification;
        if (user.notification) {
            notification = user.notification;
        }
        else {
            notification = new Notification();
        }

        notification.item_sold = req.body.item_sold ? req.body.item_sold : false;
        notification.auction_expiration = req.body.auction_expiration ? req.body.auction_expiration : false;
        notification.bid_activity = req.body.bid_activity ? req.body.bid_activity : false;
        notification.outbid = req.body.outbid ? req.body.outbid : false;
        notification.price_changed = req.body.price_changed ? req.body.price_changed : false;
        notification.purchase = req.body.purchase ? req.body.purchase : false;
        await notificationRepo.save(notification);

        user.notification = notification;
        await userRepository.save(user);

        return res.json(notification);
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while update notification.'
            });
    }

}

export const get_assets = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;
        let per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        let page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;

        let builder = getRepository(Asset).createQueryBuilder("asset");
        builder.leftJoinAndSelect("asset.traits", "trait");
        builder.where({
            creator: userId,
            synced: true
        });

        if (req.query.collection_id) {
            builder.andWhere({
                collection_id: parseInt(req.query.collection_id.toString())
            });
        }

        if (req.query.liked && req.query.liked == '1') {
            builder.leftJoin("asset.favs", "favs");
            builder.andWhere('`favs`.`userId` = ' + userId)
        }

        let data = await paginate(builder, page, per_page);
        return res.status(200)
            .json(data);
    }
    catch (ex) {
        console.log(ex);
        return res.status(500)
            .json({
                'msg': 'Get error while retrieve assets.'
            });
    }

}

export const get_collections = async function (req: Request, res: Response, next: NextFunction) {

    try {
        const userId = (req as any).user.payload.id;
        let per_page: number = req.query.per_page ? parseInt(req.query.per_page.toString()) : 25;
        let page: number = req.query.page ? parseInt(req.query.page.toString()) : 1;

        let builder = getRepository(Collection).createQueryBuilder();
        builder.where({
            creator: userId
        });

        let data = await paginate(builder, page, per_page);
        return res.status(200)
            .json(data);
    }
    catch {
        return res.status(500)
            .json({
                'msg': 'Get error while retrieve categories.'
            });
    }

}

export const follow = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const followerId = (req as any).user.payload.id;

        if(!req.body.id) {
            return res.status(400)
                .json({
                    msg: 'request following user id is not valid'
                })
        }

        const userId = req.body.id;

        const followRepo = getRepository(UserFollower);
        const userRepo = getRepository(User);

        let _follow = await followRepo.createQueryBuilder("user_follower")
        .where("userId = :userId and followerId = :followerId", {userId, followerId})
        .getOne();

        if(_follow) { // unfollow
            await followRepo.createQueryBuilder('user_follower')
            .where("userId = :userId and followerId = :followerId", {userId, followerId})
            .delete()
            .execute();            

            return res.status(200)
                    .json({
                        msg: 'Unfollow'
                    });
        }
        else {        //follow
            const _user = await userRepo.findOne(userId);
            if(!_user) {
                return res.status(400)
                    .json({
                        msg: 'Following user is not valid.'
                    })
            }

            const _follower = await userRepo.findOne(followerId);
            if(!_follower) {
                return res.status(400)
                    .json({
                        msg: 'Follower is not valid.'
                    })
            }

            let _newFollow: UserFollower;
            _newFollow = new UserFollower();
            _newFollow.userId = userId;
            _newFollow.followerId = followerId;

            await followRepo.save(_newFollow);

            return res.status(200)
                    .json({
                        msg: 'Follow'
                    });
        }
    }
    catch(ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while follow.'
            });
    }
}

export const like_asset = async function (req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.payload.id;
        
        if(!req.body.id) {
            return res.status(400)
                .json({
                    msg: 'request asset id is not valid'
                })
        }

        const assetId = req.body.id;

        const assetRepo = getRepository(Asset);
        const userRepo = getRepository(User);
        const favRepo = getRepository(AssetFavourite);

        const user = await userRepo.findOne(userId);
        if(!user) {
            return res.status(400)
                .json({
                    msg: 'User is not valid.'
                })
        }

        const asset = await assetRepo.findOne(assetId);
        if (!asset) {
            return res.status(400)
                .json({
                    msg: 'Asset is not valid.'
                })
        }
        
        let fav = await favRepo.findOne({
            asset: asset,
            user: user
        });

        if(fav) {
            //unlike
            await favRepo.createQueryBuilder('asset_favourite')
            .where("assetId = :assetId and userId = :userId", {assetId, userId})
            .delete()
            .execute();            

            return res.status(200)
                    .json({
                        msg: 'Delete this asset to like list.',
                        like: false,
                    });
        }
        else {
            fav = await favRepo.save({
                asset: asset,
                user: user
            });

            return res.status(200)
                    .json({
                        msg: 'Added this asset to like list.',
                        like: true
                    });
        }
    }
    catch (ex) {
        console.log(ex);
        res.status(500)
            .json({
                'msg': 'Get error while like asset.'
            });
    }
}

export const getTopSellers = async function (req: Request, res: Response, next: NextFunction) {
    try {
        /* let data = await getRepository(User).createQueryBuilder('user')
        .orderBy('user.saleSum', 'DESC')
        .skip(0)
        .take(12)
        .getMany();

        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};
            _item = {
                sellerId: item.id,
                sellerName: item.username,
                sellerAvatar: item.avatar,
                sellerSaleSum: item.saleSum,
                sellerAddress: item.public_address,
                sellerVerified: item.verified
            }

            ret_data.push(_item);
        });

        return res.json(
            extendResponse(
            { data: ret_data })
        ); */

        let sub_query = getConnection()
                        .createQueryBuilder()
                        .select('asset_activity.from as seller')
                        .addSelect('sum(asset_activity.other_price) as sum_price')
                        .from(AssetActivity, "asset_activity")
                        .where("asset_activity.activity = 'sale'")
                        .groupBy('asset_activity.from');

        
        let data = await getRepository(User).createQueryBuilder("user")
                    .leftJoin('(' + sub_query.getQuery() + ')', "tb", "LOWER(user.public_address) = LOWER(tb.seller)")
                    .addSelect("tb.sum_price")
                    .orderBy("tb.sum_price", "DESC")
                    .offset(0)
                    .limit(14)
                    .getRawMany();
        
        let ret_data = [];

        data.forEach(function(item) {
            let _item: {[k: string]: any} = {};
            _item = {
                sellerId: item.user_id,
                sellerName: item.user_username,
                sellerAvatar: item.user_avatar,
                sellerSaleSum: item.sum_price ? item.sum_price : 0,
                sellerAddress: item.user_public_address,
                sellerVerified: item.user_verified
            }

            ret_data.push(_item);
        });

        return res.json(
            extendResponse(
            { data: ret_data })
        );
    }
    catch (err) {
        console.log("getTopSellers Err: ", err);
    }
}