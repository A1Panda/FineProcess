import mysql from 'mysql2/promise';

const db = await mysql.createConnection({ host: 'localhost', user: 'kgd', password: 'kgd123456', database: 'kgd_process' });
const [tokens] = await db.query('SELECT * FROM kgd_token ORDER BY id DESC LIMIT 1');
const token = tokens[0]?.user_token;
if (!token) { console.log('未找到凭证'); process.exit(1); }

const base = {
  produce_craft_id: '999999999',
  report_user_id: '101809',
  valid_num: '1',
  waste_num: '0',
  is_finish: 2,
};

// 探测报工附加内容可能的参数名（均用非法任务ID，安全）
const cases = [
  ['fieldValueList(含field_value)', { fieldValueList: [{ id: 104303898, field_name: 'e___kehubianma', field_value: 'TEST-X' }] }],
  ['field_list', { field_list: [{ field_id: 104303898, value: 'TEST-X' }] }],
  ['additional_content', { additional_content: '附加内容测试' }],
  ['extra_content', { extra_content: '附加内容测试' }],
  ['attachment_list(真实格式猜测)', { attachment_list: [{ name: 'a.jpg', url: 'http://x/a.jpg' }] }],
  ['attachment_list(内部字段名)', { attachment_list: [{ file_name: 'a.jpg', file_url: 'http://x/a.jpg', type: 'image' }] }],
];

for (const [name, extra] of cases) {
  const resp = await fetch('https://api.kgd.ltd/open_api/report_work_record/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TOKEN': token },
    body: JSON.stringify({ ...base, ...extra }),
  });
  const j = await resp.json();
  console.log(`${name.padEnd(42)} → success=${j.success}  msg=${j.msg ?? ''}`);
}
await db.end();
