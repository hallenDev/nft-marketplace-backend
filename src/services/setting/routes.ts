import * as express from 'express';
import * as controller from './controller';

export const settingRouter = express.Router();

settingRouter.route('/categories').get(controller.get_categories);