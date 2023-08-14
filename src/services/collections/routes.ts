import * as express from 'express';
import jwt = require('express-jwt');
import * as multer from 'multer';
import { jwt_config as config } from '../../config';
import * as controller from './controller';

export const colRouter = express.Router();


/** GET /api/collections */
colRouter.route('/').get(controller.get_collections);
colRouter.route('/search').get(controller.search_collections);

colRouter.route('/activities/:id').get(controller.getActivity);

colRouter.route('/:id').get(controller.get_collection);

/** POST /api/collections */
colRouter.route('/').post(jwt(config), multer().fields([
    {
        name: 'featured',
        maxCount: 1
    }, {
        name: 'avatar',
        maxCount: 1
    }, {
        name: 'banner',
        maxCount: 1
    }
]), controller.save_collection);

colRouter.route('/import').post(jwt(config), controller.import_collection);

colRouter.route('/hot-collections').post(controller.getHotCollections);

colRouter.route('/get-ranking').post(controller.getRanking);

colRouter.route('/request-verify').post(jwt(config), controller.requestVerify);