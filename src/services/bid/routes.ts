import * as express from 'express';
import jwt = require('express-jwt');
import { jwt_config as config } from './../../config';
import * as controller from './controller';

export const bidRouter = express.Router();

bidRouter.route('/place-bid').post(jwt(config), controller.placeBid);
bidRouter.route('/asset-bids').post(controller.getBidsForAsset);
bidRouter.route('/cancel-bid').post(jwt(config), controller.cancelBid);
bidRouter.route('/asset-bid-list').post(controller.assetBidList);
bidRouter.route('/asset-sell-list').post(controller.assetSellList);