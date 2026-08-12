export interface AppConfig {
  port: number;
  kgd: {
    baseUrl: string;
    apiKey: string;
    apiSecret: string;
    username: string;
  };
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  jwtSecret: string;
  /** 外部人员每日编码服务器（编码考勤系统） */
  externalEmployeeApi: string;
  /** 机器人插件等外部服务调用「日报数据源」接口的共享密钥（Header: X-API-Key） */
  pluginApiKey: string;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  kgd: {
    baseUrl: process.env.KGD_BASE_URL ?? 'https://api.kgd.ltd',
    apiKey: process.env.KGD_API_KEY ?? '',
    apiSecret: process.env.KGD_API_SECRET ?? '',
    username: process.env.KGD_USERNAME ?? '',
  },
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USERNAME ?? 'kgd',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'kgd_process',
  },
  jwtSecret: process.env.JWT_SECRET ?? 'kgd-process-secret',
  externalEmployeeApi: process.env.EXTERNAL_EMPLOYEE_API ?? 'http://192.168.110.100:3100',
  pluginApiKey: process.env.PLUGIN_API_KEY ?? '',
});
