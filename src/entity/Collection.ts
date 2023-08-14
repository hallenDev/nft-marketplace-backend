import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { Category } from "./Category";
import { User } from "./User";


@Entity()
export class Collection {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({
        nullable: true
    })
    symbol: string;

    @Column({
        type: 'text',
        nullable: true
    })
    description: string;

    @Column({
        nullable: true
    })
    avatar: string;

    @Column({
        nullable: true
    })
    banner: string;

    @Column({
        nullable: true
    })
    featured: string;

    @Column({
        nullable: true
    })
    contract_address: string;

    @Column({
        default: 1
    })
    chain_id: number;

    @Column({
        default: 0
    })
    verify_request: number;

    @Column({
        default: false
    })
    synced: boolean;

    @Column({
        default: false
    })
    is_1155: boolean;

    @Column({
        default: false
    })
    is_721: boolean;

    @Column({
        default: false
    })
    is_voxel: boolean;

    @Column({
        nullable: true
    })
    website: string;

    @Column({
        nullable: true
    })
    twitter: string;

    @Column({
        nullable: true
    })
    instagram: string;

    @Column({
        nullable: true
    })
    telegram: string;

    @Column({
        nullable: true
    })
    discord: string;

    @Column({
        type: 'double',
        nullable: true,
        default: 0
    })
    volume: number;

    @Column({
        default: false
    })
    verified: boolean;

    @CreateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP(6)", select: false })
    created_at: Date;

    @UpdateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP(6)", onUpdate: "CURRENT_TIMESTAMP(6)", select: false })
    updated_at: Date;


    @ManyToOne(() => User)
    creator: User;

    @ManyToOne(() => Category)
    category: Category;
}
