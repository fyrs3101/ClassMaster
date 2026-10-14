/* =====================================================================
   analytics.js —— 成绩分析引擎
   提供：班级概览、学科统计、分数段、层次分布、学生对比、薄弱识别
   ===================================================================== */
(function (global) {
  'use strict';
  const St = global.Store;

  const LEVELS = ['A', 'B', 'C', 'D'];

  /* ---------------- 班级总览 ---------------- */
  function overview() {
    const studs = St.mergedStudents();
    const withTotal = studs.filter(s => s.total != null);
    const totals = withTotal.map(s => s.total);
    const n = totals.length;
    const sum = totals.reduce((a, b) => a + b, 0);
    const avg = n ? sum / n : 0;
    const sorted = totals.slice().sort((a, b) => a - b);
    const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
    const max = n ? sorted[n - 1] : 0;
    const min = n ? sorted[0] : 0;
    const variance = n ? totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / n : 0;
    const std = Math.sqrt(variance);

    // 优秀率(总分率>=85%)、及格率(>=60%)
    const subjs = St.subjects();
    let fullSum = 0;
    subjs.forEach(s => fullSum += St.fullMarkOf(s));
    const rate = fullSum ? (t => t / fullSum) : (() => 0);
    const excellent = withTotal.filter(s => avgRate(s, subjs) >= 0.85).length;
    const pass = withTotal.filter(s => avgRate(s, subjs) >= 0.6).length;

    return {
      count: studs.length,
      countWithTotal: n,
      avg, median, max, min, std,
      excellent, excellentRate: n ? excellent / n : 0,
      pass, passRate: n ? pass / n : 0,
      sum,
      maxTotal: fullSum,
      subjects: subjs,
      spread: max - min
    };
  }

  function avgRate(st, subjs) {
    let got = 0, full = 0;
    subjs.forEach(s => {
      const v = st.scores[s];
      if (v != null) { got += v; full += St.fullMarkOf(s); }
    });
    return full ? got / full : 0;
  }

  /* ---------------- 单科统计 ---------------- */
  function subjectStats() {
    const studs = St.mergedStudents();
    const subjs = St.subjects();
    return subjs.map((sub, i) => {
      const vals = studs.map(s => s.scores[sub]).filter(v => typeof v === 'number');
      const n = vals.length;
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = n ? sum / n : 0;
      const sorted = vals.slice().sort((a, b) => a - b);
      const max = n ? sorted[n - 1] : 0;
      const min = n ? sorted[0] : 0;
      const med = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
      const std = n ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / n) : 0;
      const full = St.fullMarkOf(sub);
      const passCount = vals.filter(v => v >= full * 0.6).length;
      const excCount = vals.filter(v => v >= full * 0.85).length;
      return {
        subject: sub, full, n, avg, max, min, median: med, std, sum,
        rate: full ? avg / full : 0,
        passRate: n ? passCount / n : 0,
        excellentRate: n ? excCount / n : 0,
        passCount, excCount
      };
    });
  }

  /* ---------------- 分数段分布 ---------------- */
  function distribution(step, sub) {
    const studs = St.mergedStudents().filter(s => s.total != null);
    const vals = sub ? studs.map(s => s.scores[sub]).filter(v => typeof v === 'number') : studs.map(s => s.total);
    if (!vals.length) return [];
    const full = sub ? St.fullMarkOf(sub) : (St.subjects().reduce((a, s) => a + St.fullMarkOf(s), 0));
    const buckets = [];
    const count = Math.ceil(full / step);
    for (let i = count - 1; i >= 0; i--) {
      const lo = i * step, hi = Math.min(full, (i + 1) * step);
      const c = vals.filter(v => v >= lo && (i === count - 1 ? v <= hi : v < hi)).length;
      buckets.push({ label: `${lo}-${hi}`, lo, hi, count: c });
    }
    return buckets;
  }

  /** 按得分率分段（更通用，适用于不同满分） */
  function rateDistribution(sub) {
    const studs = St.mergedStudents();
    const segs = [
      { label: '0~59%', lo: 0, hi: .6, color: '#ef4444' },
      { label: '60~69%', lo: .6, hi: .7, color: '#f97316' },
      { label: '70~79%', lo: .7, hi: .8, color: '#f59e0b' },
      { label: '80~89%', lo: .8, hi: .9, color: '#3b82f6' },
      { label: '90~100%', lo: .9, hi: 1.01, color: '#10b981' }
    ];
    return segs.map(sg => {
      const c = studs.filter(st => {
        const r = sub ? (st.scores[sub] != null ? st.scores[sub] / St.fullMarkOf(sub) : null) : avgRate(st, St.subjects());
        return r != null && r >= sg.lo && r < sg.hi;
      }).length;
      return { label: sg.label, count: c, color: sg.color };
    });
  }

  /* ---------------- 层次分布 ---------------- */
  function levelDistribution() {
    const studs = St.mergedStudents();
    const m = { A: 0, B: 0, C: 0, D: 0 };
    studs.forEach(s => { m[St.levelOf(s, studs)]++; });
    return LEVELS.map(k => ({
      label: `${k} ${St.LEVEL_META[k].name}`,
      key: k, value: m[k], color: St.LEVEL_META[k].color
    }));
  }

  /* ---------------- 排名 ---------------- */
  function ranked() {
    const studs = St.mergedStudents().filter(s => s.total != null);
    return studs.slice().sort((a, b) => b.total - a.total).map((s, i) => ({ ...s, rank: i + 1 }));
  }

  /* ---------------- 学科强弱（班级层面） ---------------- */
  function subjectStrength() {
    return subjectStats().map(s => ({
      label: s.subject,
      value: +(s.rate * 100).toFixed(1),
      avg: +s.avg.toFixed(1),
      full: s.full,
      color: s.rate >= 0.8 ? '#10b981' : s.rate >= 0.7 ? '#3b82f6' : s.rate >= 0.6 ? '#f59e0b' : '#ef4444'
    }));
  }

  /* ---------------- 需关注学生 ---------------- */
  function weakStudents() {
    const studs = St.mergedStudents().filter(s => s.total != null);
    const subjs = St.subjects();
    const rank = ranked();
    const totalRankMap = {};
    rank.forEach(r => totalRankMap[r.id] = r.rank);

    return studs.map(st => {
      const issues = [];
      // 单科显著薄弱：该科排名后 25% 且得分率 < 60%
      subjs.forEach(sub => {
        const v = st.scores[sub];
        if (v == null) return;
        const full = St.fullMarkOf(sub);
        if (v / full < 0.6) {
          const vals = studs.map(x => x.scores[sub]).filter(x => typeof x === 'number').sort((a, b) => b - a);
          const r = vals.indexOf(v) + 1;
          if (r / vals.length > 0.75) issues.push({ type: 'subject', subject: sub, value: v, full, rank: r, rankTotal: vals.length });
        }
      });
      // 偏科：某科比班平均低 15 分以上
      const ss = subjectStats();
      subjs.forEach(sub => {
        const v = st.scores[sub];
        const s = ss.find(x => x.subject === sub);
        if (v != null && s && s.n > 3 && (s.avg - v) >= Math.max(12, s.full * 0.15)) {
          if (!issues.some(i => i.subject === sub)) issues.push({ type: 'lopsided', subject: sub, value: v, avg: +s.avg.toFixed(1), gap: +(s.avg - v).toFixed(1) });
        }
      });
      // 总分偏低
      const tr = totalRankMap[st.id];
      const low = tr && tr / rank.length > 0.8;

      let severity = issues.length * 2 + (low ? 3 : 0);
      return { student: st, issues, totalRank: tr, totalRankCount: rank.length, lowTotal: low, severity };
    }).filter(x => x.severity > 0).sort((a, b) => b.severity - a.severity);
  }

  /* ---------------- 学生个体画像 ---------------- */
  function profile(studentId) {
    const studs = St.mergedStudents();
    const st = studs.find(s => s.id === studentId);
    if (!st) return null;
    const subjs = St.subjects();
    const ss = subjectStats();
    const rank = ranked();
    const tr = rank.findIndex(r => r.id === studentId);
    const points = St.pointsOf(studentId);

    const radar = subjs.map(sub => {
      const v = st.scores[sub];
      const full = St.fullMarkOf(sub);
      return { label: sub, value: v == null ? 0 : +((v / full) * 100).toFixed(1), raw: v, full };
    });

    const subjectRanks = {};
    subjs.forEach(sub => {
      const vals = studs.map(x => x.scores[sub]).filter(x => typeof x === 'number').sort((a, b) => b - a);
      const v = st.scores[sub];
      subjectRanks[sub] = v == null ? null : { rank: vals.indexOf(v) + 1, total: vals.length };
    });

    const level = St.levelOf(st, studs);
    const totals = rank.map(r => r.total);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const std = totals.length ? Math.sqrt(totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length) : 1;

    return {
      student: st, radar, subjectRanks, level,
      rankClass: tr >= 0 ? tr + 1 : null,
      rankTotal: rank.length,
      rankSchool: st.rankSchool,
      points,
      zScore: std ? +((st.total - avg) / std).toFixed(2) : 0,
      avgOfClass: +avg.toFixed(1),
      diffFromAvg: +(st.total - avg).toFixed(1),
      subjects: subjs,
      subjectStats: ss
    };
  }

  /* ---------------- 学生对比 ---------------- */
  function compare(ids) {
    const studs = St.mergedStudents();
    const picked = ids.map(id => studs.find(s => s.id === id)).filter(Boolean);
    const subjs = St.subjects();
    const rank = ranked();
    return {
      subjects: subjs,
      students: picked.map(st => ({
        student: st,
        radar: subjs.map(sub => ({
          label: sub, value: st.scores[sub] == null ? 0 : +((st.scores[sub] / St.fullMarkOf(sub)) * 100).toFixed(1), raw: st.scores[sub], full: St.fullMarkOf(sub)
        })),
        rankClass: rank.findIndex(r => r.id === st.id) + 1,
        total: st.total
      }))
    };
  }

  /* ---------------- 导出用的 AOA ---------------- */
  function buildExportSheets() {
    const ov = overview();
    const ss = subjectStats();
    const rank = ranked();
    const subjs = ov.subjects;

    /* Sheet1：班级总览 */
    const s1 = [
      ['班级成绩分析报告'],
      ['生成时间', new Date().toLocaleString('zh-CN')],
      [],
      ['指标', '数值'],
      ['学生人数', ov.count],
      ['有成绩人数', ov.countWithTotal],
      ['总分平均', +ov.avg.toFixed(2)],
      ['总分中位数', +ov.median.toFixed(1)],
      ['总分最高', ov.max],
      ['总分最低', ov.min],
      ['极差', ov.spread],
      ['标准差', +ov.std.toFixed(2)],
      ['优秀人数(≥85%)', ov.excellent],
      ['优秀率', (ov.excellentRate * 100).toFixed(1) + '%'],
      ['及格人数(≥60%)', ov.pass],
      ['及格率', (ov.passRate * 100).toFixed(1) + '%']
    ];

    /* Sheet2：学科统计 */
    const s2 = [['学科', '满分', '参考人数', '平均分', '最高分', '最低分', '中位数', '标准差', '得分率', '及格率', '优秀率']];
    ss.forEach(s => s2.push([
      s.subject, s.full, s.n, +s.avg.toFixed(2), s.max, s.min, +s.median.toFixed(1), +s.std.toFixed(2),
      (s.rate * 100).toFixed(1) + '%', (s.passRate * 100).toFixed(1) + '%', (s.excellentRate * 100).toFixed(1) + '%'
    ]));

    /* Sheet3：成绩明细 */
    const s3 = [['班次', '姓名', '总分', '层次', ...subjs, '积分']];
    const pm = St.pointsMap();
    rank.forEach(r => {
      s3.push([
        r.rank, r.name, r.total, St.levelOf(r, rank.map(x => x)),
        ...subjs.map(sub => r.scores[sub] == null ? '' : r.scores[sub]),
        pm[r.id] || 0
      ]);
    });

    /* Sheet4：学科排名 */
    const s4 = [['姓名', ...subjs.map(s => s + '排名')]];
    rank.forEach(r => {
      const row = [r.name];
      subjs.forEach(sub => {
        const vals = rank.map(x => x.scores[sub]).filter(x => typeof x === 'number').sort((a, b) => b - a);
        const v = r.scores[sub];
        row.push(v == null ? '' : vals.indexOf(v) + 1);
      });
      s4.push(row);
    });

    return [
      { name: '班级总览', aoa: s1 },
      { name: '学科统计', aoa: s2 },
      { name: '成绩明细', aoa: s3 },
      { name: '学科排名', aoa: s4 }
    ];
  }

  global.Analytics = {
    overview, subjectStats, distribution, rateDistribution, levelDistribution,
    ranked, subjectStrength, weakStudents, profile, compare,
    buildExportSheets, avgRate
  };
})(window);
