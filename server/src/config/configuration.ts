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
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
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
});
