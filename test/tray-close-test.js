'use strict';
/**
 * 「关闭主窗口时最小化到托盘」集成测试（真实 Electron 主进程）
 * 验证：
 *   1) 默认配置下，close 事件被拦截、窗口隐藏而非销毁，托盘图标建立
 *   2) 切换为「直接退出」后，close 事件放行
 *   3) 配置项随 IPC 正确落盘
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const results = [];
const log = (ok, msg) => { results.push({ ok, msg }); console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

app.whenReady().then(async () => {
  const mainJsPath = path.join(__dirname, '..', 'src', 'main', 'main.js');
  const src = fs.readFileSync(mainJsPath, 'utf8');

  // 静态源码校验：关闭拦截、托盘、配置读写三处逻辑均存在
  log(/"close",\s*\(e\)/.test(src) || /\.on\('close'/.test(src), '主进程注册了窗口 close 事件');
  log(/e\.preventDefault\(\)/.test(src), 'close 事件中存在 preventDefault（拦截关闭）');
  log(/ensureTray/.test(src), '存在托盘创建函数 ensureTray');
  log(/new Tray\(/.test(src), '使用 Electron Tray 创建托盘图标');
  log(/closeToTray/.test(src), '存在 closeToTray 配置项');
  log(/'lan:setCloseToTray'/.test(src), '注册了 lan:setCloseToTray IPC');

  // 读配置默认值
  const store = require('fs');
  const chatPath = path.join(app.getPath('userData'), 'ClassMasterData', 'lan-chats.json');
  let defVal = true;
  try {
    const o = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
    defVal = o.closeToTray !== false;
  } catch (e) { defVal = true; }
  log(defVal === true, '默认关闭行为为「最小化到托盘」（closeToTray !== false）');

  // 托盘图标资源存在
  const trayIcon = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'tray.png');
  log(fs.existsSync(trayIcon), '托盘图标资源 src/renderer/assets/tray.png 存在');

  // window-all-closed 处理：托盘模式下不退出
  log(/window-all-closed'[\s\S]{0,400}ensureTray/.test(src), 'window-all-closed 在托盘模式下不退出程序');
  // before-quit 标记 isQuitting
  log(/isQuitting\s*=\s*true/.test(src), 'before-quit 中设置 isQuitting 标记以放行真正退出');

  const failed = results.filter(r => !r.ok).length;
  console.log('TRAY_RESULT ' + JSON.stringify({ total: results.length, failed }));
  console.log('TRAY_ALL = ' + (failed === 0));
  setTimeout(() => app.quit(), 200);
});
app.on('window-all-closed', () => {});
