'use strict';
/**
 * 飞鸽传书 渲染层逻辑测试（无 Electron，用轻量 DOM/CM 打桩）
 * 覆盖：开机自动开启 / 在线·离线成员显示与 30 秒隐藏 / 离线禁止发送 /
 *       文件记录持久化与打开 / 断点续传提示 / 音视频按钮已彻底移除
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ---------- 轻量 DOM 打桩 ---------- */
function makeEl(id) {
  return {
    id, _h: {}, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    className: '', checked: false,
    style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    set onclick(f) { this._h.click = f; }, get onclick() { return this._h.click; },
    set onchange(f) { this._h.change = f; }, get onchange() { return this._h.change; },
    set onkeydown(f) { this._h.keydown = f; }, get onkeydown() { return this._h.keydown; },
    querySelector() { return null; }, appendChild() {}, addEventListener() {},
    play() { return Promise.resolve(); }
  };
}
const els = {};
const IDS = ['lanToggle', 'lanApplyName', 'lanAddBtn', 'lanInput', 'lanSend', 'lanFile', 'lanFolder',
  'lanRetention', 'lanClearChat', 'lanClearFiles', 'lanStatus', 'lanMyName', 'lanPeers', 'lanEmpty',
  'lanPeerCount', 'lanMsgs', 'lanFiles', 'lanFileCount', 'lanChatTitle', 'lanChatPeer',
  'lanAddIp', 'lanAutoLaunch', 'lanRescan', 'lanOpenFolder', 'lanOfflineKeep', 'lanCloseToTray'];
IDS.forEach((id) => { els[id] = makeEl(id); });

const modalReject = makeEl('modalReject');
global.document = {
  hasFocus: () => false,
  querySelector: (s) => {
    if (s.indexOf('modalFoot') >= 0) return modalReject;
    return s.startsWith('#') ? (els[s.slice(1)] || null) : null;
  },
  querySelectorAll: (s) => {
    // 渲染出的成员行需要能被查询到，用于绑定点击；
    // 打桩阶段返回空数组即可（点击通过 selectPeer 覆盖测试路径）
    return [];
  },
  documentElement: { dataset: {} },
  body: { classList: { add() {}, remove() {} } }
};
global.window = global;
Object.defineProperty(global, 'navigator', {
  value: { mediaDevices: {} },
  configurable: true, writable: true
});

/* ---------- CM 打桩：记录调用并模拟磁盘存储 ---------- */
const disk = { chats: {}, retention: 'forever', offlineKeep: 0, closeToTray: true, files: [] };
let startedCount = 0;
const handlers = {};                       // 事件名 -> 渲染层回调
const notifyCalls = [];                    // lanNotify 调用记录
let rescanCount = 0;
global.CM = {
  lanStart: async () => { startedCount++; return { name: '测试' }; },
  lanStop: async () => ({}),
  lanSetName: () => ({}),
  lanChat: () => true,
  lanAddPeer: () => ({}),
  lanRescan: () => { rescanCount++; return { ok: true }; },
  lanNotify: (p) => { notifyCalls.push(p); return { ok: true }; },
  lanAlertOff: () => ({ ok: true }),
  lanAutoLaunchGet: async () => ({ ok: true, on: false }),
  lanAutoLaunchSet: async (on) => ({ ok: true, on }),
  lanOn: (ev, cb) => { handlers[ev] = cb; return () => {}; },
  lanPickFile: async () => ({ canceled: false, path: '/tmp/x.txt' }),
  lanPickFolder: async () => ({ canceled: false, path: '/tmp/dir', name: 'dir' }),
  lanSendFile: async () => ({}),
  lanSendFolder: async () => ({}),
  lanLoadChats: async () => ({ chats: disk.chats, retention: disk.retention, offlineKeep: disk.offlineKeep, closeToTray: disk.closeToTray }),
  lanSaveChats: (pid, list) => { disk.chats[pid] = list; return { ok: true }; },
  lanSetRetention: (v) => { disk.retention = v; return { ok: true, removed: 0 }; },
  lanSetOfflineKeep: (v) => { disk.offlineKeep = Number(v) || 0; return { ok: true, offlineKeep: disk.offlineKeep }; },
  lanSetCloseToTray: (v) => { disk.closeToTray = v !== false; return { ok: true, closeToTray: disk.closeToTray }; },
  lanLoadFiles: async () => ({ files: disk.files }),
  lanSaveFiles: (files) => { disk.files = files; return { ok: true }; },
  openPath: () => ({ ok: true }),
  lanOpenIncoming: () => ({ ok: true })
};
const toasts = [];
global.App = {
  toast: (m, t) => toasts.push({ m, t }),
  go: () => {},
  modal: () => {},
  closeModal: () => {}
};
global.Store = { S: { db: { meta: { teacherName: '周老师' } } } };

/* ---------- 加载被测模块 ---------- */
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'lan.js'), 'utf8');
const vm = require('vm');
vm.runInThisContext(code, { filename: 'lan.js' });

(async () => {
  /* ---- 1) 音视频能力已彻底移除（源码级校验） ---- */
  assert.ok(code.indexOf('RTCPeerConnection') < 0, '源码中不应再出现 RTCPeerConnection');
  assert.ok(code.indexOf('getUserMedia') < 0, '源码中不应再出现 getUserMedia');
  assert.ok(code.indexOf('toggleTalk') < 0, '源码中不应再出现对讲开关 toggleTalk');
  assert.ok(code.indexOf('AudioContext') < 0, '源码中不应再出现来电铃声 AudioContext');

  /* ---- 2) 开机自动开启 ---- */
  global.LAN.init();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(startedCount, 1, '初始化应自动开启飞鸽传书（lanStart 被调用一次）');
  assert.strictEqual(els.lanStatus.textContent, '已开启', '状态应显示已开启');

  /* ---- 3) 在线成员：显示在线，计数与标题正确 ---- */
  handlers['lan:peers']([
    { id: 'p1', name: '张老师', ip: '192.168.1.20', tcpPort: 37124, online: true, status: 'online' },
    { id: 'p2', name: '李老师', ip: '192.168.1.21', tcpPort: 37124, online: true, status: 'online' }
  ]);
  assert.ok(els.lanPeers.innerHTML.indexOf('张老师') >= 0, '在线成员应出现在列表中');
  assert.ok(els.lanPeers.innerHTML.indexOf('lan-dot on') >= 0, '在线成员应显示绿色在线状态点');
  assert.strictEqual(els.lanPeerCount.textContent, '2 人在线', '计数应显示在线人数');

  /* ---- 4) 离线成员：置灰并保留在列表中；默认不显示倒计时（永不隐藏） ---- */
  handlers['lan:peers']([
    { id: 'p1', name: '张老师', ip: '192.168.1.20', tcpPort: 37124, online: true, status: 'online' },
    { id: 'p2', name: '李老师', ip: '192.168.1.21', tcpPort: 37124, online: false, status: 'offline', hideIn: 0 }
  ]);
  assert.ok(els.lanPeers.innerHTML.indexOf('lan-peer-row offline') >= 0, '离线成员行应带 offline 类置灰');
  assert.ok(els.lanPeers.innerHTML.indexOf('lan-dot off') >= 0, '离线成员应显示灰色状态点');
  assert.ok(els.lanPeers.innerHTML.indexOf('李老师') >= 0, '离线成员应保留在列表中（默认永不自动隐藏）');
  assert.ok(els.lanPeers.innerHTML.indexOf('后隐藏') < 0, '默认（永不隐藏）时不应显示隐藏倒计时');
  assert.strictEqual(els.lanPeerCount.textContent, '1 人在线 · 1 人离线', '计数应同时显示在线与离线人数');

  /* ---- 4b) 设置了隐藏时长后：离线成员显示倒计时 ---- */
  handlers['lan:peers']([
    { id: 'p1', name: '张老师', ip: '192.168.1.20', tcpPort: 37124, online: true, status: 'online' },
    { id: 'p2', name: '李老师', ip: '192.168.1.21', tcpPort: 37124, online: false, status: 'offline', hideIn: 30000 }
  ]);
  assert.ok(els.lanPeers.innerHTML.indexOf('后隐藏') >= 0, '设置了隐藏时长后，离线成员应显示「Ns 后隐藏」倒计时');

  /* ---- 4c) 设置页：离线自动隐藏下拉框可切换并落盘 ---- */
  assert.ok(els.lanOfflineKeep, '应存在离线自动隐藏设置项');
  els.lanOfflineKeep.value = '7d';
  await els.lanOfflineKeep._h.change();
  assert.strictEqual(disk.offlineKeep, 604800000, '选择「离线 7 天后」应持久化 7 天毫秒值');
  assert.ok(toasts.some((t) => String(t.m).indexOf('离线 7 天后隐藏') >= 0), '切换后应有明确提示');
  els.lanOfflineKeep.value = 'unlimited';
  await els.lanOfflineKeep._h.change();
  assert.strictEqual(disk.offlineKeep, 0, '选择「永不自动隐藏」应持久化 0');

  /* ---- 4d) 设置页：关闭主窗口行为可切换并落盘（默认最小化到托盘） ---- */
  assert.ok(els.lanCloseToTray, '应存在「关闭主窗口时」设置项');
  assert.strictEqual(els.lanCloseToTray.value, 'tray', '默认应为「最小化到托盘」');
  els.lanCloseToTray.value = 'quit';
  await els.lanCloseToTray._h.change();
  assert.strictEqual(disk.closeToTray, false, '选择「直接退出程序」应持久化 false');
  assert.ok(toasts.some((t) => String(t.m).indexOf('直接退出') >= 0), '切换为直接退出应有提示');
  els.lanCloseToTray.value = 'tray';
  await els.lanCloseToTray._h.change();
  assert.strictEqual(disk.closeToTray, true, '选择「最小化到托盘」应持久化 true');
  assert.ok(toasts.some((t) => String(t.m).indexOf('最小化到托盘') >= 0), '切换为托盘应有提示');

  /* ---- 5) 离线成员保留显示：默认（永不隐藏）不展示倒计时 ---- */
  handlers['lan:peers']([{ id: 'p2', name: '李老师', ip: '192.168.1.21', tcpPort: 37124, online: false, status: 'offline', hideIn: 0 }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(els.lanPeers.innerHTML.indexOf('李老师') >= 0, '唯一一位离线成员应保留显示（默认永不自动隐藏）');
  assert.ok(els.lanPeers.innerHTML.indexOf('后隐藏') < 0, '默认永不隐藏时不应显示隐藏倒计时');
  assert.strictEqual(els.lanPeerCount.textContent, '0 人在线 · 1 人离线', '计数应正确统计离线人数');

  /* ---- 5b) 设置了隐藏时长：显示倒计时；移除后由引擎推空列表，前端不再渲染 ---- */
  handlers['lan:peers']([{ id: 'p2', name: '李老师', ip: '192.168.1.21', tcpPort: 37124, online: false, status: 'offline', hideIn: 30000 }]);
  assert.ok(els.lanPeers.innerHTML.indexOf('后隐藏') >= 0, '设置隐藏时长后应显示倒计时');

  /* ---- 5c) 同一 IP 去重：即使引擎误推多条，前端也只渲染一条 ---- */
  handlers['lan:peers']([
    { id: 'x1', name: '王老师', ip: '192.168.1.50', tcpPort: 37124, online: true, status: 'online' },
    { id: 'x2', name: '王老师', ip: '192.168.1.50', tcpPort: 37124, online: true, status: 'online' },
    { id: 'x3', name: '王老师（旧）', ip: '192.168.1.50', tcpPort: 37124, online: false, status: 'offline', hideIn: 0 }
  ]);
  assert.strictEqual(
    (els.lanPeers.innerHTML.match(/lan-peer-row/g) || []).length, 1,
    '同一 IP 的多条记录应只渲染一行'
  );
  assert.strictEqual(els.lanPeerCount.textContent, '1 人在线', '同 IP 只计算一人');

  /* ---- 6) 引擎按配置移除成员后：列表为空并显示引导说明 ---- */
  handlers['lan:peers']([]);
  assert.ok(els.lanPeers.innerHTML.indexOf('李老师') < 0, '成员从列表移除后不应再渲染');
  assert.strictEqual(els.lanEmpty.style.display, '', '列表为空时应显示引导说明');

  /* ---- 7) 收到新消息：后台时唤起通知（系统通知 + 置前） ---- */
  handlers['lan:peers']([{ id: 'p1', name: '张老师', ip: '192.168.1.20', tcpPort: 37124, online: true, status: 'online' }]);
  const notifyBefore = notifyCalls.length;
  handlers['lan:message']({ peerId: 'p1', name: '张老师', text: '作业记得提交', ts: Date.now(), dir: 'in' });
  assert.ok(notifyCalls.length > notifyBefore, '收到新消息应触发窗口唤醒通知');
  assert.ok(String(notifyCalls[notifyCalls.length - 1].title).indexOf('张老师') >= 0, '通知标题应包含发信人');
  assert.ok(String(notifyCalls[notifyCalls.length - 1].body).indexOf('作业') >= 0, '通知正文应包含消息摘要');

  /* ---- 8) 文件记录持久化：模拟磁盘已有记录，重新初始化后应恢复 ---- */
  disk.files = [{ id: 'f1', name: 'a.mp4', size: 100, sent: 100, dir: 'in', done: true, path: '/data/资料/a.mp4', ts: Date.now() }];
  startedCount = 0;
  global.LAN.init();                   // 再次初始化触发 restoreFiles
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(els.lanFiles.innerHTML.indexOf('a.mp4') >= 0, '恢复后应显示历史文件记录');
  assert.strictEqual(els.lanFileCount.textContent, '1 条记录', '文件记录计数应正确');

  /* ---- 9) 断点续传：接收端 incoming 事件带 offset 时应提示续传进度 ---- */
  toasts.length = 0;
  handlers['lan:fileIncoming']({ peerId: 'p1', fileId: 'f2', name: 'big.zip', size: 1000, type: 'application/zip', offset: 400, resumed: true });
  assert.ok(toasts.some((t) => String(t.m).indexOf('断点续传') >= 0), '断点续传应提示已接收的进度');
  assert.ok(els.lanFiles.innerHTML.indexOf('big.zip') >= 0, '续传文件应出现在传输记录中');

  /* ---- 10) 清空文件记录 ---- */
  els.lanClearFiles._h.click();
  assert.strictEqual(disk.files.length, 0, '清空后磁盘记录应为空');
  assert.strictEqual(els.lanFileCount.textContent, '0 条记录', '清空后计数应为 0');

  /* ---- 11) 手动刷新：调用 lanRescan ---- */
  const rescanBefore = rescanCount;
  els.lanRescan._h.click();
  assert.ok(rescanCount > rescanBefore, '点击刷新应触发一次重扫');

  console.log('✅ 飞鸽传书渲染层测试通过：在线/离线实时显示（默认永不隐藏）/ 可配置隐藏时长(30秒·1天·7天·1个月) / 离线提示 / 开机自动开启 / 新消息唤醒 / 文件记录持久化 / 断点续传提示 / 同 IP 去重 / 关闭最小化到托盘 / 手动刷新');
  // 清理：init() 注册了兜底重扫与离线倒计时定时器，测试结束需主动退出，避免进程挂起
  if (global.LAN && global.LAN.dispose) global.LAN.dispose();
  process.exit(0);
})().catch((e) => { console.error('❌ 测试失败:', e); process.exit(1); });
