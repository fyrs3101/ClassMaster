/* =====================================================================
   charts.js —— 轻量级 SVG 图表引擎（零依赖，适配深色/浅色主题）
   提供：bar / groupedBar / line / pie / donut / radar / hist / sparkline
   ===================================================================== */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const PALETTE = ['#5b83f7', '#8b5cf6', '#22d3ee', '#10b981', '#f59e0b', '#f472b6', '#fb923c', '#38bdf8', '#a3e635', '#ef4444'];

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, opts) {
    const o = opts || {};
    const t = el('text', {
      x, y,
      fill: o.fill || 'var(--txt-2)',
      'font-size': o.size || 11,
      'font-weight': o.weight || 400,
      'text-anchor': o.anchor || 'middle',
      'dominant-baseline': o.baseline || 'middle',
      'font-family': o.mono ? 'var(--mono)' : 'var(--font)'
    }, parent);
    t.textContent = s;
    return t;
  }
  function esc(s) { return String(s == null ? '' : s); }
  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    let m;
    if (n <= 1) m = 1; else if (n <= 2) m = 2; else if (n <= 2.5) m = 2.5;
    else if (n <= 5) m = 5; else m = 10;
    return m * p;
  }

  /** 生成 viewBox 自适应 SVG */
  function newSvg(host, w, h) {
    host.innerHTML = '';
    const svg = el('svg', {
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: 'xMidYMid meet',
      style: `width:100%;height:auto;display:block;overflow:visible`
    }, host);
    return svg;
  }

  /* ---------------- 柱状图（可分组 / 可堆叠） ---------------- */
  function bar(host, data, opts) {
    const o = Object.assign({ width: 660, height: 300, pad: { t: 22, r: 18, b: 46, l: 48 }, colors: PALETTE, showValues: true, rotateLabels: false, maxY: null, format: v => v, radius: 5, grouped: false, target: null }, opts || {});
    const W = o.width, H = o.height, P = o.pad;
    const svg = newSvg(host, W, H);
    const iw = W - P.l - P.r, ih = H - P.t - P.b;

    // 计算数据范围
    let maxV = 0;
    for (const d of data) {
      if (o.grouped) { for (const v of d.values) maxV = Math.max(maxV, v); }
      else maxV = Math.max(maxV, d.value);
    }
    if (o.target != null) maxV = Math.max(maxV, o.target);
    maxV = o.maxY || niceMax(maxV || 1);

    // 网格 + Y 轴
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const y = P.t + ih - (ih * i / ticks);
      el('line', { x1: P.l, y1: y, x2: P.l + iw, y2: y, stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': i === 0 ? '0' : '3 4' }, svg);
      txt(svg, P.l - 8, y, o.format(maxV * i / ticks), { anchor: 'end', size: 10.5, mono: true });
    }

    const n = data.length || 1;
    const slot = iw / n;
    const seriesCount = o.grouped ? (data[0] ? data[0].values.length : 1) : 1;
    const groupW = slot * 0.68;
    const barW = Math.max(4, (groupW - (seriesCount - 1) * 3) / seriesCount);

    data.forEach((d, i) => {
      const cx = P.l + slot * i + slot / 2;
      const vals = o.grouped ? d.values : [d.value];
      const totalW = barW * seriesCount + 3 * (seriesCount - 1);
      vals.forEach((v, si) => {
        const bx = cx - totalW / 2 + si * (barW + 3);
        const bh = Math.max(0, (v / maxV) * ih);
        const by = P.t + ih - bh;
        const color = o.grouped ? (o.colors[si % o.colors.length]) : (d.color || o.colors[i % o.colors.length]);
        const g = el('g', {}, svg);
        el('rect', { x: bx, y: by, width: barW, height: bh, rx: o.radius, fill: color, opacity: .95 }, g);
        // 悬停高亮
        const hit = el('rect', { x: bx - 2, y: P.t, width: barW + 4, height: ih, fill: 'transparent', style: 'cursor:pointer' }, g);
        const tip = el('title', {}, hit); tip.textContent = `${d.label}${o.grouped ? ' · ' + (d.series ? d.series[si] : '') : ''}: ${o.format(v)}`;
        if (o.showValues && barW > 15) {
          txt(g, bx + barW / 2, by - 8, o.format(v), { size: 10.2, weight: 700, fill: 'var(--txt-1)', mono: true });
        }
      });
      // X 轴标签
      if (o.rotateLabels && n > 7) {
        const t = txt(svg, cx, P.t + ih + 14, esc(d.label), { size: 10.5, anchor: 'end' });
        t.setAttribute('transform', `rotate(-38 ${cx} ${P.t + ih + 14})`);
      } else {
        txt(svg, cx, P.t + ih + 15, esc(d.label), { size: 11 });
      }
    });

    // 目标线
    if (o.target != null) {
      const y = P.t + ih - (o.target / maxV) * ih;
      el('line', { x1: P.l, y1: y, x2: P.l + iw, y2: y, stroke: 'var(--warn)', 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }, svg);
      txt(svg, P.l + iw - 3, y - 8, '目标 ' + o.format(o.target), { anchor: 'end', size: 10.5, fill: 'var(--warn)', weight: 600 });
    }
    // 轴
    el('line', { x1: P.l, y1: P.t + ih, x2: P.l + iw, y2: P.t + ih, stroke: 'var(--line-2)', 'stroke-width': 1.2 }, svg);
    return svg;
  }

  /* ---------------- 横向条形图（排名用） ---------------- */
  function hbar(host, data, opts) {
    const o = Object.assign({ width: 660, rowH: 30, pad: { t: 10, r: 62, b: 10, l: 96 }, colors: PALETTE, format: v => v, showRank: true }, opts || {});
    const H = o.pad.t + o.pad.b + data.length * o.rowH;
    const W = o.width;
    const svg = newSvg(host, W, H);
    const iw = W - o.pad.l - o.pad.r;
    const maxV = Math.max(1, ...data.map(d => d.value));

    data.forEach((d, i) => {
      const y = o.pad.t + i * o.rowH;
      const bh = o.rowH - 11;
      const bw = Math.max(2, (d.value / maxV) * iw);
      const color = d.color || o.colors[i % o.colors.length];
      // 行背景
      el('rect', { x: o.pad.l, y: y + 5, width: iw, height: bh, rx: 5, fill: 'var(--bg-3)', opacity: .6 }, svg);
      el('rect', { x: o.pad.l, y: y + 5, width: bw, height: bh, rx: 5, fill: color }, svg);
      // 姓名
      txt(svg, o.pad.l - 9, y + o.rowH / 2, esc(d.label), { anchor: 'end', size: 12, fill: 'var(--txt-0)', weight: 600 });
      // 值
      txt(svg, o.pad.l + bw + 7, y + o.rowH / 2, o.format(d.value), { anchor: 'start', size: 11.5, fill: 'var(--txt-1)', weight: 700, mono: true });
      if (o.showRank) {
        txt(svg, 16, y + o.rowH / 2, '#' + (i + 1), { size: 11, fill: i < 3 ? 'var(--warn)' : 'var(--txt-3)', weight: 700, mono: true });
      }
    });
    return svg;
  }

  /* ---------------- 折线 / 面积图 ---------------- */
  function line(host, data, opts) {
    const o = Object.assign({ width: 660, height: 290, pad: { t: 22, r: 20, b: 42, l: 50 }, colors: PALETTE, area: true, dots: true, format: v => v, smooth: true }, opts || {});
    const W = o.width, H = o.height, P = o.pad;
    const svg = newSvg(host, W, H);
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const series = o.series || [{ name: 'value', key: 'value', color: o.colors[0] }];
    let maxV = 0, minV = Infinity;
    for (const d of data) for (const s of series) { const v = d[s.key]; if (v != null) { maxV = Math.max(maxV, v); minV = Math.min(minV, v); } }
    if (!isFinite(minV)) minV = 0;
    const base = o.zeroBase === false ? minV - (maxV - minV) * 0.15 : 0;
    maxV = niceMax(maxV || 1);

    for (let i = 0; i <= 5; i++) {
      const y = P.t + ih - (ih * i / 5);
      el('line', { x1: P.l, y1: y, x2: P.l + iw, y2: y, stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': i === 0 ? '0' : '3 4' }, svg);
      txt(svg, P.l - 8, y, o.format(base + (maxV - base) * i / 5), { anchor: 'end', size: 10.5, mono: true });
    }

    const n = data.length;
    const xs = i => n === 1 ? P.l + iw / 2 : P.l + (iw * i / (n - 1));
    const ys = v => P.t + ih - ((v - base) / (maxV - base)) * ih;

    series.forEach((s) => {
      const pts = data.map((d, i) => ({ x: xs(i), y: ys(d[s.key] == null ? base : d[s.key]), v: d[s.key] }));
      const valid = pts.filter(p => p.v != null);
      if (!valid.length) return;
      let dpath = `M ${valid[0].x} ${valid[0].y}`;
      for (let i = 1; i < valid.length; i++) {
        if (o.smooth && i > 0 && i < valid.length) {
          const p0 = valid[i - 1], p1 = valid[i];
          const cx1 = p0.x + (p1.x - p0.x) * 0.42, cx2 = p0.x + (p1.x - p0.x) * 0.58;
          dpath += ` C ${cx1} ${p0.y}, ${cx2} ${p1.y}, ${p1.x} ${p1.y}`;
        } else dpath += ` L ${valid[i].x} ${valid[i].y}`;
      }
      if (o.area) {
        const gid = 'lg' + Math.random().toString(36).slice(2, 8);
        const defs = el('defs', {}, svg);
        const grad = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
        el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': .34 }, grad);
        el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': .02 }, grad);
        el('path', { d: `${dpath} L ${valid[valid.length - 1].x} ${P.t + ih} L ${valid[0].x} ${P.t + ih} Z`, fill: `url(#${gid})` }, svg);
      }
      el('path', { d: dpath, fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      if (o.dots) valid.forEach(p => {
        const g = el('g', {}, svg);
        el('circle', { cx: p.x, cy: p.y, r: 3.6, fill: 'var(--bg-1)', stroke: s.color, 'stroke-width': 2.2 }, g);
        const hit = el('circle', { cx: p.x, cy: p.y, r: 11, fill: 'transparent', style: 'cursor:pointer' }, g);
        const tip = el('title', {}, hit); tip.textContent = `${o.format(p.v)}`;
      });
    });

    // X 标签
    data.forEach((d, i) => {
      if (n > 10 && i % Math.ceil(n / 10) !== 0) return;
      txt(svg, xs(i), P.t + ih + 15, esc(d.label), { size: 10.5 });
    });
    el('line', { x1: P.l, y1: P.t + ih, x2: P.l + iw, y2: P.t + ih, stroke: 'var(--line-2)', 'stroke-width': 1.2 }, svg);
    return svg;
  }

  /* ---------------- 环形图 / 饼图 ---------------- */
  function donut(host, data, opts) {
    const o = Object.assign({ width: 300, height: 260, colors: PALETTE, inner: 0.6, format: v => v, centerLabel: '总计' }, opts || {});
    const W = o.width, H = o.height;
    const svg = newSvg(host, W, H);
    const cx = W / 2, cy = H / 2 - 6, R = Math.min(W, H) / 2 - 16, r = R * o.inner;
    const total = data.reduce((a, b) => a + b.value, 0) || 1;
    let ang = -Math.PI / 2;

    data.forEach((d, i) => {
      const frac = d.value / total;
      const a2 = ang + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const color = d.color || o.colors[i % o.colors.length];
      const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      const x3 = cx + r * Math.cos(a2), y3 = cy + r * Math.sin(a2);
      const x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
      const g = el('g', {}, svg);
      if (frac >= 0.9999) {
        el('circle', { cx, cy, r: (R + r) / 2, fill: 'none', stroke: color, 'stroke-width': R - r }, g);
      } else {
        el('path', {
          d: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`,
          fill: color, style: 'cursor:pointer', stroke: 'var(--bg-1)', 'stroke-width': 1.5
        }, g);
      }
      const tip = el('title', {}, g); tip.textContent = `${d.label}: ${o.format(d.value)} (${(frac * 100).toFixed(1)}%)`;
      // 引导标签
      if (frac > 0.045) {
        const mid = (ang + a2) / 2;
        const lx = cx + (R * 0.76) * Math.cos(mid), ly = cy + (R * 0.76) * Math.sin(mid);
        txt(svg, lx, ly, (frac * 100).toFixed(0) + '%', { size: 10.5, weight: 700, fill: '#fff' });
      }
      ang = a2;
    });

    txt(svg, cx, cy - 6, o.totalLabel != null ? o.totalLabel : total, { size: 24, weight: 800, fill: 'var(--txt-0)', mono: true });
    txt(svg, cx, cy + 15, o.centerLabel, { size: 11, fill: 'var(--txt-3)' });

    // 图例
    const ly0 = H - 12;
    const perRow = Math.min(5, data.length);
    const colW = W / perRow;
    data.forEach((d, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const lx = col * colW + 6, ly = ly0 - (Math.floor(data.length / perRow) - row) * 16;
      el('rect', { x: lx, y: ly - 4.5, width: 9, height: 9, rx: 2.5, fill: d.color || o.colors[i % o.colors.length] }, svg);
      txt(svg, lx + 13, ly, `${esc(d.label)} ${d.value}`, { anchor: 'start', size: 10.2 });
    });
    return svg;
  }

  /* ---------------- 雷达图 ---------------- */
  function radar(host, data, opts) {
    const o = Object.assign({ width: 380, height: 340, colors: PALETTE, max: 100, format: v => v.toFixed(1) }, opts || {});
    const W = o.width, H = o.height;
    const svg = newSvg(host, W, H);
    const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 46;
    const axes = data.length; // data: [{label, value}]
    if (!axes) return svg;
    const angleOf = i => -Math.PI / 2 + (Math.PI * 2 * i) / axes;

    // 同心网格
    [0.25, 0.5, 0.75, 1].forEach(f => {
      const pts = [];
      for (let i = 0; i < axes; i++) { const a = angleOf(i); pts.push(`${cx + R * f * Math.cos(a)},${cy + R * f * Math.sin(a)}`); }
      el('polygon', { points: pts.join(' '), fill: 'none', stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': f === 1 ? '0' : '3 3' }, svg);
    });
    // 轴线 + 标签
    for (let i = 0; i < axes; i++) {
      const a = angleOf(i);
      el('line', { x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a), stroke: 'var(--line)', 'stroke-width': 1 }, svg);
      const lx = cx + (R + 22) * Math.cos(a), ly = cy + (R + 22) * Math.sin(a);
      txt(svg, lx, ly, esc(data[i].label), { size: 11, weight: 600, fill: 'var(--txt-1)' });
      txt(svg, lx, ly + 12, o.format(data[i].value), { size: 9.8, fill: 'var(--txt-3)', mono: true });
    }
    // 数据面
    const pts = data.map((d, i) => {
      const a = angleOf(i);
      const f = Math.max(0, Math.min(1, d.value / o.max));
      return { x: cx + R * f * Math.cos(a), y: cy + R * f * Math.sin(a) };
    });
    el('polygon', {
      points: pts.map(p => `${p.x},${p.y}`).join(' '),
      fill: o.colors[0], 'fill-opacity': .24,
      stroke: o.colors[0], 'stroke-width': 2.2, 'stroke-linejoin': 'round'
    }, svg);
    pts.forEach((p, i) => {
      const g = el('g', {}, svg);
      el('circle', { cx: p.x, cy: p.y, r: 3.6, fill: o.colors[0], stroke: 'var(--bg-1)', 'stroke-width': 1.8 }, g);
      const tip = el('title', {}, g); tip.textContent = `${data[i].label}: ${o.format(data[i].value)}`;
    });
    return svg;
  }

  /* ---------------- 直方图（分数段） ---------------- */
  function hist(host, buckets, opts) {
    return bar(host, buckets.map(b => ({ label: b.label, value: b.count, color: b.color })), Object.assign({
      height: 300, showValues: true, radius: 6
    }, opts || {}));
  }

  /* ---------------- 迷你趋势线 ---------------- */
  function sparkline(host, values, opts) {
    const o = Object.assign({ width: 130, height: 34, color: '#5b83f7' }, opts || {});
    const W = o.width, H = o.height;
    const svg = newSvg(host, W, H);
    if (!values || values.length < 2) return svg;
    const mx = Math.max(...values), mn = Math.min(...values), rng = (mx - mn) || 1;
    const pts = values.map((v, i) => `${(W * i / (values.length - 1)).toFixed(1)},${(H - 4 - ((v - mn) / rng) * (H - 8)).toFixed(1)}`);
    el('polyline', { points: pts.join(' '), fill: 'none', stroke: o.color, 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    const last = pts[pts.length - 1].split(',');
    el('circle', { cx: last[0], cy: last[1], r: 2.6, fill: o.color }, svg);
    return svg;
  }

  global.Charts = { bar, hbar, line, donut, radar, hist, sparkline, PALETTE, niceMax };
})(window);
