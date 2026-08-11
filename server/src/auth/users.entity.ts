import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 本地账号，与快工单用户（kgd_user_id）一一对应 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  /** 快工单用户ID */
  @Column({ name: 'kgd_user_id', unique: true })
  kgdUserId: number;

  /** 登录名（默认取快工单用户名） */
  @Column({ unique: true })
  username: string;

  /** 姓名 */
  @Column()
  name: string;

  /** 登录密码（bcrypt 哈希） */
  @Column({ select: false })
  password: string;

  /** 角色：admin / worker */
  @Column({ default: 'worker' })
  role: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
