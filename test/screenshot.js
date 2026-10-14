/**
 * 自动化截图测试（使用真实主进程，仅追加截图逻辑）
 * 用法: xvfb-run -a npx electron --no-sandbox --disable-gpu test/screenshot.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// 先加载真实主进程（注册所有 IPC 与创建窗口）
require('../src/main/main.js');

const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

function getWin() {
  const ws = BrowserWindow.getAllWindows();
  return ws[0] || null;
}

app.whenReady().then(async () => {
  // 等待主进程创建窗口
  let win = null;
  for (let i = 0; i < 60 && !win; i++) {
    await new Promise(r => setTimeout(r, 200));
    win = getWin();
  }
  if (!win) { console.log('NO WINDOW'); return app.quit(); }

  const errs = [];
  win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });

  await new Promise(r => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r);
    else r();
  });
  await new Promise(r => setTimeout(r, 2000));

  const shot = async name => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('SHOT ' + name);
  };
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (e) { console.log('JSERR ' + e.message.split('\n')[0]); return null; }
  };

  await shot('00-dashboard-empty');
  await js(`App.toast('测试', 'ok')`);

  // 载入示例数据
  await js(`(async()=>{ const b=document.querySelector('[data-quick="sample"]'); if(b) b.click(); return 1; })()`);
  await new Promise(r => setTimeout(r, 2000));
  await js(`App.go('dashboard')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('01-dashboard');

  // 导入向导
  await js(`App.openImportWizard('grades')`);
  await new Promise(r => setTimeout(r, 700));
  await shot('02-import-step1');
  await js(`document.querySelector('#useSample').click()`);
  await new Promise(r => setTimeout(r, 900));
  await shot('03-import-step2');
  await js(`document.querySelector('#doImport').click()`);
  await new Promise(r => setTimeout(r, 1800));
  await shot('04-import-step3');
  await js(`document.querySelector('#importClose').click()`);
  await new Promise(r => setTimeout(r, 400));

  // 学生管理
  await js(`App.go('students')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('05-students');

  await js(`(function(){const b=document.querySelector('[data-act="profile"]'); if(b)b.click();})()`);
  await new Promise(r => setTimeout(r, 1100));
  await shot('06-student-profile');
  await js(`App.closeModal()`);

  await js(`App.go('students'); (function(){const b=document.querySelector('[data-act="edit"]'); if(b)b.click();})()`);
  await new Promise(r => setTimeout(r, 900));
  await shot('07-student-edit');
  await js(`App.closeModal()`);

  // 成绩分析
  await js(`App.go('grades')`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('08-grades-overview');
  await js(`document.querySelector('#gradeModeSeg [data-m="subjects"]').click()`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('09-grades-subjects');
  await js(`document.querySelector('#gradeModeSeg [data-m="trend"]').click()`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('10-grades-trend');
  await js(`document.querySelector('#gradeModeSeg [data-m="compare"]').click()`);
  await new Promise(r => setTimeout(r, 700));
  await js(`(function(){const bs=document.querySelectorAll('[data-cmp]'); if(bs[0])bs[0].click(); if(bs[3])bs[3].click(); if(bs[7])bs[7].click();})()`);
  await new Promise(r => setTimeout(r, 1400));
  await shot('11-grades-compare');

  // 智能排座
  await js(`App.go('seating')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('12-seating-empty');
  await js(`document.querySelector('#btnSeatAuto').click()`);
  await new Promise(r => setTimeout(r, 2600));
  await shot('13-seating-grouped');
  await js(`document.querySelector('#seatModeSeg [data-m="classroom"]').click()`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('14-seating-classroom');
  await js(`document.querySelector('#seatModeSeg [data-m="group"]').click()`);
  await new Promise(r => setTimeout(r, 800));

  // 排座设置弹窗（容量不足）
  await js(`document.querySelector('#seatGroupCount').value=8; document.querySelector('#btnSeatAuto').click()`);
  await new Promise(r => setTimeout(r, 900));
  await shot('15-seat-capacity-warn');
  await js(`App.closeModal()`);

  // 积分管理
  await js(`App.go('points')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('16-points-board');
  await js(`document.querySelector('#btnPointsAdd').click()`);
  await new Promise(r => setTimeout(r, 1000));
  await shot('17-points-dialog');
  await js(`App.closeModal()`);
  await js(`document.querySelector('#pointsModeSeg [data-m="rank"]').click()`);
  await new Promise(r => setTimeout(r, 900));
  await shot('18-points-rank');
  await js(`document.querySelector('#pointsModeSeg [data-m="rules"]').click()`);
  await new Promise(r => setTimeout(r, 900));
  await shot('19-points-rules');
  await js(`document.querySelector('#pointsModeSeg [data-m="records"]').click()`);
  await new Promise(r => setTimeout(r, 800));
  await shot('20-points-records');

  // 会员中心
  await js(`App.go('membership')`);
  await new Promise(r => setTimeout(r, 1000));
  await shot('21-membership');
  await js(`(function(){const b=document.querySelector('[data-plan="pro"]'); if(b)b.click();})()`);
  await new Promise(r => setTimeout(r, 1000));
  await shot('22-license-key');
  await js(`App.closeModal()`);

  // 设置
  await js(`App.go('settings')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('23-settings');

  // 浅色主题
  await js(`document.body.dataset.theme='light'; App.go('dashboard')`);
  await new Promise(r => setTimeout(r, 1100));
  await shot('24-light-dashboard');
  await js(`App.go('seating')`);
  await new Promise(r => setTimeout(r, 900));
  await shot('25-light-seating');
  await js(`document.body.dataset.theme='dark'`);

  // 飞鸽传书（本版已移除音视频，仅文字 + 文件）
  await js(`App.go('lan')`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('26-lan');
  // 注入一份模拟成员列表，验证在线/离线渲染样式（走渲染层真实事件通道）
  const lanCheck = await js(`(function(){
    try {
      const emit = (list) => {
        const on = window.__lanPeersHandler;
        if (on) on(list);
      };
      emit([
        { id:'p1', name:'王老师', ip:'192.168.1.20', tcpPort:37124, online:true, status:'online', hideIn:0 },
        { id:'p2', name:'年级组办公室', ip:'192.168.1.51', tcpPort:37124, online:true, status:'online', hideIn:0 },
        { id:'p3', name:'李老师', ip:'192.168.1.33', tcpPort:37124, online:false, status:'offline', hideIn:0 },
        { id:'p4', name:'张老师', ip:'192.168.1.66', tcpPort:37124, online:false, status:'offline', hideIn:18000 }
      ]);
      const peersBox = document.querySelector('#lanPeers');
      const peerCount = document.querySelector('#lanPeerCount');
      return JSON.stringify({
        hasPeersBox: !!peersBox,
        hasPeerCount: !!peerCount,
        countText: peerCount ? peerCount.textContent : '',
        rowCount: peersBox ? peersBox.querySelectorAll('.lan-peer-row').length : 0,
        offlineRows: peersBox ? peersBox.querySelectorAll('.lan-peer-row.offline').length : 0,
        videoBtnGone: !document.querySelector('#lanVideo'),
        callBtnGone: !document.querySelector('#lanCall'),
        callBarGone: !document.querySelector('#lanCallBar'),
        talkHintGone: !document.querySelector('#lanTalkHint'),
        fileBtn: !!document.querySelector('#lanFile'),
        folderBtn: !!document.querySelector('#lanFolder'),
        offlineKeep: !!document.querySelector('#lanOfflineKeep'),
        offlineKeepOpts: document.querySelector('#lanOfflineKeep')
          ? Array.prototype.map.call(document.querySelector('#lanOfflineKeep').options, o => o.value + ':' + o.textContent).join(' | ')
          : '',
        closeToTray: !!document.querySelector('#lanCloseToTray'),
        closeToTrayOpts: document.querySelector('#lanCloseToTray')
          ? Array.prototype.map.call(document.querySelector('#lanCloseToTray').options, o => o.value + ':' + o.textContent).join(' | ')
          : '',
        notifyFn: typeof (window.CM && CM.lanNotify),
        alertOffFn: typeof (window.CM && CM.lanAlertOff),
        signalFn: typeof (window.CM && CM.lanSignal),
        incomingFn: typeof (window.CM && CM.lanIncoming)
      });
    } catch(e) { return 'ERR:'+e.message; }
  })()`);
  console.log('LAN_CHECK = ' + lanCheck);
  await new Promise(r => setTimeout(r, 400));
  await shot('27-lan-after');

  // 滚动到设置卡「关闭主窗口时」处，单独出一张设置截图
  await js(`(function(){
    const el = document.querySelector('#lanCloseToTray') || document.querySelector('#lanOfflineKeep');
    if (el && el.closest('.card')) el.closest('.card').scrollIntoView({ block: 'end' });
    const page = document.querySelector('#page-lan') || document.querySelector('.page');
    if (page) page.scrollTop = page.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  })()`);
  await new Promise(r => setTimeout(r, 700));
  await shot('28-lan-offline-setting');

  console.log('=== ERRORS ===');
  console.log(JSON.stringify(errs.slice(0, 30), null, 1));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
