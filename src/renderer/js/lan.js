/* =====================================================================
   lan.js —— 飞鸽传书界面：成员发现 / 文字聊天 / 文件传输（支持断点续传）
   聊天记录本地持久化，支持保留期设置（半年 / 一年 / 永久），重启不丢失。
   在线成员实时显示「在线 / 离线」，离线成员 30 秒内自动从列表移除。
   ===================================================================== */
(function (global) {
  'use strict';
  const CM = global.CM;
  const App = global.App || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(ts) {
    const d = new Date(ts || Date.now());
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDateTime(ts) {
    const d = new Date(ts || Date.now());
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  const S = {
    peers: new Map(),       // id -> {id,name,ip,tcpPort,status}
    activePeer: null,
    chats: new Map(),       // peerId -> [{dir,text,ts,name}]
    unread: new Map(),      // peerId -> count
    files: [],              // 文件传输记录 [{id,name,size,sent,dir,done,path,peerId,peerName,rel,ts}]
    started: false,
    retention: 'forever',   // half=半年 | year=一年 | forever=永久
    offlineKeep: 0,         // 离线成员自动隐藏时长(ms)：0=永不隐藏（可在设置中改为 30秒/1天/7天/1个月）
    closeToTray: true,      // 关闭主窗口时是否最小化到托盘（默认 true）
    listenersReady: false,
    uiRescanTimer: null,    // 渲染层兜底重扫定时器
    offlineTimer: null,     // 离线倒计时走秒定时器
    dropDepth: 0,           // 拖拽高亮深度计数（dragenter/dragleave 成对出现，防止闪烁）
    windowDropReady: false  // 窗口级拖拽监听是否已绑定
  };

  /* ============================ 启动 / 停止 ============================ */
  async function start() {
    const name = ($('#lanMyName') && $('#lanMyName').value.trim()) || '';
    const info = await CM.lanStart({ name });
    S.started = true;
    applyStartedUI();
    if ($('#lanMyName')) $('#lanMyName').value = info.name || name;
  }
  async function stop() {
    await CM.lanStop();
    S.started = false;
    S.peers.clear();
    applyStartedUI();
    renderPeers();
  }
  async function toggle() {
    if (S.started) { await stop(); toast('已关闭飞鸽传书'); }
    else { await start(); toast('飞鸽传书已开启，正在发现同网段设备…', 'ok'); }
  }

  /** 软件启动即自动开启飞鸽传书（无需手动点击） */
  async function autoStart() {
    if (S.started) return;
    try { await start(); } catch (e) { /* 忽略：端口占用等情况不阻塞启动 */ }
  }

  function applyStartedUI() {
    const st = $('#lanStatus'), btn = $('#lanToggle');
    if (st) {
      st.textContent = S.started ? '已开启' : '未开启';
      st.className = 'lan-status ' + (S.started ? 'lan-on' : 'lan-off');
    }
    if (btn) btn.textContent = S.started ? '关闭飞鸽传书' : '开启飞鸽传书';
    // 聊天 / 文件控件：需已开启且已选中成员
    ['#lanInput', '#lanSend', '#lanFile', '#lanFolder'].forEach((s) => { const el = $(s); if (el) el.disabled = !S.started || !S.activePeer; });
  }

  function applyName() {
    const n = $('#lanMyName') && $('#lanMyName').value.trim();
    if (!n) { toast('昵称不能为空', 'err'); return; }
    CM.lanSetName(n);
    toast('昵称已更新', 'ok');
  }
  function addPeer() {
    const ip = $('#lanAddIp') && $('#lanAddIp').value.trim();
    if (!ip) { toast('请输入对方 IP', 'err'); return; }
    CM.lanAddPeer(ip);
    toast('已向 ' + ip + ' 发送探测，若对方在线将出现在列表中', 'ok', 3600);
  }

  /* ============================ 在线 / 离线成员 ============================ */
  /** 把时长（毫秒）转成简短中文：如 30 秒 / 1 天 / 7 天 / 30 天 */
  function humanSpan(ms) {
    const s = Math.round((Number(ms) || 0) / 1000);
    if (s < 60) return s + ' 秒';
    if (s < 3600) return Math.round(s / 60) + ' 分钟';
    if (s < 86400) return Math.round(s / 3600) + ' 小时';
    const d = Math.round(s / 86400);
    if (d < 30) return d + ' 天';
    return Math.round(d / 30) + ' 个月';
  }

  /**
   * 离线提示文案。
   * hideIn > 0 → 显示「离线 · 12s 后隐藏」倒计时
   * hideIn = 0 → 表示设置为「永不隐藏」，只显示「离线」
   */
  function offlineHint(ms) {
    const s = Math.ceil((Number(ms) || 0) / 1000);
    if (s <= 0) return '';
    if (s < 60) return `离线 · ${s}s 后隐藏`;
    return `离线 · ${humanSpan(ms)}后隐藏`;
  }

  function renderPeers() {
    const box = $('#lanPeers');
    const empty = $('#lanEmpty');
    if (!box) return;
    // 兜底去重：同一 IP 视为同一用户，只显示一条（优先保留在线的那条）
    const byIp = new Map();
    for (const p of S.peers.values()) {
      if (!p.ip) { byIp.set('__' + p.id, p); continue; }
      const dup = byIp.get(p.ip);
      if (!dup || (dup.online === false && p.online !== false)) byIp.set(p.ip, p);
    }
    const all = Array.from(byIp.values());
    const onlineN = all.filter((p) => p.online !== false).length;
    const offN = all.length - onlineN;
    const cnt = $('#lanPeerCount');
    if (cnt) {
      cnt.textContent = onlineN + ' 人在线' + (offN ? ' · ' + offN + ' 人离线' : '');
      cnt.className = 'lan-count' + (onlineN ? ' ok' : '');
    }
    if (!all.length) { box.innerHTML = ''; if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    // 在线置顶，离线沉底
    all.sort((a, b) => {
      const oa = a.online !== false ? 0 : 1, ob = b.online !== false ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
    box.innerHTML = all.map((p) => {
      const online = p.online !== false;
      const unread = S.unread.get(p.id) || 0;
      const active = p.id === S.activePeer ? ' active' : '';
      const badge = unread ? `<span class="lan-badge">${unread}</span>` : '';
      const dot = `<span class="lan-dot ${online ? 'on' : 'off'}" title="${online ? '在线' : '离线'}"></span>`;
      const txt = online ? '' : offlineHint(p.hideIn);
      const tip = txt ? `<div class="lan-peer-off">${esc(txt)}</div>` : (online ? '' : '<div class="lan-peer-off">离线</div>');
      return `<div class="lan-peer-row${active}${online ? '' : ' offline'}" data-id="${esc(p.id)}">
        ${dot}
        <div class="lan-peer-main">
          <div class="lan-peer-name">${esc(p.name)}</div>
          <div class="lan-peer-ip">${esc(p.ip)}</div>
        </div>
        ${tip}
        ${badge}
      </div>`;
    }).join('');
    $$('#lanPeers .lan-peer-row').forEach((el) => {
      el.onclick = () => selectPeer(el.dataset.id);
    });
  }

  /** 离线倒计时走秒：仅在「设置了隐藏时长」时才需要逐秒刷新 */
  function tickOfflineCountdown() {
    if (!S.peers.size) return;
    let needRepaint = false;
    S.peers.forEach((p) => {
      if (p.online === false && p.hideIn > 0) {
        p.hideIn = Math.max(0, p.hideIn - 1000);
        if (p.hideIn % 1000 === 0) needRepaint = true;
      }
    });
    if (needRepaint) renderPeers();
  }

  /** 每秒刷新离线倒计时文案，让「xx 秒后隐藏」持续走秒 */
  function selectPeer(id) {
    S.activePeer = id;
    S.unread.set(id, 0);
    const p = S.peers.get(id);
    const off = p && p.online === false;
    if ($('#lanChatTitle')) $('#lanChatTitle').textContent = '与 ' + (p ? p.name : '成员') + ' 对话' + (off ? '（离线）' : '');
    if ($('#lanChatPeer')) $('#lanChatPeer').textContent = p ? (p.name + ' · ' + p.ip + (off ? ' · 当前离线' : ' · 在线')) : '';
    // 离线成员不允许发送消息 / 文件
    ['#lanInput', '#lanSend', '#lanFile', '#lanFolder'].forEach((s) => { const el = $(s); if (el) el.disabled = !S.started || !S.activePeer || !!off; });
    renderPeers();
    renderChat();
  }

  /* ============================ 聊天 ============================ */
  function renderChat() {
    const box = $('#lanMsgs');
    if (!box) return;
    const list = S.chats.get(S.activePeer) || [];
    if (!S.activePeer || !list.length) {
      box.innerHTML = '<div class="lan-placeholder">选择一位在线成员，即可发送文字、传输文件（支持文件夹与大文件断点续传）。</div>';
      return;
    }
    box.innerHTML = list.map((m) => {
      const cls = m.dir === 'out' ? 'out' : 'in';
      return `<div class="lan-msg ${cls}">
        <div class="lan-msg-bubble"><span class="lan-msg-name">${esc(m.name || (m.dir === 'out' ? '我' : '对方'))}</span>${esc(m.text)}</div>
        <div class="lan-msg-time">${fmtTime(m.ts)}</div>
      </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function sendMsg() {
    const inp = $('#lanInput');
    if (!inp || !S.activePeer) return;
    const text = inp.value.trim();
    if (!text) return;
    CM.lanChat(S.activePeer, text);
    // 发送方本地也持久化（主进程 sendChat 会回传 lan:message 带 dir:out，避免重复由 onMessage 判定）
    inp.value = '';
  }

  function onMessage(p) {
    const arr = S.chats.get(p.peerId) || [];
    // 去重：同一时间戳 + 同文本 + 同方向，避免回显重复
    const dup = arr.some((m) => m.ts === p.ts && m.text === p.text && m.dir === p.dir);
    if (!dup) arr.push({ dir: p.dir, text: p.text, ts: p.ts, name: p.name });
    S.chats.set(p.peerId, arr);
    persistChat(p.peerId);
    if (p.dir === 'in') {
      if (p.peerId !== S.activePeer) {
        S.unread.set(p.peerId, (S.unread.get(p.peerId) || 0) + 1);
        const peer = S.peers.get(p.peerId);
        toast('来自 ' + (peer ? peer.name : '成员') + ' 的新消息', 'info', 2600);
      }
      // 后台收到消息时，把窗口置前并弹系统通知（需已开启飞鸽传书）
      notifyIncoming(p.name, String(p.text || '').slice(0, 60));
    }
    renderPeers();
    renderChat();
  }

  /** 新消息提醒：置前 + 系统通知；界面已在前台时只做轻量提示，避免打扰 */
  function notifyIncoming(name, text) {
    const focused = !!(global.document && document.hasFocus && document.hasFocus());
    if (focused) return;
    if (!CM.lanNotify) return;
    try {
      CM.lanNotify({ title: '飞鸽传书 · ' + (name || '同事'), body: text || '你有一条新消息' });
    } catch (e) {}
  }

  /* -------- 聊天记录持久化（本地文件，重启不丢） -------- */
  function persistChat(peerId) {
    if (!peerId) return;
    const list = S.chats.get(peerId) || [];
    CM.lanSaveChats(peerId, list);
  }

  /** 从磁盘恢复全部聊天记录 */
  async function restoreChats() {
    try {
      const r = await CM.lanLoadChats();
      if (r && r.chats) {
        Object.keys(r.chats).forEach((pid) => {
          if (!S.chats.has(pid)) S.chats.set(pid, r.chats[pid] || []);
        });
      }
      if (r && r.retention) {
        S.retention = r.retention;
        const sel = $('#lanRetention'); if (sel) sel.value = r.retention;
      }
      // 恢复「离线成员自动隐藏」设置（0 = 永不隐藏）
      if (r && typeof r.offlineKeep === 'number') {
        S.offlineKeep = r.offlineKeep;
        const sel = $('#lanOfflineKeep');
        if (sel) sel.value = offlineKeepValue(r.offlineKeep);
      }
      // 恢复「关闭主窗口时」设置（默认最小化到托盘）
      if (r && typeof r.closeToTray === 'boolean') {
        S.closeToTray = r.closeToTray;
        const sel = $('#lanCloseToTray');
        if (sel) sel.value = r.closeToTray ? 'tray' : 'quit';
      }
    } catch (e) { /* 忽略，首次运行无记录 */ }
  }

  /** 设置「关闭主窗口时」的行为：最小化到托盘 / 直接退出 */
  async function setCloseToTray(value) {
    const toTray = value !== 'quit';
    S.closeToTray = toTray;
    const r = await CM.lanSetCloseToTray(toTray);
    if (!r || !r.ok) { toast('设置失败，请重试', 'err'); return; }
    toast(toTray ? '已设置：关闭时最小化到托盘' : '已设置：关闭时直接退出程序', 'ok', 3200);
  }

  /** 把毫秒值映射为下拉框的取值（unlimited / 30s / 1d / 7d / 30d） */
  function offlineKeepValue(ms) {
    const m = Number(ms) || 0;
    if (m <= 0) return 'unlimited';
    if (m <= 30000) return '30s';
    if (m <= 86400000) return '1d';
    if (m <= 604800000) return '7d';
    return '30d';
  }
  const OFFLINE_KEEP_MS = { unlimited: 0, '30s': 30000, '1d': 86400000, '7d': 604800000, '30d': 2592000000 };
  function offlineKeepLabel(v) {
    return v === 'unlimited' ? '永不自动隐藏' : v === '30s' ? '离线 30 秒后隐藏'
      : v === '1d' ? '离线 1 天后隐藏' : v === '7d' ? '离线 7 天后隐藏' : '离线 1 个月后隐藏';
  }

  /** 设置「离线成员自动隐藏」时长并立即生效 */
  async function setOfflineKeep(value) {
    const ms = OFFLINE_KEEP_MS[value] != null ? OFFLINE_KEEP_MS[value] : 0;
    S.offlineKeep = ms;
    const r = await CM.lanSetOfflineKeep(ms);
    const ok = r && r.ok;
    if (!ok) { toast('设置失败，请重试', 'err'); return; }
    toast('已设置：' + offlineKeepLabel(value), 'ok', 3200);
    // 本地立即按新规则重算一次展示（离线倒计时需要马上刷新）
    if (ms > 0) {
      const now = Date.now();
      S.peers.forEach((p) => {
        if (p.online === false) p.hideIn = Math.max(0, ms - (now - (p.offlineAt || now)));
        else p.hideIn = 0;
      });
    } else {
      S.peers.forEach((p) => { p.hideIn = 0; });
    }
    renderPeers();
  }

  /** 设置保留期（half=半年 year=一年 forever=永久）并触发清理 */
  async function setRetention(value) {
    S.retention = value;
    const r = await CM.lanSetRetention(value);
    const removed = (r && r.removed) || 0;
    toast('聊天记录保留期已设为「' + retentionLabel(value) + '」' + (removed ? `，已清理 ${removed} 条过期记录` : ''), 'ok', 3600);
    // 同步清理内存
    if (removed) { await restoreReload(); }
  }
  function retentionLabel(v) {
    return v === 'half' ? '半年' : v === 'year' ? '一年' : '永久';
  }
  async function restoreReload() {
    S.chats = new Map();
    await restoreChats();
    renderChat();
  }

  /* ============================ 文件传输 ============================ */
  function fileIcon(f) {
    if (f.isFolder) return '📁';
    const n = (f.name || '').toLowerCase();
    if (/\.(mp4|mov|avi|mkv|wmv)$/.test(n)) return '🎬';
    if (/\.(mp3|wav|flac|m4a)$/.test(n)) return '🎵';
    if (/\.(png|jpg|jpeg|gif|webp|bmp)$/.test(n)) return '🖼';
    if (/\.(xls|xlsx|csv)$/.test(n)) return '📊';
    if (/\.(doc|docx)$/.test(n)) return '📝';
    if (/\.(ppt|pptx)$/.test(n)) return '📽';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜';
    if (/\.pdf$/.test(n)) return '📕';
    return '📄';
  }
  function fileRow(f) {
    const pct = f.size ? Math.min(100, Math.round((f.sent / f.size) * 100)) : (f.done ? 100 : 0);
    const dirTxt = f.dir === 'out' ? '发送' : '接收';
    const status = f.done ? (f.dir === 'in' && f.path ? '<span class="lan-fdone">已接收</span>' : '已完成') : (pct + '%');
    const time = f.ts ? `<span class="muted">· ${fmtDateTime(f.ts)}</span>` : '';
    // 已落地文件：无论收发，只要本机有路径即可打开
    const openBtn = (f.path)
      ? `<button class="btn btn-sm" data-open="${esc(f.path)}">打开</button><button class="btn btn-sm ghost" data-folder="${esc(f.path)}">文件夹</button>`
      : '';
    return `<div class="lan-file" data-id="${esc(f.id)}">
      <div class="lan-file-ic">${fileIcon(f)}</div>
      <div class="lan-file-main">
        <div class="lan-file-name">${esc(f.name)} <span class="muted">· ${fmtSize(f.size)} · ${dirTxt}</span> ${time}</div>
        ${f.isFolder ? '' : `<div class="lan-file-bar"><span style="width:${pct}%"></span></div>`}
      </div>
      <div class="lan-file-status">${status}</div>
      <div class="row" style="gap:6px">${openBtn}</div>
    </div>`;
  }
  function dirOf(p) { return (p || '').replace(/[\\/][^\\/]*$/, ''); }

  function renderFiles() {
    const box = $('#lanFiles');
    if (!box) return;
    const arr = S.files.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if ($('#lanFileCount')) $('#lanFileCount').textContent = arr.length + ' 条记录';
    if (!arr.length) { box.innerHTML = '<div class="muted">暂无文件传输记录。发送或接收文件后，记录会保存在这里，重启软件也不会丢失。</div>'; return; }
    box.innerHTML = arr.map(fileRow).join('');
    $$('#lanFiles [data-open]').forEach((b) => { b.onclick = () => CM.openPath(b.dataset.open); });
    $$('#lanFiles [data-folder]').forEach((b) => { b.onclick = () => CM.openPath(dirOf(b.dataset.folder)); });
  }

  /** 文件记录持久化（按 id 归并：进度更新、完成状态、落地路径） */
  function upsertFile(id, patch) {
    let f = S.files.find((x) => x.id === id);
    if (!f) { f = { id, name: '', size: 0, sent: 0, dir: 'in', done: false, path: null, ts: Date.now() }; S.files.push(f); }
    Object.assign(f, patch);
    return f;
  }
  function persistFiles() {
    if (CM.lanSaveFiles) CM.lanSaveFiles(S.files);
  }
  async function restoreFiles() {
    try {
      const r = await CM.lanLoadFiles();
      if (r && Array.isArray(r.files)) S.files = r.files;
    } catch (e) { /* 首次运行无记录 */ }
  }

  function onFileEvent(p) {
    if (p.type === 'incoming') {
      const base = { name: p.name, size: p.size, sent: p.offset || 0, dir: 'in', done: false, path: null, peerId: p.peerId, rel: p.rel, ts: Date.now() };
      upsertFile(p.fileId, base);
      if (p.resumed) toast('正在断点续传「' + (p.name || '') + '」：已收到 ' + fmtSize(p.offset || 0) + ' / ' + fmtSize(p.size || 0), 'info', 3600);
    } else if (p.type === 'progress') {
      const f = upsertFile(p.fileId, {});
      f.sent = p.sent; f.size = p.size || f.size; f.name = p.name || f.name; f.dir = p.dir || f.dir;
      if (!f.ts) f.ts = Date.now();
    } else if (p.type === 'done') {
      upsertFile(p.fileId, { sent: p.size, size: p.size, done: true, path: p.path || undefined, dir: p.dir || undefined, name: p.name || undefined, rel: p.rel });
      const f = S.files.find((x) => x.id === p.fileId);
      if (f && f.dir === 'in') toast('收到文件：' + f.name + (f.path ? '（可在「文件传输」中点打开）' : ''), 'ok', 4000);
    } else if (p.type === 'error') {
      toast('文件传输失败：' + p.error, 'err', 4000);
    } else if (p.type === 'folderStart') {
      toast('开始接收文件夹「' + (p.name || '') + '」…', 'info', 3000);
    } else if (p.type === 'folderDone') {
      toast('文件夹「' + (p.name || '') + '」传输完成，共 ' + (p.count || 0) + ' 个文件', 'ok', 4000);
    }
    persistFiles();
    renderFiles();
  }

  async function pickAndSendFile() {
    if (!S.activePeer) return;
    const r = await CM.lanPickFile();
    if (r.canceled || !r.path) return;
    await CM.lanSendFile(S.activePeer, r.path);
  }

  /** 选择文件夹发送（递归，逐个文件传输） */
  async function pickAndSendFolder() {
    if (!S.activePeer) return;
    const r = await CM.lanPickFolder();
    if (r.canceled || !r.path) return;
    toast('正在发送文件夹「' + (r.name || '') + '」…', 'info', 3000);
    await CM.lanSendFolder(S.activePeer, r.path);
  }

  /* ==================== 拖拽发送（文件 / 文件夹拖入窗口即发） ==================== */
  /** 切换聊天卡片高亮态（CSS .dropping 控制「松开鼠标即可发送」提示遮罩显隐） */
  function setDropHint(on) {
    const card = $('.lan-chat-card');
    if (!card || !card.classList) return;
    if (on) card.classList.add('dropping');
    else card.classList.remove('dropping');
  }

  /** 切到飞鸽传书界面（拖入时若停留在其他界面，先切换过来给出反馈） */
  function goLan() { try { if (App.go) App.go('lan'); } catch (e) {} }

  /** 当前是否正处于飞鸽传书界面（决定拖拽经过时是否显示高亮） */
  function onLanView() {
    const v = $('#view-lan');
    if (!v) return true; // 无该节点（测试 / 异常场景）时不拦截
    try {
      if (v.classList && typeof v.classList.contains === 'function') return v.classList.contains('active');
    } catch (e) { /* 打桩环境的 classList 无 contains */ }
    return /active/.test(v.className || '');
  }

  /** 是否携带文件 / 文件夹的拖拽（排座等界面内部拖拽用 text/plain，必须放行） */
  function isFileDrag(dt) {
    if (!dt || !dt.types) return false;
    return Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
  }

  /**
   * 归一化目录条目路径：Chromium 在 Windows 下 entry.fullPath 形如 /C:/Users/...，
   * 去掉前导斜杠并转回反斜杠，得到 fs 可直接使用的 C:\Users\...
   */
  function normalizeDropPath(p) {
    if (!p) return '';
    const m = /^\/([A-Za-z]:)(.*)$/.exec(p);
    if (m) return (m[1] + m[2]).replace(/\//g, '\\');
    return p;
  }
  function baseName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''; }

  /**
   * 窗口级拖拽处理：把文件 / 文件夹拖到窗口上即发送给当前成员。
   * - 仅响应 dataTransfer.types 含 Files 的拖拽（排座拖拽为 text/plain，不受影响）
   * - 落在成绩导入区 .drop-zone 上时放行（该区域有自己的导入逻辑）
   * - 文件项经 webUtils.getPathForFile 取真实路径；目录项经 webkitGetAsEntry 取 fullPath
   */
  async function handleDrop(e) {
    const dt = e && e.dataTransfer;
    if (!isFileDrag(dt)) return; // 非文件拖拽（如排座）不处理
    if (e.preventDefault) e.preventDefault();
    S.dropDepth = 0;
    setDropHint(false);
    if (e.target && e.target.closest && e.target.closest('.drop-zone')) return; // 成绩导入区自治
    if (!S.started) { goLan(); toast('请先开启飞鸽传书，再拖入文件发送', 'err'); return; }
    if (!S.activePeer) { goLan(); toast('请先在左侧选择一位成员，再拖入文件发送', 'info', 3600); return; }
    goLan();

    // 同步取出条目（drop 事件分发结束后 items 即失效），目录与文件分开处理
    const items = Array.from(dt.items || []);
    const dirs = [];
    const files = [];
    for (const it of items) {
      if (!it || it.kind !== 'file') continue;
      let entry = null;
      try { entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch (err) { entry = null; }
      if (entry && entry.isDirectory) { dirs.push(entry); continue; }
      const f = it.getAsFile ? it.getAsFile() : null;
      if (f) files.push(f);
    }
    // 兜底：个别环境 items 不可用时退化为 files
    if (!dirs.length && !files.length) files.push(...Array.from(dt.files || []));

    let sent = 0;
    for (const f of files) {
      const p = CM.getPathForFile ? CM.getPathForFile(f) : '';
      if (!p) { toast('无法获取「' + (f.name || '该文件') + '」的路径，请点 📎 按钮选择发送', 'err'); continue; }
      try { await CM.lanSendFile(S.activePeer, p); sent++; }
      catch (err) { toast('发送「' + (f.name || '') + '」失败：' + (err && err.message ? err.message : err), 'err'); }
    }
    for (const en of dirs) {
      const p = normalizeDropPath(en.fullPath || en.name || '');
      if (!p) continue;
      toast('正在发送文件夹「' + baseName(p) + '」…', 'info', 3000);
      try { await CM.lanSendFolder(S.activePeer, p); sent++; }
      catch (err) { toast('发送文件夹「' + baseName(p) + '」失败：' + (err && err.message ? err.message : err), 'err'); }
    }
    if (sent > 1) toast('已开始发送 ' + sent + ' 项（文件 / 文件夹），进度见下方「文件传输记录」', 'ok', 3600);
  }

  /**
   * 绑定窗口级拖拽（仅一次）。
   * dragover 必须 preventDefault，否则 Electron 会以默认行为直接打开拖入的文件。
   */
  function bindWindowDrop() {
    if (S.windowDropReady || typeof global.addEventListener !== 'function') return;
    S.windowDropReady = true;
    const onOver = (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      if (e.preventDefault) e.preventDefault();
      try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
      if (onLanView()) setDropHint(true);
    };
    global.addEventListener('dragover', onOver);
    global.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      if (e.preventDefault) e.preventDefault();
      S.dropDepth++;
      if (onLanView()) setDropHint(true);
    });
    global.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      S.dropDepth = Math.max(0, S.dropDepth - 1);
      if (S.dropDepth === 0) setDropHint(false);
    });
    global.addEventListener('drop', (e) => { handleDrop(e); });
    global.addEventListener('dragend', () => { S.dropDepth = 0; setDropHint(false); });
  }

  /* ============================ 事件监听（仅注册一次） ============================ */
  function registerListeners() {
    if (S.listenersReady) return;
    S.listenersReady = true;
    CM.lanOn('lan:peers', (list) => {
      const prev = S.peers;
      S.peers = new Map(list.map((p) => [p.id, p]));
      // 当前会话对象已从列表移除（配置了隐藏时长且离线已超时）：取消选中并提示
      if (S.activePeer && !S.peers.has(S.activePeer)) {
        const wasName = prev.get(S.activePeer) ? prev.get(S.activePeer).name : '对方';
        S.activePeer = null;
        ['#lanInput', '#lanSend', '#lanFile', '#lanFolder'].forEach((s) => { const el = $(s); if (el) el.disabled = true; });
        toast(wasName + ' 已离线，成员已从列表移除', 'info', 3000);
      } else if (S.activePeer) {
        // 会话对象离线/恢复时同步刷新输入区可用状态
        const p = S.peers.get(S.activePeer);
        const off = p && p.online === false;
        ['#lanInput', '#lanSend', '#lanFile', '#lanFolder'].forEach((s) => { const el = $(s); if (el) el.disabled = !S.started || !!off; });
      }
      renderPeers();
    });
    // 测试/截图辅助：允许从控制台注入一份成员列表来观察在线/离线渲染（不影响线上逻辑）
    try { window.__lanPeersHandler = (list) => { S.peers = new Map(list.map((p) => [p.id, p])); renderPeers(); }; } catch (e) {}
    CM.lanOn('lan:message', (p) => onMessage(p));
    // 注意：引擎载荷内含文件 MIME 的 type 字段，必须让事件类型 type 放在展开之后，避免被覆盖
    CM.lanOn('lan:fileIncoming', (p) => onFileEvent({ ...p, type: 'incoming' }));
    CM.lanOn('lan:fileProgress', (p) => onFileEvent({ ...p, type: 'progress' }));
    CM.lanOn('lan:fileDone', (p) => onFileEvent({ ...p, type: 'done' }));
    CM.lanOn('lan:fileError', (p) => onFileEvent({ ...p, type: 'error' }));
    CM.lanOn('lan:folderStart', (p) => onFileEvent({ ...p, type: 'folderStart' }));
    CM.lanOn('lan:folderDone', (p) => onFileEvent({ ...p, type: 'folderDone' }));
    // 点击系统通知时切到飞鸽传书界面
    CM.lanOn('lan:focus-view', () => { try { if (App.go) App.go('lan'); } catch (e) {} });
  }

  /* ============================ 初始化 / 渲染 ============================ */
  function init() {
    registerListeners();
    // 窗口级拖拽发送：文件 / 文件夹拖到窗口上即发送给当前成员
    bindWindowDrop();
    // 控件事件
    const t = $('#lanToggle'); if (t) t.onclick = toggle;
    const an = $('#lanApplyName'); if (an) an.onclick = applyName;
    const ab = $('#lanAddBtn'); if (ab) ab.onclick = addPeer;
    const ip = $('#lanInput'); if (ip) ip.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
    const se = $('#lanSend'); if (se) se.onclick = sendMsg;
    const fe = $('#lanFile'); if (fe) fe.onclick = pickAndSendFile;
    const fd = $('#lanFolder'); if (fd) fd.onclick = pickAndSendFolder;
    const rt = $('#lanRetention'); if (rt) rt.onchange = () => setRetention(rt.value);
    const ok_ = $('#lanOfflineKeep'); if (ok_) ok_.onchange = () => setOfflineKeep(ok_.value);
    const ctt = $('#lanCloseToTray'); if (ctt) ctt.onchange = () => setCloseToTray(ctt.value);
    const cl = $('#lanClearChat'); if (cl) cl.onclick = clearActiveChat;
    const cf = $('#lanClearFiles'); if (cf) cf.onclick = clearFileRecords;
    const of_ = $('#lanOpenFolder'); if (of_) of_.onclick = openIncomingFolder;
    const rs = $('#lanRescan'); if (rs) rs.onclick = () => {
      if (CM.lanRescan) CM.lanRescan();
      toast('正在重新扫描同网段成员…', 'info', 2000);
    };
    // 申请通知权限：收到新消息时需要弹系统通知提醒
    try {
      if (global.Notification && global.Notification.permission === 'default') {
        global.Notification.requestPermission().catch(() => {});
      }
    } catch (e) {}
    // 开机自动启动（便于同网段同事随时发现本机）
    const al = $('#lanAutoLaunch');
    if (al) {
      CM.lanAutoLaunchGet && CM.lanAutoLaunchGet().then((r) => { al.checked = !!(r && r.on); }).catch(() => {});
      al.onchange = () => {
        if (!CM.lanAutoLaunchSet) return;
        CM.lanAutoLaunchSet(al.checked).then((r) => {
          if (r && r.ok) toast(al.checked ? '已开启开机自动启动，同事可随时发现本机' : '已关闭开机自动启动', 'ok');
          else { al.checked = !al.checked; toast('设置失败，请重试', 'err'); }
        }).catch(() => { al.checked = !al.checked; });
      };
    }
    // 默认昵称
    if ($('#lanMyName') && !$('#lanMyName').value) $('#lanMyName').value = (global.Store && global.Store.S.db.meta.teacherName) || '';
    // 恢复历史聊天与文件记录
    restoreChats().then(() => { renderChat(); renderPeers(); });
    restoreFiles().then(() => renderFiles());
    applyStartedUI();
    // 渲染层定时兜底重扫：只要软件开着就周期性重新发现同网段成员，避免"必须重启才看得到对方"
    if (!S.uiRescanTimer) {
      S.uiRescanTimer = setInterval(() => {
        if (S.started) { try { CM.lanRescan && CM.lanRescan(); } catch (e) {} }
      }, 8000);
    }
    // 离线倒计时走秒：让「离线 · Ns 后隐藏」实时刷新
    if (!S.offlineTimer) S.offlineTimer = setInterval(() => tickOfflineCountdown(), 1000);
    // 开机自动开启飞鸽传书
    autoStart();
  }

  /** 打开本机「接收目录」，便于用户直接找到收到的文件 */
  function openIncomingFolder() {
    // 优先用最近一次接收记录所在目录，其次回落到系统接收目录
    const f = S.files.filter((x) => x.dir === 'in' && x.path).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (f && f.path) { CM.openPath(f.path.replace(/[\\/][^\\/]*$/, '')); return; }
    CM.lanOpenIncoming && CM.lanOpenIncoming();
    toast('已打开接收目录', 'ok');
  }

  /** 清空文件传输记录（仅清列表，不删除已下载文件） */
  function clearFileRecords() {
    S.files = [];
    persistFiles();
    renderFiles();
    toast('已清空文件传输记录', 'ok');
  }

  /** 清空当前会话（本地） */
  function clearActiveChat() {
    const pid = S.activePeer;
    if (!pid) return;
    S.chats.set(pid, []);
    CM.lanSaveChats(pid, []);
    renderChat();
    toast('已清空与对方的聊天记录', 'ok');
  }

  function render() {
    registerListeners();
    renderPeers();
    renderChat();
    renderFiles();
    applyStartedUI();
    // 兜底：进入界面时主动重新扫描一次，避免"对方其实已在线，但列表没刷出来"
    if (S.started && CM.lanRescan) { try { CM.lanRescan(); } catch (e) {} }
  }

  function toast(msg, type, ms) { if (App.toast) App.toast(msg, type, ms); }
  function closeModal() { if (App.closeModal) App.closeModal(); }

  /** 释放资源（测试与切换用户时使用） */
  function dispose() {
    if (S.uiRescanTimer) { clearInterval(S.uiRescanTimer); S.uiRescanTimer = null; }
    if (S.offlineTimer) { clearInterval(S.offlineTimer); S.offlineTimer = null; }
  }

  global.LAN = { init, render, start, stop, toggle, dispose, selectPeer, handleDrop };
})(window);
