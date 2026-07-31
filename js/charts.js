/* 轻量 Canvas 图表库：零依赖，适配高分屏，符合涨红跌绿配色。*/
const Charts = (() => {
  const C = {
    up: "#e23b3b", down: "#16a34a", line: "#2f6df0",
    grid: "#e9eef5", text: "#8a97a8", axis: "#c4ccd8",
    band: "rgba(47,109,240,.08)", fill: "rgba(47,109,240,.14)",
  };
  function setup(canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const hh = h || canvas.clientHeight || 220;
    canvas.width = w * dpr; canvas.height = hh * dpr;
    canvas.style.height = hh + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    return { ctx, w, h: hh };
  }

  // 折线/面积图 series: [[x, y], ...] 或 {x:[], y:[]}
  function line(canvas, series, opts = {}) {
    const { ctx, w, h } = setup(canvas, opts.h);
    const pad = { l: 52, r: 12, t: 12, b: 22 };
    const pts = series.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (opts.baseline !== undefined) { min = Math.min(min, opts.baseline); max = Math.max(max, opts.baseline); }
    if (min === max) { min -= 1; max += 1; }
    const padV = (max - min) * 0.08; min -= padV; max += padV;
    const X = (i) => pad.l + (xs.length === 1 ? 0 : (i / (xs.length - 1)) * (w - pad.l - pad.r));
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    // 网格 + Y 轴标签
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.font = "10px sans-serif"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4);
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(opts.fmtY ? opts.fmtY(v) : v.toFixed(0), 4, y + 3);
    }
    // 基线
    if (opts.baseline !== undefined) {
      ctx.strokeStyle = C.axis; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(pad.l, Y(opts.baseline)); ctx.lineTo(w - pad.r, Y(opts.baseline)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 面积
    const col = opts.color || C.line;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(X(pts.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath();
    const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    g.addColorStop(0, opts.fill || C.fill); g.addColorStop(1, "rgba(47,109,240,0)");
    ctx.fillStyle = g; ctx.fill();
    // 线
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // X 轴标签（稀疏）
    const step = Math.ceil(xs.length / 6);
    ctx.fillStyle = C.text;
    xs.forEach((xv, i) => { if (i % step === 0 || i === xs.length - 1) ctx.fillText(String(xv), X(i) - 14, h - 6); });
  }

  // 柱状图 data: [{label, value, color?}]
  function bars(canvas, data, opts = {}) {
    const { ctx, w, h } = setup(canvas, opts.h);
    const pad = { l: 46, r: 10, t: 12, b: 22 };
    if (!data.length) return;
    const vals = data.map((d) => d.value);
    let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
    if (min === max) max = min + 1;
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    ctx.strokeStyle = C.grid; ctx.font = "10px sans-serif"; ctx.fillStyle = C.text; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4); const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText((v * 100).toFixed(0) + "%", 2, y + 3);
    }
    const n = data.length;
    const bw = (w - pad.l - pad.r) / n * 0.6;
    const gap = (w - pad.l - pad.r) / n;
    const baseY = Y(0);
    data.forEach((d, i) => {
      const x = pad.l + gap * i + (gap - bw) / 2;
      const y = Y(d.value);
      ctx.fillStyle = d.color || (d.value >= 0 ? C.up : C.down);
      const top = d.value >= 0 ? y : baseY;
      const bh = Math.abs(y - baseY);
      ctx.fillRect(x, top, bw, Math.max(bh, 0.5));
      if (i % Math.ceil(n / 8) === 0 || i === n - 1)
        ctx.fillStyle = C.text, ctx.fillText(String(d.label), x - 4, h - 6);
    });
  }

  // 环形饼图 data: [{label, value}]  value 已为占比(0-1)
  function pie(canvas, data, opts = {}) {
    const { ctx, w, h } = setup(canvas, opts.h || 220);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 18;
    const palette = ["#2f6df0", "#16a34a", "#e23b3b", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b", "#84cc16", "#f97316"];
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let a0 = -Math.PI / 2;
    data.forEach((d, i) => {
      const a1 = a0 + (d.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
      ctx.fillStyle = palette[i % palette.length]; ctx.fill();
      a0 = a1;
    });
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    // 图例
    ctx.font = "11px sans-serif"; ctx.textBaseline = "middle";
    const lx = cx + r + 6 > w ? 6 : cx + r + 6;
    let ly = cy - data.length * 9;
    data.forEach((d, i) => {
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(lx, ly, 10, 10);
      ctx.fillStyle = C.text;
      ctx.fillText(`${d.label} ${(d.value * 100).toFixed(1)}%`, lx + 14, ly + 5);
      ly += 18;
    });
  }

  // K线图 bars: [{date,open,high,low,close}]  （绘制最近 N 根）
  function kline(canvas, bars, opts = {}) {
    const { ctx, w, h } = setup(canvas, opts.h || 280);
    const pad = { l: 50, r: 12, t: 10, b: 20 };
    const N = Math.min(bars.length, opts.n || 120);
    const data = bars.slice(-N);
    if (!data.length) return;
    const highs = data.map((b) => b.high), lows = data.map((b) => b.low);
    let min = Math.min(...lows), max = Math.max(...highs);
    const padv = (max - min) * 0.06; min -= padv; max += padv;
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.font = "10px sans-serif"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4); const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(v.toFixed(2), 2, y + 3);
    }
    const cw = (w - pad.l - pad.r) / N;
    data.forEach((b, i) => {
      const x = pad.l + cw * i + cw / 2;
      const up = b.close >= b.open;
      ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(b.high)); ctx.lineTo(x, Y(b.low)); ctx.stroke();
      const yo = Y(b.open), yc = Y(b.close);
      const top = Math.min(yo, yc), bh = Math.max(Math.abs(yo - yc), 1);
      ctx.fillRect(x - cw * 0.32, top, cw * 0.64, bh);
    });
    const step = Math.ceil(N / 6);
    data.forEach((b, i) => { if (i % step === 0 || i === N - 1) ctx.fillText(b.date.slice(5), pad.l + cw * i, h - 6); });
  }

  function spark(canvas, vals, opts = {}) {
    const { ctx, w, h } = setup(canvas, opts.h || 36);
    if (!vals.length) return;
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const X = (i) => (vals.length === 1 ? 0 : (i / (vals.length - 1)) * w);
    const Y = (v) => h - ((v - min) / (max - min)) * (h - 4) - 2;
    ctx.beginPath(); ctx.strokeStyle = opts.color || C.line; ctx.lineWidth = 1.4;
    vals.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.stroke();
  }

  // 主题联动：由 app.js 在主题/配色变化时调用，动态覆盖颜色
  function setTheme(t) {
    if (!t) return;
    Object.assign(C, t);
  }
  return { line, bars, pie, kline, spark, setTheme };
})();
