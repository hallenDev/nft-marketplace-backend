import { NextFunction, Request, Response } from "express";
import { getRepository } from "typeorm";
import { Category } from "../../entity/Category";

export const get_categories = function (req: Request, res: Response, next: NextFunction) {

    const categoryRepository = getRepository(Category);

    return categoryRepository.find()
        .then((categories) => res.json(categories))
        .catch(err => {
            res.status(500)
                .json({
                    'msg': 'Get error while list categories.'
                });
        });

}