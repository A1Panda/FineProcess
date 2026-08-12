import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: 'localhost', user: 'kgd', password: 'kgd123456', database: 'kgd_process',
});
const [tokens] = await db.query('SELECT user_token FROM kgd_token WHERE id=1');
const token = tokens[0]?.user_token;
if (!token) { console.log('NO TOKEN'); process.exit(1); }

const call = async (params) => {
  const r = await fetch('https://api.kgd.ltd/open_api/report_work_record/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TOKEN': String(token) },
    body: JSON.stringify({ pageNo: 1, pageSize: 5, ...params }),
  });
  const j = await r.json();
  return { count: j.count, msg: j.message, sample: j.data?.[0] ? { id: j.data[0].id, keys: Object.keys(j.data[0]) } : null };
};

console.log('BASE:', JSON.stringify(await call({})));
console.log('start/end_time:', JSON.stringify(await call({ start_time: '2026-08-10 00:00:00', end_time: '2026-08-11 23:59:59' })));
console.log('begin/end_time:', JSON.stringify(await call({ begin_time: '2026-08-10 00:00:00', end_time: '2026-08-11 23:59:59' })));
console.log('create_start/end:', JSON.stringify(await call({ create_start_time: '2026-08-10 00:00:00', create_end_time: '2026-08-11 23:59:59' })));
console.log('start_date/end_date:', JSON.stringify(await call({ start_date: '2026-08-10', end_date: '2026-08-11' })));
console.log('reportTime:', JSON.stringify(await call({ report_time_start: '2026-08-10 00:00:00', report_time_end: '2026-08-11 23:59:59' })));
await db.end();
