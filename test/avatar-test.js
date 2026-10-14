'use strict';
/**
 * 头像 + 改名 专项测试：验证软件名渲染、教师头像上传保存与侧边栏同步。
 * 用法: xvfb-run -a npx electron --no-sandbox --disable-gpu test/avatar-test.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

require('../src/main/main.js');

const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { await sleep(200); win = BrowserWindow.getAllWindows()[0]; }
  if (!win) { console.log('AV_NO_WINDOW'); return app.quit(); }

  const errs = [];
  win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2 && !/Electron Security Warning/.test(String(msg))) errs.push(String(msg)); });

  await new Promise(r => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r); else r(); });
  await sleep(2200);

  const js = async (code) => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (e) { console.log('AV_JSERR ' + e.message.split('\n')[0]); return null; }
  };
  const shot = async (name) => {
    await sleep(400);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  };

  const out = {};

  /* 1. 软件名 */
  out.brand = await js(`({ title: document.title, brand: document.querySelector('.brand-text').textContent, about: document.querySelectorAll('#view-settings .card')[2] ? 'ok' : 'ok' })`);

  /* 2. 填教师名并保存 */
  await js(`(async function(){
    window.App.go('settings');
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#setTeacherName').value = '周老师';
    document.querySelector('#btnSaveMeta').click();
    await new Promise(r => setTimeout(r, 500));
    return 1;
  })()`);

  /* 3. 生成测试头像并写入，再回到设置页触发渲染 */
  const dataUrl = await js(`(function(){
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#3b5ce8'); g.addColorStop(1, '#8b5cf6');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#fff'; x.font = 'bold 60px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('周', 64, 68);
    return c.toDataURL('image/jpeg', 0.9);
  })()`);

  out.saved = await js(`(async function(){
    window.Store.S.db.meta.teacherAvatar = ${JSON.stringify(dataUrl)};
    await window.Store.save();
    window.App.go('settings');
    await new Promise(r => setTimeout(r, 500));
    const img = document.querySelector('#teacherAvatar');
    const side = document.querySelector('#sideAvatar');
    return {
      mainShown: !!img && !img.hidden && (img.src || '').startsWith('data:image'),
      sideShown: !!side && !side.hidden && (side.src || '').startsWith('data:image'),
      phHidden: document.querySelector('#avatarPlaceholder').style.display === 'none',
      clearVisible: !document.querySelector('#btnAvatarClear').hidden,
      sideName: document.querySelector('#sideTeacherName').textContent,
      sidePhText: document.querySelector('#sideAvatarPh').textContent,
      storedLen: (window.Store.S.db.meta.teacherAvatar || '').length
    };
  })()`);
  await shot('06-settings-avatar');

  await js(`window.App.go('dashboard')`);
  await sleep(700);
  out.sideOnDashboard = await js(`({
    sideShown: !document.querySelector('#sideAvatar').hidden,
    name: document.querySelector('#sideTeacherName').textContent
  })`);
  await shot('07-dashboard-avatar');

  /* 4. 恢复默认 */
  out.cleared = await js(`(async function(){
    document.querySelector('#btnAvatarClear').hidden;
    window.App.go('settings');
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('#btnAvatarClear').click();
    await new Promise(r => setTimeout(r, 500));
    return {
      mainHidden: document.querySelector('#teacherAvatar').hidden,
      sideHidden: document.querySelector('#sideAvatar').hidden,
      phText: document.querySelector('#avatarPlaceholder').textContent,
      storedEmpty: !window.Store.S.db.meta.teacherAvatar
    };
  })()`);

  /* 5. 持久化验证：重新读库 */
  out.reload = await js(`(async function(){
    const db = await window.CM.readDB();
    return { teacherName: db.meta.teacherName, avatarCleared: !db.meta.teacherAvatar };
  })()`);

  console.log('AV_RESULT ' + JSON.stringify(out));
  console.log('AV_CONSOLE_ERRORS ' + JSON.stringify(errs));

  const pass =
    out.brand && out.brand.title === '班级智管-鸿升周老师' && out.brand.brand === '班级智管-鸿升周老师' &&
    out.saved && out.saved.mainShown && out.saved.sideShown && out.saved.phHidden && out.saved.clearVisible &&
    out.saved.sideName === '周老师' && out.saved.sidePhText === '老师' &&
    out.sideOnDashboard && out.sideOnDashboard.sideShown &&
    out.cleared && out.cleared.mainHidden && out.cleared.sideHidden && out.cleared.storedEmpty &&
    out.reload && out.reload.teacherName === '周老师' &&
    errs.length === 0;

  console.log('AV_ALL = ' + pass);
  app.exit(pass ? 0 : 1);
});
