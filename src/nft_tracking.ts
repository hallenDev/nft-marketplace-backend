import * as cron from 'node-cron';
import { createConnection, getRepository } from "typeorm";
import { NFTAddressList } from './entity/NFTAddressList';
import { Collection } from './entity/Collection';
import { Asset } from './entity/Asset';
import { ethers } from 'ethers';
import { provider } from './config';
import * as abi from "./core/abis/abi.json"

createConnection().then(async connection => {
    const handleTransferEvent = async () => {
        const nftAddressListRepo = getRepository(NFTAddressList);
        const assetRepository = getRepository(Asset);
        
        //get contract address list
        const addresses = await nftAddressListRepo.find();

        console.log("addresses", await provider.getBlockNumber());

        var latestblocknumber = await provider.getBlockNumber() - 10;

        const getLatestEvent = async () => {
            for (var j = 0; j < addresses.length; j++) {
                let blockNumber = await provider.getBlockNumber();
                var itemContract = new ethers.Contract(addresses[j].tokenAddress, abi, provider);
                var filter = itemContract.filters.Transfer();

                var events = await itemContract.queryFilter(
                    filter,
                    latestblocknumber + 1,
                    blockNumber
                );

                latestblocknumber = blockNumber;
                console.log("events", events);

                if (events.length > 0) {
                    for (const ev of events) {
                        console.log("from", ev.args.from, "to", ev.args.from, "tokenID", ev.args.tokenId);

                        if(!addresses[j].is_voxel) {
                        }
                        else {
                        }
                        /* 
                        var token = await assetRepository.findOne(
                            {
                                where: {
                                    token_id: ev.args.tokenId,
                                    collection: addresses[j].tokenAddress
                                }
                            }
                        );

                        if(!token){
                            const asset = new Asset();
                            const collection = new Collection();
                            collection.contract_address = addresses[j].tokenAddress;
                            asset.token_id = ev.args.tokenId;
                            asset.owner_of = ev.args.to;
                            asset.collection = collection;
            
                            await assetRepository.save(asset);
                        }
                        else{
                            token.owner_of = ev.args.to;
                            await assetRepository.save(token);
                        }
                        console.log("addressRepository", assetRepository); */
                    }
                }
            }
        }

        cron.schedule("*/15 * * * * *", () => {
            getLatestEvent();
        });
    }

    handleTransferEvent();
});