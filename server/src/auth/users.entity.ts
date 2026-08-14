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

  /** 快工单岗位名（如 生产工/生产班长/生产主管/质检员），用于后续任务分配与权限管理 */
  @Column({ name: 'role_name', type: 'varchar', length: 64, nullable: true, default: '' })
  roleName: string | null;

  /** 快工单部门路径（如 包装部/打磨/A组），同步时以快工单为准刷新 */
  @Column({ name: 'department_path_names', type: 'varchar', length: 255, nullable: true, default: '' })
  departmentPathNames: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
