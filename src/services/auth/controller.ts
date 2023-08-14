import { NextFunction, Request, Response } from "express";
import { getRepository } from "typeorm";
import { isAddress } from "web3-utils";
import { bufferToHex } from 'ethereumjs-util';
import { recoverPersonalSignature } from 'eth-sig-util';
import * as jwt from 'jsonwebtoken';

import { User } from "../../entity/User";
import { getNonce } from "../../utils";
import { jwt_config as config } from "../../config";

export const auth = async function (req: Request, res: Response, next: NextFunction) {
    
    const userRepository = getRepository(User);

    let publicAddress = req.body.public_address;
    if (!isAddress(publicAddress)) {
        return res.status(400)
            .send({
                error: 'Your address not valid.'
            });
    }

    let signature = req.body.signature;
    if (!signature) {
        return res.status(400)
            .send({
                error: 'Your signature empty.'
            });
    }

    try {
        // Find existing public address
        let user = await userRepository.createQueryBuilder('user')
            .select(['user.id', 'user.nonce'])
            .where({
                public_address: publicAddress
            })
            .getOne();
        if (!user) {
            return res.status(401)
                .send({
                    error: 'Your address not exists.'
                });
        }

        // Validation sign message
        let signMsg =
            `Welcome to VoxelX!
This request will not trigger a blockchain transaction or cost any gas fees.
Your authentication status will reset after 24 hours.
Wallet address:${publicAddress}
Nonce:${user.nonce}`;

        const msgBufferHex = bufferToHex(Buffer.from(signMsg, 'utf8'));
        const address = recoverPersonalSignature({
            data: msgBufferHex,
            sig: signature,
        });

        if (address.toLowerCase() !== publicAddress.toLowerCase()) {
            return res.status(401).send({
                error: 'Signature verification failed',
            });
        }

        // Generate new nonce
        user.nonce = getNonce();
        userRepository.save(user)
            .then((user: User) => {
                // Create JWT
                let accessToken = jwt.sign(
                    {
                        payload: {
                            id: user.id,
                            publicAddress
                        }
                    },
                    config.secret,
                    {
                        algorithm: 'HS256'
                    }
                );

                return res.json({
                    accessToken
                });
            })
            .catch(err => {
                return res.status(500)
                    .json({
                        'msg': 'Get error while generate token.'
                    });
            });
    }
    catch {
        return res.status(500)
            .json({
                'msg': 'Get error while process authentication.'
            });
    }


};