/* Sessions page: KPIs, filter tabs, search, sorting, paging, detail drawer. */
(function () {
  "use strict";

  var fmt = CP.fmt, esc = UI.esc, icon = UI.icon;
  var PAGE = 12;
  var FILTERS = ["all", "running", "waiting", "completed", "failed", "stopped"];
  var FILTER_LABEL = { all: "All", running: "Running", waiting: "Waiting", completed: "Completed", failed: "Failed", stopped: "Stopped" };
  var STATUS_ORDER = { running: 0, waiting: 1, failed: 2, stopped: 3, completed: 4 };
  var NUMERIC = { runtime: 1, tokens: 1, cost: 1 };

  var state = { status: "all", q: "", sort: null, dir: "desc", page: 1, open: null, facet: null, from: null, to: null };
  var data = [];

  /* ---------- URL state ---------- */

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (FILTERS.indexOf(p.get("status")) > -1) state.status = p.get("status");
    state.q = p.get("q") || "";
    var sort = p.get("sort");
    if (sort && document.querySelector('th[data-key="' + sort + '"]')) {
      state.sort = sort;
      state.dir = p.get("dir") === "asc" ? "asc" : "desc";
    }
    state.page = Math.max(1, parseInt(p.get("page"), 10) || 1);
    ["mode", "model", "owner"].forEach(function (k) {
      var v = p.get(k);
      var valid = k === "mode" ? CP.modes[v] : k === "model" ? CP.models[v] : CP.owner(v);
      if (v && valid) state.facet = { key: k, value: v };
    });
    state.from = parseDay(p.get("from"));
    state.to = parseDay(p.get("to"));
  }
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }
  function dayStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function writeUrl() {
    var p = new URLSearchParams();
    if (state.status !== "all") p.set("status", state.status);
    if (state.q) p.set("q", state.q);
    if (state.sort) { p.set("sort", state.sort); p.set("dir", state.dir); }
    if (state.page > 1) p.set("page", state.page);
    if (state.facet) p.set(state.facet.key, state.facet.value);
    if (state.from) p.set("from", dayStr(state.from));
    if (state.to) p.set("to", dayStr(state.to));
    var qs = p.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); } catch (e) {}
  }

  /* ---------- derived ---------- */

  function isActive(s) { return s.status === "running" || s.status === "waiting"; }

  function haystack(s) {
    var o = CP.owner(s.owner);
    return [s.title, s.id, o.name, CP.modes[s.mode], s.mode, CP.models[s.model].label, s.model, s.backend, CP.statuses[s.status].label]
      .join(" ").toLowerCase();
  }

  function scoped() {
    return data.filter(function (s) {
      if (state.facet && s[state.facet.key] !== state.facet.value) return false;
      if (state.from && s.startedAt < state.from) return false;
      if (state.to && s.startedAt >= state.to + CP.DAY) return false;
      return true;
    });
  }

  function facetLabel() {
    var parts = [];
    if (state.facet) {
      var f = state.facet;
      parts.push(f.key === "mode" ? CP.modes[f.value] + " mode" : f.key === "model" ? CP.models[f.value].label : CP.owner(f.value).name);
    }
    if (state.from || state.to) {
      var a = state.from ? fmt.date(state.from).replace(/, \d{4}$/, "") : "Start";
      var b = state.to ? fmt.date(state.to).replace(/, \d{4}$/, "") : "today";
      parts.push(a === b ? a : a + " to " + b);
    }
    return parts.join(", ");
  }

  function searched() {
    var terms = state.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var pool = scoped();
    if (!terms.length) return pool;
    return pool.filter(function (s) {
      var h = s._h || (s._h = haystack(s));
      return terms.every(function (t) { return h.indexOf(t) > -1; });
    });
  }

  function sortValue(s, key) {
    switch (key) {
      case "title": return s.title.toLowerCase();
      case "mode": return CP.modes[s.mode].toLowerCase();
      case "owner": return CP.owner(s.owner).name.toLowerCase();
      case "model": return CP.models[s.model].label.toLowerCase();
      case "status": return STATUS_ORDER[s.status];
      case "runtime": return CP.runtimeMin(s);
      case "tokens": return CP.totalTokens(s);
      case "cost": return s.cost;
    }
  }

  function sorted(rows) {
    var out = rows.slice();
    if (!state.sort) return out.sort(function (a, b) { return b.startedAt - a.startedAt; });
    var k = state.sort, m = state.dir === "asc" ? 1 : -1;
    return out.sort(function (a, b) {
      var va = sortValue(a, k), vb = sortValue(b, k);
      if (va < vb) return -1 * m;
      if (va > vb) return 1 * m;
      return b.startedAt - a.startedAt;
    });
  }

  /* ---------- KPIs ---------- */

  function renderKpis() {
    var st = CP.store.read();
    var d7 = CP.today0 - 6 * CP.DAY, d14 = CP.today0 - 13 * CP.DAY;
    var month0 = new Date(2026, 8, 1).getTime();
    var cur = data.filter(function (s) { return s.startedAt >= d7; });
    var prev = data.filter(function (s) { return s.startedAt >= d14 && s.startedAt < d7; });
    var running = data.filter(function (s) { return s.status === "running"; }).length;
    var waiting = data.filter(function (s) { return s.status === "waiting"; }).length;

    var tok = sum(cur, CP.totalTokens), tokPrev = sum(prev, CP.totalTokens);
    var mtd = sum(data.filter(function (s) { return s.startedAt >= month0; }), function (s) { return s.cost; });
    var budget = Number(st.budget.monthly) || 0;
    var used = budget ? mtd / budget : 0;
    var alertAt = (Number(st.budget.alertAt) || 80) / 100;

    var finished = cur.filter(function (s) { return !isActive(s); });
    var failed = finished.filter(function (s) { return s.status === "failed"; }).length;
    var rate = finished.length ? failed / finished.length : 0;
    var prevFinished = prev.filter(function (s) { return !isActive(s); });
    var prevRate = prevFinished.length ? prevFinished.filter(function (s) { return s.status === "failed"; }).length / prevFinished.length : 0;

    var meterCls = used >= 1 ? "over" : used >= alertAt ? "warn" : "";
    var html = "";
    html += kpi("Active now", String(running + waiting),
      '<span class="kpi-live"><span class="status running"><span class="dot" aria-hidden="true"></span>' + running + ' running</span><span class="status waiting"><span class="dot" aria-hidden="true"></span>' + waiting + " waiting</span></span>");
    html += kpi("Sessions, last 7 days", String(cur.length), delta(cur.length, prev.length, "count"));
    html += kpi("Tokens, last 7 days", fmt.tokens(tok), delta(tok, tokPrev, "pct"));
    if (!budget) html += kpi("Spend this month", fmt.money0(mtd), 'No monthly budget set. <a href="settings.html#budget">Set one</a>');
    else html += '<div class="kpi"><p class="kpi-label">Spend this month</p><p class="kpi-value">' + fmt.money0(mtd) +
      "<small>of " + fmt.money0(budget) + "</small></p>" +
      '<div class="meter ' + meterCls + '" role="meter" aria-valuemin="0" aria-valuemax="' + budget + '" aria-valuenow="' + mtd.toFixed(2) + '" aria-label="Spend against monthly budget">' +
      '<span style="width:' + Math.min(100, used * 100).toFixed(1) + '%"></span><i style="left:' + (alertAt * 100) + '%" title="Alert threshold"></i></div>' +
      '<p class="kpi-meta"><span class="' + (meterCls ? "warn" : "") + '">' + Math.round(used * 100) + "% used</span><span>alert at " + Math.round(alertAt * 100) + "%</span></p></div>";
    html += kpi("Failure rate, 7 days", fmt.pct(rate * 100),
      '<span class="' + (rate > prevRate ? "bad" : "ok") + '">' + failed + " of " + finished.length + " finished</span><span>" + fmt.pct(prevRate * 100) + " prior week</span>");
    document.getElementById("kpis").innerHTML = html;
  }

  function kpi(label, value, meta) {
    return '<div class="kpi"><p class="kpi-label">' + label + '</p><p class="kpi-value">' + value + '</p><p class="kpi-meta">' + meta + "</p></div>";
  }
  function sum(arr, f) { return arr.reduce(function (a, x) { return a + f(x); }, 0); }
  function delta(a, b, kind) {
    if (!b) return "No prior week";
    var diff = a - b;
    var up = diff >= 0;
    var txt = kind === "pct" ? Math.abs(Math.round((diff / b) * 100)) + "%" : String(Math.abs(diff));
    return '<span class="' + (up ? "up" : "down") + '">' + icon(up ? "up" : "down") + (up ? "+" : "−") + txt + "</span> vs prior 7 days";
  }

  /* ---------- tabs ---------- */

  function renderTabs(base) {
    var counts = { all: base.length };
    base.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });
    var el = document.getElementById("status-tabs");
    el.innerHTML = FILTERS.map(function (f) {
      var sel = state.status === f;
      var dot = f === "running" || f === "waiting" || f === "failed" ? '<span class="tdot ' + f + '" aria-hidden="true"></span>' : "";
      return '<button type="button" role="tab" class="tab" data-status="' + f + '" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '" aria-controls="ledger">' +
        dot + FILTER_LABEL[f] + '<span class="n">' + (counts[f] || 0) + "</span></button>";
    }).join("");
  }

  /* ---------- table ---------- */

  function runtimeCell(s) {
    var m = CP.runtimeMin(s);
    return '<span class="' + (isActive(s) ? "rt-live" : "") + '" data-rt="' + s.id + '">' + fmt.runtime(m) + "</span>";
  }

  function row(s) {
    var o = CP.owner(s.owner), md = CP.models[s.model];
    return '<tr data-id="' + s.id + '"' + (state.open === s.id ? ' class="is-open"' : "") + ">" +
      '<td class="col-session"><button type="button" class="s-title" data-open="' + s.id + '">' + esc(s.title) + '</button>' +
        '<div class="s-meta"><span class="mono">' + s.id + "</span><span>" + fmt.when(s.startedAt) + "</span></div></td>" +
      '<td><span class="mode">' + CP.modes[s.mode] + "</span></td>" +
      '<td><span class="who">' + UI.avatar(o) + '<span class="owner-full">' + esc(o.name) + '</span><span class="owner-first">' + esc(o.name.split(" ")[0]) + "</span></span></td>" +
      '<td><span class="model-name">' + md.label + '</span><span class="backend">' + s.backend + "</span></td>" +
      "<td>" + UI.statusBadge(s.status) + (s.status === "waiting" && s.waitingSince ? '<span class="since">for <span data-wait="' + s.id + '">' + fmt.runtime((CP.now() - s.waitingSince) / CP.MIN) + "</span></span>" : "") + "</td>" +
      '<td class="r num">' + runtimeCell(s) + "</td>" +
      '<td class="r num">' + fmt.tokens(CP.totalTokens(s)) + '<span class="m-unit"> tokens</span></td>' +
      '<td class="r num cost-cell">' + fmt.cost(s.cost) + "</td></tr>";
  }

  function renderHeaders() {
    document.querySelectorAll("#ledger thead th").forEach(function (th) {
      var k = th.getAttribute("data-key");
      var b = th.querySelector("button");
      var active = state.sort === k;
      if (active) th.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
      var label = b.textContent.trim();
      b.innerHTML = esc(label) + icon(active ? (state.dir === "asc" ? "up" : "down") : "sort");
      b.setAttribute("aria-label", "Sort by " + label.toLowerCase() + (active ? ", currently " + (state.dir === "asc" ? "ascending" : "descending") : ""));
    });
  }

  function render() {
    data = CP.sessions();
    var base = searched();
    var rows = state.status === "all" ? base : base.filter(function (s) { return s.status === state.status; });
    rows = sorted(rows);

    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE;
    var slice = rows.slice(start, start + PAGE);

    renderKpis();
    renderTabs(base);
    var chip = document.getElementById("scope");
    var label = facetLabel();
    chip.hidden = !label;
    if (label) document.getElementById("scope-label").textContent = label;
    renderHeaders();

    document.getElementById("rows").innerHTML = slice.map(row).join("");

    var empty = document.getElementById("empty");
    var table = document.getElementById("ledger");
    empty.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
    if (!rows.length) {
      var parts = [];
      if (state.q) parts.push("matching “" + esc(state.q) + "”");
      if (state.status !== "all") parts.push("with status " + FILTER_LABEL[state.status].toLowerCase());
      document.getElementById("empty-text").innerHTML = "No sessions " + parts.join(" ") + ". Try a different search or show all statuses.";
    }

    var tokens = sum(rows, CP.totalTokens), cost = sum(rows, function (s) { return s.cost; });
    document.getElementById("totals").innerHTML = rows.length
      ? '<tr><td colspan="5">' + (state.status === "all" && !state.q && !facetLabel() ? "All sessions" : "Filtered sessions") + ", " + rows.length + '</td><td class="r"></td>' +
        '<td class="r tot">' + fmt.tokens(tokens) + '</td><td class="r tot">' + fmt.cost(cost) + "</td></tr>"
      : "";

    document.getElementById("pager-info").textContent = rows.length
      ? "Showing " + (start + 1) + "–" + (start + slice.length) + " of " + rows.length
      : "Showing 0 of 0";
    document.getElementById("page-of").textContent = "Page " + state.page + " of " + pages;
    document.getElementById("prev").disabled = state.page <= 1;
    document.getElementById("next").disabled = state.page >= pages;
    document.querySelector(".pager-controls").hidden = pages <= 1;

    var sel = document.getElementById("sort-select");
    var want = state.sort ? state.sort + ":" + state.dir : "";
    sel.value = want;
    if (sel.value !== want) {
      var o = document.createElement("option");
      o.value = want; o.textContent = "Sorted by " + state.sort + (state.dir === "asc" ? ", ascending" : ", descending");
      sel.appendChild(o); sel.value = want;
    }

    writeUrl();
    if (state.open) renderDrawer();
  }

  /* ---------- drawer ---------- */

  var lastTrigger = null;
  // On a narrow screen the drawer covers the page, so it becomes a modal
  // dialog: the page behind it is inert and its shortcuts are off. On wider
  // screens it stays a side panel beside the live table.
  var narrow = window.matchMedia("(max-width: 560px)");

  function isModal() { return !!state.open && narrow.matches; }

  function setModal(on) {
    var d = document.getElementById("drawer");
    if (on) { d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); }
    else { d.removeAttribute("role"); d.removeAttribute("aria-modal"); }
    document.querySelectorAll(".app > :not(#drawer), body > .skip").forEach(function (el) { el.inert = on; });
    document.documentElement.classList.toggle("drawer-modal", on);
  }

  narrow.addEventListener("change", function () { if (state.open) setModal(isModal()); });

  // Keep Tab inside the modal drawer: past its last control it wraps to the
  // first, and back from the first to the last. (Inert already removes the
  // page behind; this stops focus leaving the document, e.g. from a frame.)
  document.getElementById("drawer").addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || !isModal()) return;
    var items = Array.prototype.filter.call(
      this.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      function (el) { return !el.disabled && el.getClientRects().length; }
    );
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || items.indexOf(at) < 0)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  });

  function openDrawer(id, trigger) {
    state.open = id;
    lastTrigger = trigger || null;
    document.querySelectorAll("#rows tr").forEach(function (tr) { tr.classList.toggle("is-open", tr.getAttribute("data-id") === id); });
    renderDrawer();
    var d = document.getElementById("drawer");
    d.hidden = false;
    setModal(isModal());
    document.getElementById("d-title").focus({ preventScroll: true });
  }

  function closeDrawer() {
    state.open = null;
    setModal(false);
    document.getElementById("drawer").hidden = true;
    document.querySelectorAll("#rows tr.is-open").forEach(function (tr) { tr.classList.remove("is-open"); });
    if (lastTrigger && document.body.contains(lastTrigger)) lastTrigger.focus();
  }

  function renderDrawer() {
    var s = data.filter(function (x) { return x.id === state.open; })[0];
    if (!s) { closeDrawer(); return; }
    var o = CP.owner(s.owner), md = CP.models[s.model];

    document.getElementById("d-status").innerHTML = UI.statusBadge(s.status);
    document.getElementById("d-title").textContent = s.title;
    document.getElementById("d-event").textContent = (isActive(s) ? "Now: " : "Last event: ") + s.event;

    var actions = "";
    if (isActive(s)) actions += '<button type="button" class="btn danger" data-act="stop">' + icon("stop") + "Stop session</button>";
    actions += '<button type="button" class="btn" data-act="owner">More from ' + esc(o.name.split(" ")[0]) + "</button>";
    document.getElementById("d-actions").innerHTML = actions;

    var st = CP.store.read();
    var member = st.members.filter(function (m) { return m.id === o.id; })[0] || o;
    document.getElementById("d-facts").innerHTML =
      "<dt>Session ID</dt><dd><span class=\"mono\">" + s.id + '</span><button type="button" class="btn ghost sm copy" data-act="copy">' + icon("copy") + "Copy</button></dd>" +
      "<dt>Owner</dt><dd>" + UI.avatar(o) + esc(o.name) + ' <span class="hint">' + esc(member.role) + ", " + esc(o.title) + "</span></dd>" +
      "<dt>Mode</dt><dd>" + CP.modes[s.mode] + "</dd>" +
      "<dt>Model</dt><dd>" + md.label + ' <span class="hint mono">' + s.model + "</span></dd>" +
      "<dt>Backend</dt><dd>" + s.backend + "</dd>" +
      "<dt>Started</dt><dd>" + fmt.date(s.startedAt) + ", " + fmt.clock(s.startedAt) + "</dd>" +
      (s.status === "waiting" && s.waitingSince ? "<dt>Waiting since</dt><dd>" + fmt.clock(s.waitingSince) + ' <span class="hint">auto-stops at ' + fmt.clock(s.waitingSince + (Number(st.defaults.idleMinutes) || 60) * CP.MIN) + "</span></dd>" : "") +
      "<dt>Runtime</dt><dd class=\"num\">" + runtimeCell(s) + (isActive(s) ? ' <span class="hint">and counting</span>' : "") + "</dd>";

    var t = s.tokens, total = CP.totalTokens(s);
    var parts = [
      ["input", "Input", t.input, t.input * md.input / 1e6],
      ["output", "Output", t.output, t.output * md.output / 1e6],
      ["cache", "Cache reads", t.cache, t.cache * md.cache / 1e6]
    ];
    document.getElementById("d-bar").innerHTML = parts.map(function (p) {
      return '<span class="sw-' + p[0] + '" style="flex:' + Math.max(p[2] / total, 0.01) + '"></span>';
    }).join("");
    document.getElementById("d-bk-table").innerHTML =
      '<thead><tr><th scope="col">Type</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead><tbody>' +
      parts.map(function (p) {
        return '<tr><td><span class="sw sw-' + p[0] + '" aria-hidden="true"></span>' + p[1] + "</td><td>" + fmt.tokens(p[2]) + "</td><td>" + fmt.cost(p[3]) + "</td></tr>";
      }).join("") +
      "</tbody><tfoot><tr><td>Total</td><td>" + fmt.tokens(total) + "</td><td>" + fmt.cost(s.cost) + "</td></tr></tfoot>";
  }

  function stopSession(id) {
    var s = data.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var mins = Math.round(CP.runtimeMin(s));
    var prevStatus = s.status;
    CP.store.patch(function (st) {
      st.overrides[id] = { status: "stopped", minutes: mins, event: "Stopped by Maya Chen from the console" };
    });
    UI.hydrateRail();
    render();
    UI.toast("Stopped “" + s.title + "”", {
      undo: function () {
        CP.store.patch(function (st) { delete st.overrides[id]; });
        UI.hydrateRail();
        render();
        UI.toast("Resumed. Status is back to " + CP.statuses[prevStatus].label.toLowerCase() + ".");
      }
    });
  }

  /* ---------- events ---------- */

  function setStatus(f) { state.status = f; state.page = 1; render(); }

  document.getElementById("status-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-status]");
    if (b) setStatus(b.getAttribute("data-status"));
  });
  document.getElementById("status-tabs").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var i = FILTERS.indexOf(state.status) + (e.key === "ArrowRight" ? 1 : -1);
    i = (i + FILTERS.length) % FILTERS.length;
    setStatus(FILTERS[i]);
    document.querySelector('[data-status="' + FILTERS[i] + '"]').focus();
    e.preventDefault();
  });

  var search = document.getElementById("search");
  var debounce;
  search.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { state.q = search.value; state.page = 1; render(); }, 120);
  });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && !isModal() && tag !== "input" && tag !== "textarea" && tag !== "select") { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === "Escape") {
      if (document.activeElement === search && search.value) { search.value = ""; state.q = ""; render(); return; }
      if (state.open) closeDrawer();
    }
  });

  document.querySelector("#ledger thead").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-key]");
    if (!th) return;
    var k = th.getAttribute("data-key");
    var first = NUMERIC[k] ? "desc" : "asc";
    if (state.sort !== k) { state.sort = k; state.dir = first; }
    else if (state.dir === first) { state.dir = first === "asc" ? "desc" : "asc"; }
    else { state.sort = null; state.dir = "desc"; }
    state.page = 1;
    render();
    var btn = document.querySelector('th[data-key="' + k + '"] button');
    if (btn) btn.focus();
  });

  document.getElementById("sort-select").addEventListener("change", function (e) {
    var v = e.target.value.split(":");
    state.sort = v[0] || null; state.dir = v[1] || "desc"; state.page = 1;
    render();
  });

  document.getElementById("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    var id = tr.getAttribute("data-id");
    if (state.open === id && !e.target.closest("[data-open]")) { closeDrawer(); return; }
    openDrawer(id, tr.querySelector("[data-open]"));
  });

  document.getElementById("prev").addEventListener("click", function () { state.page--; render(); document.querySelector(".table-wrap").scrollIntoView({ block: "nearest" }); });
  document.getElementById("next").addEventListener("click", function () { state.page++; render(); document.querySelector(".table-wrap").scrollIntoView({ block: "nearest" }); });
  document.getElementById("clear-filters").addEventListener("click", function () {
    state.q = ""; search.value = ""; state.status = "all"; state.page = 1;
    state.facet = null; state.from = null; state.to = null;
    render(); search.focus();
  });
  document.getElementById("scope-clear").addEventListener("click", function () {
    state.facet = null; state.from = null; state.to = null; state.page = 1;
    render(); search.focus();
  });

  document.getElementById("d-close").addEventListener("click", closeDrawer);
  // the scrim beside a modal drawer closes it
  document.querySelector(".app").addEventListener("click", function (e) {
    if (isModal() && e.target === e.currentTarget) closeDrawer();
  });
  document.getElementById("drawer").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "stop") stopSession(state.open);
    if (act === "copy") {
      var id = state.open;
      var done = function () {
        b.innerHTML = icon("check") + "Copied";
        setTimeout(function () { if (b.isConnected) b.innerHTML = icon("copy") + "Copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done, function () { fallbackCopy(id); done(); });
      else { fallbackCopy(id); done(); }
    }
    if (act === "owner") {
      var s = data.filter(function (x) { return x.id === state.open; })[0];
      var name = CP.owner(s.owner).name;
      state.q = name; search.value = name; state.status = "all"; state.page = 1;
      render();
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  /* live runtime for active sessions */
  var lastActive = null;
  setInterval(function () {
    var active = CP.sessions().filter(isActive).map(function (s) { return s.id; }).join();
    if (lastActive !== null && active !== lastActive) {
      var stopped = data.filter(function (s) { return isActive(s) && active.indexOf(s.id) === -1; });
      UI.hydrateRail();
      render();
      stopped.forEach(function (s) { UI.toast("\u201c" + s.title + "\u201d was auto-stopped after waiting too long"); });
    }
    lastActive = active;
    document.querySelectorAll("[data-wait]").forEach(function (el) {
      var s = data.filter(function (x) { return x.id === el.getAttribute("data-wait"); })[0];
      if (s && s.waitingSince) el.textContent = fmt.runtime((CP.now() - s.waitingSince) / CP.MIN);
    });
    document.querySelectorAll("[data-rt]").forEach(function (el) {
      var s = data.filter(function (x) { return x.id === el.getAttribute("data-rt"); })[0];
      if (s && isActive(s)) el.textContent = fmt.runtime(CP.runtimeMin(s));
    });
  }, 1000);

  /* header date line */
  var today = new Date(CP.NOW);
  var todayCount = CP.sessions().filter(function (s) { return s.startedAt >= CP.today0; }).length;
  document.getElementById("today-line").textContent =
    today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + " · " + todayCount + " sessions started today";

  readUrl();
  search.value = state.q;
  render();
})();
