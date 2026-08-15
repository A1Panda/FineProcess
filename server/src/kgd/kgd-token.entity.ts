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

  /** 公版 Web 系统会话凭证（数据库唯一事实源，生产/开发多实例共享同一账号，避免各自登录互顶） */
  @Column({ name: 'web_token', length: 500, default: '' })
  webToken: string;

  /** 公版 Web 登录返回的企业 ID */
  @Column({ name: 'web_enterprise_id', length: 64, default: '' })
  webEnterpriseId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
