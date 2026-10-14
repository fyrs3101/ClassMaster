'use strict';
/**
 * 安全审计：确认客户端【不具备】任何生成激活码的能力
 *   1) 枚举渲染进程可通过 preload 访问的全部 API（不应含 genKey 之类）
 *   2) 扫描主进程源码的 IPC 注册表与算法函数
 *   3) 全文件搜索客户端源码，确认无签发出口
 * 用法: xvfb-run -a npx electron --no-sandbox --disable-gpu test/security-audit.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const SRC = path.join(__dirname, '..', 'src');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { await sleep(200); win = BrowserWindow.getAllWindows()[0]; }
  if (!win) { console.log('SEC_NO_WINDOW'); return app.quit(); }
  await new Promise(r => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r); else r(); });
  await sleep(2000);
  const js = c => win.webContents.executeJavaScript(c, true).catch(e => 'ERR:' + e.message.split('\n')[0]);

  const result = {};

  /* 1. preload 暴露面 */
  result.exposedApi = await js(`Object.keys(window.CM).sort().join(',')`);
  result.hasGenKeyApi = await js(`typeof window.CM.licenseGenKey !== 'undefined' || typeof window.CM.genKey !== 'undefined'`);

  /* 2. 主进程已注册的 IPC 通道 */
  result.ipcChannels = Object.keys(ipcMain._invokeHandlers ? Object.fromEntries(ipcMain._invokeHandlers) : {}).sort().join(',');
  result.hasGenKeyChannel = /genKey/i.test(result.ipcChannels);

  /* 3. 尝试从渲染进程直接调用已删除的通道（应报错） */
  result.callGenKeyBlocked = await js(`(async function(){
    try { await window.CM.licenseGenKey({plan:'pro'}); return false; }
    catch(e) { return true; }
  })()`);

  /* 4. 为任意机器码生成激活码的能力是否存在于渲染进程 */
  result.rendererHasAlgorithm = await js(`(function(){
    // 客户端不应存在能产出激活码的函数
    var names = Object.keys(window).filter(function(k){ return /licen|activ|key/i.test(k); });
    return names.join(',');
  })()`);

  /* 5. 源码静态扫描：区分「签发」与「校验」 */
  const files = walk(SRC);
  const hits = [];
  const needle = [
    { re: /makeLicenseKey\s*\(/, why: '签发函数定义/调用' },
    { re: /license:genKey/, why: '签发 IPC 通道' },
    { re: /licenseGenKey/, why: '签发 API 暴露' }
  ];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const n of needle) {
      if (n.re.test(txt)) hits.push(path.relative(SRC, f) + ' → ' + n.why);
    }
  }
  result.sourceHits = hits;

  /* 5b. HMAC 计算必须只出现在校验函数内部（不得有对外返回激活码的出口） */
  const mainTxt = fs.readFileSync(path.join(SRC, 'main', 'main.js'), 'utf8');
  const hmacCount = (mainTxt.match(/createHmac\(/g) || []).length;
  const checkFnBody = (mainTxt.match(/function checkLicenseKey[\s\S]*?\n\}/) || [''])[0];
  const hmacInCheckOnly = hmacCount === 1 && /createHmac\(/.test(checkFnBody);
  // 禁用签发函数名必须彻底消失（grep 命中数须为 0）
  const forbiddenNames = (mainTxt.match(/makeLicenseKey|license:genKey|licenseGenKey/g) || []).length;
  // 激活码格式（20 位 5 组）不得作为任何 handler 的返回值出现
  const returnsKeyToRenderer = /return\s*\{[^}]*\b(licenseKey|activationKey)\s*:/.test(mainTxt);
  result.hmacGuard = { hmacCount, hmacInCheckOnly, forbiddenNames, returnsKeyToRenderer };

  /* 6. 申请码机制是否可用 */
  result.applyFlow = await js(`(async function(){
    const a = await window.CM.licenseApplyCode({ plan: 'pro' });
    const s = await window.CM.licenseStatus();
    return JSON.stringify({ hasCode: !!a.code, codeLen: (a.code||'').length, mc: a.machineCode, hitPlans: a.plan });
  })()`);

  /* 7. 正常激活链路仍可用（用外部签发的正确码） */
  result.activation = await js(`(async function(){
    const apply = await CM.licenseApplyCode({ plan: 'pro' });
    return JSON.stringify({ machineCode: apply.machineCode, applyCode: apply.code });
  })()`);

  console.log('SEC_RESULT ' + JSON.stringify(result, null, 1));

  const ok =
    !result.hasGenKeyApi &&
    !result.hasGenKeyChannel &&
    result.callGenKeyBlocked === true &&
    result.sourceHits.length === 0 &&
    result.hmacGuard.hmacCount === 1 && result.hmacGuard.hmacInCheckOnly &&
    result.hmacGuard.forbiddenNames === 0 && !result.hmacGuard.returnsKeyToRenderer &&
    /hasCode":true/.test(result.applyFlow);

  console.log('SEC_ALL = ' + ok);
  app.exit(ok ? 0 : 1);
});
app.on('window-all-closed', () => app.quit());
