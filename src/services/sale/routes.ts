import * as express from 'express';
import jwt = require('express-jwt');
import { jwt_config as config } from '../../config';
import * as controller from './controller';

export const saleRouter = express.Router();

saleRouter.route('/buy-item').post(jwt(config), controller.buyItem);
saleRouter.route('/accept-item').post(jwt(config), controller.acceptItem);
saleRouter.route('/register-buytxhash').post(jwt(config), controller.registerBuyTxHash);
saleRouter.route('/register-accepttxhash').post(jwt(config), controller.registerAcceptTxHash);
saleRouter.route('/register-addtxhash').post(jwt(config), controller.registerAddTxHash);