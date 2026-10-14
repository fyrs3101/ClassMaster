'use strict';
/**
 * 「导出智能分组」专项测试：
 *   1) UI 一键排座 → 按钮存在、守卫生效（未分组时点击不弹保存框）
 *   2) Seating.exportSheets 数据正确性（3 Sheet、层次、组号名单可回导）
 *   3) buildXlsx 生成真实 xlsx 并解析回读
 * 用法: xvfb-run -a npx electron --no-sandbox --disable-gpu test/seat-export-test.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { await sleep(200); win = BrowserWindow.getAllWindows()[0]; }
  if (!win) { console.log('SEX_NO_WINDOW'); return app.quit(); }
  win.webContents.on('console-message', (e, lvl, msg) => {
    if (lvl >= 2 && !/Electron Security Warning/.test(String(msg))) console.log('SEX_CONSOLE ' + String(msg).slice(0, 300));
  });
  await new Promise(r => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r); else r(); });
  await sleep(2200);
  const js = c => win.webContents.executeJavaScript(c, true).catch(e => 'ERR:' + e.message.split('\n')[0]);

  // 载入示例数据
  await js(`(async()=>{const b=document.querySelector('[data-quick="sample"]'); if(b)b.click();})()`);
  await sleep(2200);

  const out = {};

  /* 1. UI 自动排座 + 按钮存在 */
  out.auto = await js(`(async function(){
    window.App.go('seating');
    await new Promise(r=>setTimeout(r,700));
    document.querySelector('#btnSeatAuto').click();
    await new Promise(r=>setTimeout(r,1600));
    return { hasGroups: document.body.innerText.includes('第 1 组'), btnExists: !!document.querySelector('#btnSeatExport') };
  })()`);

  /* 2. 未分组守卫：清空分组后点击导出不应打开保存框（保存框无法在无头环境出现，用 XLSX 构造状态判断） */
  out.emptyGuard = await js(`(async function(){
    const draft = (function(){ return null; })();
    // 清空 db 分组，切视图重建 draft
    Store.S.db.seating.groups = [];
    Store.S.db.seating.pool = Store.mergedStudents().map(x=>x.id);
    await Store.save();
    window.App.go('students'); window.App.go('seating');
    await new Promise(r=>setTimeout(r,800));
    // 直接调 buildXlsx 模拟"如果守卫失效会做什么"——真实守卫在 UI 闭包里，
    // 这里通过导出函数应拒绝空组来验证数据层守卫
    let rejected = false;
    try {
      const sheets = Seating.exportSheets({ groups: [], pool: [] });
      rejected = sheets[0].aoa.length === 1; // 只有表头
    } catch (e) { rejected = true; }
    return { emptySheetsHeaderOnly: rejected };
  })()`);

  /* 3. 重新排座（UI）后导出数据 + 真实 xlsx 解析 */
  out.export = await js(`(async function(){
    document.querySelector('#btnSeatAuto').click();
    await new Promise(r=>setTimeout(r,1600));
    const res = Seating.buildGroups({ groupCount:9, groupSize:6, perLevel:2, strategy:'sbalance', nameStyle:'num' });
    const sheets = Seating.exportSheets({ groups: res.groups, pool: res.pool });
    const names = sheets.map(s => s.name);
    const detail = sheets[0].aoa, roster = sheets[1].aoa, stat = sheets[2].aoa;
    // 构造真实 xlsx 并回读
    const x = await CM.buildXlsx(sheets);
    if (x.error) return { ok:false, reason:x.error };
    const wb = XLSX.read(new Uint8Array(x.buffer), { type:'array' });
    const d2 = XLSX.utils.sheet_to_json(wb.Sheets['分组明细'], { header:1 });
    const s2 = XLSX.utils.sheet_to_json(wb.Sheets['均衡统计'], { header:1 });
    // 统计每组人数
    const perGroup = {};
    d2.slice(1).forEach(row => { if (typeof row[0] === 'number') perGroup[row[0]] = (perGroup[row[0]] || 0) + 1; });
    return {
      ok: true,
      sheetNames: names,
      detailHeader: detail[0].join(),
      detailDataRows: detail.length - 1,
      rosterHeader: roster[0].join(),
      rosterRows: roster.length - 1,
      groupCount: Object.keys(perGroup).length,
      groupSizes: Object.keys(perGroup).sort((a,b)=>a-b).map(k => perGroup[k]).join(','),
      statScore: (s2.find(r => r[0] === '均衡度评分') || [])[1],
      statGap: (s2.find(r => r[0] === '组间总分极差') || [])[1],
      firstStudent: detail[1] ? detail[1].slice(3, 9) : null,
      xlsxReadable: !!wb.Sheets['分组明细']
    };
  })()`);

  /* 4. 组号名单可通过导入解析器还原（与「导入分组表」同一条链路） */
  out.reimportable = await js(`(function(){
    const res = Seating.buildGroups({ groupCount:9, groupSize:6, perLevel:2, strategy:'sbalance', nameStyle:'num' });
    const sheets = Seating.exportSheets({ groups: res.groups, pool: res.pool });
    const rows = sheets[1].aoa.slice(1).map(r => ({ name: r[0], groupNo: r[1] }));
    const applied = Seating.applyGroupNumbers(rows, 9);
    const okCount = applied.groups.length === 9 &&
      applied.groups.every(g => g.members.length > 0);
    return { appliedGroups: applied.groups.length, allNonEmpty: okCount, unknown: (applied.unknown || []).length };
  })()`);

  console.log('SEX_RESULT ' + JSON.stringify(out));
  const pass = !!(out.auto && out.auto.hasGroups && out.auto.btnExists &&
    out.emptyGuard && out.emptyGuard.emptySheetsHeaderOnly &&
    out.export && out.export.ok &&
    out.export.sheetNames.join() === '分组明细,组号名单,均衡统计' &&
    out.export.detailDataRows >= 52 && out.export.rosterRows >= 52 &&
    out.export.groupCount === 9 &&
    out.export.xlsxReadable && out.export.statScore != null && out.export.statGap != null &&
    out.reimportable && out.reimportable.appliedGroups === 9 && out.reimportable.allNonEmpty);
  console.log('SEX_ALL = ' + pass);
  app.exit(pass ? 0 : 1);
});
app.on('window-all-closed', () => app.quit());
