'use strict';
/**
 * 班级智管 · 局域网通信引擎（纯 Node 实现，便于单元测试）
 *
 * 能力：
 *  - UDP 广播发现：周期性 announce，监听同网段其他实例；支持手动 probe（按 IP 添加）
 *  - TCP 中继：基于长度前缀(JSON)帧协议，每条消息可被可靠送达对端
 *  - 文字聊天：经 TCP 中继的实时消息
 *  - 文件传输：主进程读取文件、分块 base64 经 TCP 发送，接收方落地到 incoming 目录
 *  - 断点续传：大文件中断后可询问对端已落盘偏移，从断点继续（ask-offset / resume）
 *  - 在线状态：实时区分在线 / 离线；离线默认**永不自动隐藏**，可在设置中配置隐藏时长
 *
 * 已移除：音视频（对讲 / 视频通话）能力与相关信令转发。
 *
 * 设计要点：
 *  - 通过构造参数 emit(event, payload) 把事件推给上层（Electron 中即 webContents.send）
 *  - 不依赖 electron，可在 node 中直接实例化做集成测试
 */
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_UDP = 37123;
const DEFAULT_TCP = 37124;
const ANNOUNCE_INTERVAL = 1800;   // 广播周期间隔（缩短以加快互相发现）
const PEER_TIMEOUT = 9000;        // 超过此时间未收到心跳则剔除（客户端 30s 内隐藏的前置判定）
const HEARTBEAT_INTERVAL = 3000;  // TCP 心跳间隔：维持长连接活性（含 NAT/防火墙保活）
const RESCAN_INTERVAL = 4000;     // 周期性重扫：主动 discover，确保对方上线后被自动发现
const MAX_FILE = 6 * 1024 * 1024 * 1024;   // 单文件上限 6GB
const FILE_CHUNK = 64 * 1024;     // 单块原始字节（64KB）：单帧约 88KB，远低于 TCP 接收窗口，避免大帧丢包
const FILE_HIGH_WATER = 8 * 1024 * 1024;   // 发送缓冲高水位：超过则等待 drain，防止 6GB 文件把内存撑爆
const FILE_YIELD = 4;             // 每发送 N 块让出一次事件循环
const OFFER_TIMEOUT = 20000;      // 文件请求后等待对端应答的超时
const RESUME_TIMEOUT = 20000;     // 询问断点偏移的超时
const OFFLINE_KEEP_DEFAULT = 0;   // 离线成员保留时长（ms）；0 = 永不自动隐藏（默认）
                                  // 可在「设置」中改为 30 秒 / 1 天 / 7 天 / 1 个月
const MAX_FRAME = 32 * 1024 * 1024;   // 单帧上限 32MB（防御性上限，正常帧约 88KB）

/* ----------------------------- 工具 ----------------------------- */
function broadcastAddresses() {
  const addrs = new Set();
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const f of ifaces[name]) {
      if (f.family === 'IPv4' && !f.internal && f.netmask) {
        const ip = f.address.split('.').map(Number);
        const mask = f.netmask.split('.').map(Number);
        const bc = ip.map((b, i) => (b | (~mask[i] & 255)) & 255);
        addrs.add(bc.join('.'));
      }
    }
  }
  addrs.add('255.255.255.255');
  return Array.from(addrs);
}

function encodeFrame(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 稳定短哈希：用于给"同名同大小"的文件生成一致的续传标识 */
function hashKey(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/** 在目标目录下取一个不冲突的文件路径：重名时追加 (1) (2) … 不覆盖已有文件 */
function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let p = path.join(dir, fileName);
  let i = 1;
  while (fs.existsSync(p)) { p = path.join(dir, `${stem}(${i})${ext}`); i++; if (i > 999) break; }
  return p;
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};
function mimeOf(name) { return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'; }

/* --------------------------- 连接读取器 --------------------------- */
// 在每条 socket 上维护一个累积缓冲，按 4 字节长度前缀切出完整帧
function attachReader(sock, onFrame, onError) {
  sock._buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    sock._buf = Buffer.concat([sock._buf, chunk]);
    while (sock._buf.length >= 4) {
      const len = sock._buf.readUInt32BE(0);
      // 防御：非法长度（超过 32MB 上限）视为流损坏，直接断开，避免内存暴涨与死等
      if (len <= 0 || len > MAX_FRAME) {
        if (onError) onError(new Error('非法帧长度 ' + len));
        try { sock.destroy(); } catch (e) {}
        return;
      }
      if (sock._buf.length < 4 + len) break;
      const payload = sock._buf.slice(4, 4 + len);
      sock._buf = sock._buf.slice(4 + len);
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { if (onError) onError(e); continue; }
      onFrame(msg);
    }
  });
}

/* ============================ 引擎 ============================ */
class LANEngine {
  constructor(opts = {}) {
    this.udpPort = opts.udpPort || DEFAULT_UDP;
    this.tcpPort = opts.tcpPort || DEFAULT_TCP;
    this.selfId = opts.selfId || ('cm-' + Math.random().toString(36).slice(2, 10));
    this.name = opts.name || os.hostname();
    this.status = 'online'; // online | offline
    this.emit = opts.emit || (() => {});
    this.incomingDir = opts.incomingDir || path.join(os.tmpdir(), 'ClassMasterLanIncoming');
    // 离线成员保留时长（ms）：0 表示永不自动隐藏，由「设置」页配置
    this.offlineKeep = Number(opts.offlineKeep) > 0 ? Number(opts.offlineKeep) : OFFLINE_KEEP_DEFAULT;

    this.udp = null;
    this.tcpServer = null;
    this.peers = new Map();      // id -> { id,name,ip,tcpPort,lastSeen,status,online }
    this.conns = new Map();      // peerId -> socket（已握手）
    this._ipIndex = new Map();   // ip -> 该 IP 的「主记录 id」：同一 IP 只保留一个成员，避免重复显示
    this._aliases = new Map();   // 别名 id -> 主记录 id：同一 IP 的不同 id 统一归并到主记录
    this._fileReceivers = new Map(); // fileId -> { meta, peerId, ws, received, savePath, failed }
    this._pendingOffers = new Map(); // fileId -> { resolve, timer }：等待接收方 ACK
    this._pendingResume = new Map(); // fileId -> { resolve, timer }：等待接收方回报断点偏移
    this._known = new Map();         // peerId -> { ip, udpPort }：历史成员，用于重扫时定向探测
    this._announceTimer = null;
    this._pruneTimer = null;
    this.running = false;
  }

  /* ---------------------- 同一 IP 去重（核心） ----------------------
   * 同一台电脑可能因为「重装 / 缓存不同步 / 多网卡」产生多个 id，
   * 若各自独立成条，列表中就会出现重复成员。这里以 **IP 为唯一身份**：
   *   - 每个 IP 只保留一条「主记录」，先出现者为主；
   *   - 后续同 IP 的新 id 记为「别名」，其心跳/连接/名称都归并到主记录；
   *   - 对外（前端列表、发送消息、文件传输）统一使用主记录 id。
   */

  /** 把可能为别名的 id 解析为主记录 id（不存在则原样返回） */
  resolveId(id) {
    if (!id) return id;
    const alias = this._aliases.get(id);
    return alias && this.peers.has(alias) ? alias : id;
  }

  /**
   * 写入 / 合并一条成员记录。
   * @param {string} id   对端上报的 id（可能是别名）
   * @param {object} info { name, ip, tcpPort, online }
   * @returns {string} 实际生效的主记录 id
   */
  _mergePeer(id, info) {
    if (!id || id === this.selfId) return id;
    const ip = info.ip;
    // 1) 该 id 已是别名 → 直接归并到主记录
    let target = this._aliases.get(id);
    // 2) 该 IP 已有主记录 → 本次上报归并过去
    if (!target && ip && this._ipIndex.has(ip)) target = this._ipIndex.get(ip);
    // 3) 都没有 → 该 id 升为这个 IP 的主记录
    if (!target) {
      target = id;
      if (ip) this._ipIndex.set(ip, target);
      this._aliases.delete(id);
    } else if (target !== id) {
      // 记录别名，并迁移可能存在的连接（同一 IP 的连接视为同一条）
      this._aliases.set(id, target);
      const sock = this.conns.get(id);
      if (sock) { this.conns.delete(id); if (!this.conns.has(target) || this.conns.get(target).destroyed) this.conns.set(target, sock); }
      // 同 IP 的旧记录直接删除，避免重复显示
      if (target !== id && this.peers.has(id)) this.peers.delete(id);
    }

    const prev = this.peers.get(target) || {};
    this.peers.set(target, {
      id: target,
      name: info.name || prev.name || '未知用户',
      ip: ip || prev.ip,
      tcpPort: info.tcpPort || prev.tcpPort,
      lastSeen: Date.now(),
      online: info.online !== false,
      offlineAt: info.online === false ? (prev.offlineAt || Date.now()) : 0,
      status: info.online === false ? 'offline' : 'online'
    });
    if (ip) this._ipIndex.set(ip, target);
    if (info.name) this._known.set(target, { ip: ip || prev.ip, udpPort: this.udpPort, name: info.name });
    return target;
  }

  /** 清理已失效的 IP 索引（成员被移除时调用） */
  _dropIpIndex(id, ip) {
    const key = ip || (this.peers.get(id) || {}).ip;
    if (key && this._ipIndex.get(key) === id) this._ipIndex.delete(key);
    for (const [alias, main] of this._aliases) { if (main === id) this._aliases.delete(alias); }
  }

  /* ---------------------------- 启停 ---------------------------- */
  start() {
    if (this.running) return true;
    this._startUdp();
    this._startTcp();
    this._announceTimer = setInterval(() => this._announce(), ANNOUNCE_INTERVAL);
    this._pruneTimer = setInterval(() => this._prune(), 1500);
    // 周期性重扫 + 心跳保活：解决"对方上线后一直不出现、必须重启软件"的问题
    this._rescanTimer = setInterval(() => this._rescan(), RESCAN_INTERVAL);
    this._heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_INTERVAL);
    this.running = true;
    // 立即广播一次并探活
    this._announce();
    this._discover();
    return true;
  }

  stop() {
    this.running = false;
    if (this._announceTimer) clearInterval(this._announceTimer);
    if (this._pruneTimer) clearInterval(this._pruneTimer);
    if (this._rescanTimer) clearInterval(this._rescanTimer);
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._announceTimer = this._pruneTimer = this._rescanTimer = this._heartbeatTimer = null;
    // 清理未完成的文件等待与接收流，避免重启后残留
    if (this._pendingOffers) {
      for (const [, w] of this._pendingOffers) { try { clearTimeout(w.timer); w.resolve(null); } catch (e) {} }
      this._pendingOffers.clear();
    }
    if (this._pendingResume) {
      for (const [, w] of this._pendingResume) { try { clearTimeout(w.timer); w.resolve(0); } catch (e) {} }
      this._pendingResume.clear();
    }
    if (this._fileReceivers) {
      // 未收完的分片保留 .part 文件，下次同文件重发时可续传
      for (const [, r] of this._fileReceivers) { try { r.ws.end(); } catch (e) {} }
      this._fileReceivers.clear();
    }
    // 通知在线成员离线
    for (const [id, sock] of this.conns) {
      try { sock.write(encodeFrame({ t: 'bye', id: this.selfId })); } catch (e) {}
      try { sock.destroy(); } catch (e) {}
    }
    this.conns.clear();
    if (this.udp) { try { this.udp.close(); } catch (e) {} this.udp = null; }
    if (this.tcpServer) { try { this.tcpServer.close(); } catch (e) {} this.tcpServer = null; }
    this.peers.clear();
    this._ipIndex.clear();
    this._aliases.clear();
  }

  setName(name) { this.name = (name || '').trim() || os.hostname(); if (this.running) this._announce(); }

  /**
   * 设置离线成员自动隐藏时长（ms）：0 = 永不隐藏。
   * 变更后立即重算一次，让已离线的成员按新规则生效（例如从"永不隐藏"改为"30 秒"后立即收敛）。
   */
  setOfflineKeep(ms) {
    this.offlineKeep = Number(ms) > 0 ? Number(ms) : 0;
    if (this.running) this._prune();
    return this.offlineKeep;
  }

  /* ---------------------------- UDP ---------------------------- */
  _startUdp() {
    // 关键：必须使用 reuseAddr。多实例（同一台机器跑两个、或端口被其它进程占用）场景下，
    // 不用 reuseAddr 会导致第二个实例直接 EADDRINUSE 起不来，从而"必须重启软件才能发现对方"。
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('error', (e) => console.error('[LAN udp]', e.message));
    this.udp.on('message', (buf, rinfo) => this._onUdp(buf, rinfo));
    this.udp.bind(this.udpPort, () => {
      try { this.udp.setBroadcast(true); } catch (e) {}
      // 绑定成功后立即宣告 + 探测一次，缩短"上线后要等一会儿才出现"的时延
      this._announce();
      this._discover();
    });
  }

  _onUdp(buf, rinfo) {
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
    if ((m.type === 'announce' || m.type === 'discover') && m.id && m.id !== this.selfId) {
      if (m.type === 'discover') {
        // 单播回应，便于手动按 IP 添加对方
        this._respond(rinfo.address, rinfo.port);
      }
      // 同一 IP 只保留一条记录：重复/改名/重装的客户端会归并到主记录
      this._mergePeer(m.id, {
        name: m.name,
        ip: rinfo.address,
        tcpPort: m.tcpPort,
        online: true
      });
      this._emitPeers();
    }
  }

  _announce() {
    if (!this.udp) return;
    const pkt = JSON.stringify({ type: 'announce', id: this.selfId, name: this.name, tcpPort: this.tcpPort, status: this.status, ts: Date.now() });
    const body = Buffer.from(pkt, 'utf8');
    for (const a of broadcastAddresses()) {
      try { this.udp.send(body, 0, body.length, this.udpPort, a); } catch (e) {}
    }
  }

  _respond(addr, port) {
    if (!this.udp) return;
    const pkt = JSON.stringify({ type: 'announce', id: this.selfId, name: this.name, tcpPort: this.tcpPort, status: this.status, ts: Date.now() });
    const body = Buffer.from(pkt, 'utf8');
    try { this.udp.send(body, 0, body.length, port, addr); } catch (e) {}
  }

  _discover() {
    if (!this.udp) return;
    const pkt = JSON.stringify({ type: 'discover', id: this.selfId, name: this.name, tcpPort: this.tcpPort });
    const body = Buffer.from(pkt, 'utf8');
    for (const a of broadcastAddresses()) {
      try { this.udp.send(body, 0, body.length, this.udpPort, a); } catch (e) {}
    }
  }

  /** 手动按 IP 探测（防火墙屏蔽广播时的兜底）；port 省略时使用本机同端口 */
  probeAddress(addr, port) {
    if (!this.udp) return;
    const pkt = JSON.stringify({ type: 'discover', id: this.selfId, name: this.name, tcpPort: this.tcpPort });
    const body = Buffer.from(pkt, 'utf8');
    try { this.udp.send(body, 0, body.length, port || this.udpPort, addr); } catch (e) {}
  }

  /**
   * 周期性清理：
   *  - 超过 PEER_TIMEOUT 未收到心跳 → 标记为「离线」（前端仍显示，但标注离线）
   *  - 离线持续时间超过 offlineKeep → 从列表彻底移除（前端不再显示该成员）
   *
   * offlineKeep 默认 0，即**离线不再自动隐藏**（成员会一直保留在列表中并显示离线状态）；
   * 用户可在「设置」里改为 30 秒 / 1 天 / 7 天 / 1 个月自动隐藏。
   */
  _prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      // 已建立 TCP 连接的对端视为在线，不因偶尔丢一个广播包就被误剔
      const sock = this.conns.get(id);
      if (sock && !sock.destroyed) {
        p.lastSeen = now;
        if (p.online === false) { p.online = true; p.status = 'online'; p.offlineAt = 0; changed = true; }
        continue;
      }
      if (now - (p.lastSeen || 0) > PEER_TIMEOUT) {
        if (p.online !== false) {
          // 刚判定离线：保留在列表中并标注为离线
          p.online = false;
          p.status = 'offline';
          p.offlineAt = now;
          changed = true;
        } else if (this.offlineKeep > 0 && now - (p.offlineAt || now) > this.offlineKeep) {
          // 仅当用户配置了隐藏时长（>0）才移除；默认 0 表示永不隐藏
          this.peers.delete(id);
          this._dropIpIndex(id, p.ip);   // 同步释放 IP 索引，便于该 IP 重新上线时重建记录
          changed = true;
        }
      }
    }
    if (changed) this._emitPeers();
  }

  /** 对外暴露：立即重扫一次（渲染层进入界面 / 用户点刷新时调用） */
  rescan() {
    if (!this.udp) return;
    this._announce();
    this._discover();
    // 主动单播探测历史成员：对方刚上线时能立刻被发现，无需等下一个广播周期
    for (const [id, p] of this._known) {
      if (this.peers.has(id) || !p.ip) continue;
      this._discoverTo(p.ip);
    }
  }

  /** 周期性重扫：主动 discover，确保对方上线后被自动发现 */
  _rescan() {
    if (!this.running) return;
    this._announce();
    this._discover();
    // 对历史成员逐个单播探测：广播可能被防火墙拦截或被 reuseAddr 分流，
    // 单播是更可靠的兜底（对方收到 discover 后会单播回应 announce）。
    for (const [id, p] of this._known) {
      if (this.peers.has(id)) continue;
      if (!p.ip) continue;
      this._discoverTo(p.ip);
    }
  }

  /** 向指定地址单播 discover（比广播可靠） */
  _discoverTo(addr) {
    if (!this.udp) return;
    const pkt = JSON.stringify({ type: 'discover', id: this.selfId, name: this.name, tcpPort: this.tcpPort });
    const body = Buffer.from(pkt, 'utf8');
    // 同时尝试本机端口与对端端口，覆盖端口不一致的情况
    const ports = new Set([this.udpPort, DEFAULT_UDP]);
    for (const p of ports) { try { this.udp.send(body, 0, body.length, p, addr); } catch (e) {} }
  }

  /** TCP 心跳：维持连接活性，探测已断开的连接 */
  _heartbeat() {
    if (!this.running) return;
    for (const [id, sock] of this.conns) {
      if (sock.destroyed) { this.conns.delete(id); continue; }
      try { sock.write(encodeFrame({ t: 'ping', ts: Date.now() })); } catch (e) { this.conns.delete(id); }
    }
    // 对已判定在线但仍无连接的成员补一次连接（注意：不对已离线成员主动重连，
    // 否则对端已下线时会被反复"复活"，导致永远无法从列表移除）
    for (const [id, p] of this.peers) {
      if (p.online === false) continue;
      if (!this.conns.has(id) && p.ip && (Date.now() - (p.lastSeen || 0)) < PEER_TIMEOUT) {
        this._ensureConn(id);
      }
    }
  }

  _emitPeers() {
    const now = Date.now();
    const keep = this.offlineKeep;   // 0 = 永不自动隐藏
    const seenIp = new Map();        // ip -> 已选中的记录（兜底去重，防任何路径漏网）
    const list = [];
    for (const p of this.peers.values()) {
      // 兜底：同一 IP 只输出一条；若已存在，优先保留在线的那条，其次保留先出现的
      if (p.ip) {
        const dup = seenIp.get(p.ip);
        if (dup) {
          const mineOnline = p.online !== false;
          const dupOnline = dup.online !== false;
          if (dupOnline || !mineOnline) continue;    // 已有在线记录，或两条都离线 → 跳过本条
          list.splice(list.indexOf(dup), 1);          // 本条在线而旧记录离线 → 用本条替换
        }
        seenIp.set(p.ip, p);
      }
      const online = p.online !== false;
      // 离线成员附带"剩余隐藏时间"(ms)：0 表示不会自动隐藏
      const hideIn = (online || keep <= 0) ? 0 : Math.max(0, keep - (now - (p.offlineAt || now)));
      // 已离线多久（ms）：设置页与列表可用于展示"离线于 xx"
      const offlineFor = online ? 0 : Math.max(0, now - (p.offlineAt || now));
      list.push({
        id: p.id, name: p.name, ip: p.ip, tcpPort: p.tcpPort,
        status: online ? 'online' : 'offline', online, hideIn, offlineFor,
        offlineAt: p.offlineAt || 0
      });
    }
    this.emit('lan:peers', list);
  }

  /* ---------------------------- TCP ---------------------------- */
  _startTcp() {
    this.tcpServer = net.createServer((sock) => this._setupConn(sock, null));
    this.tcpServer.on('error', (e) => console.error('[LAN tcp]', e.message));
    this.tcpServer.listen(this.tcpPort, () => {
      this.emit('lan:ready', { udpPort: this.udpPort, tcpPort: this.tcpPort });
    });
  }

  _setupConn(sock, presetPeerId) {
    sock._peerId = presetPeerId;
    sock.on('error', () => { /* 静默，close 事件中清理 */ });
    sock.on('close', () => {
      const id = sock._peerId;
      if (id && this.conns.get(id) === sock) this.conns.delete(id);
      // 连接断开：结束该连接上所有等待 ACK 的文件，避免发送方一直空等
      if (this._pendingOffers && this._pendingOffers.size) {
        for (const [fid, w] of Array.from(this._pendingOffers)) {
          if (w.peerId === id || id == null) { clearTimeout(w.timer); w.resolve(null); this._pendingOffers.delete(fid); }
        }
      }
      if (this._pendingResume && this._pendingResume.size) {
        for (const [fid, w] of Array.from(this._pendingResume)) {
          if (w.peerId === id || id == null) { clearTimeout(w.timer); w.resolve(0); this._pendingResume.delete(fid); }
        }
      }
    });
    attachReader(sock, (msg) => this._onMessage(sock, msg), (e) => console.error('[LAN frame]', e.message));
    sock.on('connect', () => {
      // 主动拨出的连接：确保握手身份最先发出（仅一次）
      if (sock._peerId && !sock._helloSent) {
        sock._helloSent = true;
        sock.write(encodeFrame({ t: 'hello', id: this.selfId, name: this.name, tcpPort: this.tcpPort, status: this.status }));
      }
    });
  }

  // 取得/创建到某 peer 的连接（可能在握手前）
  _ensureConn(peerId) {
    const id = this.resolveId(peerId);
    const exist = this.conns.get(id);
    if (exist && !exist.destroyed) return exist;
    const p = this.peers.get(id);
    if (!p || !p.tcpPort) return null;
    const s = net.connect(p.tcpPort, p.ip);
    s._peerId = id;
    this._setupConn(s, id);
    // 立即把握手帧排在缓冲最前，保证身份先于业务消息送达
    s._helloSent = true;
    s.write(encodeFrame({ t: 'hello', id: this.selfId, name: this.name, tcpPort: this.tcpPort, status: this.status }));
    this.conns.set(id, s);
    return s;
  }

  _onMessage(sock, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'hello') {
      // 同一 IP 归并为一条记录：返回主记录 id，连接挂到主记录上
      const mainId = this._mergePeer(msg.id, {
        name: msg.name,
        ip: sock.remoteAddress,
        tcpPort: msg.tcpPort,
        online: true
      });
      sock._peerId = mainId;
      sock._peerName = msg.name;
      this.conns.set(mainId, sock);
      this._emitPeers();
      return;
    }
    const pid = this.resolveId(sock._peerId);
    if (!pid) return;

    switch (msg.t) {
      case 'ping':
        // 心跳：刷新对端在线时间并回一个 pong，双向维持连接
        {
          const p = this.peers.get(pid);
          if (p) { p.lastSeen = Date.now(); if (p.online === false) { p.online = true; p.status = 'online'; p.offlineAt = 0; this._emitPeers(); } }
          try { sock.write(encodeFrame({ t: 'pong', ts: Date.now() })); } catch (e) {}
        }
        break;
      case 'pong':
        {
          const p = this.peers.get(pid);
          if (p) { p.lastSeen = Date.now(); if (p.online === false) { p.online = true; p.status = 'online'; p.offlineAt = 0; this._emitPeers(); } }
        }
        break;
      case 'chat':
        this.emit('lan:message', { peerId: pid, name: msg.name, text: msg.text, ts: msg.ts, dir: 'in' });
        break;
      case 'file-offer':
        this._beginReceive(pid, msg);
        break;
      case 'file-accept':
        // 接收方确认落盘就绪（附带断点偏移），发送方结束等待
        if (this._pendingOffers) {
          const w = this._pendingOffers.get(msg.id);
          if (w) { clearTimeout(w.timer); w.resolve({ ok: true, offset: Number(msg.offset) || 0 }); this._pendingOffers.delete(msg.id); }
        }
        break;
      case 'file-cancel':
        // 接收方拒收（磁盘/权限问题）：发送方立即停止，不再空转
        if (this._pendingOffers) {
          const w = this._pendingOffers.get(msg.id);
          if (w) { clearTimeout(w.timer); w.resolve(false); this._pendingOffers.delete(msg.id); }
        }
        this.emit('lan:fileError', { peerId: pid, error: msg.reason || '对方无法接收该文件' });
        break;
      case 'file-ask-offset':
        // 断点续传协商：回报本机已成功落盘的字节数，发送方据此续传
        this._answerOffset(pid, msg);
        break;
      case 'file-resume':
        // 接收方确认从第 offset 字节继续，发送方结束等待
        if (this._pendingResume) {
          const w = this._pendingResume.get(msg.id);
          if (w) { clearTimeout(w.timer); w.resolve(Number(msg.offset) || 0); this._pendingResume.delete(msg.id); }
        }
        break;
      case 'file-chunk':
        this._receiveChunk(pid, msg);
        break;
      case 'bye':
        if (this.conns.get(pid) === sock) this.conns.delete(pid);
        // 对端主动告别：立即标记离线（保留 30 秒供前端展示，之后自动移除）
        {
          const p = this.peers.get(pid);
          if (p) { p.online = false; p.status = 'offline'; p.offlineAt = Date.now(); }
        }
        this._emitPeers();
        break;
    }
  }

  /* ------------------------- 对外发送 ------------------------- */
  _send(peerId, msg, cb) {
    // 传入的可能是同一 IP 的别名 id → 统一解析为主记录 id
    const sock = this._ensureConn(this.resolveId(peerId));
    if (!sock) return false;
    let buf;
    try { buf = encodeFrame(msg); } catch (e) { return false; }
    // 大文件分块量极大：背压时静默丢帧会导致接收方文件截断，必须先等 drain
    if (sock.writableLength > FILE_HIGH_WATER) {
      if (typeof cb === 'function') return sock.write(buf, cb);
      return sock.write(buf);
    }
    try { sock.write(buf); return true; }
    catch (e) { return false; }
  }

  /** 背压感知的发送：缓冲超阈值时等待 drain，保证不丢帧 */
  _sendFlow(sock, buf) {
    if (!sock || sock.destroyed) return Promise.resolve();
    if (sock.writableLength <= FILE_HIGH_WATER) { try { sock.write(buf); } catch (e) {} return Promise.resolve(); }
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; sock.removeListener('drain', fin); sock.removeListener('close', fin); resolve(); };
      sock.once('drain', fin);
      sock.once('close', fin);
      try { sock.write(buf); } catch (e) { fin(); }
    });
  }

  sendChat(peerId, text) {
    const ok = this._send(peerId, { t: 'chat', from: this.selfId, name: this.name, text: String(text || ''), ts: Date.now() });
    if (ok) this.emit('lan:message', { peerId, name: this.name, text: String(text || ''), ts: Date.now(), dir: 'out' });
    return ok;
  }

  setStatus(status) { this.status = status; if (this.running) this._announce(); }

  /* ------------------------- 文件传输 ------------------------- */
  /**
   * 发送文件。支持断点续传：
   *  - 先发 file-offer（携带 fileId / 名称 / 大小）；接收方若已有同名未完成的 .part 文件，
   *    会在 file-accept 中附带已落盘偏移；发送方据此从该偏移继续读取源文件。
   *  - 若接收方已完整接收过该文件（偏移 == 大小），直接判定秒传完成。
   */
  async sendFile(peerId, filePath, relDir) {
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { this.emit('lan:fileError', { peerId, error: '文件不存在' }); return; }
    if (stat.isDirectory()) { return this.sendFolder(peerId, filePath, relDir); }
    if (stat.size > MAX_FILE) { this.emit('lan:fileError', { peerId, error: '文件超过 6GB 限制' }); return; }
    const name = path.basename(filePath);
    const type = mimeOf(name);
    const total = stat.size;
    // fileId 对同一文件稳定（同名同大小 → 同一 id）：这是断点续传与秒传能识别出
    // "同一个文件"的前提。发送过程中每次重发都会命中同一个 id，接收端据此找到 .part。
    const fileId = 'f' + hashKey(name + '|' + total).toString(36);
    const resumedId = fileId;

    // ① 取得连接（走 _ensureConn，保证握手帧已排在缓冲最前）
    const sock = this._ensureConn(peerId);
    if (!sock) { this.emit('lan:fileError', { peerId, error: '对方不在线，无法发送' }); return; }

    // ② 发 offer 并等待接收方回 ACK（含已落盘偏移 resumeOffset）
    this._pendingOffers = this._pendingOffers || new Map();
    const ack = await new Promise((resolve) => {
      const w = { resolve, timer: null, peerId };
      w.timer = setTimeout(() => { this._pendingOffers.delete(fileId); resolve(null); }, OFFER_TIMEOUT);
      this._pendingOffers.set(fileId, w);
      try {
        sock.write(encodeFrame({
          t: 'file-offer', from: this.selfId, name: this.name,
          file: { id: fileId, rid: resumedId, name, size: total, type, rel: relDir || '' }
        }));
      } catch (e) { clearTimeout(w.timer); this._pendingOffers.delete(fileId); resolve(null); }
    });
    if (!ack || !ack.ok) {
      this.emit('lan:fileError', { peerId, error: '对方未确认接收（可能离线或接收目录不可写）' });
      return;
    }
    // 接收方已完整持有该文件 → 秒传
    let start = Math.max(0, Math.min(total, Number(ack.offset) || 0));
    if (start >= total && total > 0) {
      this.emit('lan:fileProgress', { peerId, fileId, name, sent: total, size: total, dir: 'out', rel: relDir || '' });
      this.emit('lan:fileDone', { peerId, fileId, name, size: total, dir: 'out', rel: relDir || '', resumed: true, instant: true });
      return;
    }

    let fd;
    try { fd = fs.openSync(filePath, 'r'); } catch (e) { this.emit('lan:fileError', { peerId, error: '无法读取文件' }); return; }
    const buf = Buffer.alloc(FILE_CHUNK);
    let sent = start, seq = 0, n = 0, aborted = false;
    if (start > 0) {
      this.emit('lan:fileProgress', { peerId, fileId, name, sent: start, size: total, dir: 'out', rel: relDir || '', resumed: true });
    }
    try {
      while ((n = fs.readSync(fd, buf, 0, FILE_CHUNK, sent)) > 0) {
        if (sock.destroyed) { aborted = true; break; }
        const data = buf.slice(0, n).toString('base64');
        sent += n;
        const last = sent >= total;
        await this._sendFlow(sock, encodeFrame({ t: 'file-chunk', id: fileId, seq: seq++, data, last, offset: sent }));
        if (!last) this.emit('lan:fileProgress', { peerId, fileId, name, sent, size: total, dir: 'out', rel: relDir || '' });
        if ((seq % FILE_YIELD) === 0) await sleep(0);
      }
    } catch (e) {
      aborted = true;
      this.emit('lan:fileError', { peerId, error: '发送中断：' + e.message });
    } finally {
      try { fs.closeSync(fd); } catch (e) {}
    }
    if (aborted) return;
    this.emit('lan:fileDone', { peerId, fileId, name, size: total, dir: 'out', rel: relDir || '', resumed: start > 0 });
  }

  /** 递归遍历文件夹，逐个发送其中的文件（保留相对目录结构） */
  async sendFolder(peerId, dirPath, relBase) {
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch (e) { this.emit('lan:fileError', { peerId, error: '无法读取文件夹' }); return; }
    const folderName = relBase || path.basename(dirPath);
    this.emit('lan:folderStart', { peerId, name: folderName, dir: 'out' });
    let count = 0;
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      if (ent.isDirectory()) {
        count += await this.sendFolder(peerId, full, path.join(folderName, ent.name));
      } else if (ent.isFile()) {
        await this.sendFile(peerId, full, folderName);
        count++;
      }
    }
    this.emit('lan:folderDone', { peerId, name: folderName, count, dir: 'out' });
    return count;
  }

  /**
   * 接收端：处理 file-offer。
   * 断点续传逻辑：把数据先写入 `<rid>.part` 临时文件，若该文件已存在且大小 > 0，
   * 则在 ACK 中回报已落盘偏移，发送方从该偏移继续推数据；全部收齐后再重命名为正式文件名。
   */
  _beginReceive(peerId, msg) {
    const f = msg.file || {};
    const safe = String(f.name || 'file').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80) || 'file';
    // 若为文件夹传输，按相对目录落地
    const rel = String(f.rel || '').split(/[\\/]+/).filter(Boolean).map((seg) => seg.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')).join(path.sep);
    const destDir = rel ? path.join(this.incomingDir, rel) : this.incomingDir;
    const rid = String(f.rid || f.id || '').replace(/[^\w\-]/g, '');
    let savePath, partPath;
    const plainPath = path.join(destDir, safe);
    try {
      fs.mkdirSync(destDir, { recursive: true });
      // 断点偏移优先取 .part；若该文件已按原名完整存在（且大小匹配），视为已接收过 → 秒传
      partPath = path.join(destDir, `.${rid}_${safe}.part`);
      savePath = plainPath;
    } catch (e) {
      // 落盘不可用：明确回拒，让发送方立即停止而不是空转超时
      this._send(peerId, { t: 'file-cancel', id: f.id, reason: '接收方无法创建接收目录' });
      this.emit('lan:fileError', { peerId, fileId: f.id, dir: 'in', error: '无法创建接收目录：' + e.message });
      return;
    }
    // 计算断点偏移：优先复用已有 .part，其次检测是否已完整接收过
    let offset = 0;
    try {
      if (fs.existsSync(partPath)) {
        const st = fs.statSync(partPath);
        offset = st.size || 0;
        if (offset > (f.size || 0)) offset = 0;    // 记录异常（大于源文件）时重头来
      } else if (fs.existsSync(plainPath)) {
        const st = fs.statSync(plainPath);
        if (st.size === (f.size || -1)) offset = st.size;   // 已完整接收 → 秒传
      }
    } catch (e) { offset = 0; }
    // 秒传以外的场景：若目标文件名已被占用，落地时自动加序号，不覆盖用户已有文件
    if (offset < (f.size || 0) && fs.existsSync(plainPath)) savePath = uniquePath(destDir, safe);

    let ws;
    try {
      // 续传用追加模式，全新接收用覆盖模式
      ws = fs.createWriteStream(partPath, offset > 0 && offset < (f.size || 0) ? { flags: 'a' } : { flags: 'w' });
    } catch (e) {
      this._send(peerId, { t: 'file-cancel', id: f.id, reason: '接收方无法写入文件' });
      this.emit('lan:fileError', { peerId, fileId: f.id, dir: 'in', error: '无法写入文件：' + e.message });
      return;
    }
    // 写流出错必须上报并回拒，避免接收端静默失败、发送端却"成功"
    ws.on('error', (e) => {
      this._fileReceivers.delete(f.id);
      this.emit('lan:fileError', { peerId, fileId: f.id, name: f.name, dir: 'in', error: '磁盘写入失败：' + e.message });
    });
    this._fileReceivers.set(f.id, {
      meta: f, peerId, ws, received: offset, savePath, partPath, rid, failed: false, resumed: offset > 0
    });
    this.emit('lan:fileIncoming', {
      peerId, fileId: f.id, name: f.name, size: f.size, type: f.type, dir: 'in', rel: f.rel || '',
      offset, resumed: offset > 0
    });
    // 确认就绪（携带断点偏移），发送方收到 ACK 后才开始推数据
    this._send(peerId, { t: 'file-accept', id: f.id, offset });
  }

  /** 接收端：回答发送方的断点询问 */
  _answerOffset(peerId, msg) {
    const f = msg.file || {};
    const safe = String(f.name || 'file').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80) || 'file';
    const rel = String(f.rel || '').split(/[\\/]+/).filter(Boolean).map((seg) => seg.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')).join(path.sep);
    const destDir = rel ? path.join(this.incomingDir, rel) : this.incomingDir;
    const rid = String(f.rid || f.id || '').replace(/[^\w\-]/g, '');
    let offset = 0;
    try {
      const partPath = path.join(destDir, `.${rid}_${safe}.part`);
      const plainPath = path.join(destDir, safe);
      if (fs.existsSync(partPath)) { const st = fs.statSync(partPath); offset = st.size || 0; }
      else if (fs.existsSync(plainPath)) { const st = fs.statSync(plainPath); if (st.size === (f.size || -1)) offset = st.size; }
    } catch (e) { offset = 0; }
    this._send(peerId, { t: 'file-resume', id: f.id, offset });
  }

  _receiveChunk(peerId, msg) {
    const r = this._fileReceivers.get(msg.id);
    if (!r || r.failed) return;
    let data;
    try { data = Buffer.from(msg.data || '', 'base64'); } catch (e) { return; }
    if (data.length) {
      try { r.ws.write(data); } catch (e) { r.failed = true; }
      r.received += data.length;
    }
    this.emit('lan:fileProgress', { peerId, fileId: msg.id, name: r.meta.name, sent: r.received, size: r.meta.size, dir: 'in' });
    if (msg.last) {
      if (r.failed) { this._fileReceivers.delete(msg.id); return; }
      this._fileReceivers.delete(msg.id);
      const finish = () => {
        // 收齐后把 .part 重命名为正式文件；失败时保留 .part 以便下次续传
        try { fs.renameSync(r.partPath, r.savePath); }
        catch (e) { try { fs.copyFileSync(r.partPath, r.savePath); fs.unlinkSync(r.partPath); } catch (e2) {} }
        this.emit('lan:fileDone', {
          peerId, fileId: msg.id, name: r.meta.name, size: r.meta.size, path: r.savePath, dir: 'in', resumed: !!r.resumed
        });
      };
      try { r.ws.end(finish); } catch (e) { finish(); }
    }
  }

  /* --------------------------- 状态查询 --------------------------- */
  getPeers() { return Array.from(this.peers.values()); }
  getInfo() { return { selfId: this.selfId, name: this.name, udpPort: this.udpPort, tcpPort: this.tcpPort, running: this.running }; }
}

module.exports = { LANEngine, encodeFrame, broadcastAddresses, mimeOf, hashKey, DEFAULT_UDP, DEFAULT_TCP };
