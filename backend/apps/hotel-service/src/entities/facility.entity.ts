import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('facilities')
export class Facility {
  @PrimaryGeneratedColumn()
  facilityId!: number;

  @Column({ name: 'hotel_id' })
  hotelId!: number;

  @Column()
  name!: string;

  @Column()
  price!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
