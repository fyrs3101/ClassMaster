'use strict';
/**
 * 班级智管 ClassMaster —— 主进程
 * 负责：窗口管理、数据持久化(JSON 库)、Excel 导入解析、导出、激活码授权校验
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Notification, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { LANEngine } = require('./lan');

// xlsx 走 CommonJS 引入
let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) { console.error('[ClassMaster] xlsx 未安装:', e.message); }

const APP_NAME = '班级智管-鸿升周老师';
const IS_DEV = process.argv.includes('--dev');

let mainWindow = null;
let lanEngine = null;   // 局域网通信引擎（懒加载）
let tray = null;        // 系统托盘（关闭最小化时驻留）
let isQuitting = false; // 是否正在真正退出（用于区分「关闭」与「退出」）

/* ------------------------------------------------------------------ */
/*  数据持久化层：存于用户数据目录，打包后依然可写                       */
/* ------------------------------------------------------------------ */
const DATA_DIR = path.join(app.getPath('userData'), 'ClassMasterData');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const CHAT_FILE = path.join(DATA_DIR, 'lan-chats.json');   // 飞鸽传书聊天记录（本地持久化）
const FILE_REC_FILE = path.join(DATA_DIR, 'lan-files.json'); // 飞鸽传书文件传输记录（本地持久化）

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* ---- 飞鸽传书聊天记录：本地持久化 + 保留期清理 ---- */
const RETENTION_MS = {
  half: 183 * 24 * 3600 * 1000,     // 半年
  year: 365 * 24 * 3600 * 1000,     // 一年
  forever: Infinity                 // 永久
};
function readChatStore() {
  ensureDataDir();
  if (!fs.existsSync(CHAT_FILE)) return { version: 1, retention: 'forever', offlineKeep: 0, closeToTray: true, chats: {} };
  try {
    const obj = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    return {
      version: 1,
      retention: obj.retention || 'forever',
      offlineKeep: Number(obj.offlineKeep) > 0 ? Number(obj.offlineKeep) : 0,   // 0 = 离线永不自动隐藏
      closeToTray: obj.closeToTray !== false,   // 关闭主窗口时最小化到托盘（默认 true）
      chats: obj.chats || {}
    };
  } catch (e) {
    console.error('[ClassMaster] 聊天记录损坏，已重置:', e.message);
    return { version: 1, retention: 'forever', offlineKeep: 0, closeToTray: true, chats: {} };
  }
}
function writeChatStore(store) {
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify(store, null, 2), 'utf8');
  return true;
}
/** 按保留期裁剪所有会话，返回被删除条数 */
function pruneChats(store) {
  const span = RETENTION_MS[store.retention || 'forever'];
  if (span === Infinity) return 0;
  const cutoff = Date.now() - span;
  let removed = 0;
  Object.keys(store.chats).forEach((pid) => {
    const list = store.chats[pid] || [];
    const kept = list.filter((m) => (Number(m.ts) || 0) >= cutoff);
    removed += list.length - kept.length;
    if (kept.length) store.chats[pid] = kept; else delete store.chats[pid];
  });
  return removed;
}

/* ---- 飞鸽传书文件传输记录：本地持久化 ---- */
function readFileStore() {
  ensureDataDir();
  if (!fs.existsSync(FILE_REC_FILE)) return { version: 1, files: [] };
  try {
    const obj = JSON.parse(fs.readFileSync(FILE_REC_FILE, 'utf8'));
    return { version: 1, files: Array.isArray(obj.files) ? obj.files : [] };
  } catch (e) {
    console.error('[ClassMaster] 文件记录损坏，已重置:', e.message);
    return { version: 1, files: [] };
  }
}
function writeFileStore(store) {
  ensureDataDir();
  fs.writeFileSync(FILE_REC_FILE, JSON.stringify(store, null, 2), 'utf8');
  return true;
}

function defaultDB() {
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      school: '',
      className: '八4班',
      semester: '2026学年第一学期',
      examName: '第一次月考'
    },
    students: [],
    grades: [],          // 每次导入的成绩快照 { id, name, examName, date, subjects:[], total, rankSchool, rankClass }
    seating: {
      groupSize: 6,
      groupCount: 9,
      mode: 'homogeneous',  // homogeneous 均衡 | random 随机 | manual 手动
      groups: [],           // [{ id, name, members:[studentId,...], seatMap:[{seat,x,y,studentId}] }]
      updatedAt: null
    },
    points: {
      rules: [
        { id: 'r1', name: '课堂积极发言', score: 2, type: 'add' },
        { id: 'r2', name: '作业优秀', score: 1, type: 'add' },
        { id: 'r3', name: '考试进步', score: 3, type: 'add' },
        { id: 'r4', name: '违纪扣分', score: 3, type: 'sub' },
        { id: 'r5', name: '未完成作业', score: 2, type: 'sub' }
      ],
      records: [],   // { id, studentId, score(正负), reason, category, operator, time }
      exchange: [
        { id: 'e1', name: '免写一次作业券', cost: 20 },
        { id: 'e2', name: '优先选座位', cost: 30 },
        { id: 'e3', name: '小礼品兑换', cost: 50 }
      ]
    },
    license: {
      plan: 'trial',           // trial | pro | school
      activatedAt: null,
      expiresAt: null,
      machineCode: '',
      licenseKey: ''
    }
  };
}

function readDB() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    // 兜底补字段，兼容老版本数据
    const def = defaultDB();
    return { ...def, ...db, meta: { ...def.meta, ...(db.meta || {}) }, points: { ...def.points, ...(db.points || {}) }, seating: { ...def.seating, ...(db.seating || {}) }, license: { ...def.license, ...(db.license || {}) } };
  } catch (e) {
    console.error('[ClassMaster] 数据库损坏，已备份并重置:', e.message);
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.broken.' + Date.now()); } catch (_) {}
    const db = defaultDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
}

function writeDB(db) {
  ensureDataDir();
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  return true;
}

/* ------------------------------------------------------------------ */
/*  授权 / 会员制                                                       */
/* ------------------------------------------------------------------ */
const PLANS = {
  trial: { name: '试用版', maxStudents: 20, features: ['students', 'grades'], days: 7 },
  pro: { name: '个人专业版', maxStudents: 200, features: ['students', 'grades', 'seating', 'points', 'export'], days: 365 },
  school: { name: '校园旗舰版', maxStudents: 99999, features: ['students', 'grades', 'seating', 'points', 'export', 'multiClass'], days: 3650 }
};

/** 机器码：基于主机信息生成稳定指纹 */
function getMachineCode() {
  const info = [
    os.hostname(),
    os.platform(),
    os.arch(),
    (os.cpus()[0] || {}).model || 'CPU',
    os.totalmem()
  ].join('#');
  const hash = crypto.createHash('sha256').update(info).digest('hex').toUpperCase();
  // 分组显示 XXXX-XXXX-XXXX-XXXX
  return hash.slice(0, 16).match(/.{4}/g).join('-');
}

/**
 * 激活码校验（客户端只保留「校验」能力，「生成」能力已从客户端彻底移除）
 * 激活码由销售方使用独立注册机为该机机器码签发。
 */
function checkLicenseKey(machineCode, plan, key) {
  const salt = `ClassMaster::${plan}::2026`;
  const expect = crypto.createHmac('sha256', salt)
    .update(String(machineCode || '').replace(/-/g, '').toUpperCase())
    .digest('hex').toUpperCase().slice(0, 20).match(/.{5}/g).join('-');
  const got = String(key || '').toUpperCase().replace(/[^0-9A-Z]/g, '').match(/.{1,5}/g);
  return expect === (got ? got.join('-') : '');
}

/* 授权申请码：客户端把机器码打包成可分享字符串，发给销售方在注册机中解析 */
const APPLY_SALT = 'ClassMasterApply::2026';
function makeApplyCode(machineCode, plan) {
  const mc = String(machineCode || '').replace(/-/g, '').toUpperCase();
  const h = Math.abs(crypto.createHash('sha256').update(APPLY_SALT + mc).digest().readInt32BE(0)).toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
  const payload = `CM1|${mc}|${plan || 'pro'}|${h}`;
  return Buffer.from(payload, 'utf8').toString('base64').replace(/=+$/, '');
}
function parseApplyCode(code) {
  try {
    const raw = Buffer.from(String(code || '').trim(), 'base64').toString('utf8');
    const [tag, mc, plan, h] = raw.split('|');
    if (tag !== 'CM1' || !/^[0-9A-F]{16}$/.test(mc)) return null;
    const want = Math.abs(crypto.createHash('sha256').update(APPLY_SALT + mc).digest().readInt32BE(0)).toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
    if (want !== h) return null;
    return { machineCode: mc, plan };
  } catch (e) { return null; }
}

function planOf(license) {
  const p = PLANS[license.plan] || PLANS.trial;
  const expired = license.expiresAt ? new Date(license.expiresAt).getTime() < Date.now() : true;
  return { ...p, key: license.plan, expired };
}

/* ------------------------------------------------------------------ */
/*  Excel 导入解析：多元化 —— 自适应多行表头 / 合并单元格 / 多种排版      */
/* ------------------------------------------------------------------ */
const SUBJECT_ALIAS = {
  语文: ['语文', '语', '语文得分', 'chinese', 'chn'],
  数学: ['数学', '数', '数学得分', 'math'],
  英语: ['英语', '英', '英语得分', 'english', 'eng'],
  物理: ['物理', '物', '物理得分', 'physics', 'phy'],
  化学: ['化学', '化', '化学得分', 'chemistry'],
  政治: ['政治', '道德与法治', '道法', '思想品德', '政治得分'],
  历史: ['历史', '史', '历史得分', 'history'],
  地理: ['地理', '地', '地理得分', 'geography'],
  生物: ['生物', '生', '生物得分', 'biology'],
  总分: ['总分', '合计', '总计', '总成绩', 'total'],
  姓名: ['姓名', '学生姓名', '学生', '名字', 'name'],
  学号: ['学号', '学籍号', '考号', '准考证号', '编号', 'no', 'id'],
  序号: ['序号', '序'],
  班级: ['班级', '所在班级'],
  校次: ['校次', '校排名', '年级排名', '级名次', '校名次'],
  班次: ['班次', '班排名', '班级排名', '班名次']
};

function normText(s) {
  return String(s == null ? '' : s).replace(/[\s\u3000]/g, '').replace(/[（）()]/g, '').toLowerCase();
}

function matchField(header) {
  const h = normText(header);
  if (!h) return null;
  // 先精确
  for (const [field, alias] of Object.entries(SUBJECT_ALIAS)) {
    for (const a of alias) {
      if (h === normText(a)) return field;
    }
  }
  // 再包含
  for (const [field, alias] of Object.entries(SUBJECT_ALIAS)) {
    for (const a of alias) {
      const na = normText(a);
      if (na.length >= 2 && h.includes(na)) return field;
    }
  }
  return null;
}

/**
 * 解析工作簿为 { headers, rows, mapping, headerRowCount }
 * 支持：单行表头、两行表头（科目 / 得分·校次·班次）、多 sheet 合并
 */
function parseWorkbook(filePath) {
  if (!XLSX) throw new Error('缺少 xlsx 解析库，请重新安装依赖');
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const result = {
    sheetNames: wb.SheetNames,
    detected: [],
    students: [],
    examNameGuess: '',
    classNameGuess: ''
  };

  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws || !ws['!ref']) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
    if (!matrix.length) continue;

    const sheetData = parseMatrix(matrix, sn);
    if (sheetData.students.length) {
      result.detected.push({ sheet: sn, ...sheetData });
      result.students.push(...sheetData.students.map(s => ({ ...s, sheet: sn })));
      if (!result.examNameGuess && sheetData.examNameGuess) result.examNameGuess = sheetData.examNameGuess;
      if (!result.classNameGuess && sheetData.classNameGuess) result.classNameGuess = sheetData.classNameGuess;
    }
  }

  // 去重（同名学生 + 同分 视为同一条目）
  const seen = new Set();
  result.students = result.students.filter(s => {
    const k = `${s.name}#${s.total}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return result;
}

/** 把一个 sheet 的二维矩阵解析成学生数组 */
function parseMatrix(matrix, sheetName) {
  // 1) 找表头行：包含"姓名"的行 + 其后可能是子表头行
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const row = matrix[i] || [];
    if (row.some(c => { const f = matchField(c); return f === '姓名'; })) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) {
    // 退化：找第一行非空且像表头的
    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
      const row = (matrix[i] || []).filter(x => x != null);
      if (row.length >= 3 && row.every(x => typeof x === 'string')) { headerRowIdx = i; break; }
    }
  }
  if (headerRowIdx === -1) return { students: [], mapping: [], examNameGuess: '', classNameGuess: '' };

  const titleRows = matrix.slice(0, headerRowIdx).flat().filter(x => typeof x === 'string' && x.trim());
  let examNameGuess = '';
  let classNameGuess = '';
  for (const t of titleRows) {
    const s = String(t);
    const m = s.match(/([\u4e00-\u9fa5]{1,6}班)/);
    if (m && !classNameGuess) classNameGuess = m[1];
    if (/月考|期中|期末|模拟|考试|测验|联考/.test(s) && !examNameGuess) examNameGuess = s.trim();
  }

  // 2) 合并表头：若 headerRow 后一行存在"得分/校次/班次"这类子表头，则二维展开
  const rawHeader = matrix[headerRowIdx] || [];
  const subHeader = matrix[headerRowIdx + 1] || [];
  const hasSubHeader = subHeader.filter(x => x != null && typeof x === 'string').some(x => /得分|分数|成绩|校次|班次|排名|名次/.test(String(x)));

  let dataStart = headerRowIdx + 1;
  const columns = []; // { index, field, sub }

  if (hasSubHeader) {
    dataStart = headerRowIdx + 2;
    // 横向填充父表头（应对合并单元格）
    const parents = [];
    let lastParent = '';
    for (let c = 0; c < Math.max(rawHeader.length, subHeader.length); c++) {
      const p = rawHeader[c];
      if (p != null && String(p).trim()) lastParent = String(p).trim();
      parents[c] = lastParent;
    }
    for (let c = 0; c < subHeader.length; c++) {
      const parent = parents[c] || '';
      const sub = subHeader[c] == null ? '' : String(subHeader[c]).trim();
      const pf = matchField(parent);
      const sf = matchField(sub);
      if (sub && /^(得分|分数|成绩)$/.test(sub) && pf) {
        columns.push({ index: c, field: pf, sub: 'score' });
      } else if (sub && /^(校次|年级排名|级名次)$/.test(sub)) {
        columns.push({ index: c, field: '校次', sub: 'rank' });
      } else if (sub && /^(班次|班级排名|班名次)$/.test(sub)) {
        columns.push({ index: c, field: '班次', sub: 'rank' });
      } else if (sf && !pf) {
        columns.push({ index: c, field: sf, sub: 'score' });
      } else if (pf) {
        columns.push({ index: c, field: pf, sub: /次|排名|名次/.test(sub) ? 'rank' : 'score' });
      } else {
        columns.push({ index: c, field: null, sub: null });
      }
    }
  } else {
    for (let c = 0; c < rawHeader.length; c++) {
      const f = matchField(rawHeader[c]);
      columns.push({ index: c, field: f, sub: f ? 'score' : null });
    }
  }

  // 3) 逐行取学生
  const students = [];
  const usedNames = new Set();
  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some(x => x != null && String(x).trim() !== '')) continue;

    const obj = { scores: {}, ranks: {}, extra: {} };
    for (const col of columns) {
      if (!col.field) continue;
      const v = row[col.index];
      if (v == null || v === '' || v === '-' || v === '—' || v === '/') continue;
      if (col.field === '姓名') { obj.name = String(v).trim(); continue; }
      if (col.field === '学号') { obj.sid = String(v).trim(); continue; }
      if (col.field === '序号') { continue; }
      if (col.field === '班级') { obj.className = String(v).trim(); continue; }
      const num = Number(v);
      if (Number.isNaN(num)) continue;
      if (col.field === '总分') {
        if (col.sub === 'rank') obj.ranks['总分'] = num; else obj.total = num;
      } else if (col.field === '校次') {
        obj.ranks['_school'] = num;
      } else if (col.field === '班次') {
        obj.ranks['_class'] = num;
      } else {
        if (col.sub === 'rank') obj.ranks[col.field] = num;
        else obj.scores[col.field] = num;
      }
    }

    if (!obj.name) continue;
    if (/合计|平均|总计|统计|班级平均/.test(obj.name)) continue;
    if (usedNames.has(obj.name)) continue;
    usedNames.add(obj.name);

    // 若没读到总分，则用各科求和
    if (obj.total == null) {
      const vals = Object.values(obj.scores).filter(v => typeof v === 'number');
      if (vals.length) obj.total = vals.reduce((a, b) => a + b, 0);
    }

    students.push({
      name: obj.name,
      sid: obj.sid || '',
      className: obj.className || '',
      scores: obj.scores,
      ranks: obj.ranks,
      total: obj.total == null ? null : obj.total
    });
  }

  return {
    students,
    mapping: columns.filter(c => c.field).map(c => ({ col: c.index, field: c.field, sub: c.sub })),
    examNameGuess,
    classNameGuess
  };
}

/* ------------------------------------------------------------------ */
/*  IPC 处理器                                                          */
/* ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.handle('db:read', () => readDB());
  ipcMain.handle('db:write', (_e, db) => { writeDB(db); return true; });
  ipcMain.handle('db:path', () => DB_FILE);

  ipcMain.handle('dialog:openExcel', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择成绩表文件',
      filters: [{ name: '表格文件', extensions: ['xlsx', 'xls', 'csv'] }, { name: '全部文件', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, files: res.filePaths };
  });

  ipcMain.handle('excel:parse', async (_e, files) => {
    const out = [];
    for (const f of files) {
      try {
        const r = parseWorkbook(f);
        out.push({ file: f, fileName: path.basename(f), ok: true, ...r });
      } catch (err) {
        out.push({ file: f, fileName: path.basename(f), ok: false, error: err.message });
      }
    }
    return out;
  });

  ipcMain.handle('export:save', async (_e, { defaultName, buffer, filters }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出文件',
      defaultPath: defaultName,
      filters: filters || [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      // buffer 可能是 ArrayBuffer / Uint8Array
      const buf = Buffer.from(buffer);
      fs.writeFileSync(res.filePath, buf);
      return { canceled: false, path: res.filePath };
    } catch (e) {
      return { canceled: false, error: e.message };
    }
  });

  ipcMain.handle('export:buildXlsx', async (_e, { sheets }) => {
    // sheets: [{ name, aoa }]
    if (!XLSX) return { error: '缺少 xlsx 库' };
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa);
      XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet1').slice(0, 31));
    }
    const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer: out };
  });

  ipcMain.handle('export:buildSeatHtml', async (_e, { html, defaultName }) => {
    const wb2 = BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(wb2 || mainWindow, {
      title: '导出座位表',
      defaultPath: defaultName || '座位表.html',
      filters: [{ name: '网页文件', extensions: ['html'] }, { name: 'PDF 文件', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, html, 'utf8');
    return { canceled: false, path: res.filePath };
  });

  ipcMain.handle('print:html', async (_e, { html, defaultName }) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出 PDF',
      defaultPath: defaultName || '文档.pdf',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) { win.destroy(); return { canceled: true }; }
    try {
      const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: true, margins: { marginType: 'custom', top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } });
      fs.writeFileSync(res.filePath, data);
      win.destroy();
      return { canceled: false, path: res.filePath };
    } catch (e) {
      win.destroy();
      return { canceled: false, error: e.message };
    }
  });

  /* ---- 授权 ---- */
  ipcMain.handle('license:status', () => {
    const db = readDB();
    const mc = getMachineCode();
    const plan = planOf(db.license);
    // 校验已保存的激活码是否与本机匹配
    let valid = false;
    if (db.license.plan && db.license.plan !== 'trial' && db.license.licenseKey) {
      valid = checkLicenseKey(mc, db.license.plan, db.license.licenseKey);
    }
    return { machineCode: mc, license: db.license, plan, valid, plans: PLANS };
  });

  ipcMain.handle('license:activate', (_e, { key, plan }) => {
    const mc = getMachineCode();
    const targetPlan = plan || 'pro';
    const k = String(key || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '').match(/.{1,5}/g);
    const norm = k ? k.join('-') : '';
    // 兼容客户未指定版本的情况：依次尝试全部套餐
    const plansToTry = plan ? [targetPlan] : ['pro', 'school'];
    const hit = plansToTry.find(p => checkLicenseKey(mc, p, norm));
    if (!hit) {
      return { ok: false, error: '激活码无效，请确认与当前设备机器码匹配' };
    }
    const db = readDB();
    const days = PLANS[hit] ? PLANS[hit].days : 365;
    db.license = {
      plan: hit,
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      machineCode: mc,
      licenseKey: norm
    };
    writeDB(db);
    return { ok: true, license: db.license };
  });

  ipcMain.handle('license:trial', () => {
    const db = readDB();
    const mc = getMachineCode();
    db.license = { plan: 'trial', activatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + PLANS.trial.days * 86400000).toISOString(), machineCode: mc, licenseKey: '' };
    writeDB(db);
    return { ok: true, license: db.license };
  });

  /** 生成授权申请码（仅含机器码与目标版本，不含任何激活信息） */
  ipcMain.handle('license:applyCode', (_e, { plan } = {}) => {
    const mc = getMachineCode();
    return {
      machineCode: mc,
      plan: plan || 'pro',
      code: makeApplyCode(mc, plan || 'pro'),
      planName: (PLANS[plan] || PLANS.pro).name
    };
  });

  ipcMain.handle('license:reset', () => {
    const db = readDB();
    db.license = defaultDB().license;
    writeDB(db);
    return { ok: true };
  });

  ipcMain.handle('dialog:openImage', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }, { name: '全部文件', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const p = res.filePaths[0];
      const st = fs.statSync(p);
      if (st.size > 10 * 1024 * 1024) return { canceled: false, error: '图片过大，请选择 10MB 以内的图片' };
      const ext = path.extname(p).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      const data = fs.readFileSync(p).toString('base64');
      return { canceled: false, dataUrl: `data:${mime};base64,${data}` };
    } catch (e) {
      return { canceled: false, error: e.message };
    }
  });

  /* ---- 局域网通信 ---- */
  function emitLan(event, payload) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send(event, payload);
    }
  }
  function ensureLan(name) {
    if (lanEngine) return lanEngine;
    const incomingDir = path.join(DATA_DIR, 'LanIncoming');
    // 启动即确保接收目录存在且可写，避免首次接收文件时因目录问题静默失败
    try {
      fs.mkdirSync(incomingDir, { recursive: true });
      fs.accessSync(incomingDir, fs.constants.W_OK);
    } catch (e) { console.error('[LAN] 接收目录不可写:', e.message); }
    // 读取用户配置的「离线成员自动隐藏」时长（0 = 永不隐藏），随引擎启动生效
    let offlineKeep = 0;
    try { offlineKeep = readChatStore().offlineKeep || 0; } catch (e) { offlineKeep = 0; }
    lanEngine = new LANEngine({
      selfId: 'cm-' + getMachineCode().replace(/-/g, '').slice(0, 12) + '-' + Math.random().toString(36).slice(2, 6),
      name: (name || '').trim() || os.hostname(),
      incomingDir,
      offlineKeep,
      emit: emitLan
    });
    return lanEngine;
  }

  ipcMain.handle('lan:start', (_e, { name } = {}) => {
    const eng = ensureLan(name);
    eng.setName(name || eng.name);
    eng.start();
    return eng.getInfo();
  });
  ipcMain.handle('lan:stop', () => { if (lanEngine) lanEngine.stop(); return { ok: true }; });
  ipcMain.handle('lan:setName', (_e, name) => { if (lanEngine) lanEngine.setName(name); return { ok: true }; });
  ipcMain.handle('lan:chat', (_e, peerId, text) => { if (!lanEngine) return { ok: false, error: '未开启局域网' }; return { ok: lanEngine.sendChat(peerId, text) }; });
  ipcMain.handle('lan:addPeer', (_e, ip) => { if (lanEngine) lanEngine.probeAddress(ip); return { ok: true }; });
  ipcMain.handle('lan:openIncoming', () => {
    const dir = path.join(DATA_DIR, 'LanIncoming');
    try { fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); return { ok: true, path: dir }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  /** 手动/进入界面时触发一次重扫，立即发现新上线的同事 */
  ipcMain.handle('lan:rescan', () => {
    if (!lanEngine) return { ok: false, error: '未开启飞鸽传书' };
    try { lanEngine.rescan(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('lan:sendFile', async (_e, peerId, filePath) => {
    if (!lanEngine) return { ok: false, error: '未开启局域网' };
    await lanEngine.sendFile(peerId, filePath);
    return { ok: true };
  });
  ipcMain.handle('lan:pickFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择要发送的文件（单文件最大 6GB）',
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  });
  ipcMain.handle('lan:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择要发送的文件夹',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const p = res.filePaths[0];
    return { canceled: false, path: p, name: path.basename(p) };
  });
  ipcMain.handle('lan:sendFolder', async (_e, peerId, dirPath) => {
    if (!lanEngine) return { ok: false, error: '未开启飞鸽传书' };
    await lanEngine.sendFolder(peerId, dirPath);
    return { ok: true };
  });

  /* ---- 飞鸽传书：聊天记录持久化 + 离线隐藏时长设置 ---- */
  ipcMain.handle('lan:loadChats', () => {
    const store = readChatStore();
    const removed = pruneChats(store);
    if (removed) writeChatStore(store);   // 顺带落盘一次清理结果
    return { chats: store.chats, retention: store.retention, offlineKeep: store.offlineKeep, closeToTray: store.closeToTray, removed };
  });
  ipcMain.handle('lan:saveChats', (_e, peerId, list) => {
    if (!peerId) return { ok: false };
    const store = readChatStore();
    store.chats[peerId] = Array.isArray(list) ? list : [];
    pruneChats(store);
    writeChatStore(store);
    return { ok: true };
  });
  ipcMain.handle('lan:setRetention', (_e, value) => {
    const store = readChatStore();
    store.retention = ['half', 'year', 'forever'].indexOf(value) >= 0 ? value : 'forever';
    const removed = pruneChats(store);
    writeChatStore(store);
    return { ok: true, retention: store.retention, removed };
  });
  /**
   * 设置「离线成员自动隐藏」时长：
   *   keep 取值（毫秒）→ 0=永不隐藏 | 30000=30秒 | 86400000=1天 | 604800000=7天 | 2592000000=30天
   * 落盘持久化，并立即同步给运行中的引擎生效。
   */
  ipcMain.handle('lan:setOfflineKeep', (_e, keep) => {
    const store = readChatStore();
    store.offlineKeep = Number(keep) > 0 ? Number(keep) : 0;
    writeChatStore(store);
    if (lanEngine) { try { lanEngine.setOfflineKeep(store.offlineKeep); } catch (e) {} }
    return { ok: true, offlineKeep: store.offlineKeep };
  });

  /**
   * 设置「关闭主窗口时」的行为：
   *   on = true  → 最小化到托盘（默认）：关窗后程序继续后台运行，同事仍能发现你
   *   on = false → 直接退出程序
   * 落盘持久化；切回「直接退出」时销毁托盘，避免残留图标。
   */
  ipcMain.handle('lan:setCloseToTray', (_e, on) => {
    const store = readChatStore();
    store.closeToTray = on !== false;
    writeChatStore(store);
    if (!store.closeToTray) destroyTray();
    else if (!mainWindow || !mainWindow.isVisible()) ensureTray();
    return { ok: true, closeToTray: store.closeToTray };
  });

  /* ---- 飞鸽传书：文件传输记录持久化 ---- */
  ipcMain.handle('lan:loadFiles', () => {
    const store = readFileStore();
    return { files: store.files };
  });
  ipcMain.handle('lan:saveFiles', (_e, files) => {
    const store = readFileStore();
    store.files = Array.isArray(files) ? files.slice(0, 500) : [];   // 最多保留 500 条
    writeFileStore(store);
    return { ok: true };
  });
  ipcMain.handle('sys:openPath', (_e, p) => { try { shell.openPath(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

  /* ---- 飞鸽传书：新消息提醒（窗口置前 / 任务栏闪烁 / 系统通知） ---- */
  // 说明：本版本已移除音视频（对讲 / 视频通话）功能，仅保留「收到消息 / 收到文件」的文字提醒，
  //       因此不再需要来电响铃、频道占用协商等音视频专属能力。
  let msgNotif = null;
  let dockBounceId = null;

  /** 把窗口从后台/最小化状态唤醒到前台（用于新消息提醒） */
  function wakeWindow() {
    try {
      const w = mainWindow;
      if (!w || w.isDestroyed()) return;
      // ① 最小化 / 隐藏时先还原
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.show();
      // ② 临时置顶再取消：Windows 上对"后台窗口"最可靠的抢前台手段，
      //    单纯 focus() 常被系统前台锁定策略忽略，导致用户"感觉没被唤醒"
      try {
        w.setAlwaysOnTop(true, 'screen-saver');
        w.setAlwaysOnTop(false);
      } catch (e) {}
      w.showInactive && w.showInactive();
      w.focus();
      try { w.moveTop(); } catch (e) {}
      // ③ 任务栏 / Dock 提醒
      if (typeof w.flashFrame === 'function') w.flashFrame(true);   // Windows 任务栏闪烁
      if (app.dock) {                                              // macOS Dock 图标弹跳
        try { if (dockBounceId == null) dockBounceId = app.dock.bounce('informational'); } catch (e) {}
      }
    } catch (e) {}
  }

  /** 停止任务栏 / Dock 提醒并关闭通知 */
  function calmWindow() {
    try {
      const w = mainWindow;
      if (!w || w.isDestroyed()) return;
      if (typeof w.flashFrame === 'function') w.flashFrame(false);
      if (app.dock && dockBounceId != null) { try { app.dock.cancelBounce(dockBounceId); } catch (e) {} dockBounceId = null; }
      if (msgNotif) { try { msgNotif.close(); } catch (e) {} msgNotif = null; }
    } catch (e) {}
  }

  /** 新消息 / 新文件提醒：置前 + 系统通知，点击直达飞鸽传书 */
  ipcMain.handle('lan:notify', (_e, payload) => {
    const p = payload || {};
    const title = p.title || '飞鸽传书';
    const body = p.body || '你有一条新消息';
    wakeWindow();
    try {
      if (Notification.isSupported()) {
        if (msgNotif) { try { msgNotif.close(); } catch (e) {} }
        msgNotif = new Notification({ title, body, silent: !!p.silent });
        msgNotif.on('click', () => {
          wakeWindow();
          try { mainWindow && mainWindow.webContents && mainWindow.webContents.send('lan:focus-view'); } catch (e) {}
        });
        msgNotif.show();
      } else {
        console.warn('[LAN] 当前系统不支持通知，已改用窗口置前 + 闪烁提醒');
      }
    } catch (e) { /* 通知失败不阻塞消息 */ }
    return { ok: true };
  });
  ipcMain.handle('lan:alertOff', () => { calmWindow(); return { ok: true }; });

  /* ---- 开机自动启动（便于被同网段电脑随时发现） ---- */
  ipcMain.handle('lan:autoLaunchGet', () => {
    try { return { ok: true, on: !!(app.getLoginItemSettings && app.getLoginItemSettings().openAtLogin) }; }
    catch (e) { return { ok: false, on: false }; }
  });
  ipcMain.handle('lan:autoLaunchSet', (_e, on) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true });
      return { ok: true, on: !!on };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ---- 系统 ---- */
  ipcMain.handle('sys:info', () => ({
    version: app.getVersion(),
    name: APP_NAME,
    platform: process.platform,
    dataPath: DB_FILE,
    electron: process.versions.electron,
    node: process.versions.node
  }));

  ipcMain.handle('sys:openDataDir', () => { shell.openPath(DATA_DIR); return true; });
  ipcMain.handle('sys:openExternal', (_e, url) => { shell.openExternal(url); return true; });

  ipcMain.handle('sys:saveDialog', async (_e, { defaultName, content, filters }) => {
    const res = await dialog.showSaveDialog(mainWindow, { title: '保存备份', defaultPath: defaultName, filters });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { canceled: false, path: res.filePath };
  });

  ipcMain.handle('sys:openDialog', async (_e, { filters }) => {
    const res = await dialog.showOpenDialog(mainWindow, { filters, properties: ['openFile'] });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0], content: fs.readFileSync(res.filePaths[0], 'utf8') };
  });
}

/* ------------------------------------------------------------------ */
/*  窗口                                                               */
/* ------------------------------------------------------------------ */
function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: isMac ? '#00000000' : '#0f172a',
    title: APP_NAME,
    autoHideMenuBar: true,
    /* macOS 27「Golden Gate」适配：
       - hiddenInset：隐藏原生标题栏、保留交通灯按钮，配合页面内自绘顶栏（Liquid Glass）
       - trafficLightPosition：为红绿灯留出与侧边栏品牌区对齐的位置
       - vibrancy：原生毛玻璃窗口材质（under-window 最贴近系统级 Liquid Glass）
       - transparent：让 #app 的渐变背景透出系统壁纸/材质 */
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      transparent: true,
      roundedCorners: true
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  /**
   * 关闭行为（可在「设置 → 关闭主窗口时」中配置）：
   *   - 最小化到托盘（默认）：点关闭只把窗口隐藏，程序继续在后台运行，
   *     这样同网段的同事仍能发现你、给你发消息与文件；点托盘图标可随时唤回。
   *   - 直接退出：点关闭即结束程序。
   * 只有在用户选择「退出」菜单或系统关机时（isQuitting = true）才真正关闭。
   */
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    let toTray = true;
    try { toTray = readChatStore().closeToTray !== false; } catch (err) { toTray = true; }
    if (!toTray) return;                      // 用户选择「直接退出」：放行，正常关闭
    e.preventDefault();
    mainWindow.hide();
    ensureTray();                             // 首次隐藏时创建托盘图标
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ------------------------- 系统托盘 ------------------------- */
/** 创建（或复用）托盘图标，提供「显示主界面 / 退出」菜单 */
function ensureTray() {
  if (tray) return tray;
  try {
    // 托盘图标：优先用 32px 小图标（Windows 任务栏托盘显示更清晰）
    const p32 = path.join(__dirname, '..', 'renderer', 'assets', 'tray.png');
    const pIco = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
    let icon = nativeImage.createFromPath(p32);
    if (icon.isEmpty()) icon = nativeImage.createFromPath(pIco);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const showWin = () => {
      if (!mainWindow) createWindow();
      else { mainWindow.show(); mainWindow.focus(); }
    };
    const menu = Menu.buildFromTemplate([
      { label: APP_NAME, enabled: false },
      { type: 'separator' },
      { label: '显示主界面', click: showWin },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(menu);
    // 单击 / 双击托盘图标即唤回窗口（Windows 习惯）
    tray.on('click', showWin);
    tray.on('double-click', showWin);
  } catch (e) {
    console.error('[ClassMaster] 托盘创建失败（不影响功能）:', e.message);
  }
  return tray;
}

/** 销毁托盘图标 */
function destroyTray() {
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
}

// 单实例：重复启动时不再开第二个窗口，而是把已有窗口唤醒到前台。
// 局域网场景下这很关键——用户双击图标想"唤起"软件时，必须能看到已在运行的窗口。
const gotLock = app.requestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    } catch (e) {}
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    /* macOS 必须有应用菜单（否则 Cmd+Q / Cmd+W 与「关于」缺失，不符合 HIG） */
    const macMenu = Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: '关于 ' + APP_NAME + '（开发者：鸿升中学周老师）' },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏 ' + APP_NAME },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: '退出 ' + APP_NAME }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '拷贝' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新载入' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '进入全屏幕' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          { type: 'separator' },
          { role: 'front', label: '前置全部窗口' }
        ]
      }
    ]);
    Menu.setApplicationMenu(macMenu);
  } else {
    Menu.setApplicationMenu(null);
  }
  // 权限：仅放行「通知」（收到新消息时弹系统提醒），已移除音视频相关权限
  try {
    const ALLOW = ['notifications'];
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOW.indexOf(permission) >= 0);
    });
    if (session.defaultSession.setPermissionCheckHandler) {
      session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOW.indexOf(permission) >= 0);
    }
  } catch (e) { console.error('[ClassMaster] 权限处理器注册失败:', e.message); }
  registerIpc();
  createWindow();
  // macOS：点 Dock 图标时，若窗口已被隐藏（最小化到托盘）则重新显示
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); }
  });
});

// 关闭全部窗口后：若开启了「关闭时最小化到托盘」，则不退出程序（后台常驻，
// 便于同事持续发现你并给你发消息/文件）；仅当用户选择「直接退出」时才真正退出。
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;      // macOS 惯例：关窗不退出
  if (!isQuitting) {
    let toTray = true;
    try { toTray = readChatStore().closeToTray !== false; } catch (e) { toTray = true; }
    if (toTray) { ensureTray(); return; }          // 继续驻留托盘
  }
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;                               // 标记为真正退出，放行 close 事件
  destroyTray();
  if (lanEngine) try { lanEngine.stop(); } catch (e) {}
});
