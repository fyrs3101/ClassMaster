/* =====================================================================
   seating.js —— 智能排座引擎
   核心约束：每组 2 名优秀 + 2 名中等 + 2 名学困，组间总分均衡
   ===================================================================== */
(function (global) {
  'use strict';
  const St = global.Store;

  const GROUP_NAMES_STAR = ['逐梦组', '启航组', '星辰组', '破晓组', '远航组', '凌云组', '寻光组', '沐阳组', '摘星组',
    '青竹组', '白杨组', '弘毅组', '求真组', '笃行组', '博学组', '思齐组', '致远组', '敏行组'];

  /**
   * 核心分组算法：蛇形分配 + 层次约束 + 均衡优化
   * @param {Object} opt
   *   groupCount  组数
   *   groupSize   每组人数（不含老师）
   *   perLevel    每组每层次人数
   *   strategy    'snake' | 'sbalance' | 'random'
   *   basis       'total' | 'avg' | 'ratio'
   *   nameStyle   'num' | 'star' | 'keep'
   * @returns {Object} { groups:[{id,name,members:[sid]}], pool:[sid], meta }
   */
  function buildGroups(opt) {
    const o = Object.assign({ groupCount: 9, groupSize: 6, perLevel: 2, strategy: 'sbalance', basis: 'total', nameStyle: 'num' }, opt || {});
    const G = Math.max(1, o.groupCount | 0);
    const CAP = Math.max(1, o.groupSize | 0);
    const L = Math.max(1, o.perLevel | 0);

    const all = St.mergedStudents();
    const cls = St.classify(o.basis === 'ratio' ? 'ratio' : 'quartile', G, L);

    // 每层的排序依据
    const sortBy = (arr) => arr.slice().sort((a, b) => (b.total || 0) - (a.total || 0));

    const layers = {
      A: sortBy(cls.A),
      B: sortBy(cls.B),
      C: sortBy(cls.C),
      D: sortBy(cls.D)
    };

    // 初始化组
    const groups = [];
    for (let i = 0; i < G; i++) {
      groups.push({ id: 'g' + (i + 1), name: '', members: [], _sum: 0, _cnt: { A: 0, B: 0, C: 0, D: 0 } });
    }

    /* --------------------------------------------------------------
       核心分配：按层次蛇形（每层人名按实力降序，从当前最弱的组开始填）
       —— 这是实现"组间均衡 + 组内同层"的关键
       -------------------------------------------------------------- */
    const place = (stu, lv, order, allowOver) => {
      let best = -1, bestScore = Infinity;
      for (const gi of order) {
        const g = groups[gi];
        if (g.members.length >= CAP) continue;
        if (!allowOver && g._cnt[lv] >= L) continue;
        // 排在最前 = 该层名额仍有空 & 总分最低
        const need = L - g._cnt[lv];
        const score = (need <= 0 ? 500 : 0) + g._sum * 1000 + g.members.length;
        if (score < bestScore) { bestScore = score; best = gi; }
      }
      if (best < 0 && !allowOver) return place(stu, lv, order, true);
      if (best < 0) return false;
      groups[best].members.push(stu.id);
      groups[best]._cnt[lv]++;
      groups[best]._sum += (stu.total || 0);
      return true;
    };

    if (o.strategy === 'random') {
      /* ---------- 完全随机 ---------- */
      const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[x[i], x[j]] = [x[j], x[i]]; } return x; };
      const order = shuffle(groups.map((_, i) => i));
      const pool = shuffle(all.slice());
      let p = 0;
      for (const s of pool) {
        let placed = false;
        for (let k = 0; k < G; k++) {
          const gi = order[(p + k) % G];
          if (groups[gi].members.length < CAP) {
            groups[gi].members.push(s.id);
            groups[gi]._sum += (s.total || 0);
            groups[gi]._cnt[St.levelOf(s, all)]++;
            p++;
            placed = true; break;
          }
        }
        if (!placed) break;
      }
    } else if (o.strategy === 'snake') {
      /* ---------- 传统 S 型蛇形：每层内部按实力分块，正反向交替 ---------- */
      const lvOrder = ['A', 'B', 'C', 'D'];
      const totalPerLv = lvOrder.map(lv => layers[lv].length);
      // 轮次：每轮向每组放 1 人，层内从强到弱
      const maxRounds = Math.ceil(Math.max(...totalPerLv, 0) / G) || 1;
      const used = { A: 0, B: 0, C: 0, D: 0 };
      for (let round = 0; round < maxRounds; round++) {
        lvOrder.forEach((lv, li) => {
          const seq = [];
          for (let i = 0; i < G; i++) seq.push((round + li) % 2 === 0 ? i : G - 1 - i);
          for (const gi of seq) {
            if (used[lv] >= layers[lv].length) break;
            const g = groups[gi];
            if (g.members.length >= CAP) continue;
            if (g._cnt[lv] >= L) continue;
            const stu = layers[lv][used[lv]];
            if (!stu) continue;
            g.members.push(stu.id);
            g._cnt[lv]++;
            g._sum += (stu.total || 0);
            used[lv]++;
          }
        });
      }
      // 余下学生补入最空的组
      const rest = [];
      lvOrder.forEach(lv => { for (let i = used[lv]; i < layers[lv].length; i++) rest.push({ stu: layers[lv][i], lv }); });
      rest.sort((a, b) => (b.stu.total || 0) - (a.stu.total || 0));
      rest.forEach(({ stu, lv }) => {
        let best = -1, bestLen = Infinity;
        groups.forEach((g, gi) => { if (g.members.length < bestLen && g.members.length < CAP) { bestLen = g.members.length; best = gi; } });
        if (best >= 0) { groups[best].members.push(stu.id); groups[best]._cnt[lv]++; groups[best]._sum += (stu.total || 0); }
      });
    } else {
      /* ---------- 强均衡（推荐）：动态最弱组优先 + 层次名额约束 ---------- */
      const lvOrder = ['A', 'B', 'C', 'D'];
      for (const lv of lvOrder) {
        const list = layers[lv];
        for (const stu of list) {
          const order = groups.map((g, i) => i).sort((a, b) => {
            const ga = groups[a], gb = groups[b];
            const na = L - ga._cnt[lv], nb = L - gb._cnt[lv];
            // 优先仍缺该层次的组，其次总分更低的组，再次人更少的组
            if ((na > 0) !== (nb > 0)) return nb > 0 ? 1 : -1;
            if (ga._sum !== gb._sum) return ga._sum - gb._sum;
            return ga.members.length - gb.members.length;
          });
          place(stu, lv, order, false);
        }
      }
    }

    /* ---------- 均衡优化：局部交换降低组间总分差 ---------- */
    optimizeBalance(groups, CAP, o.strategy === 'random' ? 0 : 420);

    /* ---------- 未分组 ---------- */
    const assigned = new Set();
    groups.forEach(g => g.members.forEach(id => assigned.add(id)));
    const pool = all.filter(s => !assigned.has(s.id)).map(s => s.id);

    /* ---------- 去重（同一学生只保留一次） ---------- */
    const seen = new Set();
    groups.forEach(g => {
      g.members = g.members.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });
    });

    /* ---------- 命名 ---------- */
    const keepNames = o.nameStyle === 'keep' && Array.isArray(o.prevNames) && o.prevNames.length;
    groups.forEach((g, i) => {
      if (keepNames && o.prevNames[i]) g.name = o.prevNames[i];
      else if (o.nameStyle === 'star') g.name = GROUP_NAMES_STAR[i % GROUP_NAMES_STAR.length];
      else g.name = '第 ' + (i + 1) + ' 组';
    });

    return {
      groups: groups.map(g => ({ id: g.id, name: g.name, members: g.members.slice() })),
      pool,
      meta: { groupCount: G, groupSize: CAP, perLevel: L, strategy: o.strategy, basis: o.basis, createdAt: new Date().toISOString() }
    };
  }

  /**
   * 均衡优化：通过组间学生交换，使各组总分方差最小
   * 交换时保持每层人数结构不变（同层交换）
   */
  function optimizeBalance(groups, CAP, iterations) {
    if (iterations <= 0) return;
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);
    const lvOf = id => map[id] ? St.levelOf(map[id], all) : 'C';
    const totOf = g => g.members.reduce((a, id) => a + ((map[id] && map[id].total) || 0), 0);
    const varOf = () => {
      const sums = groups.map(totOf);
      const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
      return sums.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
    };

    let cur = varOf();
    for (let it = 0; it < iterations; it++) {
      const i = Math.floor(Math.random() * groups.length);
      let j = Math.floor(Math.random() * groups.length);
      if (i === j) j = (j + 1) % groups.length;
      const gi = groups[i], gj = groups[j];
      if (!gi.members.length || !gj.members.length) continue;

      // 选择同层次的两名学生交换
      const lv = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
      const candI = gi.members.filter(id => lvOf(id) === lv);
      const candJ = gj.members.filter(id => lvOf(id) === lv);
      if (!candI.length || !candJ.length) continue;

      const a = candI[Math.floor(Math.random() * candI.length)];
      const b = candJ[Math.floor(Math.random() * candJ.length)];
      if (a === b) continue;

      // 试交换
      const ia = gi.members.indexOf(a), ib = gj.members.indexOf(b);
      gi.members[ia] = b; gj.members[ib] = a;
      const nv = varOf();
      if (nv < cur) { cur = nv; }
      else { gi.members[ia] = a; gj.members[ib] = b; }  // 回滚
    }
  }

  /* ---------------- 分组均衡度指标 ---------------- */
  function metrics(groups) {
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);

    const rows = groups.map(g => {
      const studs = g.members.map(id => map[id]).filter(Boolean);
      const withTotal = studs.filter(s => s.total != null);
      const sum = withTotal.reduce((a, b) => a + b.total, 0);
      const avg = withTotal.length ? sum / withTotal.length : 0;
      const cnt = { A: 0, B: 0, C: 0, D: 0 };
      studs.forEach(s => cnt[St.levelOf(s, all)]++);
      const weak = studs.filter(s => St.levelOf(s, all) === 'D').length;
      return { id: g.id, name: g.name, size: studs.length, sum, avg, cnt, weak, studs };
    });

    const sums = rows.map(r => r.sum);
    const avgSum = sums.length ? sums.reduce((a, b) => a + b, 0) / sums.length : 0;
    const maxSum = sums.length ? Math.max(...sums) : 0;
    const minSum = sums.length ? Math.min(...sums) : 0;
    const std = sums.length ? Math.sqrt(sums.reduce((a, b) => a + Math.pow(b - avgSum, 2), 0) / sums.length) : 0;

    // 均衡度评分（0-100）：由极差与标准差综合折算
    const gapRatio = avgSum ? (maxSum - minSum) / avgSum : 0;
    const cv = avgSum ? std / avgSum : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - gapRatio * 190 - cv * 240)));

    // 层次结构校验：期望每组每层 perLevel 人
    const violations = [];
    rows.forEach(r => {
      ['A', 'B', 'C', 'D'].forEach(k => {
        if (r.cnt[k] !== undefined) { /* filled below */ }
      });
    });

    return {
      rows, avgSum, maxSum, minSum, std,
      gap: maxSum - minSum,
      score,
      totalLevels: {
        A: rows.reduce((a, r) => a + r.cnt.A, 0),
        B: rows.reduce((a, r) => a + r.cnt.B, 0),
        C: rows.reduce((a, r) => a + r.cnt.C, 0),
        D: rows.reduce((a, r) => a + r.cnt.D, 0)
      }
    };
  }

  /* ---------------- 教室座位图生成 ----------------
     每组 6 人排成 2×3 的方阵，组与组之间留过道
  -------------------------------------------------- */
  function classroom(groups, opt) {
    const o = Object.assign({ deskPerGroup: 6, cols: 3 }, opt || {});
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);

    return groups.map((g, gi) => {
      const studs = g.members.map(id => map[id]).filter(Boolean);
      const rows = [];
      const cols = o.cols;
      const rcount = Math.ceil(Math.max(studs.length, 1) / cols);
      // 组内排列：成绩最强的两人坐正中间
      const sorted = studs.slice().sort((a, b) => {
        const la = St.levelOf(a, all) === 'A' ? 0 : St.levelOf(a, all) === 'B' ? 1 : St.levelOf(a, all) === 'C' ? 2 : 3;
        const lb = St.levelOf(b, all) === 'A' ? 0 : St.levelOf(b, all) === 'B' ? 1 : St.levelOf(b, all) === 'C' ? 2 : 3;
        return la - lb;
      });
      // 中间优先排布：位置顺序 中、左、右、中后、左后、右后
      const slotOrder = rcount === 2 && cols === 3 ? [1, 0, 2, 4, 3, 5] : [...Array(rcount * cols).keys()];
      const seats = new Array(rcount * cols).fill(null);
      sorted.forEach((s, i) => { if (i < slotOrder.length) seats[slotOrder[i]] = s; });
      for (let r = 0; r < rcount; r++) rows.push(seats.slice(r * cols, (r + 1) * cols));
      return { groupId: g.id, name: g.name, index: gi, rows, count: studs.length };
    });
  }

  /* ---------------- 分组模板（下载用） ---------------- */
  function templateAoa(students, groupCount, groupSize) {
    const G = groupCount || 9, L = groupSize || 6;
    const aoa = [
      [`智能排座分组表模板（${G}组 × 每组${L}人）`],
      ['填写说明：在"组号"列填入 1-' + G + '，保存后通过"导入分组表"一键生成分组'],
      [],
      ['序号', '姓名', '总分', '层次', '组号(1-' + G + ')', '备注']
    ];
    const rank = global.Analytics.ranked();
    rank.forEach((s, i) => {
      aoa.push([i + 1, s.name, s.total, St.levelOf(s, rank.map(x => x)), '', '']);
    });
    return aoa;
  }

  /* ---------------- 导入分组号 ---------------- */
  function applyGroupNumbers(list, groupCount) {
    // list: [{name, groupNo}]
    const all = St.mergedStudents();
    const nameMap = {}; all.forEach(s => nameMap[s.name] = s);

    const buckets = {};
    const unknown = [];
    list.forEach(item => {
      const n = String(item.name || '').trim();
      if (!n) return;
      const st = nameMap[n];
      if (!st) { unknown.push(n); return; }
      const gnum = parseInt(String(item.groupNo).replace(/[^\d]/g, ''), 10);
      if (!gnum || gnum < 1) return;
      (buckets[gnum] = buckets[gnum] || []).push(st.id);
    });

    const nums = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const groups = nums.map((num, i) => ({
      id: 'g' + num,
      name: '第 ' + num + ' 组',
      members: buckets[num]
    }));

    const assigned = new Set();
    groups.forEach(g => g.members.forEach(id => assigned.add(id)));
    const pool = all.filter(s => !assigned.has(s.id)).map(s => s.id);

    return { groups, pool, unknown, groupCount: groups.length };
  }

  /* ---------------- 增删移动操作 ---------------- */
  function moveMember(draft, studentId, fromGroupIdx, toGroupIdx) {
    // draft: { groups, pool }
    if (fromGroupIdx === 'pool') {
      draft.pool = draft.pool.filter(id => id !== studentId);
    } else {
      const g = draft.groups[fromGroupIdx];
      if (g) g.members = g.members.filter(id => id !== studentId);
    }
    if (toGroupIdx === 'pool') {
      if (!draft.pool.includes(studentId)) draft.pool.push(studentId);
    } else {
      const g = draft.groups[toGroupIdx];
      if (g && !g.members.includes(studentId)) g.members.push(studentId);
    }
    return draft;
  }

  function addGroup(draft) {
    const n = draft.groups.length + 1;
    draft.groups.push({ id: 'g' + Date.now().toString(36), name: '第 ' + n + ' 组', members: [] });
    return draft;
  }

  function removeGroup(draft, idx) {
    const g = draft.groups[idx];
    if (!g) return draft;
    g.members.forEach(id => { if (!draft.pool.includes(id)) draft.pool.push(id); });
    draft.groups.splice(idx, 1);
    draft.groups.forEach((x, i) => { if (!/^第/.test(x.name) || true) x.name = x.name; });
    return draft;
  }

  /**
   * 导出智能分组 → 3 个 Sheet 数据
   *   分组明细：组号/组名/姓名/学号/性别/层次/总分/班级排名（含未入组名单）
   *   组号名单：姓名+组号，可通过「导入分组表」一键还原分组
   *   均衡统计：各组人数/均分/层次分布 + 均衡度评分与组间极差
   */
  function exportSheets(draft) {
    const all = St.mergedStudents();
    const rank = global.Analytics.ranked();
    const rankMap = {}; rank.forEach(s => { rankMap[s.id] = s; });
    const infoMap = {}; all.forEach(s => { infoMap[s.id] = s; });
    const LEVEL_NAMES = { A: '优秀', B: '良好', C: '中等', D: '待提高' };
    const groups = draft.groups || [];

    const detail = [['组号', '组名', '组内序号', '姓名', '学号', '性别', '层次', '总分', '班级排名']];
    const roster = [['姓名', '组号']];
    const stat = [['组号', '组名', '人数', '平均分', 'A层(优秀)', 'B层(良好)', 'C层(中等)', 'D层(待提高)']];

    let placed = 0;
    groups.forEach((g, gi) => {
      const members = (g.members || []).map(id => infoMap[id] || rankMap[id]).filter(Boolean);
      let sum = 0, sumN = 0;
      const lv = { A: 0, B: 0, C: 0, D: 0 };
      members.forEach((s, si) => {
        const lvKey = St.levelOf(s, all) || 'D';
        lv[lvKey] = (lv[lvKey] || 0) + 1;
        const src = rankMap[s.id] || s;
        const sc = typeof s.total === 'number' ? s.total : src.total;
        if (typeof sc === 'number') { sum += sc; sumN++; }
        detail.push([gi + 1, g.name || ('第 ' + (gi + 1) + ' 组'), si + 1, s.name, s.sid || '', s.gender || '',
          (LEVEL_NAMES[lvKey] || lvKey) + '（' + lvKey + '）', sc == null ? '' : sc, src.rank == null ? '' : src.rank]);
        roster.push([s.name, gi + 1]);
      });
      placed += members.length;
      stat.push([gi + 1, g.name || ('第 ' + (gi + 1) + ' 组'), members.length,
        sumN ? Math.round(sum / sumN * 10) / 10 : '—', lv.A || 0, lv.B || 0, lv.C || 0, lv.D || 0]);
    });

    const poolIds = draft.pool || [];
    if (poolIds.length) {
      detail.push([]);
      detail.push(['—', '未入组名单', '', '', '', '', '', '', '']);
      poolIds.forEach((id, i) => {
        const s = infoMap[id] || rankMap[id];
        if (!s) return;
        const lvKey = St.levelOf(s, all) || 'D';
        detail.push(['—', '未入组', i + 1, s.name, s.sid || '', s.gender || '',
          (LEVEL_NAMES[lvKey] || lvKey) + '（' + lvKey + '）', s.total == null ? '' : s.total, (rankMap[s.id] && rankMap[s.id].rank) || '']);
      });
    }

    const m = metrics(groups);
    stat.push([]);
    stat.push(['总体统计']);
    stat.push(['组数', groups.length]);
    stat.push(['已入组人数', placed]);
    stat.push(['未入组人数', poolIds.length]);
    stat.push(['均衡度评分', m.score]);
    stat.push(['组间总分极差', m.gap]);
    stat.push(['导出时间', new Date().toLocaleString('zh-CN')]);
    stat.push(['说明', '「组号名单」表可通过"导入分组表"一键还原分组']);

    return [
      { name: '分组明细', aoa: detail },
      { name: '组号名单', aoa: roster },
      { name: '均衡统计', aoa: stat }
    ];
  }

  global.Seating = {
    buildGroups, metrics, classroom, templateAoa, applyGroupNumbers,
    moveMember, addGroup, removeGroup, optimizeBalance, exportSheets,
    GROUP_NAMES_STAR
  };
})(window);
