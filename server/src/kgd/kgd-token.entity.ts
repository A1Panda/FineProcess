import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 快工单凭证本地缓存，重启后复用避免重复登录 */
@Entity('kgd_token')
export class KgdToken {
  @PrimaryColumn({ default: 1 })
  id: number;

  @Column({ name: 'access_token', length: 500 })
  accessToken: string;

  @Column({ name: 'user_token', length: 500 })
  userToken: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
