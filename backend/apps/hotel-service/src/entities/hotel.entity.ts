import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hotels')
export class Hotel {
  @PrimaryGeneratedColumn()
  hotelId!: number;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column({ name: 'phone_number' })
  phoneNumber!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
