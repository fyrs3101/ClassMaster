/* =====================================================================
   store.js —— 应用状态与数据持久化桥接
   ===================================================================== */
(function (global) {
  'use strict';

  const SUBJECT_ORDER = ['语文', '数学', '英语', '物理', '化学', '政治', '历史', '地理', '生物'];
  const FULL_MARK = { 语文: 150, 数学: 150, 英语: 150, 物理: 100, 化学: 100, 政治: 100, 历史: 100, 地理: 100, 生物: 100 };

  const S = {
    db: null,
    ui: {
      view: 'dashboard',
      theme: 'dark',
      studentFilter: 'all',
      studentSort: { key: 'rank', dir: 1 },
      globalSearch: '',
      gradeMode: 'overview',
      seatMode: 'group',
      seatShowScores: true,
      pointsMode: 'board',
      pointsSearch: '',
      compareIds: [],
      seatingDraft: null      // 未保存的分组草稿
    },
    route: {},
    listeners: {}
  };

  /* ---------- 事件总线 ---------- */
  function on(evt, fn) { (S.listeners[evt] = S.listeners[evt] || []).push(fn); }
  function emit(evt, payload) { (S.listeners[evt] || []).forEach(f => { try { f(payload); } catch (e) { console.error(e); } }); }

  /* ---------- 加载 / 保存 ---------- */
  async function load() {
    S.db = await global.CM.readDB();
    return S.db;
  }
  async function save() {
    if (!S.db) return;
    global.CM.writeDB(S.db);
    emit('changed', S.db);
  }
  function saveDebounced() {
    clearTimeout(S._t);
    S._t = setTimeout(() => save(), 260);
  }

  /* ---------- 学生工具 ---------- */
  function activeGrade() {
    const gs = (S.db && S.db.grades) || [];
    return gs.length ? gs[gs.length - 1] : null;
  }

  /** 合并 students + 最新成绩，输出统一视图对象 */
  function mergedStudents() {
    if (!S.db) return [];
    const g = activeGrade();
    const map = {};
    if (g && g.rows) g.rows.forEach(r => { map[r.name] = r; });
    return (S.db.students || []).map(st => {
      const r = map[st.name] || {};
      const scores = r.scores || st.scores || {};
      const total = r.total != null ? r.total : st.total;
      return {
        id: st.id,
        name: st.name,
        sid: st.sid || '',
        gender: st.gender || '',
        notes: st.notes || '',
        group: st.group || '',
        scores,
        ranks: r.ranks || st.ranks || {},
        total: total == null ? null : total,
        rankClass: r.ranks && r.ranks._class != null ? r.ranks._class : (st.ranks && st.ranks._class),
        rankSchool: r.ranks && r.ranks._school != null ? r.ranks._school : (st.ranks && st.ranks._school)
      };
    });
  }

  function subjects() {
    const list = [];
    for (const st of mergedStudents()) {
      for (const k of Object.keys(st.scores || {})) if (list.indexOf(k) < 0) list.push(k);
    }
    // 按标准学科顺序排
    return list.sort((a, b) => {
      const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function fullMarkOf(sub) { return FULL_MARK[sub] || 100; }

  /* ---------- 层次划分 ---------- */
  function levelOf(student, allStudents) {
    const list = (allStudents || mergedStudents()).filter(s => s.total != null).sort((a, b) => b.total - a.total);
    const n = list.length;
    if (!n || student.total == null) return 'C';
    const idx = list.findIndex(s => s.id === student.id);
    if (idx < 0) return 'C';
    const p = idx / n;
    if (p < 0.25) return 'A';
    if (p < 0.5) return 'B';
    if (p < 0.8) return 'C';
    return 'D';
  }

  const LEVEL_META = {
    A: { name: '优秀', color: '#10b981', tag: 'tag-green', desc: '成绩优秀，可担任小组长' },
    B: { name: '良好', color: '#3b82f6', tag: 'tag-blue', desc: '成绩良好，稳定中上' },
    C: { name: '中等', color: '#f59e0b', tag: 'tag-amber', desc: '成绩中等，有提升空间' },
    D: { name: '待提升', color: '#ef4444', tag: 'tag-red', desc: '需要重点关注与帮扶' }
  };

  /** 依据策略给出层次划分（用于排座） */
  function classify(strategy, groupCount, perLevel) {
    const studs = mergedStudents().filter(s => s.total != null);
    const sorted = studs.slice().sort((a, b) => b.total - a.total);
    const n = sorted.length;
    const res = { A: [], B: [], C: [], D: [], unassigned: [] };

    if (strategy === 'ratio') {
      // 按名额比例划分：每组 perLevel 人 => 该层总名额 = groupCount * perLevel
      const quota = groupCount * perLevel;
      res.A = sorted.slice(0, Math.min(quota, n));
      res.B = sorted.slice(Math.min(quota, n), Math.min(quota * 2, n));
      res.C = sorted.slice(Math.min(quota * 2, n), Math.min(quota * 3, n));
      res.D = sorted.slice(Math.min(quota * 3, n));
    } else {
      // 按四分位划分
      const q1 = Math.round(n * 0.25), q2 = Math.round(n * 0.5), q3 = Math.round(n * 0.8);
      res.A = sorted.slice(0, q1);
      res.B = sorted.slice(q1, q2);
      res.C = sorted.slice(q2, q3);
      res.D = sorted.slice(q3);
    }
    // 剩余学生（无总分）
    res.unassigned = mergedStudents().filter(s => s.total == null);
    return res;
  }

  /* ---------- 积分 ---------- */
  function pointsOf(studentId) {
    const recs = (S.db && S.db.points && S.db.points.records) || [];
    return recs.filter(r => r.studentId === studentId).reduce((a, b) => a + (Number(b.score) || 0), 0);
  }
  function pointsMap() {
    const m = {};
    const recs = (S.db && S.db.points && S.db.points.records) || [];
    for (const r of recs) m[r.studentId] = (m[r.studentId] || 0) + (Number(r.score) || 0);
    return m;
  }
  function addPoints(studentIds, score, reason, category) {
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    const now = Date.now();
    ids.forEach((sid, i) => {
      S.db.points.records.push({
        id: 'p' + (now + i) + Math.random().toString(36).slice(2, 6),
        studentId: sid,
        score: Number(score) || 0,
        reason: reason || '',
        category: category || '自定义',
        operator: '班主任',
        time: new Date().toISOString()
      });
    });
    save();
    emit('points-changed');
  }

  /* ---------- 工具 ---------- */
  function uid(prefix) { return (prefix || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDay(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = x => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}/${p(d.getDate())}`;
  }

  global.Store = {
    S, on, emit, load, save, saveDebounced,
    mergedStudents, subjects, fullMarkOf, levelOf, LEVEL_META, classify,
    pointsOf, pointsMap, addPoints, activeGrade,
    uid, fmtDate, fmtDay, SUBJECT_ORDER, FULL_MARK
  };
})(window);
