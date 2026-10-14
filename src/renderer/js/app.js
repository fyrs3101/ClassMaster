/* =====================================================================
   app.js —— 界面主控：路由 / 渲染 / 交互 / 导入向导 / 拖拽
   ===================================================================== */
(function (global) {
  'use strict';
  const St = global.Store;
  const Sv = St.S;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ================= 通用 UI 工具 ================= */
  const Icons = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14.1l-3-3"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  function toast(msg, type, ms) {
    const box = $('#toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = (Icons[type] || Icons.info) + '<span>' + escapeHTML(msg) + '</span>';
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, ms || 2600);
  }
  function loading(on, text) {
    const l = $('#loading');
    if (text) $('#loadingText').textContent = text;
    l.classList.toggle('show', !!on);
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${h},58%,52%)`;
  }
  function initialOf(name) { return String(name || '?').slice(0, 1); }

  /* ---- 弹窗 ---- */
  function modal(title, bodyHTML, footHTML, opts) {
    const o = opts || {};
    $('#modalBox').className = 'modal' + (o.size ? ' ' + o.size : '');
    $('#modalTitle').innerHTML = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modalFoot').innerHTML = footHTML || '';
    $('#modalMask').classList.add('show');
    if (o.onMount) o.onMount();
  }
  function closeModal() { $('#modalMask').classList.remove('show'); }
  $('#modalClose').onclick = closeModal;
  $('#modalMask').onclick = e => { if (e.target === $('#modalMask')) closeModal(); };

  /* ---- 排序箭头 ---- */
  function sortArrow(key) {
    const s = Sv.ui.studentSort;
    const active = s.key === key;
    return `<span class="arrow" style="opacity:${active ? 1 : .3};color:${active ? 'var(--brand-400)' : 'inherit'}">${active ? (s.dir > 0 ? '▲' : '▼') : '▲▼'}</span>`;
  }

  /* ================= 路由 ================= */
  const VIEW_META = {
    dashboard: { title: '工作台', sub: '班级数据总览' },
    students: { title: '学生管理', sub: '名单维护与成绩导入' },
    grades: { title: '成绩分析', sub: '多维统计与深度诊断' },
    seating: { title: '智能排座', sub: '层次均衡分组与座位编排' },
    points: { title: '积分管理', sub: '加减分与成长激励' },
    membership: { title: '会员中心', sub: '版本授权与功能解锁' },
    lan: { title: '飞鸽传书', sub: '同网段即时通讯 · 文件传输 · 大文件断点续传' },
    settings: { title: '设置', sub: '班级信息与数据备份' }
  };
  function go(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    Sv.ui.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    $('#pageTitle').textContent = VIEW_META[view].title;
    $('#pageSub').textContent = VIEW_META[view].sub;
    $('#content').scrollTop = 0;
    render();
  }

  /* ================= 渲染入口 ================= */
  function render() {
    switch (Sv.ui.view) {
      case 'dashboard': renderDashboard(); break;
      case 'students': renderStudents(); break;
      case 'grades': renderGrades(); break;
      case 'seating': renderSeating(); break;
      case 'points': renderPoints(); break;
      case 'membership': renderMembership(); break;
      case 'lan': if (global.LAN) global.LAN.render(); break;
      case 'settings': renderSettings(); break;
    }
    $('#badge-students').textContent = (St.S.db.students || []).length;
    renderPlanCard();
  }

  /* ================= 侧栏会员卡 ================= */
  let LICENSE = null;
  function renderPlanCard() {
    if (!LICENSE) return;
    const p = LICENSE.plan;
    const l = LICENSE.license;
    $('#pcName').textContent = p.name;
    $('#pcTag').textContent = p.key.toUpperCase();
    if (p.key === 'trial') {
      const left = l.expiresAt ? Math.max(0, Math.ceil((new Date(l.expiresAt) - Date.now()) / 86400000)) : 0;
      $('#pcDesc').textContent = `剩余 ${left} 天 · 点击升级解锁全部功能`;
    } else if (p.expired) {
      $('#pcDesc').textContent = '授权已过期 · 点击续费';
    } else {
      $('#pcDesc').textContent = '已激活 · 全部功能可用';
      $('#pcTag').textContent = '已激活';
    }
  }

  /* ================= 工作台 ================= */
  function renderDashboard() {
    const studs = St.mergedStudents();
    const ov = global.Analytics.overview();
    const pm = St.pointsMap();
    const totalPoints = Object.values(pm).reduce((a, b) => a + b, 0);
    const seatScore = (St.S.db.seating && St.S.db.seating.groups && St.S.db.seating.groups.length)
      ? global.Seating.metrics(St.S.db.seating.groups).score : null;

    $('#dashStats').innerHTML = `
      <div class="stat">
        <div class="stat-ico blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="stat-val">${ov.count}</div><div class="stat-lbl">班级学生总数</div>
      </div>
      <div class="stat">
        <div class="stat-ico violet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/></svg></div>
        <div class="stat-val">${ov.avg ? ov.avg.toFixed(1) : '—'}</div><div class="stat-lbl">总分平均（最高 ${ov.max || '—'}）</div>
      </div>
      <div class="stat">
        <div class="stat-ico green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l3 6.5 7 .9-5.1 4.8 1.3 6.9L12 17.7 5.8 21.1l1.3-6.9L2 9.4l7-.9z"/></svg></div>
        <div class="stat-val">${(ov.excellentRate * 100).toFixed(0)}%</div><div class="stat-lbl">优秀率（≥85%）· ${ov.excellent} 人</div>
      </div>
      <div class="stat">
        <div class="stat-ico amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <div class="stat-val">${(ov.passRate * 100).toFixed(0)}%</div><div class="stat-lbl">及格率（≥60%）· ${ov.pass} 人</div>
      </div>
      <div class="stat">
        <div class="stat-ico cyan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l2.9 6.3 6.85.9-5 4.72 1.25 6.78L12 17.6 5.99 20.7 7.25 13.9l-5-4.72 6.85-.9z"/></svg></div>
        <div class="stat-val">${totalPoints}</div><div class="stat-lbl">累计积分（${(St.S.db.points.records || []).length} 笔）</div>
      </div>
      <div class="stat">
        <div class="stat-ico red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></div>
        <div class="stat-val">${seatScore == null ? '—' : seatScore}</div><div class="stat-lbl">排座均衡度评分</div>
      </div>`;

    const g = St.activeGrade();
    $('#dashExamName').textContent = g ? `${g.examName} · ${St.fmtDate(g.date).slice(0, 10)}` : '暂无成绩数据';

    // 各科平均分
    const ss = global.Analytics.subjectStats();
    if (ss.length) {
      global.Charts.bar($('#dashSubjectChart'), ss.map(s => ({ label: s.subject, value: +s.avg.toFixed(1), color: s.rate >= .8 ? '#10b981' : s.rate >= .7 ? '#3b82f6' : s.rate >= .6 ? '#f59e0b' : '#ef4444' })), {
        height: 290, format: v => v.toFixed ? v.toFixed(0) : v
      });
    } else {
      $('#dashSubjectChart').innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/></svg><h4>暂无成绩数据</h4><p>点击右上角导入按钮，上传成绩表即可自动生成分析</p></div>';
    }

    // 层次占比
    const ld = global.Analytics.levelDistribution();
    if (ld.some(x => x.value > 0)) {
      global.Charts.donut($('#dashLevelChart'), ld, { width: 300, height: 265, centerLabel: '总人数', totalLabel: ld.reduce((a, b) => a + b.value, 0) });
    } else {
      $('#dashLevelChart').innerHTML = '<div class="empty" style="padding:30px"><p>暂无数据</p></div>';
    }

    // TOP10
    const rank = global.Analytics.ranked().slice(0, 10);
    const subjs = St.subjects();
    $('#dashTopRank').innerHTML = rank.length ? `
      <div class="table-wrap" style="border:none">
        <table class="data">
          <thead><tr><th class="num" style="width:44px">名次</th><th>姓名</th><th class="num">总分</th>${subjs.slice(0, 4).map(s => `<th class="num">${s}</th>`).join('')}</tr></thead>
          <tbody>${rank.map((r, i) => `<tr>
            <td class="num"><span class="rank-no ${i < 3 ? 'g' + (i + 1) : ''}">${i + 1}</span></td>
            <td><span style="display:inline-flex;align-items:center;gap:7px"><span class="ss-avatar" style="background:${avatarColor(r.name)};width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:700;color:#fff">${initialOf(r.name)}</span>${escapeHTML(r.name)}</span></td>
            <td class="num" style="font-weight:700">${r.total}</td>
            ${subjs.slice(0, 4).map(s => `<td class="num muted">${r.scores[s] == null ? '—' : r.scores[s]}</td>`).join('')}
          </tr>`).join('')}</tbody>
        </table>
      </div>` : '<div class="empty" style="padding:30px"><p>暂无数据</p></div>';

    // 需关注
    const weak = global.Analytics.weakStudents().slice(0, 7);
    $('#dashWeak').innerHTML = weak.length ? `<div style="display:flex;flex-direction:column;gap:8px">${weak.map(w => `
      <div class="row" style="gap:10px;padding:7px 9px;border-radius:9px;background:var(--bg-2);border:1px solid var(--line)">
        <span style="width:26px;height:26px;border-radius:50%;background:${avatarColor(w.student.name)};display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;flex:0 0 26px">${initialOf(w.student.name)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${escapeHTML(w.student.name)} <span class="muted" style="font-weight:400">总分 ${w.student.total}</span></div>
          <div style="font-size:11px;color:var(--txt-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${w.issues.slice(0, 3).map(i => i.type === 'subject' ? `${i.subject} ${i.value}分（第${i.rank}名）` : `${i.subject} 低于均分 ${i.gap} 分`).join(' · ') || '总分排名靠后'}
          </div>
        </div>
        <span class="tag tag-red">关注</span>
      </div>`).join('')}</div>` : '<div class="empty" style="padding:30px"><p>暂无需关注学生</p></div>';
  }

  /* ================= 学生管理 ================= */
  function filteredStudents() {
    let list = St.mergedStudents();
    const q = Sv.ui.globalSearch.trim();
    if (q) list = list.filter(s => s.name.includes(q) || (s.sid && s.sid.includes(q)));
    const f = Sv.ui.studentFilter;
    if (f !== 'all') list = list.filter(s => St.levelOf(s, St.mergedStudents()) === f);
    const sk = Sv.ui.studentSort;
    const all = St.mergedStudents();
    list.sort((a, b) => {
      let va, vb;
      switch (sk.key) {
        case 'name': va = a.name; vb = b.name; return sk.dir * String(va).localeCompare(String(vb), 'zh');
        case 'sid': va = a.sid || ''; vb = b.sid || ''; return sk.dir * String(va).localeCompare(String(vb));
        case 'rank': va = a.rankClass == null ? 1e9 : a.rankClass; vb = b.rankClass == null ? 1e9 : b.rankClass; return sk.dir * (va - vb);
        case 'level': va = 'ABCD'.indexOf(St.levelOf(a, all)); vb = 'ABCD'.indexOf(St.levelOf(b, all)); return sk.dir * (va - vb);
        default: va = a.total == null ? -1 : a.total; vb = b.total == null ? -1 : b.total; return sk.dir * (va - vb);
      }
    });
    return list;
  }

  function renderStudents() {
    const list = filteredStudents();
    const all = St.mergedStudents();
    const subjs = St.subjects();
    const pm = St.pointsMap();

    $('#studentCountTip').textContent = `共 ${all.length} 人${list.length !== all.length ? ` · 筛选出 ${list.length} 人` : ''}`;
    $('#thSubjects').textContent = subjs.length ? subjs.join(' / ') : '各科成绩';

    const tb = $('#studentTbody');
    if (!list.length) {
      tb.innerHTML = `<tr><td colspan="9"><div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>
        <div style="font-size:14px;font-weight:600;color:var(--txt-2);margin-bottom:5px">暂无学生数据</div>
        <div>点击上方「导入学生名单」上传成绩表，或「手动添加」逐个录入</div>
      </div></td></tr>`;
      return;
    }

    tb.innerHTML = list.map((s, i) => {
      const lv = St.levelOf(s, all);
      return `<tr data-id="${s.id}">
        <td class="idx">${i + 1}</td>
        <td><span style="display:inline-flex;align-items:center;gap:8px">
          <span style="width:24px;height:24px;border-radius:50%;background:${avatarColor(s.name)};display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff">${initialOf(s.name)}</span>
          <b style="font-weight:600">${escapeHTML(s.name)}</b>
          ${pm[s.id] ? `<span class="tag tag-cyan" style="font-size:10px">${pm[s.id] > 0 ? '+' : ''}${pm[s.id]}</span>` : ''}
        </span></td>
        <td class="muted">${escapeHTML(s.sid || '—')}</td>
        <td class="num" style="font-weight:700">${s.total == null ? '—' : s.total}</td>
        <td class="num"><span class="tag ${s.rankClass <= 10 ? 'tag-blue' : 'tag-gray'}">${s.rankClass == null ? '—' : s.rankClass}</span></td>
        <td class="num muted">${s.rankSchool == null ? '—' : s.rankSchool}</td>
        <td><span class="level level-${lv}" title="${St.LEVEL_META[lv].name}">${lv}</span></td>
        <td>${subjs.map(sub => {
          const v = s.scores[sub];
          if (v == null) return `<span class="muted" style="margin-right:9px">—</span>`;
          const r = v / St.fullMarkOf(sub);
          const c = r >= .85 ? 'var(--ok)' : r >= .6 ? 'var(--txt-1)' : 'var(--bad)';
          return `<span style="margin-right:9px;color:${c};font-variant-numeric:tabular-nums">${v}</span>`;
        }).join('')}</td>
        <td><div class="row" style="gap:3px">
          <button class="icon-btn" style="width:26px;height:26px" data-act="profile" data-id="${s.id}" title="查看画像"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:14px;height:14px"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="icon-btn" style="width:26px;height:26px" data-act="edit" data-id="${s.id}" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:14px;height:14px"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg></button>
          <button class="icon-btn" style="width:26px;height:26px" data-act="del" data-id="${s.id}" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:14px;height:14px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
        </div></td>
      </tr>`;
    }).join('');
  }

  /* 学生表交互 */
  document.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th && Sv.ui.view === 'students') {
      const k = th.dataset.sort;
      const s = Sv.ui.studentSort;
      if (s.key === k) s.dir = -s.dir; else { s.key = k; s.dir = k === 'name' ? 1 : -1; }
      renderStudents();
      return;
    }
    const seg = e.target.closest('#studentFilterSeg button');
    if (seg) {
      $$('#studentFilterSeg button').forEach(b => b.classList.toggle('active', b === seg));
      Sv.ui.studentFilter = seg.dataset.f;
      renderStudents();
      return;
    }
    const q = e.target.closest('[data-quick]');
    if (q) { quickAction(q.dataset.quick); return; }

    const act = e.target.closest('[data-act]');
    if (act && Sv.ui.view === 'students') {
      const id = act.dataset.id;
      if (act.dataset.act === 'profile') showProfile(id);
      else if (act.dataset.act === 'edit') editStudent(id);
      else if (act.dataset.act === 'del') deleteStudent(id);
      return;
    }
  });

  $('#globalSearch').addEventListener('input', e => {
    Sv.ui.globalSearch = e.target.value;
    if (Sv.ui.view !== 'students') go('students');
    else renderStudents();
  });

  function showProfile(id) {
    const p = global.Analytics.profile(id);
    if (!p) return;
    const subjs = p.subjects;
    const lv = p.level;
    modal(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>学生画像 · ${escapeHTML(p.student.name)}`,
      `<div class="row" style="gap:16px;align-items:flex-start;margin-bottom:16px">
        <span style="width:56px;height:56px;border-radius:16px;background:${avatarColor(p.student.name)};display:grid;place-items:center;font-size:22px;font-weight:800;color:#fff;flex:0 0 56px">${initialOf(p.student.name)}</span>
        <div style="flex:1">
          <div class="row" style="gap:9px;margin-bottom:5px">
            <b style="font-size:17px">${escapeHTML(p.student.name)}</b>
            <span class="level level-${lv}">${lv}</span>
            <span class="tag tag-gray">${St.LEVEL_META[lv].name}</span>
          </div>
          <div class="muted">${escapeHTML(p.student.sid || '未录入学号')} · 积分 ${p.points}</div>
        </div>
      </div>
      <div class="grid-3 mb-16" style="gap:11px">
        <div class="stat" style="padding:12px 13px"><div class="stat-val" style="font-size:21px">${p.student.total == null ? '—' : p.student.total}</div><div class="stat-lbl">总分</div></div>
        <div class="stat" style="padding:12px 13px"><div class="stat-val" style="font-size:21px">${p.rankClass || '—'}<span style="font-size:12px;color:var(--txt-3)">/${p.rankTotal}</span></div><div class="stat-lbl">班级排名</div></div>
        <div class="stat" style="padding:12px 13px"><div class="stat-val" style="font-size:21px">${p.zScore > 0 ? '+' : ''}${p.zScore}</div><div class="stat-lbl">标准分 Z</div></div>
      </div>
      <div class="card mb-12" style="background:var(--bg-2)">
        <div class="card-head" style="padding:10px 14px"><h3 style="font-size:13px">学科能力雷达</h3></div>
        <div class="card-body" style="padding:11px"><div id="pfRadar" style="max-width:340px;margin:0 auto"></div></div>
      </div>
      <div class="table-wrap">
        <table class="data"><thead><tr><th>学科</th><th class="num">得分</th><th class="num">满分</th><th style="width:130px">得分率</th><th class="num">班内排名</th><th class="num">与班级均分差</th></tr></thead>
        <tbody>${subjs.map(sub => {
          const v = p.student.scores[sub];
          const full = St.fullMarkOf(sub);
          const sr = p.subjectRanks[sub];
          const ss = p.subjectStats.find(x => x.subject === sub);
          const rate = v == null ? 0 : v / full;
          const diff = v == null || !ss ? null : v - ss.avg;
          const bc = rate >= .85 ? '#10b981' : rate >= .6 ? '#3b82f6' : '#ef4444';
          return `<tr>
            <td><b>${sub}</b></td>
            <td class="num" style="font-weight:700">${v == null ? '—' : v}</td>
            <td class="num muted">${full}</td>
            <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${(rate * 100).toFixed(0)}%;background:${bc}"></div></div><span class="bar-val">${(rate * 100).toFixed(0)}%</span></div></td>
            <td class="num">${sr ? sr.rank + '/' + sr.total : '—'}</td>
            <td class="num" style="color:${diff == null ? 'inherit' : diff > 0 ? 'var(--ok)' : 'var(--bad)'}">${diff == null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1)}</td>
          </tr>`;
        }).join('')}</tbody></table>
      </div>`,
      `<button class="btn" data-close>关闭</button><span class="spacer"></span>
       <button class="btn btn-primary" id="pfAddPoint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>为其加积分</button>`,
      {
        size: 'wide', onMount: () => {
          global.Charts.radar($('#pfRadar'), p.radar, { width: 340, height: 300, max: 100 });
          const b = $('#pfAddPoint');
          if (b) b.onclick = () => { closeModal(); go('points'); setTimeout(() => showPointDialog([id]), 260); };
        }
      }
    );
  }

  function editStudent(id) {
    const s = St.mergedStudents().find(x => x.id === id);
    if (!s) return;
    const subjs = St.subjects();
    modal('编辑学生', `
      <div class="grid-2" style="gap:13px">
        <div class="field"><label>姓名 *</label><input class="input" id="edName" value="${escapeHTML(s.name)}"></div>
        <div class="field"><label>学号</label><input class="input" id="edSid" value="${escapeHTML(s.sid || '')}"></div>
        <div class="field"><label>性别</label><select class="select" id="edGender"><option value="">未设置</option><option value="男" ${s.gender === '男' ? 'selected' : ''}>男</option><option value="女" ${s.gender === '女' ? 'selected' : ''}>女</option></select></div>
        <div class="field"><label>总分</label><input class="input" id="edTotal" type="number" value="${s.total == null ? '' : s.total}"></div>
      </div>
      ${subjs.length ? `<div class="grid-3 mt-12" style="gap:11px">${subjs.map(sub => `<div class="field"><label>${sub}（满分${St.fullMarkOf(sub)}）</label><input class="input" data-sub="${sub}" type="number" value="${s.scores[sub] == null ? '' : s.scores[sub]}"></div>`).join('')}</div>` : ''}
      <div class="field mt-12"><label>备注</label><textarea class="textarea" id="edNotes">${escapeHTML(s.notes || '')}</textarea></div>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="edSave">保存</button>`,
      {
        size: 'wide', onMount: () => {
          $('#edSave').onclick = async () => {
            const db = St.S.db;
            const st = db.students.find(x => x.id === id);
            if (!st) return;
            const nm = $('#edName').value.trim();
            if (!nm) return toast('姓名不能为空', 'err');
            st.name = nm; st.sid = $('#edSid').value.trim(); st.gender = $('#edGender').value; st.notes = $('#edNotes').value;
            const t = parseFloat($('#edTotal').value);
            st.total = isNaN(t) ? st.total : t;
            $$('[data-sub]').forEach(inp => {
              const v = parseFloat(inp.value);
              if (!isNaN(v)) st.scores[inp.dataset.sub] = v; else delete st.scores[inp.dataset.sub];
            });
            // 同步到最新成绩快照
            const g = St.activeGrade();
            if (g) { const r = g.rows.find(x => x.id === id); if (r) { r.scores = { ...st.scores }; r.total = st.total; } }
            await St.save();
            closeModal(); render(); toast('已保存', 'ok');
          };
        }
      });
  }

  function deleteStudent(id) {
    const s = St.S.db.students.find(x => x.id === id);
    if (!s) return;
    modal('确认删除', `<p>确定要删除学生 <b>${escapeHTML(s.name)}</b> 吗？<br><span class="muted">该学生的积分记录与分组信息也会一并移除，此操作不可撤销。</span></p>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-danger" id="delOk">确认删除</button>`,
      { onMount: () => { $('#delOk').onclick = async () => { const db = St.S.db; db.students = db.students.filter(x => x.id !== id); db.points.records = db.points.records.filter(r => r.studentId !== id); (db.seating.groups || []).forEach(g => g.members = g.members.filter(m => m !== id)); if (db.seating.pool) db.seating.pool = db.seating.pool.filter(m => m !== id); await St.save(); closeModal(); render(); toast('已删除', 'ok'); }; } });
  }

  /* 手动添加学生 */
  $('#btnAddStudent').onclick = () => {
    const subjs = St.subjects();
    modal('手动添加学生', `
      <div class="grid-2" style="gap:13px">
        <div class="field"><label>姓名 *</label><input class="input" id="asName" placeholder="请输入姓名"></div>
        <div class="field"><label>学号</label><input class="input" id="asSid"></div>
        <div class="field"><label>性别</label><select class="select" id="asGender"><option value="">未设置</option><option value="男">男</option><option value="女">女</option></select></div>
        <div class="field"><label>总分</label><input class="input" id="asTotal" type="number"></div>
      </div>
      ${subjs.length ? `<div class="grid-3 mt-12" style="gap:11px">${subjs.map(sub => `<div class="field"><label>${sub}</label><input class="input" data-asub="${sub}" type="number"></div>`).join('')}</div>` : ''}`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="asSave">添加</button>`,
      {
        size: 'wide', onMount: () => {
          $('#asSave').onclick = async () => {
            const nm = $('#asName').value.trim();
            if (!nm) return toast('请输入姓名', 'err');
            if (St.S.db.students.some(s => s.name === nm)) return toast('该姓名已存在', 'err');
            const scores = {};
            $$('[data-asub]').forEach(i => { const v = parseFloat(i.value); if (!isNaN(v)) scores[i.dataset.asub] = v; });
            let total = parseFloat($('#asTotal').value);
            if (isNaN(total)) { const vs = Object.values(scores); total = vs.length ? vs.reduce((a, b) => a + b, 0) : null; }
            St.S.db.students.push({ id: St.uid('s'), name: nm, sid: $('#asSid').value.trim(), gender: $('#asGender').value, notes: '', group: '', scores, ranks: {}, total });
            await St.save(); closeModal(); render(); toast('已添加', 'ok');
          };
        }
      });
  };

  $('#btnClearStudents').onclick = () => {
    modal('清空所有学生', '<p>将删除 <b>全部学生数据、成绩记录、积分流水与分组结果</b>。<br><span class="muted">建议先到「设置」中备份数据。确定继续？</span></p>',
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-danger" id="clrOk">确认清空</button>`,
      { onMount: () => { $('#clrOk').onclick = async () => { const db = St.S.db; db.students = []; db.grades = []; db.points.records = []; db.seating.groups = []; db.seating.pool = []; await St.save(); closeModal(); render(); toast('已清空', 'ok'); }; } });
  };

  $('#btnExportStudents').onclick = async () => {
    const subjs = St.subjects();
    const rank = global.Analytics.ranked();
    const aoa = [['序号', '姓名', '学号', '性别', '总分', '班次', '校次', '层次', ...subjs, '积分', '备注']];
    rank.forEach((r, i) => aoa.push([i + 1, r.name, r.sid, r.gender, r.total, r.rank, r.rankSchool == null ? '' : r.rankSchool, St.levelOf(r, rank), ...subjs.map(s => r.scores[s] == null ? '' : r.scores[s]), St.pointsOf(r.id), r.notes]));
    const res = await global.CM.buildXlsx([{ name: '学生名单', aoa }]);
    if (res.error) return toast(res.error, 'err');
    const out = await global.CM.saveBuffer({ defaultName: `学生名单_${St.S.db.meta.className || '班级'}.xlsx`, buffer: res.buffer, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
    if (out.canceled) return;
    if (out.error) return toast(out.error, 'err');
    toast('已导出到 ' + out.path, 'ok', 3600);
  };

  /* ================= 成绩分析 ================= */
  function renderGrades() {
    const pane = Sv.ui.gradeMode;
    $$('#gradeModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.m === pane));
    ['overview', 'subjects', 'trend', 'compare'].forEach(k => $('#gradePane-' + k).classList.toggle('hidden', k !== pane));
    if (pane === 'overview') renderGradeOverview();
    else if (pane === 'subjects') renderGradeSubjects();
    else if (pane === 'trend') renderGradeTrend();
    else renderGradeCompare();
  }

  function renderGradeOverview() {
    const ov = global.Analytics.overview();
    const ss = global.Analytics.subjectStats();
    $('#gradeStats').innerHTML = `
      <div class="stat"><div class="stat-ico blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/></svg></div><div class="stat-val">${ov.avg ? ov.avg.toFixed(1) : '—'}</div><div class="stat-lbl">总分平均</div></div>
      <div class="stat"><div class="stat-ico violet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v20M2 12h20"/></svg></div><div class="stat-val">${ov.median ? ov.median.toFixed(0) : '—'}</div><div class="stat-lbl">总分中位数</div></div>
      <div class="stat"><div class="stat-ico green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 19V5M5 12l7-7 7 7"/></svg></div><div class="stat-val">${ov.max || '—'}</div><div class="stat-lbl">最高分</div></div>
      <div class="stat"><div class="stat-ico red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></div><div class="stat-val">${ov.min || '—'}</div><div class="stat-lbl">最低分</div></div>
      <div class="stat"><div class="stat-ico amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v16H4z"/><path d="M8 12h8"/></svg></div><div class="stat-val">${ov.std ? ov.std.toFixed(1) : '—'}</div><div class="stat-lbl">标准差 · 极差 ${ov.spread || 0}</div></div>
      <div class="stat"><div class="stat-ico cyan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="stat-val">${(ov.passRate * 100).toFixed(0)}%</div><div class="stat-lbl">及格率 · 优秀率 ${(ov.excellentRate * 100).toFixed(0)}%</div></div>`;

    if (ss.length) {
      const labels = ss.map(s => s.subject);
      global.Charts.bar($('#gradeSubjectChart'), ss.map(s => ({
        label: s.subject, values: [+s.avg.toFixed(1), s.max, s.min], series: ['平均', '最高', '最低']
      })), { grouped: true, colors: ['#5b83f7', '#10b981', '#ef4444'], height: 300, format: v => Math.round(v) });
      $('#gradeSubjectChart').insertAdjacentHTML('afterend', '');
      const lg = document.createElement('div'); lg.className = 'chart-legend';      lg.innerHTML = `<div class="lg-item"><span class="lg-swatch" style="background:#5b83f7"></span>平均分</div><div class="lg-item"><span class="lg-swatch" style="background:#10b981"></span>最高分</div><div class="lg-item"><span class="lg-swatch" style="background:#ef4444"></span>最低分</div>`;
      const host = $('#gradeSubjectChart');
      if (host.parentElement.querySelector('.chart-legend')) host.parentElement.querySelector('.chart-legend').remove();
      host.parentElement.appendChild(lg);

      // 直方图：按得分率 10 分段
      const maxFull = ss.reduce((a, s) => a + s.full, 0);
      const buckets = [];
      const step = Math.round(maxFull / 10 / 10) * 10 || 50;
      for (let i = 0; i < 10; i++) {
        const lo = i * step, hi = (i + 1) * step;
        const c = St.mergedStudents().filter(st => st.total != null && st.total >= lo && st.total < hi).length;
        buckets.push({ label: `${lo}`, count: c, _lo: lo, _hi: hi });
      }
      global.Charts.bar($('#gradeTotalHist'), buckets.map(b => ({ label: b.label, value: b.count, color: '#8b5cf6' })), { height: 300, showValues: true });

      global.Charts.radar($('#gradeRadar'), global.Analytics.subjectStrength(), { width: 520, height: 380, max: 100, format: v => v.toFixed(0) + '%' });
    } else {
      ['#gradeSubjectChart', '#gradeTotalHist', '#gradeRadar'].forEach(sel => {
        const h = $(sel); if (h) h.innerHTML = '<div class="empty" style="padding:40px"><p>暂无成绩数据</p></div>';
      });
    }
  }

  function renderGradeSubjects() {
    const ss = global.Analytics.subjectStats();
    if (!ss.length) { $('#gradePane-subjects').innerHTML = '<div class="card"><div class="card-body"><div class="empty"><p>暂无成绩数据</p></div></div></div>'; return; }
    const studs = St.mergedStudents();

    $('#gradePane-subjects').innerHTML = ss.map(s => {
      const vals = studs.map(st => ({ st, v: st.scores[s.subject] })).filter(x => typeof x.v === 'number').sort((a, b) => b.v - a.v);
      const top5 = vals.slice(0, 5);
      const bottom5 = vals.slice(-5).reverse();
      const rate = s.rate;
      const bc = rate >= .8 ? 'var(--ok)' : rate >= .7 ? 'var(--brand-400)' : rate >= .6 ? 'var(--warn)' : 'var(--bad)';
      return `<div class="card mb-16">
        <div class="card-head">
          <h3>${s.subject}</h3>
          <span class="tag tag-gray">满分 ${s.full}</span>
          <span class="spacer"></span>
          <span class="ch-sub">得分率 <b style="color:${bc}">${(rate * 100).toFixed(1)}%</b> · 及格率 ${(s.passRate * 100).toFixed(0)}% · 优秀率 ${(s.excellentRate * 100).toFixed(0)}%</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:15px">
            <div><div class="muted" style="font-size:11.5px">平均分</div><div style="font-size:20px;font-weight:800">${s.avg.toFixed(1)}</div></div>
            <div><div class="muted" style="font-size:11.5px">中位数</div><div style="font-size:20px;font-weight:800">${s.median.toFixed(0)}</div></div>
            <div><div class="muted" style="font-size:11.5px">最高分</div><div style="font-size:20px;font-weight:800;color:var(--ok)">${s.max}</div></div>
            <div><div class="muted" style="font-size:11.5px">最低分</div><div style="font-size:20px;font-weight:800;color:var(--bad)">${s.min}</div></div>
            <div><div class="muted" style="font-size:11.5px">标准差</div><div style="font-size:20px;font-weight:800">${s.std.toFixed(1)}</div></div>
            <div><div class="muted" style="font-size:11.5px">参考人数</div><div style="font-size:20px;font-weight:800">${s.n}</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
              <div class="muted mb-8" style="font-size:12px;font-weight:600">🏆 学科前 5 名</div>
              ${top5.map((x, i) => `<div class="rank-row"><span class="rank-no ${i < 3 ? 'g' + (i + 1) : ''}">${i + 1}</span><span style="flex:1;font-weight:600">${escapeHTML(x.st.name)}</span><b style="color:var(--ok)">${x.v}</b></div>`).join('')}
            </div>
            <div>
              <div class="muted mb-8" style="font-size:12px;font-weight:600">⚠️ 需重点帮扶（末 5 名）</div>
              ${bottom5.map((x, i) => `<div class="rank-row"><span class="rank-no">${vals.length - i}</span><span style="flex:1;font-weight:600">${escapeHTML(x.st.name)}</span><b style="color:var(--bad)">${x.v}</b></div>`).join('')}
            </div>
          </div>
          <div class="mt-16" id="sbChart-${s.subject}"></div>
        </div>
      </div>`;
    }).join('');

    // 渲染每个学科的成绩分布条
    ss.forEach(s => {
      const host = $('#sbChart-' + s.subject);
      if (!host) return;
      const buckets = global.Analytics.distribution(Math.max(10, Math.round(s.full / 10 / 5) * 5), s.subject);
      global.Charts.bar(host, buckets.map(b => ({ label: b.label, value: b.count, color: '#5b83f7' })), { height: 190, format: v => Math.round(v) });
    });
  }

  function renderGradeTrend() {
    const studs = St.mergedStudents().filter(s => s.total != null);
    const subjs = St.subjects();
    let html = '<div class="card mb-16"><div class="card-head"><h3>各科得分率分段人数</h3><span class="spacer"></span><span class="ch-sub">按满分折算，可横向对比学科难度</span></div><div class="card-body"><div id="rateChart"></div></div></div>';
    html += '<div class="grid-2">';
    html += `<div class="card"><div class="card-head"><h3>总分分数段分布</h3></div><div class="card-body"><div id="trendTotal"></div></div></div>`;
    html += `<div class="card"><div class="card-head"><h3>层次构成</h3></div><div class="card-body"><div id="trendLevel"></div></div></div>`;
    html += '</div>';
    $('#gradePane-trend').innerHTML = html;

    // 各科得分率分段（堆叠柱）
    const segs = global.Analytics.rateDistribution();
    global.Charts.bar($('#rateChart'), segs.map(s => ({ label: s.label, value: s.count, color: s.color })), { height: 260, showValues: true });

    const maxFull = subjs.reduce((a, s) => a + St.fullMarkOf(s), 0);
    const step = Math.max(25, Math.round(maxFull / 12 / 25) * 25);
    const buckets = [];
    for (let i = 0; i < 12; i++) {
      const lo = i * step, hi = (i + 1) * step;
      if (lo > maxFull) break;
      buckets.push({ label: `${lo}-${hi}`, value: studs.filter(s => s.total >= lo && s.total < hi).length });
    }
    global.Charts.bar($('#trendTotal'), buckets.map(b => ({ label: b.label, value: b.value, color: '#22d3ee' })), { height: 280, format: v => Math.round(v) });

    const ld = global.Analytics.levelDistribution();
    global.Charts.donut($('#trendLevel'), ld, { width: 300, height: 280, centerLabel: '学生总数', totalLabel: ld.reduce((a, b) => a + b.value, 0) });
  }

  function renderGradeCompare() {
    const studs = St.mergedStudents().filter(s => s.total != null).slice().sort((a, b) => b.total - a.total);
    const ids = Sv.ui.compareIds;
    let html = `<div class="card mb-16"><div class="card-head"><h3>选择对比学生</h3><span class="spacer"></span><span class="ch-sub">最多同时对比 5 人</span></div>
      <div class="card-body">
        <div class="row wrap" style="gap:7px;max-height:150px;overflow-y:auto">
          ${studs.map(s => `<button class="btn btn-sm ${ids.includes(s.id) ? 'btn-primary' : ''}" data-cmp="${s.id}">${escapeHTML(s.name)}<span class="muted" style="margin-left:4px">${s.total}</span></button>`).join('')}
        </div>
      </div></div>`;
    if (ids.length) {
      const cmp = global.Analytics.compare(ids);
      html += `<div class="grid-2 mb-16">
        <div class="card"><div class="card-head"><h3>能力雷达对比</h3></div><div class="card-body">${cmp.students.map((x, i) => `<div id="cmpRadar${i}" style="max-width:330px;margin:0 auto 8px"></div><div style="text-align:center;font-size:12.5px;font-weight:600;margin-bottom:14px">${escapeHTML(x.student.name)} · 总分 ${x.total} · 班次 ${x.rankClass}</div>`).join('')}</div></div>
        <div class="card"><div class="card-head"><h3>逐科对比</h3></div><div class="card-body"><div class="table-wrap"><table class="data">
          <thead><tr><th>学科</th>${cmp.students.map(x => `<th class="num">${escapeHTML(x.student.name)}</th>`).join('')}<th class="num">班级均分</th></tr></thead>
          <tbody>${cmp.subjects.map(sub => {
            const ss = global.Analytics.subjectStats().find(x => x.subject === sub);
            return `<tr><td><b>${sub}</b></td>${cmp.students.map(x => {
              const v = x.student.scores[sub];
              const rate = v == null ? 0 : v / St.fullMarkOf(sub);
              const c = rate >= .85 ? 'var(--ok)' : rate >= .6 ? 'var(--txt-0)' : 'var(--bad)';
              return `<td class="num" style="color:${c};font-weight:600">${v == null ? '—' : v}</td>`;
            }).join('')}<td class="num muted">${ss ? ss.avg.toFixed(1) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div></div></div>
      </div>`;
      html += `<div class="card"><div class="card-head"><h3>综合指标</h3></div><div class="card-body"><div class="table-wrap"><table class="data">
        <thead><tr><th>指标</th>${cmp.students.map(x => `<th class="num">${escapeHTML(x.student.name)}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td>总分</td>${cmp.students.map(x => `<td class="num" style="font-weight:700">${x.total}</td>`).join('')}</tr>
          <tr><td>班级排名</td>${cmp.students.map(x => `<td class="num">${x.rankClass}</td>`).join('')}</tr>
          <tr><td>层次</td>${cmp.students.map(x => { const l = St.levelOf(x.student, studs); return `<td class="num"><span class="level level-${l}">${l}</span></td>`; }).join('')}</tr>
          <tr><td>积分</td>${cmp.students.map(x => `<td class="num">${St.pointsOf(x.student.id)}</td>`).join('')}</tr>
        </tbody></table></div></div></div>`;
      $('#gradePane-compare').innerHTML = html;
      requestAnimationFrame(() => {
        cmp.students.forEach((x, i) => {
          const host = $('#cmpRadar' + i);
          if (host) global.Charts.radar(host, x.radar, { width: 330, height: 290, max: 100, colors: [global.Charts.PALETTE[i % 10]] });
        });
      });
    } else {
      html += '<div class="card"><div class="card-body"><div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h4>请选择要对比的学生</h4><p>点击上方姓名按钮，可同时对比 2-5 名学生的各科表现</p></div></div></div>';
      $('#gradePane-compare').innerHTML = html;
    }
  }

  document.addEventListener('click', e => {
    const cmp = e.target.closest('[data-cmp]');
    if (cmp) {
      const id = cmp.dataset.cmp;
      const arr = Sv.ui.compareIds;
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
      else { if (arr.length >= 5) return toast('最多对比 5 人', 'warn'); arr.push(id); }
      renderGradeCompare();
      return;
    }
    const gb = e.target.closest('#gradeModeSeg button');
    if (gb) { Sv.ui.gradeMode = gb.dataset.m; renderGrades(); return; }
  });

  /* 导出 */
  $('#btnGradeExportXlsx').onclick = async () => {
    loading(true, '正在生成 Excel…');
    try {
      const sheets = global.Analytics.buildExportSheets();
      const res = await global.CM.buildXlsx(sheets);
      if (res.error) { loading(false); return toast(res.error, 'err'); }
      loading(false);
      const out = await global.CM.saveBuffer({ defaultName: `成绩分析报告_${St.S.db.meta.className || ''}_${new Date().toISOString().slice(0, 10)}.xlsx`, buffer: res.buffer, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
      if (out.canceled) return;
      if (out.error) return toast(out.error, 'err');
      toast('已导出：' + out.path, 'ok', 3800);
    } catch (err) { loading(false); toast('导出失败：' + err.message, 'err'); }
  };

  $('#btnGradeExportPdf').onclick = async () => {
    loading(true, '正在生成 PDF…');
    try {
      const html = buildReportHtml();
      loading(false);
      const out = await global.CM.printPdf({ html, defaultName: `成绩分析报告_${St.S.db.meta.className || ''}.pdf` });
      if (out.canceled) return;
      if (out.error) return toast(out.error, 'err');
      toast('已导出 PDF：' + out.path, 'ok', 3800);
    } catch (err) { loading(false); toast('导出失败：' + err.message, 'err'); }
  };

  function buildReportHtml() {
    const ov = global.Analytics.overview();
    const ss = global.Analytics.subjectStats();
    const rank = global.Analytics.ranked();
    const subjs = ov.subjects;
    const meta = St.S.db.meta;
    const weak = global.Analytics.weakStudents().slice(0, 15);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>成绩分析报告</title><style>
      body{font-family:"Microsoft YaHei",sans-serif;padding:26px;color:#111;font-size:12.5px}
      h1{font-size:21px;text-align:center;margin-bottom:5px} h2{font-size:15px;margin:20px 0 9px;border-left:4px solid #3b5ce8;padding-left:9px}
      .sub{text-align:center;color:#666;font-size:11.5px;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11.5px}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:center}
      th{background:#eef2fb;font-weight:600}
      td.l{text-align:left} td.r{text-align:right}
      .kpi{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px}
      .kpi div{flex:1;min-width:98px;border:1px solid #ddd;border-radius:7px;padding:9px;text-align:center}
      .kpi b{display:block;font-size:17px;color:#2c44c4}
      .kpi span{font-size:10.5px;color:#666}
      .lvA{color:#047857;font-weight:700}.lvB{color:#1d4ed8;font-weight:700}.lvC{color:#b45309;font-weight:700}.lvD{color:#b91c1c;font-weight:700}
    </style></head><body>
      <h1>${escapeHTML(meta.className || '班级')} 成绩分析报告</h1>
      <div class="sub">${escapeHTML(meta.school || '')} · ${escapeHTML(meta.semester || '')} · ${escapeHTML(St.activeGrade() ? St.activeGrade().examName : '')} · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
      <div class="kpi">
        <div><b>${ov.count}</b><span>学生人数</span></div>
        <div><b>${ov.avg.toFixed(1)}</b><span>总分平均</span></div>
        <div><b>${ov.max}</b><span>最高分</span></div>
        <div><b>${ov.min}</b><span>最低分</span></div>
        <div><b>${(ov.passRate * 100).toFixed(0)}%</b><span>及格率</span></div>
        <div><b>${(ov.excellentRate * 100).toFixed(0)}%</b><span>优秀率</span></div>
      </div>
      <h2>一、学科统计</h2>
      <table><thead><tr><th>学科</th><th>满分</th><th>平均分</th><th>最高</th><th>最低</th><th>标准差</th><th>得分率</th><th>及格率</th></tr></thead>
      <tbody>${ss.map(s => `<tr><td>${s.subject}</td><td>${s.full}</td><td>${s.avg.toFixed(1)}</td><td>${s.max}</td><td>${s.min}</td><td>${s.std.toFixed(1)}</td><td>${(s.rate * 100).toFixed(1)}%</td><td>${(s.passRate * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table>
      <h2>二、成绩明细（按总分降序）</h2>
      <table><thead><tr><th>名次</th><th>姓名</th><th>总分</th><th>层次</th>${subjs.map(s => `<th>${s}</th>`).join('')}</tr></thead>
      <tbody>${rank.map(r => { const l = St.levelOf(r, rank); return `<tr><td>${r.rank}</td><td>${escapeHTML(r.name)}</td><td><b>${r.total}</b></td><td class="lv${l}">${l}</td>${subjs.map(s => `<td>${r.scores[s] == null ? '—' : r.scores[s]}</td>`).join('')}</tr>`; }).join('')}</tbody></table>
      <h2>三、需重点关注学生</h2>
      <table><thead><tr><th>姓名</th><th>总分</th><th>班次</th><th>主要问题</th></tr></thead>
      <tbody>${weak.map(w => `<tr><td>${escapeHTML(w.student.name)}</td><td>${w.student.total}</td><td>${w.totalRank || '—'}</td><td class="l">${w.issues.slice(0, 4).map(i => i.type === 'subject' ? `${i.subject}仅${i.value}分（第${i.rank}名）` : `${i.subject}低于均分${i.gap}分`).join('；') || '总分排名靠后'}</td></tr>`).join('') || '<tr><td colspan="4">无需特别关注的学生</td></tr>'}</tbody></table>
    </body></html>`;
  }

  /* ================= 智能排座 ================= */
  function currentDraft() {
    if (!Sv.ui.seatingDraft) {
      const s = St.S.db.seating;
      if (s && s.groups && s.groups.length) {
        Sv.ui.seatingDraft = { groups: JSON.parse(JSON.stringify(s.groups)), pool: JSON.parse(JSON.stringify(s.pool || [])) };
      } else {
        Sv.ui.seatingDraft = { groups: [], pool: St.mergedStudents().map(x => x.id) };
      }
    }
    return Sv.ui.seatingDraft;
  }

  function renderSeating() {
    const draft = currentDraft();
    $$('#seatModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.m === Sv.ui.seatMode));
    $('#seatGroupPane').classList.toggle('hidden', Sv.ui.seatMode !== 'group');
    $('#seatClassroomPane').classList.toggle('hidden', Sv.ui.seatMode !== 'classroom');
    $('#seatPaneTitle').textContent = Sv.ui.seatMode === 'group' ? '分组视图' : '教室座位图';
    if (Sv.ui.seatMode === 'group') renderGroups(draft);
    else renderClassroom(draft);
    renderBalance(draft);
    renderSeatValidate(draft);
  }

  function renderGroups(draft) {
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);
    const scores = Sv.ui.seatShowScores;

    $('#groupsGrid').innerHTML = draft.groups.map((g, gi) => {
      const members = g.members.map(id => map[id]).filter(Boolean);
      const cnt = { A: 0, B: 0, C: 0, D: 0 };
      members.forEach(s => cnt[St.levelOf(s, all)]++);
      const sum = members.reduce((a, b) => a + (b.total || 0), 0);
      const avg = members.length ? sum / members.length : 0;
      return `<div class="group-card" data-group="${gi}" data-drop="group" data-gi="${gi}">
        <div class="group-head">
          <svg class="gh-crown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h20M3 8l5 4 4-6 4 6 5-4-2 8H5z"/></svg>
          <div class="gh-name"><input value="${escapeHTML(g.name)}" data-rename="${gi}"></div>
          <span class="gh-count">${members.length}人 · 均${avg.toFixed(0)}</span>
          <button class="icon-btn" style="width:22px;height:22px" data-delgroup="${gi}" title="解散该组"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:12px;height:12px"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
        <div style="padding:6px 10px 0;display:flex;gap:5px">
          <span class="tag tag-green" style="flex:1;justify-content:center">优 ${cnt.A}</span>
          <span class="tag tag-blue" style="flex:1;justify-content:center">良 ${cnt.B}</span>
          <span class="tag tag-amber" style="flex:1;justify-content:center">中 ${cnt.C}</span>
          <span class="tag tag-red" style="flex:1;justify-content:center">困 ${cnt.D}</span>
        </div>
        <div class="group-body" data-drop="group" data-gi="${gi}">
          ${members.map(s => {
        const lv = St.levelOf(s, all);
        return `<div class="seat-slot" draggable="true" data-sid="${s.id}" data-from="${gi}">
              <span class="ss-avatar" style="background:${avatarColor(s.name)}">${initialOf(s.name)}</span>
              <span class="ss-name">${escapeHTML(s.name)}</span>
              ${scores ? `<span class="ss-score">${s.total == null ? '—' : s.total}</span>` : ''}
              <span class="level level-${lv}" style="width:19px;height:19px;font-size:10px;border-radius:5px">${lv}</span>
              <span class="ss-actions">
                <button data-top="${s.id}" data-gi="${gi}" title="移到首位"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
                <button data-pull="${s.id}" data-gi="${gi}" title="移出到未分组"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
              </span>
            </div>`;
      }).join('') || '<div class="seat-slot empty">拖拽学生到此组</div>'}
        </div>
      </div>`;
    }).join('') + `
      <div class="group-card" style="display:grid;place-items:center;min-height:170px;border-style:dashed;cursor:pointer" id="addGroupCard">
        <div style="text-align:center;color:var(--txt-3)">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" style="margin-bottom:7px"><path d="M12 5v14M5 12h14"/></svg>
          <div style="font-size:12.5px">新增一个小组</div>
        </div>
      </div>`;

    // 未分组
    const pool = draft.pool.map(id => map[id]).filter(Boolean);
    $('#poolCount').textContent = pool.length;
    $('#poolList').innerHTML = pool.length ? pool.map(s => {
      const lv = St.levelOf(s, all);
      return `<span class="pool-chip" draggable="true" data-sid="${s.id}" data-from="pool">
        <span class="ss-avatar" style="background:${avatarColor(s.name)};width:19px;height:19px;font-size:10px;border-radius:50%;display:grid;place-items:center;color:#fff">${initialOf(s.name)}</span>
        ${escapeHTML(s.name)}<b style="color:var(--txt-3);font-weight:600;font-size:11px">${s.total == null ? '—' : s.total}</b>
        <span class="level level-${lv}" style="width:17px;height:17px;font-size:9px;border-radius:4px">${lv}</span>
      </span>`;
    }).join('') : '<span class="muted">全部学生均已分组 ✓</span>';

    bindSeatDrag();
  }

  function renderClassroom(draft) {
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);
    const rooms = global.Seating.classroom(draft.groups.map((g, i) => ({ ...g, name: g.name })), { cols: 3 });

    $('#classroomSeat').innerHTML = rooms.map(r => `
      <div style="margin-bottom:19px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
          <span class="tag tag-blue">${escapeHTML(r.name)}</span>
          <span class="muted">${r.count} 人</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${r.rows.map(row => `<div class="seat-row">${row.map((s, si) => s ? `
            <div class="desk" draggable="true" data-sid="${s.id}" data-from="${r.index}">
              <span class="d-group-no">${escapeHTML(r.name)}</span>
              <span class="d-name">${escapeHTML(s.name)}</span>
              <span class="d-meta">${s.total == null ? '—' : s.total}分 · ${St.levelOf(s, all)}</span>
            </div>` : `<div class="desk" style="border-style:dashed;opacity:.4;cursor:default"><span class="d-meta">空位</span></div>`).join('')}</div>`).join('')}
        </div>
      </div>`).join('') || '<div class="empty"><p>暂无分组，请先执行智能排座</p></div>';

    const ld = global.Analytics.levelDistribution();
    $('#classroomLegend').innerHTML = `<span class="stat-mini"><span class="dot" style="background:${St.LEVEL_META.A.color}"></span>优秀 A（坐组内中间，便于带动）</span>
      <span class="stat-mini"><span class="dot" style="background:${St.LEVEL_META.B.color}"></span>良好 B</span>
      <span class="stat-mini"><span class="dot" style="background:${St.LEVEL_META.C.color}"></span>中等 C</span>
      <span class="stat-mini"><span class="dot" style="background:${St.LEVEL_META.D.color}"></span>待提升 D（两侧，由 A 帮扶）</span>`;
  }

  function renderBalance(draft) {
    if (!draft.groups.length) {
      $('#balancePanel').innerHTML = '<div class="empty" style="padding:26px 10px"><p>暂无分组数据</p></div>';
      return;
    }
    const m = global.Seating.metrics(draft.groups);
    const perLevel = parseInt($('#seatPerLevel').value, 10) || 2;
    const colorOf = sc => sc >= 85 ? 'var(--ok)' : sc >= 70 ? 'var(--brand-400)' : sc >= 50 ? 'var(--warn)' : 'var(--bad)';
    $('#balancePanel').innerHTML = `
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:36px;font-weight:800;color:${colorOf(m.score)};line-height:1">${m.score}</div>
        <div class="muted" style="margin-top:3px">综合均衡度评分（满分 100）</div>
      </div>
      <div class="balance-item">
        <div class="balance-row"><span class="bl-name">组间总分极差</span><span class="bl-val">${m.gap}</span></div>
        <div class="balance-bar"><div style="width:${Math.max(3, 100 - Math.min(100, m.gap / 12))}%;background:${m.gap < 60 ? 'var(--ok)' : m.gap < 150 ? 'var(--warn)' : 'var(--bad)'}"></div></div>
      </div>
      <div class="balance-item">
        <div class="balance-row"><span class="bl-name">组间标准差</span><span class="bl-val">${m.std.toFixed(1)}</span></div>
        <div class="balance-bar"><div style="width:${Math.max(3, 100 - Math.min(100, m.std / 1.6))}%;background:${m.std < 30 ? 'var(--ok)' : m.std < 70 ? 'var(--warn)' : 'var(--bad)'}"></div></div>
      </div>
      <div class="balance-item">
        <div class="balance-row"><span class="bl-name">平均组总分</span><span class="bl-val">${m.avgSum.toFixed(0)}</span></div>
        <div class="balance-bar"><div style="width:100%;background:linear-gradient(90deg,var(--brand-500),var(--accent-500))"></div></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <div class="muted mb-8" style="font-size:11.5px;font-weight:600">各小组总分</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${m.rows.map(r => {
      const pct = m.maxSum ? (r.sum / m.maxSum) * 100 : 0;
      return `<div class="row" style="gap:8px">
            <span style="width:52px;font-size:11.5px;color:var(--txt-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(r.name)}</span>
            <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--brand-500),var(--accent-500))"></div></div>
            <span class="bar-val" style="min-width:44px">${r.sum}</span>
          </div>`;
    }).join('')}
      </div>`;
  }

  function renderSeatValidate(draft) {
    const all = St.mergedStudents();
    const map = {}; all.forEach(s => map[s.id] = s);
    const L = parseInt($('#seatPerLevel').value, 10) || 2;
    const CAP = parseInt($('#seatGroupSize').value, 10) || 6;
    const G = draft.groups.length;

    const issues = [];
    let totalCap = G * CAP;
    const assigned = draft.groups.reduce((a, g) => a + g.members.length, 0);

    draft.groups.forEach((g, i) => {
      const members = g.members.map(id => map[id]).filter(Boolean);
      const cnt = { A: 0, B: 0, C: 0, D: 0 };
      members.forEach(s => cnt[St.levelOf(s, all)]++);
      if (members.length !== CAP && members.length > 0) issues.push({ g: g.name, t: `人数 ${members.length}，建议 ${CAP} 人`, lv: members.length < CAP ? 'warn' : 'err' });
      ['A', 'B', 'C', 'D'].forEach(k => {
        const diff = cnt[k] - L;
        if (members.length >= CAP * 0.6 && diff !== 0) {
          issues.push({ g: g.name, t: `${k}层 ${cnt[k]} 人（建议 ${L} 人）`, lv: Math.abs(diff) > 1 ? 'err' : 'warn' });
        }
      });
    });

    if (draft.pool.length) issues.push({ g: '未分组', t: `还有 ${draft.pool.length} 人未分配`, lv: 'warn' });

    const okCount = G - issues.filter(x => x.g !== '未分组').reduce((a, x) => { a.add(x.g); return a; }, new Set()).size;
    $('#seatValidate').innerHTML = `
      <div class="stat-mini mb-12" style="font-size:12.5px">
        <span class="dot" style="background:var(--brand-400)"></span>
        共 <b style="margin:0 3px">${G}</b> 组 · 已分配 <b style="margin:0 3px">${assigned}</b> 人 · 容量 <b style="margin:0 3px">${totalCap}</b> 人
      </div>
      ${issues.length ? `<div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
        ${issues.slice(0, 20).map(i => `<div class="row" style="gap:7px;font-size:11.8px;padding:5px 8px;border-radius:7px;background:var(--bg-2)">
          <span class="dot" style="background:${i.lv === 'err' ? 'var(--bad)' : 'var(--warn)'}"></span>
          <b style="color:var(--txt-1)">${escapeHTML(i.g)}</b><span class="muted">${i.t}</span>
        </div>`).join('')}
      </div>` : `<div class="row" style="gap:7px;font-size:12.5px;color:var(--ok)"><span class="dot" style="background:var(--ok)"></span>名额结构完全达标 ✓</div>`}`;
  }

  /* ---------- 拖拽 ---------- */
  const dragState = { id: null, from: null, el: null };
  function bindSeatDrag() {
    const ghost = $('#drag-ghost');
    $$('[draggable="true"][data-sid]').forEach(el => {
      el.ondragstart = e => {
        dragState.id = el.dataset.sid;
        dragState.from = el.dataset.from;
        el.classList.add('dragging');
        const name = el.querySelector('.ss-name, .d-name, .pool-chip') ;
        ghost.textContent = (el.textContent || '').trim().split('\n')[0].trim().slice(0, 12);
        ghost.style.display = 'block';
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', el.dataset.sid); } catch (_) {}
      };
      el.ondragend = () => {
        el.classList.remove('dragging');
        ghost.style.display = 'none';
        $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
      };
    });

    $$('[data-drop="group"], #unassignedPool').forEach(zone => {
      zone.ondragover = e => { e.preventDefault(); zone.classList.add('drop-target'); };
      zone.ondragleave = () => zone.classList.remove('drop-target');
      zone.ondrop = e => {
        e.preventDefault();
        zone.classList.remove('drop-target');
        const sid = dragState.id;
        if (!sid) return;
        const target = zone.id === 'unassignedPool' ? 'pool' : parseInt(zone.dataset.gi, 10);
        moveStudent(sid, dragState.from, target);
      };
    });

    document.addEventListener('dragover', e => { if (ghost.style.display === 'block') { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; } }, { passive: true });
  }

  function moveStudent(sid, from, to) {
    const draft = currentDraft();
    const fromIdx = from === 'pool' ? 'pool' : parseInt(from, 10);
    if (fromIdx === to) return;
    global.Seating.moveMember(draft, sid, fromIdx, to);
    Sv.ui.seatingDraft = draft;
    renderSeating();
    toast('已移动', 'ok', 1300);
  }

  /* 分组内按钮 / 重命名 / 删除组 */
  document.addEventListener('click', e => {
    if (Sv.ui.view !== 'seating') return;
    const top = e.target.closest('[data-top]');
    if (top) {
      const draft = currentDraft();
      const gi = parseInt(top.dataset.gi, 10);
      const g = draft.groups[gi];
      const i = g.members.indexOf(top.dataset.top);
      if (i > 0) { g.members.splice(i, 1); g.members.unshift(top.dataset.top); renderSeating(); }
      return;
    }
    const pull = e.target.closest('[data-pull]');
    if (pull) { moveStudent(pull.dataset.pull, pull.dataset.gi, 'pool'); return; }
    const del = e.target.closest('[data-delgroup]');
    if (del) {
      const draft = currentDraft();
      global.Seating.removeGroup(draft, parseInt(del.dataset.delgroup, 10));
      Sv.ui.seatingDraft = draft; renderSeating(); toast('已解散该组', 'ok', 1400); return;
    }
    if (e.target.closest('#addGroupCard')) {
      const draft = currentDraft();
      global.Seating.addGroup(draft);
      Sv.ui.seatingDraft = draft; renderSeating(); return;
    }
    const sb = e.target.closest('#seatModeSeg button');
    if (sb) { Sv.ui.seatMode = sb.dataset.m; renderSeating(); return; }
    const tn = e.target.closest('#btnSeatToggleNames');
    if (tn) { Sv.ui.seatShowScores = !Sv.ui.seatShowScores; renderSeating(); return; }
  });

  document.addEventListener('change', e => {
    const r = e.target.closest('[data-rename]');
    if (r && Sv.ui.view === 'seating') {
      const draft = currentDraft();
      draft.groups[parseInt(r.dataset.rename, 10)].name = r.value.trim() || r.dataset.rename;
      Sv.ui.seatingDraft = draft;
    }
  });

  document.addEventListener('input', e => {
    const r = e.target.closest('[data-rename]');
    if (r && Sv.ui.view === 'seating') {
      const draft = currentDraft();
      const gi = parseInt(r.dataset.rename, 10);
      if (draft.groups[gi]) draft.groups[gi].name = r.value;
      Sv.ui.seatingDraft = draft;
    }
  });

  /* 一键智能排座 */
  $('#btnSeatAuto').onclick = () => {
    if (!St.mergedStudents().length) return toast('请先导入学生数据', 'warn');
    const opt = readSeatOptions();
    const cap = opt.groupCount * opt.groupSize;
    const total = St.mergedStudents().length;
    if (cap < total) {
      modal('容量不足提示', `<p>当前配置 <b>${opt.groupCount} 组 × ${opt.groupSize} 人 = ${cap} 个座位</b>，<br>但班级共有 <b>${total} 名学生</b>，将有 <b style="color:var(--warn)">${total - cap} 名学生无法入座</b>。</p><p class="muted">建议增加组数或每组人数。是否仍要继续？</p>`,
        `<button class="btn" data-close>调整配置</button><span class="spacer"></span><button class="btn btn-primary" id="forceSeat">仍然继续</button>`,
        { onMount: () => { $('#forceSeat').onclick = () => { closeModal(); doAutoSeat(opt); }; } });
      return;
    }
    doAutoSeat(opt);
  };

  function readSeatOptions() {
    return {
      groupCount: Math.max(1, parseInt($('#seatGroupCount').value, 10) || 9),
      groupSize: Math.max(2, parseInt($('#seatGroupSize').value, 10) || 6),
      perLevel: Math.max(1, parseInt($('#seatPerLevel').value, 10) || 2),
      strategy: $('#seatStrategy').value,
      basis: $('#seatBasis').value === 'avg' ? 'avg' : $('#seatBasis').value === 'ratio' ? 'ratio' : 'total',
      nameStyle: $('#seatGroupName').value,
      prevNames: (currentDraft().groups || []).map(g => g.name)
    };
  }

  function doAutoSeat(opt) {
    loading(true, '正在智能分配…');
    setTimeout(async () => {
      try {
        const res = global.Seating.buildGroups(opt);
        Sv.ui.seatingDraft = { groups: res.groups, pool: res.pool };
        loading(false);
        renderSeating();
        const m = global.Seating.metrics(res.groups);
        toast(`排座完成！均衡度评分 ${m.score} 分，组间极差 ${m.gap}`, m.score >= 75 ? 'ok' : 'warn', 3400);
      } catch (err) { loading(false); toast('排座失败：' + err.message, 'err'); }
    }, 60);
  }

  $('#btnSeatApply').onclick = async () => {
    const draft = currentDraft();
    if (!draft.groups.length) return toast('还没有分组数据', 'warn');
    const db = St.S.db;
    const opt = readSeatOptions();
    db.seating = {
      groupCount: draft.groups.length,
      groupSize: opt.groupSize,
      perLevel: opt.perLevel,
      mode: opt.strategy,
      groups: JSON.parse(JSON.stringify(draft.groups)),
      pool: JSON.parse(JSON.stringify(draft.pool)),
      updatedAt: new Date().toISOString()
    };
    (db.students || []).forEach(s => {
      const g = db.seating.groups.find(x => x.members.includes(s.id));
      s.group = g ? g.name : '';
    });
    await St.save();
    toast('分组已保存', 'ok');
    renderSeating();
  };

  $('#btnSeatReset').onclick = () => {
    modal('重置分组', '<p>将清空当前所有分组安排，全部学生回到未分组状态。确定继续？</p>',
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-danger" id="rsOk">确认重置</button>`,
      { onMount: () => { $('#rsOk').onclick = () => { Sv.ui.seatingDraft = { groups: [], pool: St.mergedStudents().map(x => x.id) }; closeModal(); renderSeating(); toast('已重置', 'ok'); }; } });
  };

  $('#btnSeatClassroom').onclick = () => { Sv.ui.seatMode = 'classroom'; renderSeating(); };

  /* 导出智能分组 */
  $('#btnSeatExport').onclick = async () => {
    const draft = currentDraft();
    if (!draft.groups || !draft.groups.length) return toast('请先分组：点击「一键智能排座」或拖拽调整后再导出', 'warn');
    if (!St.mergedStudents().length) return toast('没有学生数据', 'warn');
    loading(true, '正在生成导出文件…');
    try {
      const sheets = global.Seating.exportSheets(draft);
      const res = await global.CM.buildXlsx(sheets);
      loading(false);
      if (res.error) return toast(res.error, 'err');
      const out = await global.CM.saveBuffer({ defaultName: `智能分组_${draft.groups.length}组_${new Date().toISOString().slice(0, 10)}.xlsx`, buffer: res.buffer, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
      if (out.canceled) return;
      if (out.error) return toast(out.error, 'err');
      toast('智能分组已导出（分组明细 / 组号名单 / 均衡统计）：' + out.path, 'ok', 4200);
    } catch (err) { loading(false); toast('导出失败：' + err.message, 'err'); }
  };

  /* 模板下载 */
  $('#btnSeatTemplate').onclick = async () => {
    const opt = readSeatOptions();
    const aoa = global.Seating.templateAoa(null, opt.groupCount, opt.groupSize);
    const res = await global.CM.buildXlsx([{ name: '分组表模板', aoa }]);
    if (res.error) return toast(res.error, 'err');
    const out = await global.CM.saveBuffer({ defaultName: `智能排座_分组表模板_${opt.groupCount}组.xlsx`, buffer: res.buffer, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
    if (out.canceled) return;
    if (out.error) return toast(out.error, 'err');
    toast('模板已保存：' + out.path, 'ok', 3600);
  };

  /* 导入分组表 */
  $('#btnSeatImport').onclick = () => { openImportWizard('group'); };

  /* ================= 积分管理 ================= */
  const POINT_STEPS = [1, 2, 3, 4, 5, 6];

  function renderPoints() {
    $$('#pointsModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.m === Sv.ui.pointsMode));
    ['board', 'rank', 'records', 'rules'].forEach(k => $('#pointsPane-' + k).classList.toggle('hidden', k !== Sv.ui.pointsMode));
    const recs = (St.S.db.points.records || []);
    const pm = St.pointsMap();
    const studs = St.mergedStudents();
    const pos = recs.filter(r => r.score > 0).reduce((a, b) => a + b.score, 0);
    const neg = recs.filter(r => r.score < 0).reduce((a, b) => a + Math.abs(b.score), 0);

    $('#pointsStats').innerHTML = `
      <div class="stat"><div class="stat-ico cyan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l2.9 6.3 6.85.9-5 4.72 1.25 6.78L12 17.6 5.99 20.7 7.25 13.9l-5-4.72 6.85-.9z"/></svg></div><div class="stat-val">${pos - neg}</div><div class="stat-lbl">班级净积分</div></div>
      <div class="stat"><div class="stat-ico green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 19V5M5 12l7-7 7 7"/></svg></div><div class="stat-val">${pos}</div><div class="stat-lbl">累计加分</div></div>
      <div class="stat"><div class="stat-ico red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></div><div class="stat-val">${neg}</div><div class="stat-lbl">累计扣分</div></div>
      <div class="stat"><div class="stat-ico violet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3 8-8"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><div class="stat-val">${recs.length}</div><div class="stat-lbl">积分流水笔数</div></div>
      <div class="stat"><div class="stat-ico amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg></div><div class="stat-val">${Object.values(pm).filter(v => v > 0).length}</div><div class="stat-lbl">有积分的学生</div></div>`;

    if (Sv.ui.pointsMode === 'board') renderPointsBoard(studs, pm);
    else if (Sv.ui.pointsMode === 'rank') renderPointsRank(studs, pm);
    else if (Sv.ui.pointsMode === 'records') renderPointsRecords(studs);
    else renderPointsRules();
  }

  function renderPointsBoard(studs, pm) {
    const q = Sv.ui.pointsSearch.trim();
    let list = studs.slice().sort((a, b) => (pm[b.id] || 0) - (pm[a.id] || 0));
    if (q) list = list.filter(s => s.name.includes(q));
    if (!list.length) {
      $('#pointsGrid').innerHTML = '<div class="card" style="grid-column:1/-1"><div class="card-body"><div class="empty"><h4>暂无学生</h4><p>请先导入学生名单</p></div></div></div>';
      return;
    }
    const all = studs;
    $('#pointsGrid').innerHTML = list.map(s => {
      const p = pm[s.id] || 0;
      const lv = St.levelOf(s, all);
      return `<div class="points-card">
        <span class="pc-avatar" style="background:${avatarColor(s.name)}">${initialOf(s.name)}</span>
        <div class="pc-info">
          <div class="pc-name">${escapeHTML(s.name)} <span class="level level-${lv}" style="width:18px;height:18px;font-size:10px;border-radius:5px;vertical-align:middle">${lv}</span></div>
          <div class="pc-sub">总分 ${s.total == null ? '—' : s.total} · 班次 ${s.rankClass == null ? '—' : s.rankClass}</div>
          <div class="points-quick">
            ${[1, 2, 3].map(n => `<button class="pq-btn plus" data-pt="${s.id}" data-v="${n}">+${n}</button>`).join('')}
            ${[1, 2].map(n => `<button class="pq-btn minus" data-pt="${s.id}" data-v="-${n}">-${n}</button>`).join('')}
            <button class="pq-btn" data-ptmore="${s.id}" style="border-color:var(--line-2)">…</button>
          </div>
        </div>
        <div class="pc-pts ${p > 0 ? 'pos' : p < 0 ? 'neg' : ''}" style="${p === 0 ? 'color:var(--txt-3)' : ''}">${p > 0 ? '+' : ''}${p}</div>
      </div>`;
    }).join('');
  }

  function renderPointsRank(studs, pm) {
    const list = studs.slice().sort((a, b) => (pm[b.id] || 0) - (pm[a.id] || 0));
    $('#rankTip').textContent = `共 ${list.length} 人 · 积分累计`;
    $('#pointsRankList').innerHTML = list.map((s, i) => {
      const p = pm[s.id] || 0;
      const max = Math.max(1, pm[list[0].id] || 1);
      return `<div class="rank-row" style="gap:12px">
        <span class="rank-no ${i < 3 ? 'g' + (i + 1) : ''}">${i + 1}</span>
        <span style="width:28px;height:28px;border-radius:50%;background:${avatarColor(s.name)};display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff">${initialOf(s.name)}</span>
        <div style="width:80px;font-weight:600;font-size:13px">${escapeHTML(s.name)}</div>
        <div class="bar-track" style="flex:1;height:8px"><div class="bar-fill" style="width:${Math.max(0, (p / max) * 100)}%;background:linear-gradient(90deg,var(--brand-500),var(--accent-500))"></div></div>
        <b style="min-width:44px;text-align:right;font-size:14px;color:${p > 0 ? 'var(--ok)' : p < 0 ? 'var(--bad)' : 'var(--txt-3)'}">${p > 0 ? '+' : ''}${p}</b>
      </div>`;
    }).join('') || '<div class="empty"><p>暂无数据</p></div>';
  }

  function renderPointsRecords(studs) {
    const map = {}; studs.forEach(s => map[s.id] = s);
    const recs = (St.S.db.points.records || []).slice().sort((a, b) => new Date(b.time) - new Date(a.time));
    $('#pointsRecords').innerHTML = recs.length ? `<div class="table-wrap" style="border:none"><table class="data">
      <thead><tr><th>时间</th><th>学生</th><th class="num">积分</th><th>事由</th><th>类别</th><th>操作人</th><th style="width:50px"></th></tr></thead>
      <tbody>${recs.slice(0, 400).map(r => `<tr>
        <td class="muted" style="font-size:11.5px">${St.fmtDate(r.time)}</td>
        <td><b>${escapeHTML((map[r.studentId] || {}).name || '已删除')}</b></td>
        <td class="num" style="font-weight:700;color:${r.score > 0 ? 'var(--ok)' : 'var(--bad)'}">${r.score > 0 ? '+' : ''}${r.score}</td>
        <td>${escapeHTML(r.reason || '—')}</td>
        <td><span class="tag tag-gray">${escapeHTML(r.category || '自定义')}</span></td>
        <td class="muted">${escapeHTML(r.operator || '')}</td>
        <td><button class="icon-btn" style="width:24px;height:24px" data-delrec="${r.id}" title="删除该记录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:12px;height:12px"><path d="M18 6 6 18M6 6l12 12"/></svg></button></td>
      </tr>`).join('')}</tbody></table></div>${recs.length > 400 ? '<div class="muted" style="text-align:center;padding:10px">仅显示最近 400 条</div>' : ''}`
      : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2l2.9 6.3 6.85.9-5 4.72 1.25 6.78L12 17.6 5.99 20.7 7.25 13.9l-5-4.72 6.85-.9z"/></svg><h4>暂无积分记录</h4><p>点击右上角「记一笔」开始为学生加减分</p></div>';
  }

  function renderPointsRules() {
    const p = St.S.db.points;
    $('#pointsPane-rules').innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h3>积分规则</h3><span class="spacer"></span><button class="btn btn-sm" id="btnAddRule"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:13px;height:13px"><path d="M12 5v14M5 12h14"/></svg>新增规则</button></div>
          <div class="card-body">
            ${(p.rules || []).map(r => `<div class="row" style="gap:11px;padding:9px 11px;border-radius:9px;background:var(--bg-2);border:1px solid var(--line);margin-bottom:7px">
              <span class="dot" style="background:${r.type === 'add' ? 'var(--ok)' : 'var(--bad)'}"></span>
              <b style="flex:1;font-size:13px">${escapeHTML(r.name)}</b>
              <span class="tag ${r.type === 'add' ? 'tag-green' : 'tag-red'}">${r.type === 'add' ? '+' : '-'}${r.score} 分</span>
              <button class="icon-btn" style="width:24px;height:24px" data-delrule="${r.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:12px;height:12px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
            </div>`).join('') || '<div class="muted">暂无规则</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>积分兑换</h3><span class="spacer"></span><button class="btn btn-sm" id="btnAddExchange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:13px;height:13px"><path d="M12 5v14M5 12h14"/></svg>新增兑换项</button></div>
          <div class="card-body">
            ${(p.exchange || []).map(e => `<div class="row" style="gap:11px;padding:9px 11px;border-radius:9px;background:var(--bg-2);border:1px solid var(--line);margin-bottom:7px">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--warn)" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>
              <b style="flex:1;font-size:13px">${escapeHTML(e.name)}</b>
              <span class="tag tag-amber">${e.cost} 分</span>
              <button class="btn btn-sm btn-ghost" data-redeem="${e.id}">兑换</button>
              <button class="icon-btn" style="width:24px;height:24px" data-delexch="${e.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:12px;height:12px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
            </div>`).join('') || '<div class="muted">暂无兑换项</div>'}
          </div>
        </div>
      </div>
      <div class="card mt-16">
        <div class="card-head"><h3>积分档位说明</h3></div>
        <div class="card-body">
          <div class="row wrap" style="gap:11px">
            ${POINT_STEPS.map(n => `<div style="flex:1;min-width:120px;text-align:center;padding:13px;border-radius:11px;background:var(--bg-2);border:1px solid var(--line)">
              <div style="font-size:23px;font-weight:800;color:${n <= 2 ? 'var(--ok)' : n <= 4 ? 'var(--brand-400)' : 'var(--warn)'}">+${n}</div>
              <div class="muted" style="font-size:11.5px;margin-top:3px">${['课堂发言', '作业优秀', '主动帮助同学', '考试进步', '竞赛获奖', '校级荣誉'][n - 1]}</div>
            </div>`).join('')}
          </div>
          <div class="muted mt-16" style="line-height:1.8">
            <b style="color:var(--txt-1)">使用建议：</b>加分档位 1-6 分对应不同行为价值；扣分建议不超过 6 分，避免打击积极性。
            所有积分变动均可在「记录流水」中追溯，支持按学生、时间、类别查询。
          </div>
        </div>
      </div>`;
  }

  /* 积分交互 */
  document.addEventListener('click', async e => {
    const pt = e.target.closest('[data-pt]');
    if (pt) {
      const v = parseInt(pt.dataset.v, 10);
      St.addPoints(pt.dataset.pt, v, v > 0 ? '课堂表现加分' : '违纪扣分', '快捷操作');
      toast(`${v > 0 ? '加' : '扣'} ${Math.abs(v)} 分`, v > 0 ? 'ok' : 'warn', 1200);
      if (Sv.ui.view === 'points') renderPoints();
      return;
    }
    const more = e.target.closest('[data-ptmore]');
    if (more) { showPointDialog([more.dataset.ptmore]); return; }
    const delrec = e.target.closest('[data-delrec]');
    if (delrec) {
      St.S.db.points.records = St.S.db.points.records.filter(r => r.id !== delrec.dataset.delrec);
      await St.save(); renderPoints(); toast('记录已删除', 'ok', 1300); return;
    }
    const dr = e.target.closest('[data-delrule]');
    if (dr) { St.S.db.points.rules = St.S.db.points.rules.filter(r => r.id !== dr.dataset.delrule); await St.save(); renderPoints(); return; }
    const de = e.target.closest('[data-delexch]');
    if (de) { St.S.db.points.exchange = St.S.db.points.exchange.filter(r => r.id !== de.dataset.delexch); await St.save(); renderPoints(); return; }
    const rd = e.target.closest('[data-redeem]');
    if (rd) { showRedeem(rd.dataset.redeem); return; }

    const seg = e.target.closest('#pointsModeSeg button');
    if (seg) { Sv.ui.pointsMode = seg.dataset.m; renderPoints(); return; }

    if (e.target.closest('#btnAddRule')) { showRuleDialog(); return; }
    if (e.target.closest('#btnAddExchange')) { showExchangeDialog(); return; }
    if (e.target.closest('#btnClearRecords')) {
      modal('清空流水', '<p>将删除全部积分流水记录，学生积分归零。确定继续？</p>',
        '<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-danger" id="crOk">确认清空</button>',
        { onMount: () => { $('#crOk').onclick = async () => { St.S.db.points.records = []; await St.save(); closeModal(); renderPoints(); toast('已清空', 'ok'); }; } });
      return;
    }
  });

  $('#pointsSearch').addEventListener('input', e => { Sv.ui.pointsSearch = e.target.value; if (Sv.ui.view === 'points') renderPoints(); });

  function showPointDialog(ids) {
    const studs = St.mergedStudents();
    const picked = ids || [];
    const rules = St.S.db.points.rules || [];
    modal('记一笔积分', `
      <div class="field mb-12">
        <label>选择学生（可多选）</label>
        <div class="row wrap" style="gap:6px;max-height:132px;overflow-y:auto;padding:3px" id="pdStudents">
          ${studs.map(s => `<button class="btn btn-sm ${picked.includes(s.id) ? 'btn-primary' : ''}" data-pd="${s.id}">${escapeHTML(s.name)}</button>`).join('')}
        </div>
      </div>
      <div class="field mb-12">
        <label>分值档位（1-6 分）</label>
        <div class="row wrap" style="gap:6px">
          ${POINT_STEPS.map(n => `<button class="btn btn-sm" data-pv="${n}" style="min-width:46px;border-color:rgba(16,185,129,.4);color:#34d399">+${n}</button>`).join('')}
          ${POINT_STEPS.map(n => `<button class="btn btn-sm" data-pv="${-n}" style="min-width:46px;border-color:rgba(239,68,68,.4);color:#f87171">-${n}</button>`).join('')}
        </div>
        <div class="field mt-12"><label>自定义分值</label><input class="input" id="pdCustom" type="number" step="0.5" placeholder="也可直接输入，如 2.5 或 -3"></div>
      </div>
      <div class="grid-2" style="gap:12px">
        <div class="field"><label>类别</label><select class="select" id="pdCat">${[...new Set([...rules.map(r => r.name), '课堂表现', '作业情况', '考试进步', '纪律', '卫生', '其他'])].map(c => `<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label>快捷事由</label><select class="select" id="pdQuick"><option value="">— 选择或自定义 —</option>${rules.map(r => `<option value="${escapeHTML(r.name)}">${escapeHTML(r.name)} (${r.type === 'add' ? '+' : '-'}${r.score})</option>`).join('')}</select></div>
      </div>
      <div class="field mt-12"><label>事由说明</label><input class="input" id="pdReason" placeholder="如：数学课积极回答问题"></div>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="pdSave">确认记账</button>`,
      {
        size: 'wide', onMount: () => {
          let sel = new Set(picked);
          let score = 2;
          const sync = () => {
            $$('[data-pd]').forEach(b => b.classList.toggle('btn-primary', sel.has(b.dataset.pd)));
            $$('[data-pv]').forEach(b => b.classList.toggle('btn-primary', parseInt(b.dataset.pv, 10) === score));
          };
          $$('[data-pd]').forEach(b => b.onclick = () => { const id = b.dataset.pd; if (sel.has(id)) sel.delete(id); else sel.add(id); sync(); });
          $$('[data-pv]').forEach(b => b.onclick = () => { score = parseInt(b.dataset.pv, 10); $('#pdCustom').value = ''; sync(); });
          $('#pdQuick').onchange = e => {
            const rule = rules.find(r => r.name === e.target.value);
            if (rule) { score = rule.type === 'add' ? rule.score : -rule.score; $('#pdReason').value = rule.name; $('#pdCustom').value = ''; sync(); }
          };
          sync();
          $('#pdSave').onclick = () => {
            if (!sel.size) return toast('请至少选择一名学生', 'warn');
            const custom = parseFloat($('#pdCustom').value);
            const v = !isNaN(custom) ? custom : score;
            const reason = $('#pdReason').value.trim() || $('#pdCat').value;
            St.addPoints([...sel], v, reason, $('#pdCat').value);
            closeModal();
            toast(`已为 ${sel.size} 名学生${v > 0 ? '加' : '扣'} ${Math.abs(v)} 分`, v > 0 ? 'ok' : 'warn');
            if (Sv.ui.view === 'points') renderPoints();
          };
        }
      });
  }

  $('#btnPointsAdd').onclick = () => { if (!St.mergedStudents().length) return toast('请先导入学生', 'warn'); showPointDialog([]); };
  $('#btnPointsBatch').onclick = () => {
    const studs = St.mergedStudents();
    if (!studs.length) return toast('请先导入学生', 'warn');
    modal('批量加分', `
      <div class="field mb-12"><label>选择学生（可多选，支持全选）</label>
        <div class="row mb-8" style="gap:7px"><button class="btn btn-sm" id="selAll">全选</button><button class="btn btn-sm" id="selNone">清空</button><button class="btn btn-sm" id="selTop">前 10 名</button><button class="btn btn-sm" id="selBottom">后 10 名</button></div>
        <div class="row wrap" style="gap:6px;max-height:180px;overflow-y:auto;padding:3px" id="pdStudents">
          ${studs.map(s => `<button class="btn btn-sm" data-pd="${s.id}">${escapeHTML(s.name)}<span class="muted" style="margin-left:3px">${s.total == null ? '' : s.total}</span></button>`).join('')}
        </div>
      </div>
      <div class="grid-2" style="gap:12px">
        <div class="field"><label>分值</label><input class="input" id="bdScore" type="number" value="2" step="0.5"></div>
        <div class="field"><label>类别</label><select class="select" id="bdCat">${['课堂表现', '作业情况', '考试进步', '纪律', '卫生', '其他'].map(c => `<option>${c}</option>`).join('')}</select></div>
      </div>
      <div class="field mt-12"><label>事由</label><input class="input" id="bdReason" placeholder="如：本次月考全班进步"></div>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="bdSave">批量记账</button>`,
      {
        size: 'wide', onMount: () => {
          let sel = new Set();
          const sync = () => $$('[data-pd]').forEach(b => b.classList.toggle('btn-primary', sel.has(b.dataset.pd)));
          $$('[data-pd]').forEach(b => b.onclick = () => { const id = b.dataset.pd; if (sel.has(id)) sel.delete(id); else sel.add(id); sync(); });
          $('#selAll').onclick = () => { sel = new Set(studs.map(s => s.id)); sync(); };
          $('#selNone').onclick = () => { sel = new Set(); sync(); };
          $('#selTop').onclick = () => { sel = new Set(global.Analytics.ranked().slice(0, 10).map(s => s.id)); sync(); };
          $('#selBottom').onclick = () => { const r = global.Analytics.ranked(); sel = new Set(r.slice(-10).map(s => s.id)); sync(); };
          $('#bdSave').onclick = () => {
            if (!sel.size) return toast('请选择学生', 'warn');
            const v = parseFloat($('#bdScore').value) || 0;
            St.addPoints([...sel], v, $('#bdReason').value.trim() || $('#bdCat').value, $('#bdCat').value);
            closeModal(); toast(`已为 ${sel.size} 名学生记 ${v > 0 ? '+' : ''}${v} 分`, 'ok');
            if (Sv.ui.view === 'points') renderPoints();
          };
        }
      });
  };

  function showRuleDialog() {
    modal('新增积分规则', `
      <div class="grid-2" style="gap:12px">
        <div class="field"><label>规则名称</label><input class="input" id="nrName" placeholder="如：主动帮助同学"></div>
        <div class="field"><label>分值（1-6）</label><input class="input" id="nrScore" type="number" min="1" max="6" value="2"></div>
      </div>
      <div class="field mt-12"><label>类型</label><select class="select" id="nrType"><option value="add">加分</option><option value="sub">扣分</option></select></div>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="nrSave">保存</button>`,
      {
        onMount: () => {
          $('#nrSave').onclick = async () => {
            const n = $('#nrName').value.trim();
            if (!n) return toast('请输入名称', 'err');
            const s = Math.max(1, Math.min(6, parseFloat($('#nrScore').value) || 2));
            St.S.db.points.rules.push({ id: St.uid('r'), name: n, score: s, type: $('#nrType').value });
            await St.save(); closeModal(); renderPoints(); toast('已添加规则', 'ok');
          };
        }
      });
  }

  function showExchangeDialog() {
    modal('新增兑换项', `
      <div class="grid-2" style="gap:12px">
        <div class="field"><label>兑换名称</label><input class="input" id="neName" placeholder="如：免写一次作业券"></div>
        <div class="field"><label>所需积分</label><input class="input" id="neCost" type="number" value="20"></div>
      </div>`,
      `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="neSave">保存</button>`,
      {
        onMount: () => {
          $('#neSave').onclick = async () => {
            const n = $('#neName').value.trim();
            if (!n) return toast('请输入名称', 'err');
            St.S.db.points.exchange.push({ id: St.uid('e'), name: n, cost: Math.max(1, parseInt($('#neCost').value, 10) || 10) });
            await St.save(); closeModal(); renderPoints(); toast('已添加', 'ok');
          };
        }
      });
  }

  function showRedeem(exId) {
    const ex = (St.S.db.points.exchange || []).find(x => x.id === exId);
    if (!ex) return;
    const pm = St.pointsMap();
    const eligible = St.mergedStudents().filter(s => (pm[s.id] || 0) >= ex.cost).sort((a, b) => (pm[b.id] || 0) - (pm[a.id] || 0));
    modal(`兑换「${escapeHTML(ex.name)}」`, `
      <p class="muted mb-12">需要 ${ex.cost} 积分。以下学生积分足够，点击即可为其兑换（将扣除相应积分）。</p>
      ${eligible.length ? `<div style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto">
        ${eligible.map(s => `<div class="row" style="gap:10px;padding:8px 11px;border-radius:9px;background:var(--bg-2);border:1px solid var(--line)">
          <span style="width:26px;height:26px;border-radius:50%;background:${avatarColor(s.name)};display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff">${initialOf(s.name)}</span>
          <b style="flex:1">${escapeHTML(s.name)}</b>
          <span class="tag tag-cyan">${pm[s.id]} 分</span>
          <button class="btn btn-sm btn-primary" data-doRedeem="${s.id}">兑换</button>
        </div>`).join('')}
      </div>` : '<div class="empty" style="padding:26px"><p>暂无学生积分达到兑换要求</p></div>'}`,
      `<button class="btn" data-close>关闭</button>`,
      {
        onMount: () => {
          $$('[data-doRedeem]').forEach(b => b.onclick = async () => {
            const sid = b.dataset.doRedeem;
            St.addPoints(sid, -ex.cost, `兑换：${ex.name}`, '积分兑换');
            await St.save(); closeModal(); renderPoints();
            const nm = (St.mergedStudents().find(s => s.id === sid) || {}).name;
            toast(`${nm} 已兑换「${ex.name}」，扣除 ${ex.cost} 分`, 'ok', 2600);
          });
        }
      });
  }

  /* ================= 会员中心 ================= */
  function renderMembership() {
    if (!LICENSE) return;
    const plans = [
      { key: 'trial', name: '试用版', price: 0, old: null, for: '新用户免费体验', featured: false, badge: '', feats: [['体验 7 天全功能', 1], ['最多 20 名学生', 1], ['成绩分析基础版', 1], ['智能排座 / 积分管理', 0], ['Excel 导出', 0], ['商用授权', 0], ['永久使用', 0]] },
      { key: 'pro', name: '个人专业版', price: 199, old: 399, for: '1 位老师 · 1 台电脑 · 永久', featured: true, badge: '最受欢迎 · 推荐', feats: [['永久使用，不限时间', 1], ['最多 200 名学生', 1], ['成绩分析完整版（雷达/分层/对比）', 1], ['智能排座（层次均衡 + 拖拽微调）', 1], ['积分管理（1-6 档位 + 兑换）', 1], ['Excel / PDF 多格式导出', 1], ['免费版本升级', 1]] },
      { key: 'school', name: '校园旗舰版', price: 899, old: 1599, for: '全校教师 · 不限设备 · 永久', featured: false, badge: '学校采购首选', feats: [['含专业版全部功能', 1], ['不限学生人数', 1], ['多班级并行管理', 1], ['批量排座 / 分组校验', 1], ['专属技术支持', 1], ['定制化功能开发', 1], ['发票与合同支持', 1]] }
    ];
    $('#pricingGrid').innerHTML = plans.map(p => `
      <div class="price-card ${p.featured ? 'featured' : ''}">
        ${p.badge ? `<div class="pc-badge">${p.badge}</div>` : ''}
        <h4>${p.name}</h4>
        <div class="pc-for">${p.for}</div>
        <div class="pc-price">${p.price === 0 ? '<span class="cur">¥</span>0' : `<span class="cur">¥</span>${p.price}`}<span class="per">${p.price === 0 ? '' : ' / 一次性'}</span></div>
        ${p.old ? `<div class="pc-old">原价 ¥${p.old}</div>` : ''}
        <ul>${p.feats.map(f => `<li class="${f[1] ? '' : 'off'}">${f[1] ? Icons.ok : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>'}${f[0]}</li>`).join('')}</ul>
        <button class="btn ${p.featured ? 'btn-primary' : ''} btn-lg" data-plan="${p.key}" ${LICENSE.license.plan === p.key ? 'disabled' : ''} style="width:100%">
          ${LICENSE.license.plan === p.key ? '当前版本' : p.key === 'trial' ? '免费试用' : '申请授权'}
        </button>
      </div>`).join('');

    // 状态
    const p = LICENSE.plan, l = LICENSE.license;
    $('#mcPlanTag').textContent = p.name;
    const st = $('#mcStatusTag');
    if (LICENSE.valid && !p.expired) { st.textContent = '已激活 · 有效期至 ' + St.fmtDate(l.expiresAt).slice(0, 10); st.className = 'tag tag-green'; }
    else if (p.expired) { st.textContent = '已过期'; st.className = 'tag tag-red'; }
    else { st.textContent = '试用中 · 剩余 ' + Math.max(0, Math.ceil((new Date(l.expiresAt) - Date.now()) / 86400000)) + ' 天'; st.className = 'tag tag-amber'; }
    $('#machineCode').textContent = LICENSE.machineCode;
  }

  document.addEventListener('click', async e => {
    const plan = e.target.closest('[data-plan]');
    if (plan) {
      const key = plan.dataset.plan;
      if (key === 'trial') { await global.CM.licenseTrial(); await refreshLicense(); toast('已开启试用', 'ok'); return; }
      const r = await global.CM.licenseApplyCode({ plan: key });
      const pname = key === 'pro' ? '个人专业版' : '校园旗舰版';
      const price = key === 'pro' ? 199 : 899;
      const reqText = `【班级智管-鸿升周老师 授权申请】\n版本：${pname}（¥${price}）\n机器码：${r.machineCode}\n申请码：${r.code}`;
      modal('申请授权', `
        <p class="muted mb-12">本软件支持<b style="color:var(--txt-1)">一机一码</b>授权。请把下方<b style="color:var(--txt-1)">申请码</b>发送给销售方，付款后即可收到对应版本的正版激活码。</p>
        <div class="field mb-12">
          <label>申请版本</label>
          <div class="key-box" style="color:var(--brand-300);display:flex;align-items:center;justify-content:space-between">
            <span>${pname}</span><span style="color:var(--txt-2)">¥${price} 一次性</span>
          </div>
        </div>
        <div class="field mb-12">
          <label>本机机器码</label>
          <div class="key-box" id="mkCode">${r.machineCode}</div>
        </div>
        <div class="field">
          <label>授权申请码（推荐发送此项）</label>
          <div class="key-box" style="color:var(--warn);word-break:break-all;font-size:11.5px;line-height:1.7" id="applyCode">${r.code}</div>
        </div>
        <div class="row mt-12" style="gap:8px">
          <button class="btn btn-sm btn-primary" id="cpApply">复制申请码</button>
          <button class="btn btn-sm" id="cpMc">仅复制机器码</button>
        </div>
        <div class="hint mt-12" id="applyTip">收到激活码后，粘贴到上方输入框点击「激活」即可解锁全部功能。</div>`,
        `<button class="btn" data-close>关闭</button>`,
        {
          onMount: () => {
            $('#cpApply').onclick = () => {
              copyText(r.code).then(ok => toast(ok ? '申请码已复制，发送给销售方即可' : '复制失败，请手动选择复制', ok ? 'ok' : 'err', 3000));
            };
            $('#cpMc').onclick = () => {
              copyText(r.machineCode).then(ok => toast(ok ? '机器码已复制' : '复制失败，请手动选择复制', ok ? 'ok' : 'err', 2600));
            };
            if ($('#applyCode')) $('#applyCode').onclick = () => {
              copyText(r.code).then(ok => toast(ok ? '申请码已复制' : '复制失败', ok ? 'ok' : 'err', 2200));
            };
            if ($('#mkCode')) $('#mkCode').onclick = () => {
              copyText(r.machineCode).then(ok => toast(ok ? '机器码已复制' : '复制失败', ok ? 'ok' : 'err', 2200));
            };
          }
        });
      return;
    }
    if (e.target.closest('#btnActivate')) {
      const key = $('#licenseInput').value.trim();
      if (!key) return toast('请输入激活码', 'warn');
      const res = await global.CM.licenseActivate({ key });
      if (!res.ok) return toast(res.error, 'err', 3200);
      await refreshLicense(); renderMembership(); toast('激活成功！全部功能已解锁 🎉', 'ok', 3200);
      return;
    }
    if (e.target.closest('#machineCode') || e.target.closest('#planCard')) {
      if (e.target.closest('#machineCode')) {
        copyText(LICENSE.machineCode).then(ok => toast(ok ? '机器码已复制' : '复制失败', ok ? 'ok' : 'err', 1600));
      }
    }
  });

  async function refreshLicense() {
    LICENSE = await global.CM.licenseStatus();
    renderPlanCard();
    return LICENSE;
  }

  /* ================= 设置 ================= */
  function renderSettings() {
    const meta = St.S.db.meta || {};
    $('#setSchool').value = meta.school || '';
    $('#setClassName').value = meta.className || '';
    $('#setSemester').value = meta.semester || '';
    $('#setExamName').value = meta.examName || '';
    $('#setTeacherName').value = meta.teacherName || '';
    renderAvatar();
    applyLogo();
    const logoClear = $('#btnLogoClear');
    if (logoClear) logoClear.hidden = !(meta.logo);
    global.CM.dbPath().then(p => { $('#dataPath').textContent = p; });
    global.CM.sysInfo().then(i => {
      $('#aboutVersion').textContent = i.version;
      $('#aboutRuntime').textContent = `Electron ${i.electron} · Node ${i.node}`;
    });
  }

  $('#btnSaveMeta').onclick = async () => {
    St.S.db.meta = St.S.db.meta || {};
    St.S.db.meta.school = $('#setSchool').value.trim();
    St.S.db.meta.className = $('#setClassName').value.trim();
    St.S.db.meta.semester = $('#setSemester').value.trim();
    St.S.db.meta.examName = $('#setExamName').value.trim();
    St.S.db.meta.teacherName = $('#setTeacherName').value.trim();
    await St.save();
    renderAvatar();
    applyLogo();
    toast('已保存', 'ok');
  };

  /* --- 教师头像 --- */
  function renderAvatar() {
    const meta = St.S.db.meta || {};
    const img = $('#teacherAvatar'), ph = $('#avatarPlaceholder'), clearBtn = $('#btnAvatarClear');
    if (img && ph) {
      if (meta.teacherAvatar) {
        img.src = meta.teacherAvatar; img.hidden = false; ph.style.display = 'none';
        if (clearBtn) clearBtn.hidden = false;
      } else {
        img.removeAttribute('src'); img.hidden = true; ph.style.display = '';
        if (clearBtn) clearBtn.hidden = true;
      }
    }
    const initial = ((meta.teacherName || '').trim() || '师').slice(-2);
    if (ph) ph.textContent = initial;
    const sidePh = $('#sideAvatarPh');
    if (sidePh) sidePh.textContent = initial.slice(-1);
    const sideImg = $('#sideAvatar');
    if (sideImg) {
      if (meta.teacherAvatar) { sideImg.src = meta.teacherAvatar; sideImg.hidden = false; }
      else { sideImg.removeAttribute('src'); sideImg.hidden = true; }
    }
    const sideName = $('#sideTeacherName');
    if (sideName) sideName.textContent = (meta.teacherName || '').trim() || '未设置姓名';
  }

  function compressAvatar(dataUrl, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const side = Math.max(1, Math.min(img.naturalWidth, img.naturalHeight));
          const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(c.toDataURL('image/jpeg', 0.88));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('图片无法解析，请换一张'));
      img.src = dataUrl;
    });
  }

  /** 等比缩放图片到最长边 maxDim 以内（用于软件 Logo，保留原始比例） */
  function compressLogo(dataUrl, maxDim) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(img, 0, 0, cw, ch);
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('图片无法解析，请换一张'));
      img.src = dataUrl;
    });
  }

  /** 把设置中的 Logo 应用到侧边栏左上角 */
  function applyLogo() {
    const meta = St.S.db.meta || {};
    const el = $('#brandLogo');
    if (el) el.src = meta.logo || '../../assets/logo.png';
    const prev = $('#logoPreview');
    if (prev) prev.src = meta.logo || '../../assets/logo.png';
  }

  $('#btnAvatarUpload').onclick = async () => {
    const r = await global.CM.openImage();
    if (r.canceled) return;
    if (r.error) { toast(r.error, 'err'); return; }
    try {
      const small = await compressAvatar(r.dataUrl, 256);
      St.S.db.meta = St.S.db.meta || {};
      St.S.db.meta.teacherAvatar = small;
      await St.save();
      renderAvatar();
      toast('头像已更新', 'ok');
    } catch (e) { toast('头像处理失败：' + e.message, 'err'); }
  };
  $('#btnAvatarClear').onclick = async () => {
    St.S.db.meta = St.S.db.meta || {};
    St.S.db.meta.teacherAvatar = '';
    await St.save();
    renderAvatar();
    toast('已恢复默认头像', 'ok');
  };

  /* --- 软件 Logo（左上角） --- */
  async function uploadLogo() {
    const r = await global.CM.openImage();
    if (r.canceled) return;
    if (r.error) { toast(r.error, 'err'); return; }
    try {
      const small = await compressLogo(r.dataUrl, 160);
      St.S.db.meta = St.S.db.meta || {};
      St.S.db.meta.logo = small;
      await St.save();
      applyLogo();
      const clearBtn = $('#btnLogoClear');
      if (clearBtn) clearBtn.hidden = false;
      toast('Logo 已更新', 'ok');
    } catch (e) { toast('Logo 处理失败：' + e.message, 'err'); }
  }
  $('#btnLogoUpload').onclick = uploadLogo;
  $('#btnLogoClear').onclick = async () => {
    St.S.db.meta = St.S.db.meta || {};
    St.S.db.meta.logo = '';
    await St.save();
    applyLogo();
    $('#btnLogoClear').hidden = true;
    toast('已恢复默认 Logo', 'ok');
  };
  // 侧边栏左上角 Logo 也可点击更换
  const brandLogoEl = $('#brandLogo');
  if (brandLogoEl) brandLogoEl.onclick = uploadLogo;

  $('#btnOpenDataDir').onclick = () => { global.CM.openDataDir(); };
  $('#btnBackup').onclick = async () => {
    const content = JSON.stringify(St.S.db, null, 2);
    const out = await global.CM.saveTextDialog({ defaultName: `班级智管-鸿升周老师备份_${new Date().toISOString().slice(0, 10)}.json`, content, filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
    if (out.canceled) return;
    toast('已备份到 ' + out.path, 'ok', 3600);
  };
  $('#btnRestore').onclick = async () => {
    const r = await global.CM.openTextDialog({ filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
    if (r.canceled) return;
    try {
      const db = JSON.parse(r.content);
      if (!db.students) throw new Error('文件格式不正确');
      St.S.db = db; await St.save(); Sv.ui.seatingDraft = null;
      go('dashboard'); toast('数据已恢复', 'ok');
    } catch (err) { toast('恢复失败：' + err.message, 'err'); }
  };
  $('#btnResetAll').onclick = () => {
    modal('清空所有数据', '<p>将删除所有学生、成绩、分组与积分数据，恢复到初始状态。<br><span class="muted">此操作不可撤销，建议先备份。</span></p>',
      '<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-danger" id="raOk">确认清空</button>',
      {
        onMount: () => {
          $('#raOk').onclick = async () => {
            St.S.db.students = []; St.S.db.grades = []; St.S.db.points.records = [];
            St.S.db.seating = { groupSize: 6, groupCount: 9, mode: 'sbalance', groups: [], pool: [], updatedAt: null };
            await St.save(); Sv.ui.seatingDraft = null; closeModal(); go('dashboard'); toast('已恢复初始状态', 'ok');
          };
        }
      });
  };

  /* ================= 导入向导 ================= */
  const impState = { step: 1, result: null, mode: 'grades', mergeMode: 'replace', preview: [], selected: new Set(), rawText: '' };

  function openImportWizard(mode) {
    impState.mode = mode || 'grades';
    impState.step = 1;
    impState.result = null;
    impState.preview = [];
    impState.rawText = '';
    $('#importMask').classList.add('show');
    renderImportStep();
  }
  function closeImport() { $('#importMask').classList.remove('show'); }
  $('#importClose').onclick = closeImport;
  $('#importMask').onclick = e => { if (e.target === $('#importMask')) closeImport(); };

  function stepsHtml(cur) {
    const labels = impState.mode === 'group'
      ? ['选择分组表', '确认对应', '生成分组']
      : ['选择数据源', '解析确认', '导入完成'];
    return `<div class="steps">${labels.map((l, i) => {
      const n = i + 1;
      const cls = n < cur ? 'done' : n === cur ? 'active' : '';
      return `<div class="step ${cls}"><div class="step-dot">${n < cur ? '✓' : n}</div><div class="step-label">${l}</div></div>${n < labels.length ? '<div class="step-line"></div>' : ''}`;
    }).join('')}</div>`;
  }

  function renderImportStep() {
    const cur = impState.step;
    $('#importBody').innerHTML = stepsHtml(cur) + `<div id="impStepBody"></div>`;
    $('#importFoot').innerHTML = '';
    if (cur === 1) step1();
    else if (cur === 2) step2();
    else step3();
  }

  /* --- 步骤 1：选择数据源 --- */
  function step1() {
    const host = $('#impStepBody');
    if (impState.mode === 'group') {
      host.innerHTML = `
        <div class="muted mb-12" style="line-height:1.8">导入「姓名 + 组号」形式的表格，可直接生成分组。组号列名可为 <b>组号 / 小组 / 组别 / 分组</b>。</div>
        <div class="drop-zone" id="dzFile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>
          <h4>点击选择分组表文件</h4>
          <p>支持 .xlsx / .xls / .csv，也可直接把文件拖到这里</p>
        </div>
        <div class="row mt-12" style="gap:9px"><span class="muted">没有模板？</span><button class="btn btn-sm" id="dlTpl">先下载分组表模板</button></div>`;
      $('#importFoot').innerHTML = `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="nextBtn" disabled>下一步</button>`;
      bindDropZone('#dzFile', () => { const b = $('#nextBtn'); if (b) b.disabled = false; });
      $('#dlTpl').onclick = () => $('#btnSeatTemplate').click();
      $('#nextBtn').onclick = () => { impState.step = 2; renderImportStep(); };
      return;
    }

    host.innerHTML = `
      <div class="row wrap mb-12" style="gap:8px">
        <button class="tab active" data-src-tab="file">📁 文件导入</button>
        <button class="tab" data-src-tab="paste">📋 粘贴表格</button>
        <button class="tab" data-src-tab="roster">📝 纯名单</button>
      </div>
      <div id="srcPane-file">
        <div class="drop-zone" id="dzFile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>
          <h4>点击选择成绩表 / 名单文件</h4>
          <p>支持 .xlsx / .xls / .csv，可一次选择多个文件（多 Sheet 自动合并）<br>
          <b style="color:var(--brand-400)">智能识别表头</b>：姓名、各科得分/校次/班次、总分自动匹配，无需手动整理格式</p>
        </div>
        <div class="row mt-12" style="gap:9px">
          <button class="btn btn-sm" id="useSample">载入示例数据（八4班 52 人）</button>
          <span class="muted" style="font-size:11.5px">没有文件？可先用示例数据体验完整流程</span>
        </div>
      </div>
      <div id="srcPane-paste" class="hidden">
        <div class="muted mb-8" style="line-height:1.75">直接在 Excel / WPS 中框选表格 → Ctrl+C 复制 → 粘贴到下方输入框（支持 Tab 或逗号分隔）</div>
        <textarea class="textarea" id="pasteArea" style="min-height:210px;font-family:var(--mono);font-size:12px" placeholder="姓名&#9;语文&#9;数学&#9;英语&#9;总分
张三&#9;120&#9;135&#9;110&#9;365
李四&#9;115&#9;128&#9;105&#9;348"></textarea>
      </div>
      <div id="srcPane-roster" class="hidden">
        <div class="muted mb-8" style="line-height:1.75">仅导入学生名单（无成绩），每行一个姓名，或用逗号/顿号分隔</div>
        <textarea class="textarea" id="rosterArea" style="min-height:190px;font-family:var(--mono);font-size:12.5px" placeholder="张三&#10;李四&#10;王五
（或）张三,李四,王五"></textarea>
      </div>`;

    $('#importFoot').innerHTML = `<button class="btn" data-close>取消</button><span class="spacer"></span><button class="btn btn-primary" id="nextBtn" disabled>下一步</button>`;

    $$('[data-src-tab]').forEach(b => b.onclick = () => {
      $$('[data-src-tab]').forEach(x => x.classList.toggle('active', x === b));
      ['file', 'paste', 'roster'].forEach(k => $('#srcPane-' + k).classList.toggle('hidden', k !== b.dataset.srcTab));
      impState.srcTab = b.dataset.srcTab;
    });
    impState.srcTab = 'file';

    bindDropZone('#dzFile');
    $('#useSample').onclick = () => loadSample();
    ['#pasteArea', '#rosterArea'].forEach(sel => {
      const t = $(sel);
      if (t) t.oninput = () => { const b = $('#nextBtn'); if (b) b.disabled = !t.value.trim(); };
    });

    $('#nextBtn').onclick = () => {
      const tab = impState.srcTab;
      if (tab === 'paste') {
        const txt = $('#pasteArea').value;
        if (!txt.trim()) return toast('请先粘贴数据', 'warn');
        impState.rawText = txt;
        impState.result = global.Importer.parseText(txt);
      } else if (tab === 'roster') {
        const txt = $('#rosterArea').value;
        const names = txt.split(/[\n,，、\t;；]+/).map(s => s.trim()).filter(Boolean);
        if (!names.length) return toast('请输入姓名', 'warn');
        impState.result = { students: names.map(n => ({ name: n, scores: {}, ranks: {}, total: null })), sheets: [], title: '手动名单', mapping: [] };
      } else {
        if (!impState.result) return toast('请先选择文件', 'warn');
      }
      impState.step = 2; renderImportStep();
    };
  }

  function bindDropZone(sel, cb) {
    const dz = $(sel);
    if (!dz) return;
    const t = dz.querySelector('h4'), p = dz.querySelector('p');
    dz.onclick = async () => {
      const res = await global.CM.openExcel();
      if (res.canceled) return;
      await handleFiles(res.files);
      if (cb) cb();
    };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
    dz.ondragleave = () => dz.classList.remove('dragover');
    dz.ondrop = async e => {
      e.preventDefault(); dz.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) { await handleFileObjects(files); if (cb) cb(); }
    };
  }

  async function handleFiles(paths) {
    loading(true, '正在解析文件…');
    try {
      // 通过 Electron 主进程解析（更可靠）
      const parsed = await global.CM.parseExcel(paths);
      const map = { 语文: '语文', 数学: '数学', 英语: '英语', 物理: '物理', 化学: '化学', 政治: '政治', 历史: '历史', 地理: '地理', 生物: '生物' };
      const students = [];
      const sheets = [];
      let title = '';
      parsed.forEach(r => {
        if (!r.ok) { toast(`「${r.fileName}」解析失败：${r.error}`, 'err', 4000); return; }
        (r.students || []).forEach(s => {
          const scores = {}, ranks = {};
          Object.entries(s.scores || {}).forEach(([k, v]) => { if (map[k]) scores[map[k]] = v; });
          Object.entries(s.ranks || {}).forEach(([k, v]) => { ranks[k === '_school' || k === '_class' ? k : (map[k] || k)] = v; });
          students.push({ name: s.name, sid: s.sid || '', className: s.className || '', scores, ranks, total: s.total == null ? null : s.total, groupNo: '' });
        });
        (r.detected || []).forEach(d => sheets.push({ name: d.sheet, count: d.students.length, file: r.fileName }));
        if (!title && r.examNameGuess) title = r.examNameGuess;
      });
      impState.rawFiles = paths;
      impState.result = { students, sheets, title, mapping: [] };
      loading(false);
    } catch (e) { loading(false); toast('解析失败：' + e.message, 'err'); }
  }

  async function handleFileObjects(files) {
    loading(true, '正在解析文件…');
    try {
      const results = await global.Importer.readFiles(files);
      const failed = results.filter(r => !r.ok);
      failed.forEach(f => toast(`「${f.fileName}」解析失败：${f.error}`, 'err', 4000));
      const merged = global.Importer.mergeResults(results);
      impState.rawFiles = files.map(f => f.name);
      impState.result = merged;
      loading(false);
    } catch (e) { loading(false); toast('解析失败：' + e.message, 'err'); }
  }

  async function loadSample() {
    loading(true, '正在载入示例数据…');
    const raw = SAMPLE_DATA;
    setTimeout(() => { loading(false); }, 120);
    impState.result = { students: raw, sheets: [{ name: '八4班全学科成绩简表', count: raw.length }], title: '八年级第一次月考9.29日', mapping: [] };
    impState.step = 2; renderImportStep();
  }

  /* --- 步骤 2：解析确认 --- */
  function step2() {
    const res = impState.result;
    if (!res || !res.students || !res.students.length) {
      $('#impStepBody').innerHTML = '<div class="empty"><h4>未能识别到有效数据</h4><p>请检查表格是否包含「姓名」列，或尝试改用粘贴方式导入</p></div>';
      $('#importFoot').innerHTML = `<button class="btn" id="back1">返回上一步</button>`;
      $('#back1').onclick = () => { impState.step = 1; renderImportStep(); };
      return;
    }

    const subjs = [];
    res.students.forEach(s => Object.keys(s.scores || {}).forEach(k => { if (!subjs.includes(k)) subjs.push(k); }));
    subjs.sort((a, b) => (St.SUBJECT_ORDER.indexOf(a) + 99) % 99 - (St.SUBJECT_ORDER.indexOf(b) + 99) % 99);

    // 组号列（分组模式）
    const hasGroupCol = res.students.some(s => s.groupNo && String(s.groupNo).trim() !== '');

    if (impState.mode === 'group') {
      const valid = res.students.filter(s => s.groupNo && String(s.groupNo).trim() !== '');
      const nums = [...new Set(valid.map(s => String(s.groupNo).trim()))].sort((a, b) => parseInt(a) - parseInt(b));
      $('#impStepBody').innerHTML = `
        <div class="stat-grid" style="margin-bottom:14px">
          <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${valid.length}</div><div class="stat-lbl">已识别组号的学生</div></div>
          <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${nums.length}</div><div class="stat-lbl">识别到的小组数</div></div>
          <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px;color:var(--warn)">${res.students.length - valid.length}</div><div class="stat-lbl">无组号（将进未分组）</div></div>
          ${impState.dlTpl ? '' : ''}
        </div>
        <div class="table-wrap" style="max-height:300px">
          <table class="data"><thead><tr><th class="num" style="width:44px">#</th><th>姓名</th><th>组号</th><th>学生是否存在</th></tr></thead>
          <tbody>${res.students.slice(0, 200).map((s, i) => {
        const exist = St.mergedStudents().some(x => x.name === s.name);
        return `<tr><td class="idx">${i + 1}</td><td><b>${escapeHTML(s.name)}</b></td>
            <td>${s.groupNo ? `<span class="tag tag-blue">第 ${escapeHTML(String(s.groupNo))} 组</span>` : '<span class="tag tag-gray">无</span>'}</td>
            <td>${exist ? '<span class="tag tag-green">✓ 已存在</span>' : '<span class="tag tag-amber">名单中没有</span>'}</td></tr>`;
      }).join('')}</tbody></table>
        </div>
        ${res.students.length > 200 ? '<div class="muted" style="text-align:center;padding:8px">仅预览前 200 行</div>' : ''}`;
      $('#importFoot').innerHTML = `<button class="btn" id="back1">返回</button><span class="spacer"></span><button class="btn btn-primary" id="doImport">生成分组</button>`;
      $('#back1').onclick = () => { impState.step = 1; renderImportStep(); };
      $('#doImport').onclick = async () => {
        loading(true, '正在生成分组…');
        const r = global.Seating.applyGroupNumbers(valid.map(s => ({ name: s.name, groupNo: s.groupNo })));
        const db = St.S.db;
        db.seating = db.seating || {};
        db.seating.groups = r.groups;
        db.seating.groupCount = r.groups.length;
        db.seating.groupSize = r.groups.length ? Math.max(...r.groups.map(g => g.members.length)) : 0;
        db.seating.pool = r.pool;
        db.seating.updatedAt = new Date().toISOString();
        (db.students || []).forEach(s => {
          const g = r.groups.find(x => x.members.includes(s.id));
          s.group = g ? g.name : '';
        });
        await St.save();
        Sv.ui.seatingDraft = null;
        loading(false);
        impState.step = 3;
        impState.groupResult = r;
        renderImportStep();
      };
      return;
    }

    /* 成绩导入模式 */
    const totalCount = res.students.length;
    const withScore = res.students.filter(s => Object.keys(s.scores || {}).length).length;
    const meta = global.Importer.guessMeta(res.title, (impState.rawFiles || []).join(' '));

    $('#impStepBody').innerHTML = `
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${totalCount}</div><div class="stat-lbl">识别到学生</div></div>
        <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${withScore}</div><div class="stat-lbl">含成绩数据</div></div>
        <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${subjs.length}</div><div class="stat-lbl">识别到学科</div></div>
        <div class="stat" style="padding:12px"><div class="stat-val" style="font-size:20px">${(res.sheets || []).length || 1}</div><div class="stat-lbl">数据表 / 文件</div></div>
      </div>
      <div class="card mb-12" style="background:var(--bg-2)"><div class="card-body" style="padding:13px">
        <div class="muted mb-8" style="font-weight:600;font-size:12px">字段自动映射结果</div>
        <div class="preview-mapping">
          <span class="map-chip"><span class="src">姓名列</span><span class="arw">→</span><span class="dst">姓名 ✓</span></span>
          ${subjs.map(s => `<span class="map-chip"><span class="src">${s}</span><span class="arw">→</span><span class="dst">${s} ✓</span></span>`).join('')}
          ${res.students.some(s => s.total != null) ? '<span class="map-chip"><span class="src">总分/合计</span><span class="arw">→</span><span class="dst">总分 ✓</span></span>' : ''}
          ${subjs.length === 0 ? '<span class="map-chip" style="border-color:var(--warn)"><span class="src">未识别到学科列</span><span class="arw">→</span><span class="dst">仅导入名单</span></span>' : ''}
        </div>
        <div class="row wrap mt-8" style="gap:14px">
          <div class="field" style="flex:1;min-width:180px"><label>考试名称</label><input class="input input-sm" id="impExam" value="${escapeHTML(meta.examName || '')}"></div>
          <div class="field" style="flex:1;min-width:180px"><label>班级名称</label><input class="input input-sm" id="impClass" value="${escapeHTML(meta.className || St.S.db.meta.className || '')}"></div>
        </div>
      </div></div>

      <div class="card mb-12" style="background:var(--bg-2)"><div class="card-body" style="padding:13px">
        <div class="muted mb-8" style="font-weight:600;font-size:12px">导入方式</div>
        <div class="row wrap" style="gap:16px">
          <label class="row" style="gap:7px;cursor:pointer;font-size:13px"><input type="radio" name="mm" value="replace" ${impState.mergeMode === 'replace' ? 'checked' : ''}><span>覆盖导入（清空原数据后导入）</span></label>
          <label class="row" style="gap:7px;cursor:pointer;font-size:13px"><input type="radio" name="mm" value="append" ${impState.mergeMode === 'append' ? 'checked' : ''}><span>追加/更新（同名合并，保留原有）</span></label>
        </div>
      </div></div>

      <div class="table-wrap" style="max-height:320px">
        <table class="data"><thead><tr><th class="num" style="width:44px">#</th><th>姓名</th><th class="num">总分</th>${subjs.slice(0, 8).map(s => `<th class="num">${s}</th>`).join('')}</tr></thead>
        <tbody>${res.students.slice(0, 300).map((s, i) => `<tr>
          <td class="idx">${i + 1}</td>
          <td><b>${escapeHTML(s.name)}</b>${s.sid ? `<span class="muted" style="margin-left:6px;font-size:11px">${escapeHTML(s.sid)}</span>` : ''}</td>
          <td class="num" style="font-weight:700">${s.total == null ? '—' : s.total}</td>
          ${subjs.slice(0, 8).map(sub => `<td class="num muted">${s.scores[sub] == null ? '—' : s.scores[sub]}</td>`).join('')}
        </tr>`).join('')}</tbody></table>
      </div>
      ${totalCount > 300 ? '<div class="muted" style="text-align:center;padding:8px">仅预览前 300 行，导入时包含全部数据</div>' : ''}`;

    $('#importFoot').innerHTML = `<button class="btn" id="back1">返回</button><span class="spacer"></span><button class="btn btn-primary" id="doImport">确认导入 ${totalCount} 名学生</button>`;
    $('#back1').onclick = () => { impState.step = 1; renderImportStep(); };
    $$('input[name="mm"]').forEach(r => r.onchange = () => { impState.mergeMode = r.value; });
    $('#doImport').onclick = async () => {
      loading(true, '正在导入数据…');
      try {
        const db = St.S.db;
        const examName = $('#impExam').value.trim() || '未命名考试';
        const className = $('#impClass').value.trim();

        if (impState.mergeMode === 'replace') { db.students = []; db.grades = []; }

        const byName = {};
        (db.students || []).forEach(s => byName[s.name] = s);
        const gradeRows = [];
        let added = 0, updated = 0;

        res.students.forEach(p => {
          let st = byName[p.name];
          if (st) {
            updated++;
            if (p.sid && !st.sid) st.sid = p.sid;
            st.scores = Object.assign({}, st.scores || {}, p.scores || {});
            st.ranks = Object.assign({}, st.ranks || {}, p.ranks || {});
            if (p.total != null) st.total = p.total;
          } else {
            added++;
            st = { id: St.uid('s'), name: p.name, sid: p.sid || '', gender: p.gender || '', notes: '', group: '', scores: p.scores || {}, ranks: p.ranks || {}, total: p.total == null ? null : p.total };
            if (!db.students) db.students = [];
            db.students.push(st);
            byName[p.name] = st;
          }
          gradeRows.push({ id: st.id, name: st.name, scores: p.scores || {}, ranks: p.ranks || {}, total: p.total == null ? null : p.total });
        });

        db.grades.push({
          id: St.uid('g'), examName, date: new Date().toISOString(),
          subjects: subjs, rows: gradeRows,
          source: (impState.rawFiles || []).slice(0, 3).join('、') || '手动粘贴'
        });
        db.meta = db.meta || {};
        if (className) db.meta.className = className;
        if (examName) db.meta.examName = examName;

        // 重算班次
        const ranked = db.students.filter(s => s.total != null).sort((a, b) => b.total - a.total);
        ranked.forEach((s, i) => { s.ranks = s.ranks || {}; if (s.ranks._class == null) s.ranks._class = i + 1; });

        await St.save();
        Sv.ui.seatingDraft = null;
        loading(false);
        impState.step = 3;
        impState.importResult = { added, updated, total: db.students.length, subjs, examName, className };
        renderImportStep();
      } catch (e) { loading(false); toast('导入失败：' + e.message, 'err'); }
    };
  }

  /* --- 步骤 3：完成 --- */
  function step3() {
    const r = impState.importResult || {};
    const gr = impState.groupResult;
    if (impState.mode === 'group' && gr) {
      $('#impStepBody').innerHTML = `
        <div style="text-align:center;padding:14px 0">
          <div style="width:62px;height:62px;border-radius:50%;background:rgba(16,185,129,.15);display:grid;place-items:center;margin:0 auto 14px">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--ok)" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h3 style="font-size:18px;margin-bottom:7px">分组导入成功</h3>
          <p class="muted">已生成 <b style="color:var(--txt-1)">${gr.groups.length}</b> 个小组，共分配 <b style="color:var(--txt-1)">${gr.groups.reduce((a, g) => a + g.members.length, 0)}</b> 名学生，未分组 ${gr.pool.length} 人。</p>
          ${gr.unknown.length ? `<p class="muted" style="margin-top:9px;color:var(--warn)">有 ${gr.unknown.length} 个姓名在名单中未找到：${gr.unknown.slice(0, 12).map(escapeHTML).join('、')}${gr.unknown.length > 12 ? '…' : ''}</p>` : ''}
        </div>`;
      $('#importFoot').innerHTML = `<button class="btn" data-close>关闭</button><span class="spacer"></span><button class="btn btn-primary" id="goSeat">查看分组结果</button>`;
      $('#goSeat').onclick = () => { closeImport(); go('seating'); };
      return;
    }
    $('#impStepBody').innerHTML = `
      <div style="text-align:center;padding:14px 0">
        <div style="width:62px;height:62px;border-radius:50%;background:rgba(16,185,129,.15);display:grid;place-items:center;margin:0 auto 14px">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--ok)" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <h3 style="font-size:18px;margin-bottom:7px">导入完成</h3>
        <p class="muted" style="line-height:1.9">
          新增 <b style="color:var(--txt-1)">${r.added || 0}</b> 名学生，更新 <b style="color:var(--txt-1)">${r.updated || 0}</b> 名，<br>
          当前班级共 <b style="color:var(--txt-1)">${r.total || 0}</b> 人 · 识别学科 <b style="color:var(--txt-1)">${(r.subjs || []).length}</b> 门<br>
          考试名称：<b style="color:var(--txt-1)">${escapeHTML(r.examName || '')}</b>
        </p>
        <div class="row mt-16" style="gap:9px;justify-content:center">
          <button class="btn btn-primary" id="goGrade">查看成绩分析</button>
          <button class="btn btn-accent" id="goSeat2">立即智能排座</button>
        </div>
      </div>`;
    $('#importFoot').innerHTML = `<button class="btn" data-close>完成</button>`;
    const b1 = $('#goGrade'), b2 = $('#goSeat2');
    if (b1) b1.onclick = () => { closeImport(); go('grades'); };
    if (b2) b2.onclick = () => { closeImport(); go('seating'); setTimeout(() => $('#btnSeatAuto').click(), 300); };
  }

  /* ================= 快捷动作 ================= */
  function quickAction(k) {
    if (k === 'import') openImportWizard('grades');
    else if (k === 'seat') { go('seating'); setTimeout(() => $('#btnSeatAuto').click(), 280); }
    else if (k === 'points') { go('points'); setTimeout(() => showPointDialog([]), 300); }
    else if (k === 'export') { go('grades'); setTimeout(() => $('#btnGradeExportXlsx').click(), 300); }
    else if (k === 'sample') loadSampleAndImport();
  }

  async function loadSampleAndImport() {
    loading(true, '正在载入示例数据…');
    const db = St.S.db;
    db.students = [];
    db.grades = [];
    SAMPLE_DATA.forEach(p => {
      db.students.push({ id: St.uid('s'), name: p.name, sid: p.sid || '', gender: p.gender || '', notes: '', group: '', scores: p.scores, ranks: p.ranks, total: p.total });
    });
    db.grades.push({
      id: St.uid('g'), examName: '八年级第一次月考（9.29）', date: new Date().toISOString(),
      subjects: ['语文', '数学', '英语', '物理', '政治', '历史'],
      rows: db.students.map(s => ({ id: s.id, name: s.name, scores: s.scores, ranks: s.ranks, total: s.total })),
      source: '内置示例数据'
    });
    db.meta.className = '八4班';
    db.meta.examName = '八年级第一次月考（9.29）';
    await St.save();
    Sv.ui.seatingDraft = null;
    loading(false);
    render();
    toast('示例数据已载入：52 名学生 + 6 门学科成绩', 'ok', 3200);
  }

  /* ================= 全局交互 ================= */
  $$('.nav-item').forEach(n => n.onclick = () => go(n.dataset.view));
  $('#btnCollapse').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#btnTheme').onclick = () => {
    const cur = document.body.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    Sv.ui.theme = next;
    render();
  };
  $('#btnQuickImport').onclick = () => openImportWizard('grades');
  $('#btnImportStudents').onclick = () => openImportWizard('grades');
  $('#planCard').onclick = e => { if (!e.target.closest('#machineCode')) go('membership'); };

  // 统一处理 data-close
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) { closeModal(); closeImport(); }
  });

  // ESC 关闭
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeImport(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); openImportWizard('grades'); }
  });

  /* ================= 启动 ================= */
  async function boot() {
    try {
      await St.load();
      await refreshLicense();
      /* 平台适配：macOS 27 启用 Liquid Glass 专属皮肤 */
      try {
        if (global.CM && global.CM.sysInfo) {
          const si = await global.CM.sysInfo();
          const plat = (si && si.platform) || '';
          document.documentElement.dataset.os = plat === 'darwin' ? 'mac' : (plat || 'win');
          if (plat === 'darwin') document.body.classList.add('os-mac');
        }
      } catch (_) { /* 非 Electron 预览环境忽略 */ }
      $('#aboutVersion').textContent = '1.2.0';
      const ac = $('#aboutContact');
      if (ac) ac.textContent = (St.S.db.meta && St.S.db.meta.teacherContact) || '鸿升中学周老师';
      renderAvatar();
      applyLogo();
      if (global.LAN) global.LAN.init();
      go('dashboard');
      const cnt = (St.S.db.students || []).length;
      if (!cnt) {
        setTimeout(() => toast('欢迎使用班级智管-鸿升周老师！点击右上角导入按钮，或先载入示例数据体验', 'info', 5200), 700);
      }
    } catch (e) {
      console.error(e);
      toast('初始化失败：' + e.message, 'err', 6000);
    }
  }

  global.App = { go, render, toast, modal, closeModal, openImportWizard, refreshLicense };
  boot();
})(window);
