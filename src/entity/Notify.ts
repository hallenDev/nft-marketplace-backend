import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { User } from "./User";

@Entity()
export class Notify {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    create_date: number;
    
    @Column({
        nullable: true
    })
    msg: string;
    
    @Column()
    type: string;

    @Column({
        default: true
    })
    unread: boolean;

    @Column({
        nullable: true
    })
    link: string;

    @Column()
    user: string;

    @Column()
    from: string;

    @Column({
        type: 'double',
        nullable: true
    })
    price: number;
}
