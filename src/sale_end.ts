import { createConnection, getRepository, getConnection } from "typeorm";
import * as cron from 'node-cron';
import { Asset } from "./entity/Asset";
import { SaleType } from "./models/enums";

createConnection().then(async connection => { 

    const validateSaleEndDate = async function () {
        
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
        catch(err) {
            console.error("validateSaleEndDate Err: ", err);
        }        
        
    }

    await validateSaleEndDate();

    cron.schedule('* * * * *', (async () => {
        await validateSaleEndDate();
    }))

});