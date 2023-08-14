import { createClient } from 'redis';
import { REDIS_CONFIG } from "./../config";

class CRedis {
    redisClient: any;
    type: string;

    constructor() {
        this.redisClient = null;
    }

    async init(redisType) {
        this.type = redisType;

        this.redisClient = createClient({
            url: REDIS_CONFIG.HOST
        });

        await this.redisClient.connect();
    }

    onError() {
        this.redisClient.on('error', (err) => {
            console.log('redisClient error :' + err);
        });
    }

    onConnect() {
        this.redisClient.on('connect', () => {
            console.log('redisClient connect');
        });
    }

    onReady() {
        this.redisClient.on('ready', () => {
            console.log('redisClient ready');
            this.redisClient.select(this.type == 'txn' ? REDIS_CONFIG.TXN_DB : REDIS_CONFIG.BLOCKNUMBER_DB, (err) => {
                console.log('redisClient select :' + '(' + this.redisClient.selected_db + ')..' + err);
            });
        });             
    }

    getRedisClient()     {
        return this.redisClient;
    }
}

let redisHandle = new CRedis();
export default redisHandle;