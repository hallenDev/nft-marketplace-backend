import axios from "axios";
import { getAddress } from "ethers/lib/utils";
import { getConnection, getRepository } from "typeorm";

import { Asset } from "./entity/Asset";
import { Trait } from "./entity/Trait";
import { Log } from "./entity/Log";
import { AssetActivity } from "./entity/AssetActivity";
import { Collection } from "./entity/Collection";
import { morlias_config } from "./config";
import { getLog, trimTokenUri } from "./utils";
import { ActivityType, SaleType } from "./models/enums";
import { AWSFileUploader } from "./services/upload/aws";
import { User } from "./entity/User";

export const validateSaleEndDate = async function () {
    try {
        let currentTime = Math.floor(Date.now() / 1000);
        await getConnection()
            .createQueryBuilder()
            .update(Asset)
            .set({
                price: 0,
                on_sale: false,
                sale_end_date: 0,
                sale_type: SaleType.Default
            })
            .where("on_sale = true and sale_type = 1 and sale_end_date < :currentTime", {currentTime})
            .execute();
    }
    catch(ex) {
        console.error("validateSaleEndDate Err: ", ex);
    }
}

const parseMetadata = function (asset: Asset, metadata: any) {

    if (!metadata) {
        return asset;
    }

    if (metadata['name']) {
        asset.name = metadata['name'];
    }
    if (metadata['description']) {
        asset.description = metadata['description'];
    }
    if (metadata['image']
        || metadata['image_url']) {
        asset.raw_image = metadata['image'] || metadata['image_url'];
    }
    if (metadata['animation']
        || metadata['animation_url']) {
        asset.raw_animation = metadata['animation'] || metadata['animation_url'];
    }

    if (metadata['attributes']) {
        let traits = new Array<Trait>();
        const attributes = metadata['attributes'];
        for (const attribute of attributes) {
            let trait = new Trait();
            trait.trait_type = attribute['trait_type'];
            trait.value = attribute['value'];
            traits.push(trait);
        }

        asset.traits = traits;
    }

    return asset;
}

export const import_collection = async function () {

    try {

        const userRepository = getRepository(User);
        const assetRepository = getRepository(Asset);
        const collectionRepo = getRepository(Collection);
        const activityRepo = getRepository(AssetActivity);

        let collection = await collectionRepo.findOne({
            where: {
                synced: false,
                is_voxel: false
            },
            relations: ['creator']
        });
        if (!collection) {
            return;
        }

        const _assets = await assetRepository.createQueryBuilder('asset')
            .select('asset.token_id AS id')
            .where('asset.collectionId = ' + collection.id)
            .getRawMany();
        const tokenIds = _assets.map((_asset) => {
            return _asset['id'];
        })

        let count = 0;
        let total = 0;
        let cursor = "";

        while (true) {
            let nftUrl = `https://deep-index.moralis.io/api/v2/nft/${collection.contract_address}/owners?chain=0x${collection.chain_id.toString(16)}&format=decimal`;
            if (cursor != "") {
                nftUrl += "&cursor=" + cursor;
            }
            if (total != 0) {
                nftUrl += "&offset=" + total;
            }

            const resp = await axios({
                url: nftUrl,
                method: "GET",
                headers: {
                    "X-API-Key": morlias_config.apiKey
                }
            });
            if (resp.status != 200) {
                break;
            }

            const nftsRes = resp.data;
            cursor = nftsRes['cursor'];
            if (cursor == "") {
                break;
            }

            let assets = [];
            const nfts: Array<any> = nftsRes['result'];
            for (let idx = 0; idx < nfts.length; idx++) {
                const nft = nfts[idx];
                const tokenId = nft['token_id'];
                if (tokenId in tokenIds) {
                    continue;
                }

                let asset = new Asset();
                asset.creator = userRepository.create({
                    id: collection.creator.id
                });
                asset.collection = collectionRepo.create({
                    id: collection.id
                });
                asset.name = `${collection.name} #${tokenId}`;
                asset.token_id = tokenId;
                asset.owner_of = getAddress(nft['owner_of']);
                asset.token_uri = nft['token_uri'];

                if (nft['metadata']) {
                    const metadata = JSON.parse(nft['metadata']);
                    asset = parseMetadata(asset, metadata);
                    asset.synced = true;
                }
                else if (!nft['token_uri']) {
                    asset.synced = true;
                }

                asset.activities = [];
                asset.activities.push(activityRepo.create({
                    to: asset.owner_of,
                    activity: ActivityType.Mint,
                    quantity: nft['amount'],
                    create_date: Math.floor(Date.now() / 1000)
                }));

                count++;
                assets.push(asset);
            }

            await assetRepository.save(assets);
        }

        collection.synced = true;
        await collectionRepo.save(collection);

        const logRepo = getRepository(Log);
        await logRepo.save({
            msg: getLog(`${collection.name} collection synced with ${count} assets.`)
        });
    }
    catch (ex) {
        // console.log(ex);
    }
}

export const import_assets = async function () {

    try {
        const logRepo = getRepository(Log);

        const assetRepository = getRepository(Asset);

        let assets = await assetRepository.createQueryBuilder()
            .loadAllRelationIds({
                relations: ['collection']
            })
            .where('(raw_image IS NOT NULL AND image IS NULL) OR (synced = 0)')
            .orderBy('created_at', "ASC")
            .take(100)
            .getMany();
        if (assets.length == 0) {
            return;
        }

        let count = 0;
        for (let asset of assets) {
            try {

                if (!asset.synced) {
                    if (asset['token_uri']) {
                        // console.log(asset.name);
                        const { data } = await axios.get(trimTokenUri(asset['token_uri']));
                        asset = parseMetadata(asset, data);
                        await assetRepository.save(asset);
                    }
                }

                const { data } = await axios.get(trimTokenUri(asset.raw_image), {
                    responseType: 'arraybuffer'
                });

                const awsUploader = new AWSFileUploader();
                const uploadFile = {
                    name: `assets/${asset['collection']}/${asset.token_id}`,
                    type: "image/png",
                    content: data,
                    size: data.size,
                    extension: 'png',
                };
                const result = await awsUploader.upload(uploadFile);
                if (result['path']) {
                    asset.image = result['path'];
                }

                count++;
                await assetRepository.save(asset);
            }
            catch (ex) {
                // console.log(ex);
            }
        }

        if (count > 0) {
            await logRepo.save({
                msg: getLog(`${count} images uploaded.`)
            });
        }
    }
    catch (ex) {
        // console.log(ex);
    }
}
