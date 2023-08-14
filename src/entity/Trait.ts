import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from "typeorm";
import { Asset } from "./Asset";


@Entity()
export class Trait {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    trait_type: string;

    @Column()
    value: string;

    @Column({
        default: 'text'
    })
    display_type: string;

    @Column({
        default: ''
    })
    max_value: string;

    @ManyToOne(type => Asset, asset => asset.traits)
    asset: Asset;
}
