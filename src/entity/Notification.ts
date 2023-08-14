import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from "typeorm";
import { User } from "./User";


@Entity()
export class Notification {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        default: false
    })
    item_sold: boolean;

    @Column({
        default: false
    })
    auction_expiration: boolean;

    @Column({
        default: false
    })
    bid_activity: boolean;

    @Column({
        default: false
    })
    outbid: boolean;

    @Column({
        default: false
    })
    price_changed: boolean;

    @Column({
        default: false
    })
    purchase: boolean;


    @OneToOne(() => User)
    @JoinColumn()
    user: User;
}
