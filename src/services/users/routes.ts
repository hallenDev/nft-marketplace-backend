import * as express from 'express';
import jwt = require('express-jwt');
import multer = require('multer');
import { jwt_config as config } from '../../config';
import * as controller from './controller';

export const userRouter = express.Router();

userRouter.route('/').get(controller.get_user);

userRouter.route('/update-balance').get(controller.updateBalance);

userRouter.route('/connect').get(controller.connect);

userRouter.route('/profile').get(jwt(config), controller.get_profile);



userRouter.route('/profile').post(jwt(config), multer().fields([
    {
        name: 'banner',
        maxCount: 1
    }, {
        name: 'avatar',
        maxCount: 1
    }
]), controller.update_profile);

userRouter.route('/verify-request').post(jwt(config), multer().fields([
    {
        name: 'kyc',
        maxCount: 1
    }
]), controller.verify_request);

userRouter.route('/notification').post(jwt(config), controller.update_notification);

userRouter.route('/assets').get(jwt(config), controller.get_assets);
userRouter.route('/collections').get(jwt(config), controller.get_collections);

userRouter.route('/like').post(jwt(config), controller.like_asset);

userRouter.route('/top-sellers').post(controller.getTopSellers);

userRouter.route('/follow').post(jwt(config), controller.follow);

userRouter.route('/duplicate-check').post(jwt(config), controller.duplicateCheck);