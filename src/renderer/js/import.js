/* =====================================================================
   import.js —— 多元化导入模块
   支持：
     1. 整班成绩表（含两行表头：科目 / 得分·校次·班次）
     2. 多 Sheet 合并导入
     3. 纯名单表（只有姓名/学号）
     4. CSV / TSV 文本
     5. 手动粘贴（直接粘贴 Excel 表格内容）
     6. 分组表导入（姓名 + 组号）
     7. 当前已导入学生追加 / 覆盖
   ===================================================================== */
(function (global) {
  'use strict';
  const St = global.Store;

  const state = {
    step: 1,
    files: [],           // 已选文件
    parsed: null,        // 解析结果
    source: '',          // 'file' | 'paste' | 'group'
    mode: 'grades',      // grades | roster | group
    mergeMode: 'replace',
    preview: [],
    groupAssign: null
  };
  let ui = null;

  /* ---------------- 学科识别 ---------------- */
  const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '政治', '历史', '地理', '生物'];
  const SUB_ALIAS = {
    语文: ['语文', '语', 'chinese', 'chn', 'yw'],
    数学: ['数学', '数', 'math', 'sx'],
    英语: ['英语', '英', 'english', 'eng', 'yy'],
    物理: ['物理', '物', 'physics', 'phy', 'wl'],
    化学: ['化学', '化', 'chemistry', 'hx'],
    政治: ['政治', '道德与法治', '道法', '思想品德', '品德', 'zz'],
    历史: ['历史', '史', 'history', 'ls'],
    地理: ['地理', '地', 'geography', 'dl'],
    生物: ['生物', '生', 'biology', 'sw']
  };
  const FIELD_ALIAS = {
    姓名: ['姓名', '学生姓名', '学生', '名字', 'name', '学生名称'],
    学号: ['学号', '学籍号', '考号', '准考证号', '编号', 'no', 'id', '学籍'],
    序号: ['序号', '序'],
    班级: ['班级', '所在班级'],
    总分: ['总分', '合计', '总计', '总成绩', 'total', '总分数'],
    校次: ['校次', '校排名', '年级排名', '级名次', '校名次', '年级名次'],
    班次: ['班次', '班排名', '班级排名', '班名次', '班级名次'],
    组号: ['组号', '小组', '组别', '分组', 'group', '小组号', '所在组'],
    性别: ['性别', 'sex', 'gender']
  };

  function norm(s) { return String(s == null ? '' : s).replace(/[\s\u3000]/g, '').replace(/[()（）:：]/g, '').toLowerCase(); }

  function matchAny(header, aliasMap) {
    const h = norm(header);
    if (!h) return null;
    for (const [field, list] of Object.entries(aliasMap)) {
      for (const a of list) if (h === norm(a)) return field;
    }
    for (const [field, list] of Object.entries(aliasMap)) {
      for (const a of list) { const na = norm(a); if (na.length >= 2 && h.includes(na)) return field; }
    }
    return null;
  }
  const matchSubject = h => matchAny(h, SUB_ALIAS);
  const matchField = h => matchAny(h, FIELD_ALIAS);

  /* ==================================================================
     解析：把 AOA（二维数组）解析为 { students, mapping, title, sheets }
     ================================================================== */
  function parseAoa(matrix, sheetName) {
    // 1. 定位表头行
    let hIdx = -1;
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const row = matrix[i] || [];
      const hasName = row.some(c => matchField(c) === '姓名');
      if (hasName) { hIdx = i; break; }
    }
    if (hIdx === -1) {
      for (let i = 0; i < Math.min(matrix.length, 12); i++) {
        const row = (matrix[i] || []).filter(x => x != null && String(x).trim() !== '');
        if (row.length >= 2 && row.every(x => typeof x === 'string' && x.length <= 12)) { hIdx = i; break; }
      }
    }
    if (hIdx === -1) return { students: [], mapping: [], title: '' };

    const title = (matrix.slice(0, hIdx).flat().filter(x => typeof x === 'string' && x.trim())[0] || '').trim();
    const head = matrix[hIdx] || [];
    const sub = matrix[hIdx + 1] || [];
    const hasSub = sub.some(x => x != null && typeof x === 'string' && /^(得分|分数|成绩|校次|班次|排名|名次|等级)$/.test(String(x).trim()));

    let dataStart = hIdx + 1;
    const cols = [];

    if (hasSub) {
      dataStart = hIdx + 2;
      // 横向填充合并表头的父级
      const parents = [];
      let last = '';
      const width = Math.max(head.length, sub.length);
      for (let c = 0; c < width; c++) {
        const p = head[c];
        if (p != null && String(p).trim()) last = String(p).trim();
        parents[c] = last;
      }
      for (let c = 0; c < width; c++) {
        const par = parents[c] || '';
        const s = sub[c] == null ? '' : String(sub[c]).trim();
        const pSub = matchSubject(par);
        const pField = matchField(par);
        const sField = matchField(s);
        const sSub = matchSubject(s);

        if (/^(得分|分数|成绩)$/.test(s) && pSub) cols.push({ i: c, field: pSub, kind: 'score' });
        else if (/^(校次|年级排名|级名次|校名次)$/.test(s)) cols.push({ i: c, field: '校次', kind: 'rank' });
        else if (/^(班次|班级排名|班名次|班级名次)$/.test(s)) cols.push({ i: c, field: '班次', kind: 'rank' });
        else if (/^(得分|分数|成绩)$/.test(s) && pField && pField !== '姓名') cols.push({ i: c, field: pField, kind: 'score' });
        else if (sSub && !pSub) cols.push({ i: c, field: sSub, kind: 'score' });
        else if (pSub) cols.push({ i: c, field: pSub, kind: /次|排名|名次/.test(s) ? 'rank' : 'score' });
        else if (pField) cols.push({ i: c, field: pField, kind: 'value' });
        else if (sField) cols.push({ i: c, field: sField, kind: 'value' });
        else cols.push({ i: c, field: null, kind: null });
      }
    } else {
      for (let c = 0; c < head.length; c++) {
        const f = matchField(head[c]) || matchSubject(head[c]);
        const isSub = !!matchSubject(head[c]) && !matchField(head[c]);
        cols.push({ i: c, field: f, kind: f ? (isSub ? 'score' : 'value') : null });
      }
    }

    // 2. 读取数据行
    const students = [];
    const seen = new Set();
    for (let r = dataStart; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (!row.some(x => x != null && String(x).trim() !== '')) continue;
      const o = { scores: {}, ranks: {}, extra: {}, groupNo: '' };
      let nonEmpty = 0;

      for (const col of cols) {
        if (!col.field) continue;
        const raw = row[col.i];
        if (raw == null || String(raw).trim() === '' || ['-', '—', '/', '--'].includes(String(raw).trim())) continue;
        nonEmpty++;
        if (col.field === '姓名') { o.name = String(raw).trim(); continue; }
        if (col.field === '学号') { o.sid = String(raw).trim(); continue; }
        if (col.field === '序号') continue;
        if (col.field === '班级') { o.className = String(raw).trim(); continue; }
        if (col.field === '组号') { o.groupNo = String(raw).trim(); continue; }
        if (col.field === '性别') { o.gender = String(raw).trim(); continue; }
        const num = Number(String(raw).replace(/[^\d.\-]/g, ''));
        if (Number.isNaN(num)) { o.extra[col.field] = String(raw).trim(); continue; }

        if (col.field === '总分') { if (col.kind === 'rank') o.ranks._total = num; else o.total = num; }
        else if (col.field === '校次') o.ranks._school = num;
        else if (col.field === '班次') o.ranks._class = num;
        else if (SUBJECTS.includes(col.field)) {
          if (col.kind === 'rank') o.ranks[col.field] = num; else o.scores[col.field] = num;
        }
      }

      if (!o.name) continue;
      if (/合计|平均|总计|统计|班级平均|最高分|最低分|及格率|优秀率/.test(o.name)) continue;
      if (o.name.length > 12) continue;
      const key = o.name + '#' + (o.total == null ? '' : o.total);
      if (seen.has(key)) continue;
      seen.add(key);

      if (o.total == null) {
        const vs = Object.values(o.scores).filter(v => typeof v === 'number');
        if (vs.length) o.total = vs.reduce((a, b) => a + b, 0);
      }
      students.push(o);
    }

    return {
      students,
      mapping: cols.filter(c => c.field).map(c => ({ col: c.i, field: c.field, kind: c.kind })),
      title, headerRow: hIdx, dataStart
    };
  }

  /* ---------------- 从 SheetJS 工作簿解析 ---------------- */
  function parseWorkbook(wb) {
    const out = { sheets: [], students: [], title: '', mapping: [] };
    wb.SheetNames.forEach(sn => {
      const ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) return;
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
      if (!matrix.length) return;
      const r = parseAoa(matrix, sn);
      if (!r.students.length) return;
      out.sheets.push({ name: sn, count: r.students.length, title: r.title, mapping: r.mapping });
      out.students.push(...r.students.map(s => ({ ...s, _sheet: sn })));
      if (!out.title && r.title) out.title = r.title;
      if (!out.mapping.length) out.mapping = r.mapping;
    });
    // 跨 sheet 去重
    const seen = new Set();
    out.students = out.students.filter(s => {
      const k = s.name + '#' + (s.total == null ? '' : s.total);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    return out;
  }

  /* ---------------- 文本粘贴解析（Tab 分隔或 CSV） ---------------- */
  function parseText(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    if (!lines.length) return { students: [], mapping: [], title: '', sheets: [] };
    const delim = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? '\t' : ',';
    const matrix = lines.map(l => {
      if (delim === '\t') return l.split('\t').map(c => c.trim());
      // 简易 CSV（支持引号）
      const cells = []; let cur = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === ',' && !q) { cells.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    });
    const r = parseAoa(matrix, '粘贴数据');
    return { students: r.students, mapping: r.mapping, title: r.title, sheets: [{ name: '粘贴数据', count: r.students.length, title: r.title, mapping: r.mapping }] };
  }

  /* ---------------- 读取文件 ---------------- */
  async function readFiles(files) {
    const results = [];
    for (const f of files) {
      const name = (f.name || f).toString();
      const ext = name.split('.').pop().toLowerCase();
      try {
        let wb;
        if (ext === 'csv') {
          const text = await f.text();
          const r = parseText(text);
          results.push({ fileName: name, ok: true, ...r });
          continue;
        }
        const buf = await f.arrayBuffer();
        wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const r = parseWorkbook(wb);
        results.push({ fileName: name, ok: true, ...r });
      } catch (e) {
        results.push({ fileName: name, ok: false, error: e.message });
      }
    }
    return results;
  }

  /* ---------------- 合并多文件结果 ---------------- */
  function mergeResults(results) {
    const ok = results.filter(r => r.ok);
    const students = [];
    const sheets = [];
    let title = '';
    let mapping = [];
    ok.forEach(r => {
      students.push(...r.students.map(s => ({ ...s, _file: r.fileName })));
      (r.sheets || []).forEach(s => sheets.push({ ...s, file: r.fileName }));
      if (!title && r.title) title = r.title;
      if (!mapping.length && r.mapping && r.mapping.length) mapping = r.mapping;
    });
    const seen = new Set();
    const uniq = students.filter(s => {
      const k = s.name + '#' + (s.total == null ? '' : s.total);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    return { students: uniq, sheets, title, mapping, failed: results.filter(r => !r.ok) };
  }

  /* ---------------- 推断考试名 / 班级名 ---------------- */
  function guessMeta(title, fileName) {
    const t = (title || '') + ' ' + (fileName || '');
    let examName = '';
    let className = '';
    const mClass = t.match(/([\u4e00-\u9fa5]{1,4}\d{0,2}班)/);
    if (mClass) className = mClass[1];
    const mExam = t.match(/(第一次月考|第二次月考|第三次月考|期中考试|期末考试|月考|期中|期末|模拟考|联考|单元测试|测验)/);
    if (mExam) examName = mExam[1];
    if (!examName) {
      const d = t.match(/(\d{1,2})[.\-月](\d{1,2})/);
      if (d) examName = `${d[1]}月${d[2]}日考试`;
    }
    return { examName, className };
  }

  /* ==================================================================
     提交导入
     ================================================================== */
  async function commit() {
    const db = St.S.db;
    const preview = state.preview;
    if (!preview.length) return { ok: false, error: '没有可导入的数据' };

    const meta = guessMeta(state.parsed.title, state.files.map(f => f.name).join(' '));
    const g = db.meta || {};

    if (state.mode === 'group') {
      // 分组表导入：只更新学生的组号映射
      const res = global.Seating.applyGroupNumbers(preview.map(p => ({ name: p.name, groupNo: p.groupNo })));
      db.seating = db.seating || {};
      db.seating.groups = res.groups;
      db.seating.groupCount = res.groups.length;
      db.seating.groupSize = Math.max(...res.groups.map(x => x.members.length), 0);
      db.seating.updatedAt = new Date().toISOString();
      // 同步 student.group
      (db.students || []).forEach(s => {
        const grp = res.groups.find(x => x.members.includes(s.id));
        s.group = grp ? grp.name : '';
      });
      await St.save();
      return { ok: true, type: 'group', groups: res.groups.length, unknown: res.unknown };
    }

    // 覆盖 / 追加
    if (state.mergeMode === 'replace') {
      db.students = [];
      db.grades = [];
    }

    const existByName = {};
    (db.students || []).forEach(s => existByName[s.name] = s);

    const gradeRows = [];
    let added = 0, updated = 0;

    preview.forEach(p => {
      let st = existByName[p.name];
      if (st) {
        updated++;
        if (p.sid && !st.sid) st.sid = p.sid;
        if (p.gender) st.gender = p.gender;
        st.scores = Object.assign({}, st.scores || {}, p.scores || {});
        st.ranks = Object.assign({}, st.ranks || {}, p.ranks || {});
        if (p.total != null) st.total = p.total;
      } else {
        added++;
        st = {
          id: St.uid('s'),
          name: p.name,
          sid: p.sid || '',
          gender: p.gender || '',
          notes: '',
          group: '',
          scores: p.scores || {},
          ranks: p.ranks || {},
          total: p.total == null ? null : p.total
        };
        db.students.push(st);
        existByName[p.name] = st;
      }
      gradeRows.push({
        id: st.id, name: st.name,
        scores: p.scores || {}, ranks: p.ranks || {},
        total: p.total == null ? null : p.total
      });
    });

    // 成绩快照
    db.grades.push({
      id: St.uid('g'),
      examName: g.examName || meta.examName || '未命名考试',
      date: new Date().toISOString(),
      subjects: Object.keys(preview[0].scores || {}),
      rows: gradeRows,
      source: state.files.map(f => f.name).join('、') || '粘贴导入'
    });

    // 更新班级信息
    db.meta = db.meta || {};
    if (meta.className && !db.meta.className) db.meta.className = meta.className;
    if (meta.examName) db.meta.examName = meta.examName;

    await St.save();
    return { ok: true, type: 'grades', added, updated, total: db.students.length };
  }

  global.Importer = { parseText, readFiles, mergeResults, commit, parseWorkbook, state, guessMeta, SUBJECTS };
})(window);
