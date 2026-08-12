import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: 'localhost', user: 'kgd', password: 'kgd123456', database: 'kgd_process',
});
const [tokens] = await db.query('SELECT user_token FROM kgd_token WHERE id=1');
const token = tokens[0]?.user_token;

const call = async (params) => {
  const r = await fetch('https://api.kgd.ltd/open_api/report_work_record/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TOKEN': String(token) },
    body: JSON.stringify({ pageNo: 1, pageSize: 3, ...params }),
  });
  const j = await r.json();
  const row = j.data?.[0];
  return { count: j.count, msg: j.message, firstId: row?.id, lastId: j.data?.at(-1)?.id };
};

// 边界验证
console.log('未来 start:', JSON.stringify(await call({ report_time_start: '2026-08-12 00:00:00', report_time_end: '2026-08-12 23:59:59' })));
console.log('仅今天:', JSON.stringify(await call({ report_time_start: '2026-08-11 00:00:00', report_time_end: '2026-08-11 23:59:59' })));
// 最近 1 小时窗口（小窗口）
const now = new Date();
const pad = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
const h1 = new Date(now.getTime() - 60*60*1000);
console.log('近1小时:', JSON.stringify(await call({ report_time_start: pad(h1), report_time_end: pad(now) })));
// 仅 start 无 end
console.log('仅start:', JSON.stringify(await call({ report_time_start: '2026-08-11 00:00:00' })));
await db.end();
