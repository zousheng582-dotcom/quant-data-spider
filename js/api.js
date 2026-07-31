/* 本地 API 封装：所有请求发往同源 127.0.0.1:8765，绝不跨域到云端。*/
const API = (() => {
  let TOKEN = localStorage.getItem("qb_token") || "";
  // 在线/离线模式：离线优先。前端一键切换并持久化；服务端也会按其自身开关做最终裁决。
  let MODE = localStorage.getItem("qb_mode") || "offline";  // 'offline' | 'online'

  function setMode(m) {
    MODE = m === "online" ? "online" : "offline";
    localStorage.setItem("qb_mode", MODE);
  }
  function getMode() { return MODE; }
  function isOffline() { return MODE === "offline"; }

  function setToken(t) {
    TOKEN = t || "";
    if (t) localStorage.setItem("qb_token", t);
    else localStorage.removeItem("qb_token");
  }
  function getToken() { return TOKEN; }

  async function req(path, opts = {}) {
    const method = opts.method || (opts.body ? "POST" : "GET");
    const headers = { "Content-Type": "application/json" };
    if (TOKEN) headers["X-Token"] = TOKEN;
    let r;
    try {
      r = await fetch(path, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      if (location.protocol === "file:") {
        throw new Error("请通过启动脚本打开本程序，不要直接双击 index.html（file:// 方式无法连接本地服务）");
      }
      throw new Error("无法连接后端服务：请确认服务已启动（本机运行 start.bat / 服务器已部署），再刷新本页");
    }
    if (r.status === 401) {
      // 登录态失效，清除 token 并提示重新登录
      setToken("");
      const ev = new CustomEvent("qb-unauthorized");
      window.dispatchEvent(ev);
      throw new Error("登录已失效，请重新登录");
    }
    const data = await r.json().catch(() => ({ error: "JSON解析失败" }));
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  const api = {
    setToken, getToken,
    setMode, getMode, isOffline,
    getModeServer: () => req("/api/settings/mode"),
    setModeServer: (off) => req("/api/settings/mode", { body: { offline: !!off } }),
    // ---- 鉴权 ----
    authStatus: () => req("/api/auth/status"),
    login: (pwd) => req("/api/auth/login", { body: { password: pwd } }),
    logout: () => req("/api/auth/logout", { method: "POST" }),
    setPassword: (pwd) => req("/api/auth/set_password", { body: { password: pwd } }),
    // ---- 布局方案 ----
    layouts: () => req("/api/layout"),
    saveLayout: (p) => req("/api/layout", { body: p }),
    getLayout: (id) => req("/api/layout/" + id),
    delLayout: (id) => req("/api/layout/" + id, { method: "DELETE" }),
    // ---- 预警事件 ----
    alerts: (limit, unread) => req("/api/alerts?limit=" + (limit || 100) + "&unread=" + (unread || 0)),
    markAlertsRead: () => req("/api/alerts/read", { method: "POST" }),
    // ---- 导出 ----
    exportPositions: (fmt) => "/api/export/positions?fmt=" + (fmt || "xlsx"),
    exportBacktests: (fmt) => "/api/export/backtests?fmt=" + (fmt || "xlsx"),

    // ---- 原有业务接口 ----
    status: () => req("/api/status"),
    // 离线模式默认不走实时行情（live=false），避免受限网络下首屏/轮询挂起；
    // 在线模式且调用方显式要求 live 时才拉外部报价。
    account: (live) => req("/api/account" + ((live === false || isOffline()) ? "?live=0" : "")),
    universe: (q) => req("/api/universe" + (q ? "?q=" + encodeURIComponent(q) : "")),
    importFull: () => req("/api/universe/import_full", { method: "POST" }),
    kline: (code, adj) => req("/api/kline?code=" + code + "&adj=" + (adj || "qfq")),
    quote: (codes) => req("/api/quote?codes=" + codes.join(",")),
    sync: (payload) => req("/api/sync", { body: payload }),
    syncOne: (code) => req("/api/sync/one", { body: { code } }),
    importCsv: (text, adj) => req("/api/import_csv", { body: { text, adj } }),
    clean: (code) => req("/api/clean?code=" + code),
    backtest: (spec) => req("/api/backtest", { body: spec }),
    backtestGrid: (spec) => req("/api/backtest/grid", { body: spec }),
    backtestAsync: (spec) => req("/api/backtest/async", { body: spec }),
    backtestJob: (id) => req("/api/backtest/job/" + id),
    backtests: () => req("/api/backtests"),
    strategies: () => req("/api/strategies"),
    saveStrategy: (p) => req("/api/strategies", { body: p }),
    delStrategy: (id) => req("/api/strategy/" + id, { method: "DELETE" }),
    getStrategy: (id) => req("/api/strategy/" + id),
    positions: () => req("/api/positions"),
    savePosition: (p) => req("/api/positions", { body: p }),
    orders: (env) => req("/api/orders?env=" + (env || "paper")),
    submitOrder: (p) => req("/api/orders/submit", { body: p }),
    cancelOrder: (id) => req("/api/orders/cancel", { body: { order_id: id } }),
    vwap: (p) => req("/api/orders/vwap", { body: p }),
    riskRules: () => req("/api/risk/rules"),
    addRisk: (p) => req("/api/risk/rules", { body: p }),
    delRisk: (id) => req("/api/risk/rules", { method: "DELETE", body: { id } }),
    updateRisk: (p) => req("/api/risk/update", { body: p }),
    riskEvaluate: (win) => req("/api/risk/evaluate", { body: { win_rate: win || 0 } }),
    riskPanel: () => req("/api/risk/panel"),
    watch: () => req("/api/watch"),
    addWatch: (p) => req("/api/watch", { body: p }),
    aiScreen: (nl) => req("/api/ai/screen", { body: { nl } }),
    aiDiagnose: (m) => req("/api/ai/diagnose", { body: { metrics: m } }),
    aiGenStrategy: (p) => req("/api/ai/gen_strategy", { body: { params: p } }),
    aiGenRisk: (p) => req("/api/ai/gen_risk", { body: { params: p } }),
    aiGenReview: (m) => req("/api/ai/gen_review", { body: { metrics: m } }),
    aiGenPlan: (m) => req("/api/ai/gen_plan", { body: { context: m } }),
    backup: () => req("/api/backup"),
    createBackup: (tag) => req("/api/backup", { body: { tag } }),
    cost: () => req("/api/settings/cost"),
    saveCost: (c) => req("/api/settings/cost", { body: { cost: c } }),
    brokerStatus: () => req("/api/broker/status"),
    brokerSync: (env) => req("/api/broker/sync", { body: { env } }),
    panelEtf: () => req("/api/panel/etf_rotation"),
    panelCb: () => req("/api/panel/cb_arb"),
  };
  return api;
})();

/* 通用工具函数 */
const U = {
  fmt(n, d = 2) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  pct(n, d = 2) {
    if (n == null || isNaN(n)) return "—";
    return (n * 100).toFixed(d) + "%";
  },
  cls(n) { return n > 0 ? "up" : n < 0 ? "down" : "flat"; },
  sign(n) { return n > 0 ? "+" : ""; },
  money(n) { return "¥" + U.fmt(n, 0); },
  toCSV(rows) {
    return rows.map((r) => r.map((x) => {
      const s = x == null ? "" : String(x);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
  },
  download(filename, content, mime = "text/csv;charset=utf-8") {
    const blob = new Blob(["﻿" + content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  // 打印导出 PDF（调用浏览器打印）
  printPDF(title) {
    const w = window.open("", "_blank");
    w.document.write("<html><head><title>" + title + "</title>");
    w.document.write("<style>body{font-family:'Microsoft YaHei',sans-serif;padding:24px;color:#1f2a37;}" +
      "h2{border-bottom:2px solid #2f6df0;padding-bottom:6px;} table{border-collapse:collapse;width:100%;margin-top:10px;}" +
      "th,td{border:1px solid #d0d7e2;padding:6px 8px;font-size:12px;text-align:left;} " +
      "th{background:#f4f6f9;} .up{color:#e23b3b;} .down{color:#16a34a;} .muted{color:#8a97a8;}</style></head><body>");
    w.document.write(document.getElementById("view").innerHTML);
    w.document.write("</body></html>");
    w.document.close();
    setTimeout(() => w.print(), 400);
  },
};
