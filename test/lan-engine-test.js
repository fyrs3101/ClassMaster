'use strict';
/**
 * LAN 引擎集成测试（纯 Node，无需 Electron）
 * 模拟两台实例：发现 -> 文字聊天 -> 文件收发 闭环
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LANEngine, encodeFrame, broadcastAddresses } = require('../src/main/lan');

const PORT_A_UDP = 38101, PORT_A_TCP = 38111;
const PORT_B_UDP = 38102, PORT_B_TCP = 38112;
const PORT_C_TCP = 38113;
const LOCALHOST = '127.0.0.1';

function makeEngine(name, udp, tcp) {
  const events = {};
  const eng = new LANEngine({
    selfId: 'test-' + name + '-' + Math.random().toString(36).slice(2, 6),
    name, udpPort: udp, tcpPort: tcp, incomingDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lantest-')),
    emit: (ev, payload) => { (events[ev] = events[ev] || []).push(payload); }
  });
  eng._events = events;
  return eng;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function last(events, ev) { const a = events[ev] || []; return a[a.length - 1]; }

(async () => {
  // 1) 帧编解码
  const f = encodeFrame({ t: 'chat', text: '你好' });
  assert.strictEqual(f.readUInt32BE(0), f.length - 4, '帧头长度应等于负载长度');
  assert.ok(Buffer.isBuffer(f));

  // 2) 广播地址
  const bcast = broadcastAddresses();
  assert.ok(Array.isArray(bcast) && bcast.includes('255.255.255.255'), '广播地址应包含 255.255.255.255');

  const A = makeEngine('A老师', PORT_A_UDP, PORT_A_TCP);
  const B = makeEngine('B老师', PORT_B_UDP, PORT_B_TCP);
  A.start(); B.start();
  await wait(300);

  // 3) 发现：A 探测 B 的 UDP 端口（产品中等同于同默认端口，这里显式指定）
  A.probeAddress(LOCALHOST, PORT_B_UDP);
  await wait(400);
  const sawB = (last(A._events, 'lan:peers') || []).some(p => p.name === 'B老师' && p.tcpPort === PORT_B_TCP);
  assert.ok(sawB, 'A 应发现 B（通过手动探测）');

  // 4) 文字聊天：A -> B
  const bId = (last(A._events, 'lan:peers') || []).find(p => p.name === 'B老师').id;
  A.sendChat(bId, '班会改到明天');
  await wait(300);
  const msg = last(B._events, 'lan:message');
  assert.ok(msg && msg.text === '班会改到明天' && msg.dir === 'in', 'B 应收到 A 的文字消息');

  // 5) 文件传输：A -> B
  const srcFile = path.join(os.tmpdir(), 'lantest-src-' + Date.now() + '.txt');
  const content = '班级智管局域网文件传输测试 ' + 'x'.repeat(5000);
  fs.writeFileSync(srcFile, content, 'utf8');
  B._events['lan:fileDone'] = []; // 清空上一阶段遗留，避免误判
  A.sendFile(bId, srcFile);
  // 等待传输完成
  for (let i = 0; i < 60; i++) { if ((B._events['lan:fileDone'] || []).length) break; await wait(50); }
  const done = last(B._events, 'lan:fileDone');
  assert.ok(done && done.dir === 'in' && done.path, 'B 应收到完整文件并落地');
  const got = fs.readFileSync(done.path, 'utf8');
  assert.strictEqual(got, content, '接收到的文件内容应与源一致');

  // 6) B 反向发小文件回 A（验证双向）
  const src2 = path.join(os.tmpdir(), 'lantest-src2-' + Date.now() + '.txt');
  fs.writeFileSync(src2, '回传内容', 'utf8');
  const aId = (last(B._events, 'lan:peers') || []).find(p => p.name === 'A老师').id;
  A._events['lan:fileDone'] = []; // 清空 A 自身发送产生的 fileDone，避免误判
  B.sendFile(aId, src2);
  for (let i = 0; i < 60; i++) { if ((A._events['lan:fileDone'] || []).length) break; await wait(50); }
  const done2 = last(A._events, 'lan:fileDone');
  assert.ok(done2 && done2.dir === 'in' && done2.path, 'A 应收到 B 的回传文件');
  assert.strictEqual(fs.readFileSync(done2.path, 'utf8'), '回传内容', '回传文件内容应一致');

  // 7) 文件夹递归传输：A -> B（保留相对目录）
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantest-dir-'));
  fs.mkdirSync(path.join(srcDir, '子目录'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'a.txt'), 'AAA', 'utf8');
  fs.writeFileSync(path.join(srcDir, '子目录', 'b.txt'), 'BBB', 'utf8');
  B._events['lan:fileDone'] = [];
  A._events['lan:folderDone'] = [];
  await A.sendFolder(bId, srcDir, '资料包');
  // 等待两端落地
  for (let i = 0; i < 120; i++) { if (((B._events['lan:fileDone'] || []).filter(x => x.dir === 'in').length) >= 2) break; await wait(50); }
  const fdone = last(A._events, 'lan:folderDone');   // 发送端事件
  assert.ok(fdone && fdone.count === 2, '发送端应报告文件夹内 2 个文件');
  const gotFiles = (B._events['lan:fileDone'] || []).filter(x => x.dir === 'in');
  assert.strictEqual(gotFiles.length, 2, '文件夹传输应落地 2 个文件');
  const contents = gotFiles.map(x => fs.readFileSync(x.path, 'utf8')).sort().join(',');
  assert.strictEqual(contents, 'AAA,BBB', '文件夹内文件内容应完整');
  // 验证目录结构：子目录中的文件应落在 incomingDir/资料包/子目录 下
  const nested = gotFiles.find(x => x.path.indexOf('子目录') >= 0);
  assert.ok(nested, '子目录结构应被保留');

  // 8) 大文件完整性（背压路径）：12MB，确保逐块发送不丢帧、不截断
  const bigContent = Buffer.alloc(12 * 1024 * 1024);
  for (let i = 0; i < bigContent.length; i++) bigContent[i] = i % 251;
  const bigSrc = path.join(os.tmpdir(), 'lantest-big-' + Date.now() + '.bin');
  fs.writeFileSync(bigSrc, bigContent);
  B._events['lan:fileDone'] = [];
  A.sendFile(bId, bigSrc);
  for (let i = 0; i < 400; i++) { if ((B._events['lan:fileDone'] || []).length) break; await wait(50); }
  const bigDone = last(B._events, 'lan:fileDone');
  assert.ok(bigDone && bigDone.path, 'B 应收到 12MB 大文件');
  const bigGot = fs.readFileSync(bigDone.path);
  assert.strictEqual(bigGot.length, bigContent.length, '大文件落盘大小应完整（背压丢帧会截断）');
  assert.ok(bigGot.equals(bigContent), '大文件内容应逐字节一致');

  // 9) 接收方无法落盘：应回 file-cancel，发送端收到明确错误且不空转
  const realIncoming = B.incomingDir;
  const blockedParent = path.join(os.tmpdir(), 'lantest-blocked-' + Date.now());
  fs.writeFileSync(blockedParent, 'not-a-dir', 'utf8');       // 用文件占位，mkdir 必失败
  B.incomingDir = path.join(blockedParent, 'x');
  A._events['lan:fileError'] = [];
  const smallSrc = path.join(os.tmpdir(), 'lantest-nope-' + Date.now() + '.txt');
  fs.writeFileSync(smallSrc, 'will be rejected', 'utf8');
  const t0 = Date.now();
  await A.sendFile(bId, smallSrc);
  const cost = Date.now() - t0;
  const errOut = last(A._events, 'lan:fileError');
  assert.ok(errOut, '接收方拒收时发送端应收到明确错误');
  assert.ok(cost < 5000, '接收方拒收应立即返回，而不是等 20 秒超时（实际 ' + cost + 'ms）');
  B.incomingDir = realIncoming;

  // 10) 自动发现与掉线重连：在真实部署中所有机器使用同一个 UDP 端口（37123），
  //     这里让 A/C 共用同一 UDP 端口，模拟"同网段多台电脑"的真实拓扑。
  const SHARED_UDP = PORT_A_UDP;          // A、C 共用同一发现端口
  const C = makeEngine('C老师', SHARED_UDP, PORT_C_TCP);
  A._events['lan:peers'] = [];
  C.start();
  let sawC = false;
  for (let i = 0; i < 40; i++) { await wait(300); if ((last(A._events, 'lan:peers') || []).some(p => p.name === 'C老师')) { sawC = true; break; } }
  assert.ok(sawC, 'C 后上线时，A 应能自动发现（无需重启软件）');

  C.stop();
  // 下线后：标记为「离线」并保留在列表中（默认永不自动隐藏）
  let cOffline = false;
  for (let i = 0; i < 60; i++) {
    await wait(400);
    const plist = last(A._events, 'lan:peers') || [];
    const c = plist.find(p => p.name === 'C老师');
    if (c && c.online === false && c.status === 'offline') { cOffline = true; break; }
    if (!c) break;   // 若被移除也算异常，下面会断言
  }
  assert.ok(cOffline, 'C 下线后 A 应将其标记为离线');

  // 默认 offlineKeep=0：离线成员应长期保留，不会自动消失
  await wait(3500);
  const stillThere = (last(A._events, 'lan:peers') || []).some(p => p.name === 'C老师' && p.online === false);
  assert.ok(stillThere, '默认设置（永不自动隐藏）下，离线成员应一直保留在列表中');
  const chk = (last(A._events, 'lan:peers') || []).find(p => p.name === 'C老师');
  assert.strictEqual(chk.hideIn, 0, '永不隐藏时 hideIn 应为 0（前端不展示倒计时）');

  // 改为 1 秒隐藏：应立即生效并自动移除
  A.setOfflineKeep(1000);
  let cRemoved = false;
  for (let i = 0; i < 30; i++) {
    await wait(400);
    if (!(last(A._events, 'lan:peers') || []).some(p => p.name === 'C老师')) { cRemoved = true; break; }
  }
  assert.ok(cRemoved, '设置为「1 秒后隐藏」时，离线成员应在超时后自动移除');
  A.setOfflineKeep(0);   // 还原默认

  const C2 = makeEngine('C老师', SHARED_UDP, PORT_C_TCP);
  C2.start();
  let sawC2 = false;
  for (let i = 0; i < 40; i++) { await wait(300); if ((last(A._events, 'lan:peers') || []).some(p => p.name === 'C老师')) { sawC2 = true; break; } }
  assert.ok(sawC2, 'C 重新上线后 A 应能再次自动发现（掉线可自愈）');
  assert.ok(A._known.size >= 1, 'A 应记录历史成员用于定向重扫');
  C2.stop();

  /* ---- 11) 大文件断点续传：接收端已有部分 .part 时，从断点继续而非重头传 ---- */
  const rsrc = path.join(os.tmpdir(), 'lantest-resume-' + Date.now() + '.bin');
  const rBody = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < rBody.length; i++) rBody[i] = (i * 7) % 253;
  fs.writeFileSync(rsrc, rBody);
  // 在 B 的接收目录里预置一个"上次中断"的 .part：模拟已收 1MB
  const rBase = path.basename(rsrc);
  const rSafe = rBase.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80);
  const { hashKey } = require('../src/main/lan');
  const rRid = 'f' + hashKey(rBase + '|' + rBody.length).toString(36);
  const rPart = path.join(B.incomingDir, '.' + rRid + '_' + rSafe + '.part');
  fs.writeFileSync(rPart, rBody.slice(0, 1024 * 1024));       // 预置已收 1MB
  assert.ok(fs.existsSync(rPart), '预置的 .part 分片应存在');

  B._events['lan:fileDone'] = [];
  B._events['lan:fileIncoming'] = [];
  await A.sendFile(bId, rsrc);
  for (let i = 0; i < 400; i++) { if ((B._events['lan:fileDone'] || []).length) break; await wait(50); }
  const rDone = last(B._events, 'lan:fileDone');
  assert.ok(rDone && rDone.path, '断点续传应最终完成并落地');
  const rGot = fs.readFileSync(rDone.path);
  assert.strictEqual(rGot.length, rBody.length, '断点续传后文件大小应完整');
  assert.ok(rGot.equals(rBody), '断点续传后内容应逐字节一致（不能重复写入已有片段）');
  const rIncoming = last(B._events, 'lan:fileIncoming');
  assert.ok(rIncoming && rIncoming.offset === 1024 * 1024, '接收端应识别已有 1MB 断点（offset=1048576）');
  assert.ok(rDone.resumed === true, '完成事件应标记为续传完成');
  assert.ok(!fs.existsSync(rPart), '续传完成后 .part 临时文件应被重命名清理');

  /* ---- 12) 秒传：同一文件再次发送时应识别为已完整接收并秒完成 ---- */
  B._events['lan:fileDone'] = [];
  const t1 = Date.now();
  await A.sendFile(bId, rsrc);
  for (let i = 0; i < 20; i++) { if ((B._events['lan:fileDone'] || []).length) break; await wait(50); }
  const cost2 = Date.now() - t1;
  assert.ok(cost2 < 3000, '已完整接收过的文件应秒传完成（实际 ' + cost2 + 'ms）');
  assert.ok(fs.existsSync(rDone.path), '秒传不应删除已落地文件');

  /* ---- 13) 同一 IP 去重：同 IP 的多个 id 只显示一条记录 ---- */
  {
    const D = makeEngine('D老师', 38105, 38115);
    D.start();
    await wait(300);
    // 模拟同一台电脑因「重装 / 缓存不同步」上报了两个不同的 id（IP 相同）
    D._mergePeer('dup-id-1', { name: 'D老师', ip: '10.0.0.9', tcpPort: 37124, online: true });
    D._mergePeer('dup-id-2', { name: 'D老师', ip: '10.0.0.9', tcpPort: 37124, online: true });
    D._emitPeers();
    let lst = last(D._events, 'lan:peers') || [];
    const sameIp = lst.filter(p => p.ip === '10.0.0.9');
    assert.strictEqual(sameIp.length, 1, '同一 IP 只应显示一条记录（实际 ' + sameIp.length + ' 条）');
    assert.strictEqual(sameIp[0].id, 'dup-id-1', '应以先出现的 id 为主记录');
    assert.strictEqual(D.resolveId('dup-id-2'), 'dup-id-1', '别名 id 应解析为主记录 id');

    // 别名心跳应刷新主记录（而非新增一条）
    D._mergePeer('dup-id-2', { name: 'D老师（新）', ip: '10.0.0.9', tcpPort: 37124, online: true });
    D._emitPeers();
    lst = last(D._events, 'lan:peers') || [];
    assert.strictEqual(lst.filter(p => p.ip === '10.0.0.9').length, 1, '别名上报后仍只应有一条记录');

    // 主记录离线、别名在线时：应保留在线的那条
    D.peers.get('dup-id-1').online = false;
    D.peers.get('dup-id-1').offlineAt = Date.now();
    D._mergePeer('dup-id-2', { name: 'D老师', ip: '10.0.0.9', tcpPort: 37124, online: true });
    D._emitPeers();
    lst = last(D._events, 'lan:peers') || [];
    const only = lst.filter(p => p.ip === '10.0.0.9');
    assert.strictEqual(only.length, 1, '同 IP 有离线与在线两条时应只显示一条');
    assert.strictEqual(only[0].online, true, '应优先展示在线状态');

    // 不同 IP 不受影响，仍各占一条
    D._mergePeer('other-ip', { name: 'E老师', ip: '10.0.0.10', tcpPort: 37124, online: true });
    D._emitPeers();
    lst = last(D._events, 'lan:peers') || [];
    assert.ok(lst.some(p => p.ip === '10.0.0.10'), '不同 IP 的成员应正常保留');
    D.stop();
  }

  A.stop(); B.stop();
  fs.unlinkSync(srcFile); fs.unlinkSync(src2); fs.unlinkSync(bigSrc); fs.unlinkSync(smallSrc);
  fs.unlinkSync(rsrc);
  fs.unlinkSync(blockedParent);
  console.log('✅ LAN 引擎测试全部通过：帧编解码 / 发现 / 文字聊天 / 双向文件传输 / 文件夹递归传输 / 大文件完整性 / 拒收即时反馈 / 掉线标记离线与可配置隐藏 / 自动重扫 / 大文件断点续传 / 秒传 / 同 IP 去重');
})().catch((e) => { console.error('❌ 测试失败:', e); process.exit(1); });
