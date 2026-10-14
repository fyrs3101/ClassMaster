// 端到端功能验证：分析 / 排座 / 导出 / 积分 / 授权
const {app, BrowserWindow} = require('electron');
const path = require('path');
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { await new Promise(r => setTimeout(r, 200)); win = BrowserWindow.getAllWindows()[0]; }
  if (!win) { console.log('E2E NO_WINDOW'); return app.quit(); }
  await new Promise(r => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r); else r(); });
  await new Promise(r => setTimeout(r, 2000));
  const js = c => win.webContents.executeJavaScript(c, true).catch(e => 'ERR:' + e.message.split('\n')[0]);

  console.log('E2E boot =', await js(`!!window.App && !!window.Seating && !!window.Analytics && !!window.CM`));
  await js(`(async()=>{const b=document.querySelector('[data-quick="sample"]'); if(b)b.click();})()`);
  await new Promise(r => setTimeout(r, 2200));

  console.log('E2E seat =', await js(`(function(){
    const r = Seating.buildGroups({groupCount:9,groupSize:6,perLevel:2,strategy:'sbalance',nameStyle:'num'});
    const m = Seating.metrics(r.groups);
    return JSON.stringify({groups:r.groups.length,pool:r.pool.length,gap:m.gap,score:m.score,sizes:r.groups.map(g=>g.members.length)});
  })()`));

  console.log('E2E export =', await js(`(async function(){
    const sheets = Analytics.buildExportSheets();
    const r = await CM.buildXlsx(sheets);
    return JSON.stringify({err:r.error||null,names:sheets.map(s=>s.name),rows:sheets.map(s=>s.aoa.length),bytes:r.buffer?r.buffer.length:0});
  })()`));

  console.log('E2E analytics =', await js(`(function(){
    const ov=Analytics.overview(), ss=Analytics.subjectStats(), wk=Analytics.weakStudents();
    const p=Analytics.profile(Store.S.db.students[0].id);
    return JSON.stringify({count:ov.count,avg:+ov.avg.toFixed(1),max:ov.max,min:ov.min,pass:+(ov.passRate*100).toFixed(1),
      subs:ss.map(x=>x.subject+'='+x.avg.toFixed(1)).join(','),weak:wk.length,rank:p.rankClass,pts:p.points});
  })()`));

  console.log('E2E points =', await js(`(async function(){
    const ids = Store.S.db.students.slice(0,3).map(s=>s.id);
    Store.addPoints(ids,3,'测试加分','测试');
    Store.addPoints(ids[0],-2,'测试扣分','测试');
    await Store.save();
    return JSON.stringify({s0:Store.pointsOf(ids[0]),s1:Store.pointsOf(ids[1]),n:Store.S.db.points.records.length});
  })()`));

  console.log('E2E license =', await js(`(async function(){
    const st = await CM.licenseStatus();
    // 客户端已无签发能力：改为「申请码 → 外部算法签发 → 客户端激活」
    const apply = await CM.licenseApplyCode({plan:'pro'});
    const forbidden = await (async()=>{ try { await CM.licenseGenKey({plan:'pro'}); return false; } catch(e){ return true; } })();
    const bad = await CM.licenseActivate({key:'AAAAA-AAAAA-AAAAA-AAAAA'});
    return JSON.stringify({mc:st.machineCode,applyCodeLen:(apply.code||'').length,genKeyBlocked:forbidden,rejectBad:!bad.ok});
  })()`));

  console.log('E2E import-parser =', await js(`(function(){
    const t = '姓名\\t语文\\t数学\\t总分\\n张三\\t120\\t130\\t250\\n李四\\t110\\t125\\t235';
    const r = Importer.parseText(t);
    return JSON.stringify({n:r.students.length, names:r.students.map(s=>s.name).join('/'), total:r.students.map(s=>s.total).join('/')});
  })()`));

  console.log('E2E done');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
