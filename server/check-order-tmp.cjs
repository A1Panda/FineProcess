const m = require('mysql2/promise');
(async () => {
  const c = await m.createConnection({ host: 'localhost', port: 3306, user: 'kgd', password: 'kgd123456', database: 'kgd_process' });
  // 找几张多工序的加工单，展示各自 task_id 升序 = 各自的工序顺序
  const [rows] = await c.query(
    `SELECT bill_code, GROUP_CONCAT(craft_name ORDER BY task_id ASC SEPARATOR '->') AS chain, COUNT(*) AS cnt
     FROM kgd_task_cache
     GROUP BY bill_code
     HAVING COUNT(*) >= 2
     ORDER BY chain, bill_code`
  );
  // 按链模式去重统计
  const patterns = new Map();
  const samples = new Map();
  for (const r of rows) {
    const list = patterns.get(r.chain) ?? [];
    list.push(r.bill_code);
    patterns.set(r.chain, list);
    if (!samples.has(r.chain)) samples.set(r.chain, r.bill_code);
  }
  console.log(`共 ${rows.length} 张多工序加工单，${patterns.size} 种不同的工序链顺序：`);
  for (const [chain, codes] of [...patterns].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${codes.length}张] ${chain}  例: ${codes[0]}`);
  }
  console.log('\n不同顺序的样例单据：');
  for (const [chain, code] of [...samples].slice(0, 15)) {
    console.log(' ', code, '|', chain);
  }
  await c.end();
})();
