import * as express from 'express';

import { authRouter } from './auth';
import { userRouter } from './users';
import { colRouter } from './collections';
import { assetRouter } from './assets';
import { settingRouter } from './setting';
import { bidRouter } from './bid';
import { saleRouter } from './sale';

export const services = express.Router();

services.use('/auth', authRouter);
services.use('/users', userRouter);
services.use('/collections', colRouter);
services.use('/assets', assetRouter);
services.use('/setting', settingRouter);
services.use('/bid', bidRouter);
services.use('/sale', saleRouter);