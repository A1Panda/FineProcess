export interface AppConfig {
  port: number;
  kgd: {
    baseUrl: string;
    apiKey: string;
    apiSecret: string;
    username: string;
    /** 公版 Web 系统登录凭据（用于获取真实工艺顺序 order_number） */
    webMobile: string;
    webPassword: string;
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
  /** 机器人插件等外部服务调用「日报数据源」接口的共享密钥（Header: X-API-Key，开放接口也复用同一把密钥） */
  pluginApiKey: string;
  /** 数据自动定时同步开关（每 5 分钟滚动同步）。开发环境设 false 只保留手动刷新，避免与生产环境同时拉取快工单打架；生产默认开启 */
  autoSync: boolean;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  kgd: {
    baseUrl: process.env.KGD_BASE_URL ?? 'https://api.kgd.ltd',
    apiKey: process.env.KGD_API_KEY ?? '',
    apiSecret: process.env.KGD_API_SECRET ?? '',
    username: process.env.KGD_USERNAME ?? '',
    webMobile: process.env.KGD_WEB_MOBILE ?? '',
    webPassword: process.env.KGD_WEB_PASSWORD ?? '',
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
  autoSync: process.env.KGD_AUTO_SYNC !== 'false',
});
