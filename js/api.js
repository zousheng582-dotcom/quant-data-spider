/* 本地 API 封装：适配 GitHub Pages 静态网页，无后端时读取本地data.json行情文件 */
const API = (() => {
  let TOKEN = localStorage.getItem("qb_token") || "";
  // 静态网页强制离线模式，无法连接后端服务
  let MODE = "offline";

  function setMode(m) {
    MODE = "offline";
    localStorage.setItem("qb_mode", MODE);
  }
  function getMode() { return MODE; }
  function isOffline() { return true; }

  function setToken(t) {
    TOKEN = t || "";
    if (t) localStorage.setItem("qb_token", t);
    else localStorage.removeItem("qb_token");
  }
  function getToken() { return TOKEN; }

  // 静态网页全局读取根目录data.json行情数据缓存
  let localStockData = null;
  // 加载本地data.json行情文件
  async function loadLocalJsonData() {
    if (localStockData) return localStockData;
    try {
      const res = await fetch("./data.json");
      if (!res.ok) throw new Error("未找到data.json数据文件");
      localStockData = await res.json();
      return localStockData;
    } catch (err) {
      console.error("读取本地行情JSON失败：", err);
      // 兜底空数组，防止解析报错
      localStockData = [];
      return [];
    }
  }

  // 原有后端请求函数：静态环境直接禁用，全部抛出兼容提示
  async function req(path, opts = {}) {
    // GitHub Pages纯静态环境，无后端API服务，直接拒绝接口请求
    throw new Error("线上静态站点不支持后端接口访问，仅可查看本地行情K线数据");
  }

  const api = {
    setToken, getToken,
    setMode, getMode, isOffline,

    // 服务端模式接口 静态环境空实现
    getModeServer: () => Promise.resolve({ offline: true }),
    setModeServer: () => Promise.resolve({ success: true }),

    // ---- 鉴权登录：本地存储密码，不走后端校验 ----
    authStatus: () => Promise.resolve({ login: !!TOKEN }),
    login: (pwd) => {
      // 密码本地存储校验，无后端
      const savePwd = localStorage.getItem("qb_pwd") || "";
      if (savePwd && savePwd !== pwd) throw new Error("密码错误");
      setToken("local_login");
      return Promise.resolve({ success: true });
    },
    logout: () => {
      setToken("");
      return Promise.resolve({ success: true });
    },
    setPassword: (pwd) => {
      localStorage.setItem("qb_pwd", pwd || "");
      return Promise.resolve({ success: true });
    },

    // ---- 布局存储：本地LocalStorage持久化 ----
    layouts: () => Promise.resolve(JSON.parse(localStorage.getItem("qb_layouts") || "[]")),
    saveLayout: (p) => {
      let list = JSON.parse(localStorage.getItem("qb_layouts") || "[]");
      list.push(p);
      localStorage.setItem("qb_layouts", JSON.stringify(list));
      return Promise.resolve(p);
    },
    getLayout: (id) => {
      let list = JSON.parse(localStorage.getItem("qb_layouts") || "[]");
      return Promise.resolve(list.find(item => item.id === id) || null);
    },
    delLayout: (id) => {
      let list = JSON.parse(localStorage.getItem("qb_layouts") || "[]");
      list = list.filter(item => item.id !== id);
      localStorage.setItem("qb_layouts", JSON.stringify(list));
      return Promise.resolve({ success: true });
    },

    // ---- 预警消息 本地存储 ----
    alerts: (limit, unread) => Promise.resolve(JSON.parse(localStorage.getItem("qb_alerts") || "[]")),
    markAlertsRead: () => Promise.resolve({ success: true }),

    // ---- 导出链接仅做展示，静态无法生成文件 ----
    exportPositions: (fmt) => "#",
    exportBacktests: (fmt) => "#",

    // ---- 系统状态 ----
    status: () => Promise.resolve({ running: false, env: "static_pages" }),

    // 账户资产：静态默认模拟空账户数据
    account: () => Promise.resolve({
      equity: 100000, totalProfit: 0, maxDrawdown: 0, dayProfit: 0
    }),

    // 股票列表 & K线：读取data.json本地行情数据（核心修复点）
    universe: () => loadLocalJsonData(),
    importFull: () => Promise.resolve({ success: true }),
    kline: async (code) => {
      const data = await loadLocalJsonData();
      // 返回全部日线K线数据
      return Promise.resolve(data);
    },
    quote: () => Promise.resolve([]),

    // 以下回测、持仓、AI、风控、同步等后端专属功能，静态网页全部兜底空返回
    sync: () => Promise.resolve({}),
    syncOne: () => Promise.resolve({}),
    importCsv: () => Promise.resolve({}),
    clean: () => Promise.resolve({}),
    backtest: () => Promise.resolve({}),
    backtestGrid: () => Promise.resolve({}),
    backtestAsync: () => Promise.resolve({}),
    backtestJob: () => Promise.resolve({}),
    backtests: () => Promise.resolve([]),
    strategies: () => Promise.resolve([]),
    saveStrategy: () => Promise.resolve({}),
    delStrategy: () => Promise.resolve({}),
    getStrategy: () => Promise.resolve({}),
    positions: () => Promise.resolve([]),
    savePosition: () => Promise.resolve({}),
    orders: () => Promise.resolve([]),
    submitOrder: () => Promise.resolve({}),
    cancelOrder: () => Promise.resolve({}),
    vwap: () => Promise.resolve({}),
    riskRules: () => Promise.resolve([]),
    addRisk: () => Promise.resolve({}),
    delRisk: () => Promise.resolve({}),
    updateRisk: () => Promise.resolve({}),
    riskEvaluate: () => Promise.resolve({}),
    riskPanel: () => Promise.resolve({}),
    watch: () => Promise.resolve([]),
    addWatch: () => Promise.resolve({}),
    aiScreen: () => Promise.resolve({}),
    aiDiagnose: () => Promise.resolve({}),
    aiGenStrategy: () => Promise.resolve({}),
    aiGenRisk: () => Promise.resolve({}),
    aiGenReview: () => Promise.resolve({}),
    aiGenPlan: () => Promise.resolve({}),
    backup: () => Promise.resolve({}),
    createBackup: () => Promise.resolve({}),
    cost: () => Promise.resolve({}),
    saveCost: () => Promise.resolve({}),
    brokerStatus: () => Promise.resolve({}),
    brokerSync: () => Promise.resolve({}),
    panelEtf: () => Promise.resolve([]),
    panelCb: () => Promise.resolve([]),
  };
  return api;
})();

/* 通用工具函数 完全保留原样无需修改 */
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
