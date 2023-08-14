import * as express from 'express';
import jwt = require('express-jwt');
import { jwt_config as config } from '../../config';
import multer = require('multer');
import * as controller from './controller';

export const assetRouter = express.Router();

/** GET /api/assets */
assetRouter.route('/').get(controller.get_assets);
assetRouter.route('/user_assets').get(jwt(config), controller.get_user_get_assets);

assetRouter.route('/featured').get(controller.featured_assets);

assetRouter.route('/:id').get(controller.get_asset);
assetRouter.route('/users/:id').get(jwt(config), controller.getUserAsset);

assetRouter.route('/new-items').post(controller.getNewItems);

assetRouter.route('/trending-items').post(controller.getTrendingItems);

assetRouter.route('/history').post(controller.getHistory);

assetRouter.route('/more-items').post(controller.getMoreItemsInCollection);

assetRouter.route('/add-category').post(controller.addCategory);

assetRouter.route('/get-banners').post(controller.getBanners);

assetRouter.route('/update-owner').post(controller.updateOwner);
// assetRouter.route('/upload_ipfs').post(multer().single('image'), controller.upload_ipfs);

// assetRouter.route('/').post(jwt(config), multer().single('image'), controller.save_asset);

assetRouter.route('/').post(jwt(config), multer().fields([
    {
        name: 'asset_preview',
        maxCount: 1
    },
    {
        name: 'asset',
        maxCount: 1
    },
    {
        name: 'preview',
        maxCount: 1
    },
    {
        name: 'isMTLForm',
        maxCount: 1
    }, 
    {
        name: 'isTextureForm',
        maxCount: 15
    }
]), controller.save_asset);


assetRouter.route('/upload-asset').post(multer().fields([
    {
        name: 'asset',
        maxCount: 10
    }
]), controller.uploadAsset);


assetRouter.route('/mint').post(jwt(config), controller.mint_asset);

assetRouter.route('/list').post(jwt(config), controller.list_asset);
assetRouter.route('/auction').post(jwt(config), controller.auctionItem);

assetRouter.route('/cancel-list').post(jwt(config), controller.cancelList);

assetRouter.route('/change-price').post(jwt(config), controller.changePrice);

assetRouter.route('/notifications').post(jwt(config), controller.getNotifications);

assetRouter.route('/remove-notification').post(jwt(config), controller.removeNotification);
assetRouter.route('/remove-all-notification').post(jwt(config), controller.removeAllNotification);
assetRouter.route('/refresh-item').post(jwt(config), controller.refreshItem);