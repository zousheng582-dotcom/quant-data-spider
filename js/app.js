/* 本地量化投资交易工作台 —— 前端主逻辑
 * 纯本地：所有数据经同源 /api/* 取，绝不外传。
 * 三布局：盘前投研 / 盘中监控 / 盘后复盘
 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = {
    route: "dashboard",
    layout: "pre",
    universe: [],
    account: null,
    poll: null,
    live: false,
  };

  // ============ 初始化 ============
  async function init() {
    bindUI();
    await Promise.all([refreshTop(), loadUniverse()]);
    setRoute("dashboard");
    startPolling();
  }

  function bindUI() {
    $$(".nav-item").forEach((it) => it.addEventListener("click", () => setRoute(it.dataset.route)));
    $$("#layoutSwitch button").forEach((b) =>
      b.addEventListener("click", () => setLayout(b.dataset.layout)));
    $("#sdClose").addEventListener("click", closeDrawer);
    $("#drawerBackdrop").addEventListener("click", closeDrawer);
    // 全局快捷键
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        if (e.key === "/") e.preventDefault();
        if (e.key === "Escape") e.target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      const map = { d: "dashboard", a: "data", b: "backtest", t: "trade", r: "risk", i: "ai", s: "settings" };
      if (map[k]) setRoute(map[k]);
      if (k === "1") setLayout("pre");
      if (k === "2") setLayout("intraday");
      if (k === "3") setLayout("post");
      if (k === "/") { e.preventDefault(); $("#globalSearch").focus(); }
      if (k === "escape") closeDrawer();
      if (k === "m") toggleMode();
    });

    // 在线/离线切换（不依赖外部网络即可切换，切换后服务端按开关裁决）
    const mb = $("#modeBtn");
    if (mb) mb.addEventListener("click", toggleMode);
    // 全局搜索
    const sIn = $("#globalSearch"), sR = $("#searchResults");
    sIn.addEventListener("input", () => doSearch(sIn.value));
    sIn.addEventListener("focus", () => { if (sIn.value) doSearch(sIn.value); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-box")) sR.classList.remove("show");
    });
  }

  // ============ 顶栏 ============
  async function refreshTop() {
    try {
      // 离线模式首屏不拉实时行情：用本地/合成数据兜底，保证受限网络也能秒开
      const live = !API.isOffline();
      const [st, acc, dbstat] = await Promise.all([API.status(), API.account(live), API.status()]);
      state.live = !!(acc && acc.quotes_live);
      $("#marketStatus").textContent = st.market;
      updateLiveDot();
      $("#dbStat").textContent = "DB " + (dbstat.db ? dbstat.db.db_size_mb + "MB · " +
        (dbstat.db.instrument || 0) + "只" : "—");
      renderMetrics(acc);
      state.account = acc;
    } catch (e) {
      toast("加载账户失败：" + e.message, "danger");
    }
  }

  // 根据前端模式与服务端实时状态，刷新数据源指示灯
  function updateLiveDot() {
    const offline = API.isOffline();
    const dot = $("#liveDot");
    if (!dot) return;
    if (offline) {
      dot.className = "live-dot sim";
      dot.title = "离线模式（本地数据/合成行情，不联网）— 点击切换在线";
    } else {
      dot.className = "live-dot " + (state.live ? "live" : "sim");
      dot.title = state.live ? "实时行情（腾讯财经公开接口）— 点击切换离线"
                             : "在线模式但实时行情不可用（已回退本地/合成）— 点击切换离线";
    }
    // 同步顶栏模式按钮文案
    const mb = $("#modeBtn");
    if (mb) mb.textContent = offline ? "☁ 离线" : "🌐 在线";
  }

  // 在线/离线切换：先切前端模式（立即生效，不阻塞），再异步通知服务端持久化
  async function toggleMode() {
    const next = API.isOffline() ? "online" : "offline";
    API.setMode(next);
    updateLiveDot();
    try {
      await API.setModeServer(next === "offline");
      // 切换后刷新顶栏账户状态（离线则用本地/合成数据）
      refreshTop();
      toast(next === "offline" ? "已切换到离线模式（纯本地，不联网）" : "已切换到在线模式（将尝试拉取实时行情）", "info");
    } catch (e) {
      toast("模式已切换（本地），服务端同步失败：" + e.message, "warn");
    }
  }

  function renderMetrics(acc) {
    if (!acc) return;
    const set = (id, html) => ($("#" + id).innerHTML = html);
    set("m-equity", U.money(acc.equity));
    set("m-total", `<span class="${U.cls(acc.total_pnl)}">${U.sign(acc.total_pnl)}${U.money(acc.total_pnl)}</span>`);
    set("m-mdd", `<span class="down">${U.pct(acc.max_drawdown)}</span>`);
    set("m-day", `<span class="${U.cls(acc.day_pnl)}">${U.sign(acc.day_pnl)}${U.money(acc.day_pnl)}</span>`);
  }

  // ============ 布局 / 路由 ============
  function setLayout(l) {
    state.layout = l;
    document.body.setAttribute("data-layout", l);
    $$("#layoutSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.layout === l));
    if (state.route === "dashboard") renderDashboard();
  }

  function setRoute(r) {
    state.route = r;
    $$(".nav-item").forEach((it) => it.classList.toggle("active", it.dataset.route === r));
    if (r === "dashboard") renderDashboard();
    else if (r === "data") renderData();
    else if (r === "backtest") renderBacktest();
    else if (r === "trade") renderTrade();
    else if (r === "risk") renderRisk();
    else if (r === "ai") renderAI();
    else if (r === "settings") renderSettings();
    $("#view").scrollTop = 0;
  }

  // ============ 仪表盘（三布局） ============
  function renderDashboard() {
    const v = $("#view");
    const titleMap = {
      pre: ["盘前投研布局", "开盘前：检查数据完整性、AI 选股、策略预演、预警规则确认"],
      intraday: ["盘中实盘监控布局", "交易中：持仓浮盈亏、实时报价、订单流、风控事件实时盯盘"],
      post: ["盘后回测复盘布局", "收盘后：回测绩效复盘、报告导出、策略与风控复盘"],
    };
    const [t, d] = titleMap[state.layout];
    v.innerHTML = `
      <div class="page-head">
        <div><div class="page-title">${t}</div><div class="page-desc">${d}</div></div>
        <button class="btn" id="dashRefresh">↻ 刷新</button>
      </div>
      <div class="dash-grid" id="dashGrid"></div>`;
    $("#dashRefresh").addEventListener("click", () => { refreshTop(); renderDashboard(); });
    const panels = {
      pre: ["account", "aiQuick", "btQuick", "watch", "dataSync"],
      intraday: ["account", "positions", "quotes", "riskEvents", "orders"],
      post: ["account", "btLatest", "monthly", "industry", "review"],
    }[state.layout];
    const grid = $("#dashGrid");
    const spanMap = { account: 12, aiQuick: 6, btQuick: 6, watch: 4, dataSync: 4,
      positions: 8, quotes: 4, riskEvents: 6, orders: 6, btLatest: 6, monthly: 6, industry: 4, review: 12 };
    panels.forEach((p) => {
      const card = document.createElement("div");
      card.className = "card span-" + (spanMap[p] || 6);
      card.id = "dash-" + p;
      grid.appendChild(card);
      dashPanel[p](card);
    });
  }

  const dashPanel = {
    account(card) {
      card.innerHTML = `<div class="card-h">账户概览 <span class="sub">实时刷新</span></div>
        <div class="card-b" id="accBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderAccountBody();
    },
    aiQuick(card) {
      card.innerHTML = `<div class="card-h">自然语言选股 <span class="sub">AI 辅助</span></div>
        <div class="card-b">
          <div class="field"><label>输入条件（如：低PE 高股息 银行）</label>
            <input class="inp" id="aiq" placeholder="低PE 高股息 白酒 / MACD金叉 / 小市值"/></div>
          <button class="btn primary" id="aiqRun">筛选</button>
          <button class="btn" id="aiqEx">示例</button>
          <div id="aiqRes" class="section-gap"></div>
        </div>`;
      $("#aiqRun").addEventListener("click", async () => {
        const nl = $("#aiq").value.trim(); if (!nl) return;
        const r = await API.aiScreen(nl);
        $("#aiqRes").innerHTML = `<div class="hint">命中 <b>${r.count}</b> 只 · ${r.reasons.join(" / ")}</div>` +
          `<div class="tbl-wrap"><table class="tbl"><tr><th>代码</th><th>名称</th><th>行业</th><th>理由</th></tr>` +
          r.matched.slice(0, 30).map((m) => `<tr><td class="mono">${m.code}</td><td><a data-code="${m.code}">${escapeHtml(m.name)}</a></td><td>${escapeHtml(m.industry)}</td><td class="muted">${escapeHtml(m.reason)}</td></tr>`).join("") +
          `</table></div>`;
        $$("#aiqRes a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
      });
      $("#aiqEx").addEventListener("click", () => $("#aiq").value = "低PE 高股息 银行");
    },
    btQuick(card) {
      card.innerHTML = `<div class="card-h">策略快捷回测 <span class="sub">均线轮动</span></div>
        <div class="card-b">
          <div class="row">
            <div class="field"><label>策略</label>
              <select class="inp" id="btqType"><option value="ma_cross">均线交叉</option><option value="rotation">动量轮动</option><option value="multifactor">多因子</option></select></div>
            <div class="field"><label>标的(代码逗号)</label><input class="inp" id="btqUniv" value="600519,000858,600036,300750,002594,601318"/></div>
          </div>
          <button class="btn primary" id="btqRun">运行回测</button>
          <div id="btqRes" class="section-gap"></div>
        </div>`;
      $("#btqRun").addEventListener("click", async () => {
        const type = $("#btqType").value, univ = $("#btqUniv").value.split(",").map((s) => s.trim()).filter(Boolean);
        $("#btqRes").innerHTML = `<div class="empty"><span class="spinner"></span> 回测中…</div>`;
        const spec = { strategy_type: type, universe: univ, start: "2020-01-01", end: "2024-12-31",
          params: type === "ma_cross" ? { short: 5, long: 20, topN: 5 } : type === "rotation" ? { mom: 60, topN: 5 } : { topN: 5 } };
        const m = await API.backtest(spec);
        $("#btqRes").innerHTML = metricCards(m);
      });
    },
    watch(card) {
      card.innerHTML = `<div class="card-h">自选股预警 <span class="sub">阈值提醒</span></div>
        <div class="card-b" id="watchBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderWatchBody();
    },
    dataSync(card) {
      card.innerHTML = `<div class="card-h">数据同步 <span class="sub">可溯源</span></div>
        <div class="card-b">
          <div class="hint">行情、基本面落本地 SQLite。右上角实时/模拟角标显示当前报价来源。</div>
          <div class="toolbar"><button class="btn" id="syncAll">增量同步全部</button><button class="btn" id="syncStat">查看统计</button></div>
          <div id="syncMsg" class="hint"></div>
        </div>`;
      $("#syncAll").addEventListener("click", async () => {
        $("#syncMsg").innerHTML = `<span class="spinner"></span> 同步中（网络不可用时自动回落合成数据）…`;
        const s = await API.sync({});
        $("#syncMsg").innerHTML = `完成：成功 ${s.ok} / 合成 ${s.synthetic} / 共 ${s.total}`;
      });
      $("#syncStat").addEventListener("click", () => setRoute("data"));
    },
    positions(card) {
      card.innerHTML = `<div class="card-h">持仓看板 <span class="sub">成本/浮盈/仓位</span></div>
        <div class="card-b" id="posBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderPositionsBody();
    },
    quotes(card) {
      card.innerHTML = `<div class="card-h">实时报价 <span class="sub">持仓标的</span></div>
        <div class="card-b" id="qBody"><div class="empty"><span class="spinner"></span></div></div>`;
      if (state.account) renderQuotesBody(state.account.positions);
    },
    riskEvents(card) {
      card.innerHTML = `<div class="card-h">风控事件 <span class="sub">多层级</span></div>
        <div class="card-b" id="reBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderRiskEvents();
    },
    orders(card) {
      card.innerHTML = `<div class="card-h">订单监控 <span class="sub">成交/撤单</span></div>
        <div class="card-b" id="ordBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderOrdersBody("paper");
    },
    btLatest(card) {
      card.innerHTML = `<div class="card-h">最近回测绩效 <span class="sub">复盘</span></div>
        <div class="card-b" id="btlBody"><div class="empty"><span class="spinner"></span></div></div>`;
      renderBtLatest();
    },
    monthly(card) {
      card.innerHTML = `<div class="card-h">月度收益</div><div class="card-b"><canvas class="chart-canvas" id="mChart"></canvas></div>`;
      API.backtests().then((list) => {
        if (!list.length) { $("#mChart").parentElement.innerHTML = `<div class="empty">暂无回测</div>`; return; }
        const m = list[0].metrics || {};
        const mk = Object.entries(m.monthly || {}).map(([k, v]) => ({ label: k.slice(2), value: v }));
        Charts.bars($("#mChart"), mk);
      });
    },
    industry(card) {
      card.innerHTML = `<div class="card-h">行业分布</div><div class="card-b"><canvas class="chart-canvas" id="iChart"></canvas></div>`;
      API.backtests().then((list) => {
        if (!list.length) { $("#iChart").parentElement.innerHTML = `<div class="empty">暂无回测</div>`; return; }
        const m = list[0].metrics || {};
        const ind = Object.entries(m.industry || {}).map(([k, v]) => ({ label: k, value: v }))
          .sort((a, b) => b.value - a.value).slice(0, 10);
        Charts.pie($("#iChart"), ind);
      });
    },
    review(card) {
      card.innerHTML = `<div class="card-h">复盘文档 <span class="sub">AI 生成</span></div>
        <div class="card-b"><button class="btn" id="rvGen">生成复盘总结</button><div id="rvBody" class="section-gap"></div></div>`;
      $("#rvGen").addEventListener("click", async () => {
        const list = await API.backtests();
        if (!list.length) { $("#rvBody").innerHTML = `<div class="hint">尚无回测记录</div>`; return; }
        const md = await API.aiGenReview(list[0].metrics);
        $("#rvBody").innerHTML = `<pre class="code" style="background:#f7f9fc;color:#1f2a37">${escapeHtml(md)}</pre>` +
          `<button class="btn" id="rvDown">导出 Markdown</button>`;
        $("#rvDown").addEventListener("click", () => U.download("复盘总结.md", md, "text/markdown;charset=utf-8"));
      });
    },
  };

  // 账户面板
  function renderAccountBody() {
    const b = $("#accBody"); if (!b) return;
    if (!state.account) { b.innerHTML = `<div class="empty">—</div>`; return; }
    const a = state.account;
    b.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><span class="k">净值</span><span class="v">${U.money(a.equity)}</span></div>
        <div class="kpi"><span class="k">可用现金</span><span class="v">${U.money(a.cash)}</span></div>
        <div class="kpi"><span class="k">持仓市值</span><span class="v">${U.money(a.market_value)}</span></div>
        <div class="kpi"><span class="k">总盈亏</span><span class="v ${U.cls(a.total_pnl)}">${U.sign(a.total_pnl)}${U.pct(a.total_pnlPct)}</span></div>
        <div class="kpi"><span class="k">当日盈亏</span><span class="v ${U.cls(a.day_pnl)}">${U.sign(a.day_pnl)}${U.money(a.day_pnl)}</span></div>
      </div>`;
  }

  // 持仓面板
  async function renderPositionsBody() {
    const b = $("#posBody"); if (!b) return;
    const acc = await API.account(); state.account = acc;
    if (!acc.positions.length) { b.innerHTML = `<div class="empty">暂无持仓，可在「持仓交易」模块建仓</div>`; return; }
    b.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <tr><th>代码</th><th>名称</th><th>持仓</th><th>成本</th><th>现价</th><th>市值</th><th>浮盈</th><th>仓位</th><th>环境</th></tr>` +
      acc.positions.map((p) => `<tr>
        <td class="mono">${p.code}</td><td><a data-code="${p.code}">${p.name}</a></td>
        <td>${U.fmt(p.shares, 0)}</td><td>${U.fmt(p.cost)}</td><td>${U.fmt(p.price)}</td>
        <td>${U.money(p.mv)}</td>
        <td class="${U.cls(p.pnl)}">${U.sign(p.pnl)}${U.money(p.pnl)}</td>
        <td>${U.pct(p.weight, 1)}</td>
        <td><span class="badge ${p.env}">${p.env === "live" ? "实盘" : "模拟"}</span></td></tr>`).join("") +
      `</table></div>`;
    $$("#posBody a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
  }

  async function renderQuotesBody(pos) {
    const b = $("#qBody"); if (!b || !pos || !pos.length) { if (b) b.innerHTML = `<div class="empty">无持仓</div>`; return; }
    if (API.isOffline()) {
      b.innerHTML = `<div class="empty">离线模式：实时行情已关闭<br/><span class="muted">点顶栏「☁ 离线」切到在线，或按 M 键</span></div>`;
      return;
    }
    try {
      const q = await API.quote(pos.map((p) => p.code));
      b.innerHTML = `<table class="tbl"><tr><th>名称</th><th>现价</th><th>涨跌%</th><th>涨跌额</th></tr>` +
        pos.map((p) => {
          const x = q[p.code] || {}; const c = x.chgPct || 0;
          return `<tr><td><a data-code="${p.code}">${escapeHtml(x.name || p.name)}</a></td>
            <td class="mono ${U.cls(c)}">${U.fmt(x.price)}</td>
            <td class="${U.cls(c)}">${U.sign(c)}${U.fmt(c)}%</td>
            <td class="${U.cls(c)}">${U.sign(x.chg)}${U.fmt(x.chg)}</td></tr>`;
        }).join("") + `</table>`;
      $$("#qBody a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
    } catch (e) { b.innerHTML = `<div class="empty">行情获取失败</div>`; }
  }

  async function renderWatchBody() {
    const b = $("#watchBody"); if (!b) return;
    const w = await API.watch();
    if (!w.length) { b.innerHTML = `<div class="empty">暂无自选，可在搜索或行情页添加</div>`; return; }
    if (API.isOffline()) {
      b.innerHTML = `<div class="empty">离线模式：实时行情已关闭<br/><span class="muted">点顶栏「☁ 离线」切到在线，或按 M 键</span></div>`;
      return;
    }
    try {
      const q = await API.quote(w.map((x) => x.code));
      b.innerHTML = `<table class="tbl"><tr><th>名称</th><th>现价</th><th>涨跌幅</th><th>阈值</th></tr>` +
        w.map((x) => { const c = (q[x.code] || {}).chgPct || 0;
          return `<tr><td><a data-code="${x.code}">${escapeHtml(x.name)}</a></td>
          <td class="mono ${U.cls(c)}">${U.fmt((q[x.code] || {}).price)}</td>
          <td class="${U.cls(c)}">${U.sign(c)}${U.fmt(c)}%</td>
          <td class="muted">↑${(x.threshold_up||0)*100||"—"}% ↓${(x.threshold_down||0)*100||"—"}%</td></tr>`;
        }).join("") + `</table>`;
      $$("#watchBody a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
    } catch (e) { b.innerHTML = `<div class="empty">行情失败</div>`; }
  }

  async function renderRiskEvents() {
    const b = $("#reBody"); if (!b) return;
    try {
      const { events } = await API.riskEvaluate();
      if (!events.length) { b.innerHTML = `<div class="empty">✅ 当前无触发预警</div>`; return; }
      b.innerHTML = events.map((e) => `<div class="pill ${e.level === "account" ? "red" : "warn"}" style="display:block;margin-bottom:6px;padding:6px 10px">
        <b>[${e.level === "account" ? "账户" : e.level === "stock" ? "个股" : e.level === "strategy" ? "策略" : "自选"}]</b> ${e.msg}
        <span class="muted">→ ${e.action === "alert" ? "仅提醒" : e.action === "reduce" ? "减仓" : e.action === "clean" ? "清仓" : e.action === "pause" ? "暂停" : "提醒"}</span></div>`).join("");
    } catch (e) { b.innerHTML = `<div class="empty">评估失败</div>`; }
  }

  async function renderOrdersBody(env) {
    const b = $("#ordBody"); if (!b) return;
    const o = await API.orders(env);
    if (!o.length) { b.innerHTML = `<div class="empty">暂无订单</div>`; return; }
    b.innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>时间</th><th>代码</th><th>方向</th><th>数量</th><th>价格</th><th>状态</th><th>算法</th></tr>` +
      o.slice(0, 40).map((x) => `<tr><td class="muted">${x.ts}</td><td class="mono">${x.code}</td>
        <td class="${x.side === "buy" ? "up" : "down"}">${x.side === "buy" ? "买" : "卖"}</td>
        <td>${U.fmt(x.shares, 0)}</td><td>${U.fmt(x.price)}</td>
        <td><span class="pill ${x.status === "filled" ? "green" : x.status === "canceled" ? "gray" : "warn"}">${x.status}</span></td>
        <td class="muted">${x.algo}</td></tr>`).join("") + `</table></div>`;
  }

  async function renderBtLatest() {
    const b = $("#btlBody"); if (!b) return;
    const list = await API.backtests();
    if (!list.length) { b.innerHTML = `<div class="empty">暂无回测，去「策略回测」运行</div>`; return; }
    const m = list[0].metrics || {};
    b.innerHTML = metricCards(m) + (m.overfit && m.overfit.flag ? `<div class="pill red">⚠ ${m.overfit.reason}</div>` : "");
  }

  function metricCards(m) {
    if (!m || m.annual_return === undefined) return `<div class="empty">无绩效</div>`;
    const k = (label, val, cls) => `<div class="kpi"><span class="k">${label}</span><span class="v ${cls || ""}">${val}</span></div>`;
    return `<div class="kpi-row">
      ${k("年化", U.pct(m.annual_return), U.cls(m.annual_return))}
      ${k("累计", U.pct(m.total_return), U.cls(m.total_return))}
      ${k("最大回撤", U.pct(m.max_drawdown), "down")}
      ${k("夏普", m.sharpe, "")}
      ${k("卡玛", m.calmar, "")}
      ${k("胜率", U.pct(m.win_rate, 1), "")}
      ${k("盈亏比", m.profit_loss_ratio, "")}
      ${k("换手", U.pct(m.turnover, 0), "")}</div>
      <div class="hint" style="margin-top:8px">样本 ${m.universe_size} 只 · ${m.start_date}~${m.end_date} · 交易 ${m.trades} 笔</div>`;
  }

  // ============ 数据中心 ============
  async function renderData() {
    const v = $("#view");
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">数据中心</div>
        <div class="page-desc">本地 SQLite 持久化 · 可溯源 · 支持增量同步与 CSV 导入</div></div></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-h">品种池 <span class="sub" id="uCount"></span></div>
          <div class="card-b">
            <div class="toolbar">
              <input class="inp" id="uSearch" placeholder="搜索代码/名称" style="max-width:200px"/>
              <button class="btn" id="uImport">导入全市场清单(5543)</button>
              <span class="spacer"></span>
              <span class="src-note" id="uNote"></span>
            </div>
            <div class="tbl-wrap" style="max-height:360px"><table class="tbl" id="uTbl">
              <tr><th>代码</th><th>名称</th><th>类型</th><th>行业</th><th>板块</th><th>来源</th></tr></table></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h">行情同步 / 导入</div>
          <div class="card-b">
            <div class="field"><label>增量同步（选填代码，留空同步全部股票/ETF）</label>
              <input class="inp" id="syncCodes" placeholder="如 600519,000858（留空=全部）"/></div>
            <div class="toolbar"><button class="btn primary" id="syncBtn">开始同步</button>
              <span id="syncR" class="hint"></span></div>
            <div class="divider"></div>
            <div class="field"><label>手动导入 CSV（列：code,date,open,high,low,close,volume[,amount]）</label>
              <textarea class="inp" id="csvText" rows="5" placeholder="直接粘贴 CSV 文本…"></textarea></div>
            <div class="toolbar"><button class="btn" id="csvBtn">导入CSV</button><span id="csvR" class="hint"></span></div>
            <div class="divider"></div>
            <div class="field"><label>数据清洗（剔除停牌/异常跳空）</label>
              <div class="toolbar"><input class="inp" id="cleanCode" placeholder="代码" style="max-width:140px"/>
                <button class="btn" id="cleanBtn">执行清洗</button><span id="cleanR" class="hint"></span></div></div>
            <div class="divider"></div>
            <button class="btn" id="dataStat">刷新数据库统计</button>
            <div id="dataStatR" class="hint section-gap"></div>
          </div>
        </div>
      </div>`;
    // 绑定
    let timer;
    $("#uSearch").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => loadUniverseTable(e.target.value), 200); });
    $("#uImport").addEventListener("click", async () => { const r = await API.importFull(); toast("已导入 " + r.imported + " 只", "ok"); loadUniverseTable(); });
    $("#syncBtn").addEventListener("click", async () => {
      const codes = $("#syncCodes").value.split(",").map((s) => s.trim()).filter(Boolean);
      $("#syncR").innerHTML = `<span class="spinner"></span> 同步中…`;
      const s = await API.sync({ codes: codes.length ? codes : undefined });
      $("#syncR").innerHTML = `成功 ${s.ok} / 合成 ${s.synthetic} / 共 ${s.total}`;
    });
    $("#csvBtn").addEventListener("click", async () => {
      const n = await API.importCsv($("#csvText").value, "qfq");
      $("#csvR").textContent = "导入 " + n + " 条";
    });
    $("#cleanBtn").addEventListener("click", async () => {
      const n = await API.clean($("#cleanCode").value.trim());
      $("#cleanR").textContent = "剔除 " + n + " 条";
    });
    $("#dataStat").addEventListener("click", async () => {
      const st = await API.status(); const d = st.db || {};
      $("#dataStatR").innerHTML = Object.entries(d).map(([k, val]) => `<span class="tag">${k}: ${val}</span>`).join(" ");
    });
    await loadUniverseTable();
  }

  async function loadUniverseTable(q) {
    const rows = await API.universe(q || "");
    $("#uCount").textContent = "共 " + rows.length + " 只";
    $("#uNote").textContent = "来源：builtin / universe_js / csv_import";
    const tbl = $("#uTbl");
    tbl.innerHTML = `<tr><th>代码</th><th>名称</th><th>类型</th><th>行业</th><th>板块</th><th>来源</th></tr>` +
      rows.slice(0, 600).map((r) => `<tr><td class="mono">${r.code}</td><td><a data-code="${r.code}">${escapeHtml(r.name)}</a></td>
        <td><span class="tag">${r.itype}</span></td><td>${escapeHtml(r.industry) || "—"}</td><td>${r.board || "—"}</td>
        <td class="muted">${r.source || "—"}</td></tr>`).join("") +
      (rows.length > 600 ? `<tr><td colspan="6" class="muted">…仅显示前600，搜索可精确查找</td></tr>` : "");
    $$("#uTbl a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
  }

  // ============ 策略回测 ============
  async function renderBacktest() {
    const v = $("#view");
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">策略研发 + 回测引擎</div>
        <div class="page-desc">日频事件驱动 · 真实成本模型 · 标准化绩效 · 网格寻优 · 版本管理</div></div>
        <button class="btn" id="btExport">导出最新回测报告</button></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-h">策略配置</div>
          <div class="card-b">
            <div class="row">
              <div class="field"><label>策略类型</label>
                <select class="inp" id="btType">
                  <option value="ma_cross">均线交叉轮动</option>
                  <option value="rotation">动量轮动</option>
                  <option value="multifactor">多因子</option>
                  <option value="custom">自定义(沙箱)</option></select></div>
              <div class="field"><label>名称</label><input class="inp" id="btName" value="策略A"/></div>
            </div>
            <div class="field"><label>标的池（代码逗号分隔）</label>
              <textarea class="inp" id="btUniv" rows="2">600519,000858,600036,300750,002594,601318,000333,600900,601012,002594</textarea></div>
            <div class="row">
              <div class="field"><label>起始日</label><input class="inp" id="btStart" value="2020-01-01"/></div>
              <div class="field"><label>结束日</label><input class="inp" id="btEnd" value="2024-12-31"/></div>
            </div>
            <div class="row" id="btParams"></div>
            <div class="field" id="btCodeWrap" style="display:none"><label>自定义策略代码（handle/init，ctx API）</label>
              <textarea class="inp" id="btCode" rows="8"></textarea></div>
            <div class="toolbar">
              <button class="btn primary" id="btRun">运行回测</button>
              <button class="btn" id="btGrid">参数网格寻优</button>
              <button class="btn" id="btSave">保存策略版本</button>
              <button class="btn" id="btAi">AI生成代码</button>
              <span class="spacer"></span><button class="btn ghost" id="btVers">历史版本</button>
            </div>
            <div id="btMsg" class="hint section-gap"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h">绩效报告 <span class="sub" id="btOver"></span></div>
          <div class="card-b" id="btReport"><div class="empty">运行回测后显示报告</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-h">净值曲线</div>
        <div class="card-b"><canvas class="chart-canvas" id="btCurve" style="height:280px"></canvas></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-h">月度收益</div><div class="card-b"><canvas class="chart-canvas" id="btMonth"></canvas></div></div>
        <div class="card"><div class="card-h">行业持仓分布</div><div class="card-b"><canvas class="chart-canvas" id="btInd"></canvas></div></div>
      </div>`;
    buildBtParams();
    $("#btType").addEventListener("change", () => { buildBtParams(); $("#btCodeWrap").style.display = $("#btType").value === "custom" ? "block" : "none"; });
    $("#btRun").addEventListener("click", runBt);
    $("#btGrid").addEventListener("click", gridBt);
    $("#btSave").addEventListener("click", saveBt);
    $("#btAi").addEventListener("click", aiGenBt);
    $("#btVers").addEventListener("click", showVersions);
    $("#btExport").addEventListener("click", exportBtReport);
  }

  let lastBtMetrics = null;
  function buildBtParams() {
    const t = $("#btType").value, box = $("#btParams"); box.innerHTML = "";
    const add = (id, label, val) => { const d = document.createElement("div"); d.className = "field";
      d.innerHTML = `<label>${label}</label><input class="inp" id="${id}" value="${val}"/>`; box.appendChild(d); };
    if (t === "ma_cross") { add("p_short", "短均线", 5); add("p_long", "长均线", 20); add("p_topN", "持仓数", 10); }
    else if (t === "rotation") { add("p_mom", "动量窗口", 60); add("p_topN", "持仓数", 15); }
    else if (t === "multifactor") { add("p_mom", "因子窗口", 120); add("p_topN", "持仓数", 20); }
  }

  function readBtSpec() {
    const t = $("#btType").value;
    let params = {};
    if (t === "ma_cross") params = { short: +$("#p_short").value, long: +$("#p_long").value, topN: +$("#p_topN").value };
    else if (t === "rotation") params = { mom: +$("#p_mom").value, topN: +$("#p_topN").value };
    else if (t === "multifactor") params = { mom: +$("#p_mom").value, topN: +$("#p_topN").value };
    return {
      strategy_type: t, name: $("#btName").value,
      universe: $("#btUniv").value.split(",").map((s) => s.trim()).filter(Boolean),
      start: $("#btStart").value, end: $("#btEnd").value, params,
      code_text: $("#btCode") ? $("#btCode").value : "",
    };
  }

  async function runBt() {
    $("#btMsg").innerHTML = `<span class="spinner"></span> 回测计算中…`;
    const m = await API.backtest(readBtSpec());
    lastBtMetrics = m;
    $("#btMsg").innerHTML = `完成（已存档回测记录）`;
    $("#btOver").innerHTML = m.overfit && m.overfit.flag ? `<span class="pill red">⚠ 疑似过拟合</span>` : `<span class="pill green">样本内外正常</span>`;
    $("#btReport").innerHTML = metricCards(m);
    drawBtCharts(m);
  }

  function drawBtCharts(m) {
    if (!m || !m.equity) return;
    Charts.line($("#btCurve"), m.equity.map((e) => [e[0], e[1]]), { baseline: m.start_equity, fmtY: (v) => (v / 10000).toFixed(0) + "万" });
    const mk = Object.entries(m.monthly || {}).map(([k, v]) => ({ label: k.slice(2), value: v }));
    Charts.bars($("#btMonth"), mk);
    const ind = Object.entries(m.industry || {}).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 10);
    Charts.pie($("#btInd"), ind);
  }

  async function gridBt() {
    const spec = readBtSpec();
    const t = spec.strategy_type;
    let grid = {};
    if (t === "ma_cross") grid = { short: [3, 5, 10], long: [10, 20, 30, 60] };
    else if (t === "rotation") grid = { mom: [20, 60, 120], topN: [5, 10, 15] };
    else if (t === "multifactor") grid = { mom: [60, 120, 250], topN: [10, 20] };
    else { toast("自定义策略暂不支持网格", "warn"); return; }
    $("#btMsg").innerHTML = `<span class="spinner"></span> 网格遍历 ${Object.values(grid).reduce((a, b) => a * b.length, 1)} 组…`;
    const r = await API.backtestGrid({ ...spec, grid });
    const sorted = r.results.slice().sort((a, b) => (b.sharpe || -9) - (a.sharpe || -9)).slice(0, 12);
    $("#btReport").innerHTML = `<div class="hint">共 ${r.count} 组 · ${r.overfit_flag ? "⚠ " + r.note : "边界检查通过"}</div>
      <div class="tbl-wrap"><table class="tbl"><tr><th>参数</th><th>年化</th><th>最大回撤</th><th>夏普</th><th>卡玛</th></tr>` +
      sorted.map((x) => `<tr><td class="mono">${Object.entries(x.params).map(([k, v]) => k + "=" + v).join(",")}</td>
        <td class="${U.cls(x.annual)}">${U.pct(x.annual)}</td><td class="down">${U.pct(x.mdd)}</td>
        <td>${x.sharpe}</td><td>${x.calmar}</td></tr>`).join("") + `</table></div>` +
      (r.best ? `<div class="pill green section-gap">最优：年化 ${U.pct(r.best.annual)} 夏普 ${r.best.sharpe}</div>` : "");
  }

  async function saveBt() {
    const spec = readBtSpec();
    await API.saveStrategy({ name: spec.name, code_text: spec.strategy_type === "custom" ? spec.code_text : "", params: spec.params, note: spec.strategy_type });
    toast("策略版本已保存", "ok");
  }

  async function aiGenBt() {
    const t = $("#btType").value === "custom" ? "ma_cross" : $("#btType").value;
    const code = await API.aiGenStrategy({ type: t, short: 5, long: 20, topN: 10, name: $("#btName").value });
    $("#btType").value = "custom"; $("#btCodeWrap").style.display = "block"; buildBtParams();
    $("#btCode").value = code;
    toast("已生成策略代码，可在自定义模式运行", "ok");
  }

  async function showVersions() {
    const list = await API.strategies();
    const b = $("#btReport");
    b.innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>ID</th><th>名称</th><th>参数</th><th>时间</th><th></th></tr>` +
      list.map((s) => `<tr><td>${s.id}</td><td>${escapeHtml(s.name)}</td><td class="muted mono">${JSON.stringify(s.params)}</td>
        <td class="muted">${new Date(s.created_at * 1000).toLocaleString()}</td>
        <td><button class="btn sm danger" data-del="${s.id}">删</button></td></tr>`).join("") + `</table></div>`;
    $$("#btReport [data-del]").forEach((x) => x.addEventListener("click", async () => { await API.delStrategy(x.dataset.del); showVersions(); }));
  }

  function exportBtReport() {
    if (!lastBtMetrics) { toast("请先运行回测", "warn"); return; }
    U.printPDF("回测绩效报告");
  }

  // ============ 持仓交易 ============
  async function renderTrade() {
    const v = $("#view");
    const acc = await API.account(); state.account = acc;
    const envOpts = `<select class="inp" id="tradeEnv" style="max-width:120px">
      <option value="paper" ${acc.positions.every(p=>p.env!=='live')?'':'selected'}>模拟盘</option>
      <option value="live">实盘</option></select>`;
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">持仓监控 + 模拟/实盘交易</div>
        <div class="page-desc">成本/浮盈亏/仓位/止损线 · 模拟盘与实盘双环境 · 实盘下单二次确认</div></div></div>
      <div class="grid cols-3">
        <div class="card span-2">
          <div class="card-h">持仓看板 <span class="sub">自动止损线/风控阈值</span></div>
          <div class="card-b" id="tradePos"></div>
        </div>
        <div class="card">
          <div class="card-h">下单 ${envOpts}</div>
          <div class="card-b">
            <div class="field"><label>代码</label><input class="inp" id="oCode" placeholder="600519"/></div>
            <div class="row">
              <div class="field"><label>方向</label><select class="inp" id="oSide"><option value="buy">买入</option><option value="sell">卖出</option></select></div>
              <div class="field"><label>数量(股)</label><input class="inp" id="oShares" value="100"/></div>
            </div>
            <div class="field"><label>价格</label><input class="inp" id="oPrice" placeholder="留空按市价"/></div>
            <div class="toolbar">
              <button class="btn primary" id="oSubmit">提交订单</button>
              <button class="btn" id="oVwap">VWAP拆单</button>
            </div>
            <div id="oTradeMsg" class="hint section-gap"></div>
          </div>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-h">订单监控 <span class="sub" id="ordEnvLbl"></span></div>
          <div class="card-b" id="tradeOrders"></div></div>
        <div class="card"><div class="card-h">持仓流水</div><div class="card-b" id="tradeFlow"></div></div>
      </div>`;
    await renderTradePositions();
    await renderTradeOrders();
    await renderTradeFlow();
    $("#tradeEnv").addEventListener("change", renderTradeOrders);
    $("#oSubmit").addEventListener("click", submitOrder);
    $("#oVwap").addEventListener("click", submitVwap);
  }

  async function renderTradePositions() {
    const acc = await API.account(); state.account = acc;
    const b = $("#tradePos");
    if (!acc.positions.length) { b.innerHTML = `<div class="empty">暂无持仓</div>`; return; }
    if (API.isOffline()) {
      b.innerHTML = `<div class="empty">离线模式：实时行情已关闭（持仓成本/市值按本地数据）<br/><span class="muted">点顶栏「☁ 离线」切到在线，或按 M 键</span></div>`;
      return;
    }
    try {
      const q = await API.quote(acc.positions.map((p) => p.code));
      b.innerHTML = `<div class="tbl-wrap"><table class="tbl">
        <tr><th>代码</th><th>名称</th><th>持仓</th><th>成本</th><th>现价</th><th>市值</th><th>浮盈</th><th>仓位</th><th>止损线</th><th>环境</th></tr>` +
        acc.positions.map((p) => { const x = q[p.code] || {}; const cp = U.cls(p.pnl);
          return `<tr><td class="mono">${p.code}</td><td><a data-code="${p.code}">${escapeHtml(x.name || p.name)}</a></td>
          <td>${U.fmt(p.shares, 0)}</td><td>${U.fmt(p.cost)}</td>
          <td class="${U.cls(x.chgPct||0)}">${U.fmt(x.price||p.price)}</td>
          <td>${U.money(p.mv)}</td><td class="${cp}">${U.sign(p.pnl)}${U.money(p.pnl)}</td>
          <td>${U.pct(p.weight, 1)}</td>
          <td class="muted">${p.stop ? U.fmt(p.stop) : "—"}</td>
          <td><span class="badge ${p.env}">${p.env === "live" ? "实盘" : "模拟"}</span></td></tr>`;
        }).join("") + `</table></div>`;
      $$("#tradePos a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
    } catch (e) { b.innerHTML = `<div class="empty">行情获取失败</div>`; }
  }

  async function renderTradeOrders() {
    const env = $("#tradeEnv") ? $("#tradeEnv").value : "paper";
    if ($("#ordEnvLbl")) $("#ordEnvLbl").textContent = env === "live" ? "实盘" : "模拟盘";
    const o = await API.orders(env);
    const b = $("#tradeOrders");
    b.innerHTML = `<div class="toolbar"><button class="btn sm" id="ordCancel">撤选中挂单</button></div>
      <div class="tbl-wrap"><table class="tbl"><tr><th>时间</th><th>代码</th><th>方向</th><th>数量</th><th>价格</th><th>状态</th><th>算法</th></tr>` +
      o.slice(0, 50).map((x) => `<tr><td class="muted">${x.ts}</td><td class="mono">${x.code}</td>
        <td class="${x.side === "buy" ? "up" : "down"}">${x.side === "buy" ? "买" : "卖"}</td>
        <td>${U.fmt(x.shares, 0)}</td><td>${U.fmt(x.price)}</td>
        <td><span class="pill ${x.status === "filled" ? "green" : x.status === "canceled" ? "gray" : "warn"}">${x.status}</span></td>
        <td class="muted">${x.algo}</td></tr>`).join("") + `</table></div>`;
  }

  async function renderTradeFlow() {
    // 从持仓流水（本地库）—后端未单列接口，用订单成交近似展示
    const o = await API.orders("paper").then((r) => r).catch(() => []);
    const b = $("#tradeFlow");
    b.innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>时间</th><th>代码</th><th>动作</th><th>数量</th><th>金额</th></tr>` +
      o.slice(0, 40).map((x) => `<tr><td class="muted">${x.ts}</td><td class="mono">${x.code}</td>
        <td class="${x.side === "buy" ? "up" : "down"}">${x.side === "buy" ? "买入" : "卖出"}</td>
        <td>${U.fmt(x.shares, 0)}</td><td>${U.fmt(x.price * x.shares, 0)}</td></tr>`).join("") + `</table></div>`;
  }

  async function submitOrder() {
    const code = $("#oCode").value.trim(), side = $("#oSide").value,
      shares = +$("#oShares").value, price = $("#oPrice").value ? +$("#oPrice").value : 0,
      env = $("#tradeEnv").value;
    if (!code || !shares) { toast("请填写代码与数量", "warn"); return; }
    const doSubmit = async () => {
      const r = await API.submitOrder({ code, side, shares, price, env, algo: "market" });
      $("#oTradeMsg").innerHTML = `订单 ${r.order_id} → ${r.status === "filled" ? "已模拟成交" : "已提交(等待实盘适配器)"}`;
      toast(env === "live" ? "实盘订单已提交" : "模拟订单已成交", "ok");
      renderTradePositions(); renderTradeOrders();
    };
    if (env === "live") {
      showConfirm("实盘下单二次确认", `确认对 <b>${code}</b> ${side === "buy" ? "买入" : "卖出"} <b>${shares}</b> 股${price ? " @ " + price : "（市价）"}？实盘操作涉及真实资金，请谨慎。`, doSubmit);
    } else { await doSubmit(); }
  }

  async function submitVwap() {
    const code = $("#oCode").value.trim(), shares = +$("#oShares").value,
      price = $("#oPrice").value ? +$("#oPrice").value : 0, env = $("#tradeEnv").value;
    if (!code || !shares) { toast("请填写代码与数量", "warn"); return; }
    const doVwap = async () => {
      const r = await API.vwap({ code, shares, price, env, slices: 5 });
      $("#oTradeMsg").innerHTML = `VWAP 拆为 ${r.slices} 笔提交`;
      renderTradePositions(); renderTradeOrders();
    };
    if (env === "live") showConfirm("实盘 VWAP 拆单确认", `确认对 <b>${code}</b> 拆 ${5} 笔卖出？`, doVwap);
    else await doVwap();
  }

  // ============ 风控中心 ============
  async function renderRisk() {
    const v = $("#view");
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">多层级风控预警系统</div>
        <div class="page-desc">账户 / 个股 / 策略 / 自选股 · 触发动作：提醒 / 暂停 / 减仓 / 清仓</div></div>
        <button class="btn" id="rkEval">立即评估</button></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-h">预警规则 <span class="sub" id="rkCount"></span></div>
          <div class="card-b">
            <div class="toolbar">
              <button class="btn" id="rkAdd">+ 新增规则</button>
              <button class="btn" id="rkPreset">AI生成预设</button></div>
            <div id="rkList"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h">实时评估事件</div>
          <div class="card-b" id="rkEvents"><div class="empty"><span class="spinner"></span></div></div>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-h">自选股预警</div><div class="card-b" id="rkWatch"></div></div>
        <div class="card"><div class="card-h">新增自选</div><div class="card-b">
          <div class="row">
            <div class="field"><label>代码</label><input class="inp" id="wCode" placeholder="600519"/></div>
            <div class="field"><label>上涨阈值%</label><input class="inp" id="wUp" placeholder="5"/></div>
            <div class="field"><label>下跌阈值%</label><input class="inp" id="wDown" placeholder="-5"/></div>
          </div>
          <button class="btn primary" id="wAdd">添加自选</button></div></div>
      </div>`;
    await renderRiskRules();
    await renderRiskEventsPage();
    await renderRiskWatch();
    $("#rkEval").addEventListener("click", renderRiskEventsPage);
    $("#rkAdd").addEventListener("click", addRiskRule);
    $("#rkPreset").addEventListener("click", aiRiskPreset);
    $("#wAdd").addEventListener("click", async () => {
      const code = $("#wCode").value.trim(); if (!code) return;
      await API.addWatch({ code, name: code, up: ($("#wUp").value ? +$("#wUp").value / 100 : 0) || null, down: ($("#wDown").value ? +$("#wDown").value / 100 : 0) || null });
      $("#wCode").value = ""; renderRiskWatch();
    });
  }

  async function renderRiskRules() {
    const list = await API.riskRules();
    $("#rkCount").textContent = "共 " + list.length + " 条";
    const lvlName = { account: "账户", stock: "个股", strategy: "策略", watch: "自选" };
    const actName = { alert: "仅提醒", pause: "暂停策略", reduce: "减仓", clean: "清仓" };
    $("#rkList").innerHTML = list.map((r) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--panel-2)">
      <label class="switch"><input type="checkbox" data-id="${r.id}" ${r.enabled ? "checked" : ""}/><span class="sl"></span></label>
      <div style="flex:1"><b>${escapeHtml(r.name)}</b> <span class="tag">${lvlName[r.level]}</span> <span class="muted">→ ${actName[r.action]}</span></div>
      <button class="btn sm danger" data-del="${r.id}">删</button></div>`).join("") || `<div class="empty">暂无规则</div>`;
    $$("#rkList input[type=checkbox]").forEach((c) => c.addEventListener("change", async () => {
      await API.updateRisk({ id: +c.dataset.id, enabled: c.checked, action: "" });
    }));
    $$("#rkList [data-del]").forEach((x) => x.addEventListener("click", async () => { await API.delRisk(+x.dataset.del); renderRiskRules(); }));
  }

  async function renderRiskEventsPage() {
    const b = $("#rkEvents");
    try {
      const { events, snapshot } = await API.riskEvaluate();
      if (!events.length) { b.innerHTML = `<div class="empty">✅ 当前无触发预警</div>`; return; }
      b.innerHTML = events.map((e) => `<div class="pill ${e.level === "account" ? "red" : "warn"}" style="display:block;margin-bottom:6px;padding:6px 10px">
        <b>[${e.level === "account" ? "账户" : e.level === "stock" ? "个股" : e.level === "strategy" ? "策略" : "自选"}]</b> ${e.msg}</div>`).join("");
      if (events.some((e) => e.action === "clean" || e.action === "reduce")) alertSound();
    } catch (e) { b.innerHTML = `<div class="empty">评估失败</div>`; }
  }

  async function renderRiskWatch() {
    const w = await API.watch();
    const b = $("#rkWatch");
    if (!w.length) { b.innerHTML = `<div class="empty">暂无自选</div>`; return; }
    try {
      const q = await API.quote(w.map((x) => x.code));
      b.innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>名称</th><th>现价</th><th>涨跌幅</th><th>阈值↑↓</th></tr>` +
        w.map((x) => { const c = (q[x.code] || {}).chgPct || 0;
          return `<tr><td><a data-code="${x.code}">${escapeHtml(x.name)}</a></td>
          <td class="mono ${U.cls(c)}">${U.fmt((q[x.code] || {}).price)}</td>
          <td class="${U.cls(c)}">${U.sign(c)}${U.fmt(c)}%</td>
          <td class="muted">${(x.threshold_up||0)*100||"—"}/${(x.threshold_down||0)*100||"—"}</td></tr>`;
        }).join("") + `</table></div>`;
      $$("#rkWatch a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
    } catch (e) { b.innerHTML = `<div class="empty">行情失败</div>`; }
  }

  async function addRiskRule() {
    const name = prompt("规则名称（如：单票仓位过高）"); if (!name) return;
    const level = prompt("层级 account/stock/strategy/watch", "stock") || "stock";
    const kind = prompt("类型 max_drawdown/day_loss/weight/drop/winrate", "weight") || "weight";
    const threshold = parseFloat(prompt("阈值（如 0.2 表示20%）", "0.2")) || 0.2;
    const action = prompt("动作 alert/pause/reduce/clean", "alert") || "alert";
    await API.addRisk({ name, level, kind, expr: { threshold }, action });
    renderRiskRules();
  }

  async function aiRiskPreset() {
    const preset = prompt("预设 保守/稳健/激进", "稳健") || "稳健";
    const rules = await API.aiGenRisk({ preset });
    for (const r of rules) await API.addRisk(r);
    toast("已生成 " + rules.length + " 条预设规则", "ok");
    renderRiskRules();
  }

  // ============ AI 辅助 ============
  async function renderAI() {
    const v = $("#view");
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">AI 量化辅助</div>
        <div class="page-desc">纯本地离线：自然语言选股 · 回测诊断 · 代码/风控/复盘生成</div></div></div>
      <div class="card"><div class="card-h">自然语言选股</div><div class="card-b">
        <div class="row"><div class="field" style="flex:3"><label>条件描述</label>
          <input class="inp" id="aiNl" placeholder="低PE 高股息 银行 / MACD金叉 白酒 / 小市值 高ROE"/></div>
          <div class="field" style="flex:1;align-self:flex-end"><button class="btn primary" id="aiRun">筛选</button></div></div>
        <div id="aiScreenRes"></div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-h">回测结果 AI 诊断</div><div class="card-b">
          <div class="toolbar"><button class="btn" id="aiDiag">诊断最近回测</button></div>
          <div id="aiDiagRes" class="hint"></div></div></div>
        <div class="card"><div class="card-h">一键生成</div><div class="card-b">
          <button class="btn" id="aiGs">生成策略代码</button>
          <button class="btn" id="aiGr">生成风控规则</button>
          <button class="btn" id="aiGv">生成复盘文档</button>
          <div id="aiGenRes" class="section-gap"></div></div></div>
      </div>`;
    $("#aiRun").addEventListener("click", async () => {
      const r = await API.aiScreen($("#aiNl").value);
      $("#aiScreenRes").innerHTML = `<div class="hint">命中 <b>${r.count}</b> 只 · ${r.reasons.join(" / ")}</div>` +
        `<div class="tbl-wrap"><table class="tbl"><tr><th>代码</th><th>名称</th><th>行业</th><th>理由</th></tr>` +
        r.matched.slice(0, 40).map((m) => `<tr><td class="mono">${m.code}</td><td><a data-code="${m.code}">${escapeHtml(m.name)}</a></td><td>${escapeHtml(m.industry)}</td><td class="muted">${escapeHtml(m.reason)}</td></tr>`).join("") + `</table></div>`;
      $$("#aiScreenRes a[data-code]").forEach((a) => a.addEventListener("click", () => openStock(a.dataset.code)));
    });
    $("#aiDiag").addEventListener("click", async () => {
      const list = await API.backtests(); if (!list.length) { $("#aiDiagRes").innerHTML = `<div class="hint">无回测</div>`; return; }
      const t = await API.aiDiagnose(list[0].metrics);
      $("#aiDiagRes").innerHTML = `<pre class="code" style="background:#f7f9fc;color:#1f2a37">${escapeHtml(t)}</pre>`;
    });
    $("#aiGs").addEventListener("click", async () => {
      const c = await API.aiGenStrategy({ type: "ma_cross" });
      $("#aiGenRes").innerHTML = `<pre class="code">${escapeHtml(c)}</pre>`;
    });
    $("#aiGr").addEventListener("click", async () => {
      const r = await API.aiGenRisk({ preset: "稳健" });
      $("#aiGenRes").innerHTML = `<pre class="code" style="background:#f7f9fc;color:#1f2a37">${escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
    });
    $("#aiGv").addEventListener("click", async () => {
      const list = await API.backtests(); if (!list.length) { $("#aiGenRes").innerHTML = `<div class="hint">无回测</div>`; return; }
      const md = await API.aiGenReview(list[0].metrics);
      $("#aiGenRes").innerHTML = `<pre class="code" style="background:#f7f9fc;color:#1f2a37">${escapeHtml(md)}</pre>`;
    });
  }

  // ============ 设置 / 备份 ============
  async function renderSettings() {
    const v = $("#view");
    const cost = await API.cost(); const c = cost.cost || {};
    const st = await API.status(); const d = st.db || {};
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">设置 + 本地备份</div>
        <div class="page-desc">交易成本模型 · 自动备份（每6小时）· 全部数据本机落盘</div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-h">真实交易成本模型</div><div class="card-b" id="costBox"></div></div>
        <div class="card"><div class="card-h">数据完整性</div><div class="card-b" id="dbBox"></div></div>
      </div>
      <div class="card"><div class="card-h">备份管理</div><div class="card-b">
        <div class="toolbar"><button class="btn primary" id="bkNow">立即备份</button><span id="bkMsg" class="hint"></span></div>
        <div id="bkList"></div></div></div>`;
    const costFields = [
      ["commission", "佣金费率", 0.00025], ["min_commission", "最低佣金(元)", 5],
      ["stamp_tax", "印花税(卖出)", 0.001], ["transfer_fee", "过户费", 0.00001],
      ["slippage", "滑点(双边)", 0.0005], ["delay", "信号延迟(根)", 1], ["initial_cash", "初始资金", 1000000],
    ];
    $("#costBox").innerHTML = costFields.map(([k, label, def]) =>
      `<div class="field" style="max-width:220px"><label>${label}</label><input class="inp cost-inp" data-k="${k}" value="${c[k] !== undefined ? c[k] : def}"/></div>`).join("") +
      `<button class="btn primary" id="costSave">保存成本模型</button>`;
    $("#costSave").addEventListener("click", async () => {
      const nc = {}; $$(".cost-inp").forEach((i) => nc[i.dataset.k] = +i.value);
      await API.saveCost(nc); toast("成本模型已保存", "ok");
    });
    $("#dbBox").innerHTML = `<div>${Object.entries(d).map(([k, val]) => `<span class="tag">${k}: ${val}</span>`).join(" ")}</div>
      <div class="hint section-gap">数据库路径：backend/data/quant.db （含行情/基本面/回测/持仓/风控，绝不上传）</div>`;
    const bs = await API.backup();
    renderBackupList(bs);
    $("#bkNow").addEventListener("click", async () => { const r = await API.createBackup("manual"); $("#bkMsg").textContent = "已备份：" + (r.path || ""); renderBackupList(await API.backup()); });
  }

  function renderBackupList(list) {
    $("#bkList").innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>时间</th><th>标签</th><th>大小</th><th>路径</th></tr>` +
      list.map((b) => `<tr><td class="muted">${b.time || ""}</td><td>${b.tag || ""}</td><td class="muted">${b.size_kb ? b.size_kb + "KB" : ""}</td><td class="muted" style="font-size:11px">${b.path || ""}</td></tr>`).join("") + `</table></div>`;
  }

  // ============ 股票详情抽屉 ============
  async function openStock(code) {
    $("#sdCode").textContent = code;
    $("#sdName").textContent = "加载中…";
    $("#sdBody").innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    $("#stockDrawer").classList.add("show");
    $("#drawerBackdrop").classList.add("show");
    try {
      const [info, kline, q] = await Promise.all([API.status().then(() => API.universe(code)).catch(() => []), API.kline(code, "qfq"), API.quote([code])]);
      const ins = await fetch("/api/instrument?code=" + code).then((r) => r.json());
      const inst = ins.instrument || {}; const fnd = ins.fundamental || {};
      const name = (info[0] && info[0].name) || inst.name || code;
      $("#sdName").textContent = name; $("#sdCode").textContent = code + " · " + (inst.itype || "");
      const x = q[code] || {}; const cp = U.cls(x.chgPct || 0);
      $("#sdBody").innerHTML = `
        <div class="kpi-row section-gap">
          <div class="kpi"><span class="k">现价</span><span class="v ${cp}">${U.fmt(x.price)}</span></div>
          <div class="kpi"><span class="k">涨跌幅</span><span class="v ${cp}">${U.sign(x.chgPct)}${U.fmt(x.chgPct)}%</span></div>
          <div class="kpi"><span class="k">涨跌额</span><span class="v ${cp}">${U.sign(x.chg)}${U.fmt(x.chg)}</span></div>
          <div class="kpi"><span class="k">换手</span><span class="v">${U.fmt(x.turnover || 0)}%</span></div>
        </div>
        <div class="hint">${x.time ? "行情时间 " + x.time + " · " : ""}来源：${state.live ? "腾讯财经实时" : "模拟"}</div>
        <canvas class="chart-canvas section-gap" id="sdKline" style="height:240px"></canvas>
        <div class="divider"></div>
        <div class="hint"><b>基本信息</b></div>
        <div class="tbl-wrap"><table class="tbl">
          <tr><td class="muted">行业</td><td>${inst.industry || "—"}</td><td class="muted">板块</td><td>${inst.board || "—"}</td></tr>
          <tr><td class="muted">PE(TTM)</td><td>${fnd.pe_ttm || "—"}</td><td class="muted">PB</td><td>${fnd.pb || "—"}</td></tr>
          <tr><td class="muted">股息率</td><td>${(fnd.dividend_yield||0)}%</td><td class="muted">ROE</td><td>${(fnd.roe||0)}%</td></tr>
          <tr><td class="muted">总市值</td><td>${(fnd.total_mv? (fnd.total_mv/1e12).toFixed(2)+"万亿": "—")}</td><td class="muted">来源</td><td>${inst.source || "—"}</td></tr>
        </table></div>
        <div class="toolbar section-gap">
          <button class="btn" id="sdAddPos">加入持仓</button>
          <button class="btn" id="sdAddWatch">加入自选</button>
          <button class="btn" id="sdSync">同步行情</button>
        </div>`;
      Charts.kline($("#sdKline"), kline, { n: 120 });
      $("#sdAddPos").addEventListener("click", async () => {
        const shares = parseFloat(prompt("持仓数量(股)：", "100")) || 0;
        const cost = parseFloat(prompt("成本价：", String(x.price || 0))) || 0;
        await API.savePosition({ code, name, shares, cost, env: "paper" });
        toast("已加入模拟持仓", "ok"); refreshTop();
      });
      $("#sdAddWatch").addEventListener("click", async () => {
        await API.addWatch({ code, name, up: 5 / 100, down: -5 / 100 }); toast("已加入自选", "ok");
      });
      $("#sdSync").addEventListener("click", async () => {
        await API.syncOne(code); toast("已同步 " + code + " 行情", "ok"); openStock(code);
      });
    } catch (e) { $("#sdBody").innerHTML = `<div class="empty">加载失败：${e.message}</div>`; }
  }
  function closeDrawer() { $("#stockDrawer").classList.remove("show"); $("#drawerBackdrop").classList.remove("show"); }

  // ============ 全局搜索 ============
  async function loadUniverse() {
    try { state.universe = await API.universe(""); } catch (e) { state.universe = []; }
  }
  function doSearch(q) {
    const sR = $("#searchResults"); const term = q.trim().toLowerCase();
    if (!term) { sR.classList.remove("show"); return; }
    const hit = state.universe.filter((u) => u.code.includes(term) || u.name.toLowerCase().includes(term)).slice(0, 12);
    sR.innerHTML = hit.length ? hit.map((u) => `<div class="sr" data-code="${u.code}"><span>${escapeHtml(u.name)} <span class="c">${u.code}</span></span><span class="tag">${u.itype}</span></div>`).join("") : `<div class="sr muted">无匹配</div>`;
    sR.classList.add("show");
    $$("#searchResults .sr[data-code]").forEach((a) => a.addEventListener("click", () => { openStock(a.dataset.code); sR.classList.remove("show"); $("#globalSearch").value = ""; }));
  }

  // ============ 弹窗 / 提示 / 声音 ============
  function showConfirm(title, body, onOk) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    $("#modalActions").innerHTML = `<button class="btn" id="mCancel">取消</button><button class="btn danger" id="mOk">确认</button>`;
    $("#modalBackdrop").classList.add("show");
    $("#mCancel").addEventListener("click", () => $("#modalBackdrop").classList.remove("show"));
    $("#mOk").addEventListener("click", () => { $("#modalBackdrop").classList.remove("show"); onOk(); });
  }
  function toast(msg, type = "") {
    const t = document.createElement("div"); t.className = "toast " + type; t.textContent = msg;
    $("#toastWrap").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2800);
  }
  let audioCtx = null;
  function alertSound() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination); o.type = "square";
      o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); setTimeout(() => o.stop(), 300);
    } catch (e) {}
  }
  function escapeHtml(s) { return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // ============ 实时轮询 ============
  function startPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = setInterval(async () => {
      if (document.hidden) return;
      const onDash = state.route === "dashboard";
      const needLive = state.layout === "intraday" && (onDash || state.route === "trade" || state.route === "risk");
      // 离线模式：无论何种布局都不拉外部行情，避免受限网络周期性假死
      const live = !API.isOffline() && (needLive || state.route === "trade");
      if (!needLive && state.route !== "trade") { if (state.route === "dashboard" && state.layout !== "intraday") return; }
      try {
        const acc = await API.account(live); state.account = acc; state.live = !!acc.quotes_live;
        updateLiveDot();
        renderMetrics(acc);
        if (state.route === "dashboard" && state.layout === "intraday") {
          renderAccountBody(); renderPositionsBody();
          if ($("#qBody")) renderQuotesBody(acc.positions);
          renderRiskEvents();
        }
        if (state.route === "trade") { renderTradePositions(); }
      } catch (e) {}
    }, 5000);
  }

  window.addEventListener("DOMContentLoaded", bootstrap);

  // ============ 登录门禁 / 主题 / 预警 / 导出 ============
  async function bootstrap() {
    applySavedTheme();
    syncServerMode();  // 与服务端对齐在线/离线默认（不阻塞首屏）
    let st = { password_set: false };
    try { st = await API.authStatus(); } catch (e) {}
    if (!st.password_set) {
      // 未设访问密码：直接放行（可在“设置备份”页开启密码）
      $("#loginOverlay").style.display = "none";
      wireChrome();
      init();
    } else {
      // 已设密码：展示登录框
      $("#setPwdBox").style.display = "none";
      $("#loginBox").style.display = "";
      $("#loginOverlay").style.display = "flex";
      wireLogin();
    }
    window.addEventListener("qb-unauthorized", showLoginAgain);
  }

  // 异步同步服务端离线模式（失败不影响前端离线优先体验）
  async function syncServerMode() {
    try {
      const r = await API.getModeServer();
      if (r && typeof r.offline === "boolean") {
        API.setMode(r.offline ? "offline" : "online");
        updateLiveDot();
      }
    } catch (e) {}
  }

  function wireLogin() {
    const go = async () => {
      try {
        const r = await API.login($("#loginPwd").value);
        API.setToken(r.token);
        $("#loginErr").textContent = "";
        enterApp();
      } catch (e) { $("#loginErr").textContent = e.message || "登录失败"; }
    };
    $("#loginBtn").onclick = go;
    $("#loginPwd").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  function showLoginAgain() {
    $("#setPwdBox").style.display = "none";
    $("#loginBox").style.display = "";
    $("#loginOverlay").style.display = "flex";
    $("#loginPwd").value = "";
    $("#loginErr").textContent = "登录已失效，请重新登录";
    wireLogin();
  }

  function enterApp() {
    $("#loginOverlay").style.display = "none";
    wireChrome();
    init();
  }

  function wireChrome() {
    themeFlow(); alertFlow(); exportFlow(); logoutFlow(); bindExtraKeys();
  }

  function applySavedTheme() {
    const t = localStorage.getItem("qb_theme") || "light";
    document.documentElement.setAttribute("data-theme", t);
    const fs = localStorage.getItem("qb_font");
    if (fs) document.documentElement.style.setProperty("--font-base", fs + "px");
    const ac = localStorage.getItem("qb_accent");
    if (ac) document.documentElement.style.setProperty("--accent", ac);
    if (window.Charts && Charts.setTheme) Charts.setTheme(t);
  }

  function themeFlow() {
    $$("#themeSeg button").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.t;
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("qb_theme", t);
      $$("#themeSeg button").forEach((x) => x.classList.toggle("active", x === b));
      if (window.Charts && Charts.setTheme) Charts.setTheme(t);
    }));
    const fr = $("#fontRange");
    if (fr) fr.addEventListener("input", () => {
      $("#fontVal").textContent = fr.value;
      document.documentElement.style.setProperty("--font-base", fr.value + "px");
      localStorage.setItem("qb_font", fr.value);
    });
    const ap = $("#accentPick");
    if (ap) ap.addEventListener("input", () => {
      document.documentElement.style.setProperty("--accent", ap.value);
      localStorage.setItem("qb_accent", ap.value);
    });
    const ar = $("#accentReset");
    if (ar) ar.onclick = () => {
      document.documentElement.style.setProperty("--accent", "#2f6df0");
      localStorage.removeItem("qb_accent");
    };
    $("#themeBtn").onclick = () => $("#themePanel").classList.toggle("show");
    $("#themeClose").onclick = () => $("#themePanel").classList.remove("show");
  }

  function logoutFlow() {
    const lb = $("#logoutBtn");
    if (lb) lb.onclick = async () => {
      try { await API.logout(); } catch (e) {}
      API.setToken("");
      location.reload();
    };
  }

  let _alertTimer = null;
  async function alertFlow() {
    const bell = $("#alertBell");
    if (bell) bell.onclick = () => { $("#alertCenter").classList.add("show"); $("#alertBackdrop").classList.add("show"); loadAlerts(); };
    const ac = $("#alertClose"); if (ac) ac.onclick = closeAlerts;
    const ab = $("#alertBackdrop"); if (ab) ab.onclick = closeAlerts;
    await loadAlerts();
    if (_alertTimer) clearInterval(_alertTimer);
    _alertTimer = setInterval(pollAlerts, 15000);
  }
  function closeAlerts() { $("#alertCenter").classList.remove("show"); $("#alertBackdrop").classList.remove("show"); }

  async function loadAlerts() {
    try {
      const list = await API.alerts(50, 0);
      const bd = $("#alertBody");
      if (!bd) return;
      if (!list || !list.length) { bd.innerHTML = `<div class="empty muted">暂无预警事件</div>`; }
      else {
        bd.innerHTML = list.map((a) => {
          const lvl = (a.level || "info");
          const title = a.rule || (lvl === "danger" ? "风险预警" : lvl === "warn" ? "提醒" : "通知");
          const time = a.ts || (a.created_at ? new Date(a.created_at * 1000).toLocaleString("zh-CN") : "");
          return `<div class="alert-item ${lvl}"><div class="ai-head"><b>${escapeHtml(title)}</b><span class="muted">${escapeHtml(time)}</span></div><div class="ai-body">${escapeHtml(a.message || "")}</div></div>`;
        }).join("");
        const unread = list.filter((a) => !a.read).length;
        const badge = $("#alertBadge");
        if (unread) { badge.style.display = ""; badge.textContent = unread; } else if (badge) badge.style.display = "none";
        const cnt = $("#alertCount"); if (cnt) cnt.textContent = list.length + " 条";
      }
    } catch (e) {}
  }

  async function pollAlerts() {
    try {
      const list = await API.alerts(20, 1); // 仅未读
      if (list && list.length) {
        list.forEach((a) => {
          notifyDesktop(a.rule || "量化工作台", a.message || "");
          alertSound();
        });
        await loadAlerts();
        await API.markAlertsRead();
      }
    } catch (e) {}
  }

  function notifyDesktop(title, body) {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "granted") new Notification("量化工作台 · " + title, { body });
      else if (Notification.permission !== "denied") Notification.requestPermission();
    } catch (e) {}
  }

  function exportFlow() {
    const eb = $("#exportBtn");
    if (!eb) return;
    eb.onclick = async () => {
      toast("正在导出持仓与回测报表…", "ok");
      await exportFile(API.exportPositions("xlsx"), "持仓台账.xlsx");
      await exportFile(API.exportBacktests("xlsx"), "回测绩效.xlsx");
    };
  }
  async function exportFile(url, filename) {
    try {
      const r = await fetch(url, { headers: API.getToken() ? { "X-Token": API.getToken() } : {} });
      if (!r.ok) { toast("导出失败 (" + r.status + ")", "danger"); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (e) { toast("导出失败：" + e.message, "danger"); }
  }

  function bindExtraKeys() {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "e") { e.preventDefault(); if ($("#exportBtn")) $("#exportBtn").click(); }
      else if (k === "w") { e.preventDefault(); if ($("#alertBell")) $("#alertBell").click(); }
      else if (k === "f") { e.preventDefault(); refreshTop(); if (state.route === "dashboard") renderDashboard(); }
    });
  }
})();
