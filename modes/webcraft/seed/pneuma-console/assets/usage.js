/* Usage page: budget pace, range summary, daily chart, breakdowns. */
(function () {
  "use strict";

  var fmt = CP.fmt, esc = UI.esc, icon = UI.icon, DAY = CP.DAY;
  var MONTH0 = new Date(2026, 8, 1).getTime();
  var MONTH_DAYS = 30;
  var PREV_MONTH0 = new Date(2026, 7, 1).getTime();

  var state = { range: "month", metric: "cost", group: "mode", focus: null };
  var p = new URLSearchParams(location.search);
  if (["7", "30", "month"].indexOf(p.get("range")) > -1) state.range = p.get("range");
  if (["cost", "tokens", "sessions"].indexOf(p.get("metric")) > -1) state.metric = p.get("metric");
  if (["mode", "model", "owner"].indexOf(p.get("group")) > -1) state.group = p.get("group");

  var sessions = [];

  function sum(arr, f) { return arr.reduce(function (a, x) { return a + f(x); }, 0); }
  function inWin(s, a, b) { return s.startedAt >= a && s.startedAt < b; }
  function dayStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function shortDate(ms) { return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

  function windowFor(range) {
    var todayIdx = Math.round((CP.today0 - MONTH0) / DAY);
    if (range === "month") {
      return {
        start: MONTH0, days: MONTH_DAYS, shownThrough: todayIdx,
        prevStart: PREV_MONTH0, prevEnd: PREV_MONTH0 + (todayIdx + 1) * DAY,
        label: "September 1 to " + shortDate(CP.today0) + ", month to date",
        prevLabel: "Aug 1–" + (todayIdx + 1)
      };
    }
    var n = Number(range);
    var start = CP.today0 - (n - 1) * DAY;
    return {
      start: start, days: n, shownThrough: n - 1,
      prevStart: start - n * DAY, prevEnd: start,
      label: shortDate(start) + " to " + shortDate(CP.today0),
      prevLabel: "prior " + n + " days"
    };
  }

  /* ---------- budget ---------- */

  function renderBudget() {
    var st = CP.store.read();
    var budget = Math.max(0, Number(st.budget.monthly) || 0);
    var alertPct = Number(st.budget.alertAt) || 80;
    var alertAmt = budget * alertPct / 100;
    var spent = sum(sessions.filter(function (s) { return s.startedAt >= MONTH0; }), function (s) { return s.cost; });
    var elapsed = Math.max(0.5, (CP.NOW - MONTH0) / DAY);
    var daily = spent / elapsed;
    var projected = daily * MONTH_DAYS;

    var verdict, cls;
    function dayOf(amount) { return shortDate(MONTH0 + Math.floor(amount / daily) * DAY); }
    if (!budget) { cls = ""; verdict = "No monthly budget is set. <strong>" + fmt.money0(spent) + "</strong> spent so far."; }
    else if (spent >= budget) { cls = "bad"; verdict = '<span class="bad">Over budget by ' + fmt.money0(spent - budget) + "</span>. Projected " + fmt.money0(projected) + " by Sep 30."; }
    else if (projected > budget) { cls = "bad"; verdict = '<span class="bad">Projected ' + fmt.money0(projected) + " by Sep 30</span>, " + fmt.money0(projected - budget) + " over. At this pace the budget runs out around " + dayOf(budget) + "."; }
    else if (spent >= alertAmt) { cls = "warn"; verdict = '<span class="warn">Past the ' + alertPct + "% alert</span>. Projected " + fmt.money0(projected) + " of " + fmt.money0(budget) + " by Sep 30."; }
    else if (projected >= alertAmt) { cls = "warn"; verdict = "<strong>" + fmt.money0(spent) + "</strong> of " + fmt.money0(budget) + ' spent. <span class="warn">Crosses the ' + alertPct + "% alert around " + dayOf(alertAmt) + "</span>, projected " + fmt.money0(projected) + " by Sep 30."; }
    else { cls = "ok"; verdict = "<strong>" + fmt.money0(spent) + "</strong> of " + fmt.money0(budget) + ' spent. <span class="ok">On pace</span>, projected ' + fmt.money0(projected) + " by Sep 30."; }
    document.getElementById("budget-verdict").innerHTML = verdict;

    var scale = Math.max(budget, projected, spent) * 1.04 || 1;
    function pct(v) { return (Math.min(v, scale) / scale * 100).toFixed(2) + "%"; }
    var html = '<div class="bt-rail"><div class="bt-proj ' + cls + '" style="left:' + pct(spent) + ";width:calc(" + pct(Math.max(0, projected - spent)) + ')"></div>' +
      '<div class="bt-spent" style="width:' + pct(spent) + '"></div></div>';
    if (budget) {
      html += '<div class="bt-mark" style="left:' + pct(alertAmt) + '"></div>';
      html += '<div class="bt-mark end" style="left:' + pct(budget) + '"></div>';
    }
    var track = document.getElementById("budget-track");
    track.innerHTML = html;
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", "Spent " + fmt.money0(spent) + ", projected " + fmt.money0(projected) + (budget ? ", budget " + fmt.money0(budget) : ""));

    var projColor = { bad: "oklch(0.82 0.08 30)", warn: "oklch(0.86 0.09 80)" }[cls] || "oklch(0.82 0.06 152)";
    document.getElementById("budget-foot").innerHTML =
      '<span class="bt-legend"><span><i style="background:var(--park)"></i>Spent ' + fmt.money0(spent) + '</span>' +
      '<span><i style="background:' + projColor + '"></i>Projected ' + fmt.money0(projected) + " at " + fmt.cost(daily) + "/day</span>" +
      (budget ? '<span><i class="tick"></i>Alert ' + fmt.money0(alertAmt) + '</span><span><i class="tick end"></i>Budget ' + fmt.money0(budget) + "</span>" : "") + "</span>" +
      'Budget and alert threshold are set in <a href="settings.html#budget">Settings</a>.';
  }

  /* ---------- summary ---------- */

  function renderSummary(w, cur, prev) {
    function delta(a, b, money) {
      if (!b) return "No data for " + w.prevLabel;
      var d = (a - b) / b, up = d >= 0;
      return '<span class="' + (up ? "up" : "down") + '">' + icon(up ? "up" : "down") + (up ? "+" : "−") + Math.abs(Math.round(d * 100)) + "%</span> vs " + w.prevLabel;
    }
    var cost = sum(cur, function (s) { return s.cost; }), pcost = sum(prev, function (s) { return s.cost; });
    var tok = sum(cur, CP.totalTokens), ptok = sum(prev, CP.totalTokens);
    var avg = cur.length ? cost / cur.length : 0, pavg = prev.length ? pcost / prev.length : 0;
    var perM = tok ? cost / (tok / 1e6) : 0;
    function k(label, value, meta) { return '<div class="kpi"><p class="kpi-label">' + label + '</p><p class="kpi-value">' + value + '</p><p class="kpi-meta">' + meta + "</p></div>"; }
    document.getElementById("summary").innerHTML =
      k("Spend", fmt.cost(cost), delta(cost, pcost)) +
      k("Tokens", fmt.tokens(tok), delta(tok, ptok)) +
      k("Sessions", String(cur.length), delta(cur.length, prev.length)) +
      k("Average per session", fmt.cost(avg), delta(avg, pavg)) +
      k("Blended cost", fmt.cost(perM) + "<small>per 1M</small>", "Across all models and token types");
  }

  /* ---------- chart ---------- */

  var chartDays = [];

  function niceMax(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * e >= v) return steps[i] * e;
    return 10 * e;
  }

  function metricFmt(v, axis) {
    if (state.metric === "cost") return axis ? "$" + Math.round(v) : fmt.cost(v);
    if (state.metric === "tokens") return fmt.tokens(v);
    return String(Math.round(v));
  }

  function renderChart(w, cur) {
    chartDays = [];
    for (var i = 0; i < w.days; i++) {
      var a = w.start + i * DAY, list = cur.filter(function (s) { return inWin(s, a, a + DAY); });
      chartDays.push({
        t: a, future: i > w.shownThrough, today: i === w.shownThrough,
        cost: sum(list, function (s) { return s.cost; }), tokens: sum(list, CP.totalTokens), sessions: list.length
      });
    }
    var el = document.getElementById("chart");
    var W = Math.max(280, el.clientWidth), H = el.clientHeight || 240;
    var padL = 44, padR = 8, padT = 12, padB = 26;
    var innerW = W - padL - padR, innerH = H - padT - padB;

    var st = CP.store.read();
    var pace = state.metric === "cost" && Number(st.budget.monthly) ? Number(st.budget.monthly) / MONTH_DAYS : null;
    var maxV = niceMax(Math.max(pace || 0, Math.max.apply(null, chartDays.map(function (d) { return d[state.metric]; }))) * 1.04);
    var ticks = 4;

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" tabindex="0" role="application" aria-label="Daily ' + state.metric + ' chart. Use left and right arrow keys to read each day." id="chart-svg">';
    svg += '<g class="grid">';
    for (var t = 0; t <= ticks; t++) {
      var v = maxV * t / ticks, y = padT + innerH - innerH * t / ticks;
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + metricFmt(v, true) + "</text>";
    }
    svg += "</g>";

    var slot = innerW / w.days, bw = Math.max(3, Math.min(28, slot * 0.62));
    svg += '<g class="cols">';
    chartDays.forEach(function (d, i) {
      var v = d[state.metric], h = innerH * v / maxV;
      var x = padL + slot * i + (slot - bw) / 2;
      svg += '<g class="col' + (state.focus === i ? " on" : "") + '" data-i="' + i + '">' +
        '<rect class="hit" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + innerH + '" rx="3"/>' +
        (d.future ? "" : '<rect class="bar' + (d.today ? " today" : "") + '" x="' + x + '" y="' + (padT + innerH - h) + '" width="' + bw + '" height="' + Math.max(h, v ? 1.5 : 0) + '" rx="2"/>') +
        "</g>";
    });
    svg += "</g>";
    svg += '<line class="base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) + '"/>';

    if (pace) {
      var py = padT + innerH - innerH * pace / maxV;
      svg += '<line class="pace" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + py + '" y2="' + py + '"/>';
      svg += '<text class="pace-label" x="' + (W - padR) + '" y="' + (py - 6) + '" text-anchor="end">Budget pace ' + fmt.cost(pace) + "/day</text>";
    }

    svg += '<g class="xlab">';
    var lastX = -Infinity, minGap = 52;
    chartDays.forEach(function (d, i) {
      var dt = new Date(d.t), x = padL + slot * i + slot / 2, show;
      if (w.days <= 7) { show = true; minGap = 0; }
      else if (state.range === "month") show = [1, 5, 10, 15, 20, 25, 30].indexOf(dt.getDate()) > -1;
      else show = (w.days - 1 - i) % 5 === 0;
      if (!show || x - lastX < minGap) return;
      lastX = x;
      var label = w.days <= 7 ? dt.toLocaleDateString("en-US", slot < 52 ? { weekday: "narrow" } : { weekday: "short", day: "numeric" }) : shortDate(d.t);
      svg += '<text x="' + x + '" y="' + (H - 6) + '" text-anchor="middle">' + label + "</text>";
    });
    svg += "</g></svg>";
    el.innerHTML = svg;

    el.__geom = { padL: padL, padT: padT, innerH: innerH, slot: slot, maxV: maxV };
    if (state.focus !== null) showTip(state.focus);
    document.getElementById("chart-title").textContent = { cost: "Daily spend", tokens: "Daily tokens", sessions: "Sessions per day" }[state.metric];
  }

  function showTip(i) {
    var d = chartDays[i], el = document.getElementById("chart"), g = el.__geom, tip = document.getElementById("tip");
    if (!d || !g) return;
    state.focus = i;
    el.querySelectorAll(".col").forEach(function (c) { c.classList.toggle("on", Number(c.getAttribute("data-i")) === i); });
    var h = g.innerH * d[state.metric] / g.maxV;
    var x = g.padL + g.slot * i + g.slot / 2;
    var y = g.padT + g.innerH - h;
    var dt = new Date(d.t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    tip.innerHTML = d.future
      ? "<b>" + dt + "</b><span>Not yet</span>"
      : "<b>" + dt + (d.today ? ", today" : "") + "</b>" + fmt.cost(d.cost) + " <span>spend</span><br>" + fmt.tokens(d.tokens) + " <span>tokens</span><br>" + d.sessions + " <span>session" + (d.sessions === 1 ? "" : "s") + "</span>";
    tip.hidden = false;
    var cw = el.clientWidth;
    var left = Math.min(Math.max(x, 80), cw - 80);
    tip.style.left = left + "px";
    tip.style.top = (el.offsetTop + Math.max(y, 40)) + "px";
  }
  function hideTip() {
    state.focus = null;
    document.getElementById("tip").hidden = true;
    document.querySelectorAll("#chart .col.on").forEach(function (c) { c.classList.remove("on"); });
  }

  var chartEl = document.getElementById("chart");
  chartEl.addEventListener("mousemove", function (e) {
    var c = e.target.closest(".col");
    if (c) showTip(Number(c.getAttribute("data-i")));
  });
  chartEl.addEventListener("mouseleave", function () { if (document.activeElement && document.activeElement.id === "chart-svg") return; hideTip(); });
  chartEl.addEventListener("focusin", function () { if (state.focus === null) showTip(windowFor(state.range).shownThrough); });
  chartEl.addEventListener("focusout", hideTip);
  chartEl.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    var i = state.focus === null ? 0 : state.focus;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    if (e.key === "ArrowRight") i = Math.min(chartDays.length - 1, i + 1);
    if (e.key === "Home") i = 0;
    if (e.key === "End") i = chartDays.length - 1;
    showTip(i);
  });

  /* ---------- breakdown ---------- */

  function renderBreakdown(cur) {
    var groups = {};
    cur.forEach(function (s) {
      var k = s[state.group];
      var g = groups[k] || (groups[k] = { key: k, n: 0, tokens: 0, cost: 0 });
      g.n++; g.tokens += CP.totalTokens(s); g.cost += s.cost;
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.cost - a.cost; });
    var total = sum(rows, function (r) { return r.cost; });
    var max = rows.length ? rows[0].cost : 1;

    function label(k) {
      if (state.group === "mode") return { name: CP.modes[k], sub: "" };
      if (state.group === "model") return { name: CP.models[k].label, sub: CP.models[k].backend };
      var o = CP.owner(k); return { name: o.name, sub: o.title };
    }
    var head = { mode: "Mode", model: "Model", owner: "Owner" }[state.group];
    var html = '<thead><tr><th scope="col">' + head + '</th><th scope="col">Sessions</th><th scope="col" class="hide-sm">Tokens</th><th scope="col">Spend</th><th scope="col" class="share">Share of spend</th></tr></thead><tbody>';
    if (!rows.length) html += '<tr><td colspan="5">No sessions in this range.</td></tr>';
    rows.forEach(function (r) {
      var l = label(r.key), share = total ? r.cost / total : 0;
      var w = windowFor(state.range);
      var href = "index.html?" + state.group + "=" + encodeURIComponent(r.key) + "&from=" + dayStr(w.start) + "&to=" + dayStr(CP.today0);
      html += "<tr><td>" + (state.group === "owner" ? '<span class="who">' + UI.avatar(CP.owner(r.key)) : "") +
        '<a href="' + href + '" aria-label="' + esc(l.name) + ', view these ' + r.n + ' sessions">' + esc(l.name) + icon("arrow") + "</a>" +
        (state.group === "owner" ? "</span>" : "") +
        (l.sub && state.group !== "owner" ? ' <span class="sub">' + esc(l.sub) + "</span>" : "") + "</td>" +
        "<td>" + r.n + '</td><td class="hide-sm">' + fmt.tokens(r.tokens) + "</td><td>" + fmt.cost(r.cost) + "</td>" +
        '<td class="share"><span class="sharebar"><span style="width:' + (r.cost / max * 100).toFixed(1) + '%"></span><em>' + Math.round(share * 100) + "%</em></span></td></tr>";
    });
    html += "</tbody>";
    if (rows.length) {
      html += '<tfoot><tr><td>Total</td><td>' + sum(rows, function (r) { return r.n; }) + '</td><td class="hide-sm">' + fmt.tokens(sum(rows, function (r) { return r.tokens; })) + "</td><td>" + fmt.cost(total) + '</td><td class="share"></td></tr></tfoot>';
    }
    document.getElementById("bd").innerHTML = html;
  }

  function renderTop(cur) {
    var top = cur.slice().sort(function (a, b) { return b.cost - a.cost; }).slice(0, 6);
    document.getElementById("top").innerHTML = top.length ? top.map(function (s) {
      var o = CP.owner(s.owner);
      return '<li><a href="index.html?q=' + s.id + '"><span class="t">' + esc(s.title) + '</span><span class="c">' + fmt.cost(s.cost) + "</span>" +
        '<span class="m">' + esc(o.name) + " · " + CP.modes[s.mode] + " · " + CP.models[s.model].label + " · " + fmt.tokens(CP.totalTokens(s)) + " tokens · " + fmt.when(s.startedAt) + "</span></a></li>";
    }).join("") : '<li class="top-empty">No sessions in this range.</li>';
  }

  function renderRates() {
    var parts = Object.keys(CP.models).map(function (k) {
      var m = CP.models[k];
      return m.label + " $" + m.input + " / $" + m.output + " / $" + m.cache.toFixed(2);
    });
    document.getElementById("rates").textContent =
      "Sample workspace. Costs are computed from token counts at illustrative rates per 1M tokens (input / output / cache read): " + parts.join("; ") + ".";
  }

  /* ---------- wiring ---------- */

  function syncSeg(id, attr, val) {
    document.querySelectorAll("#" + id + " [" + attr + "]").forEach(function (b) {
      var on = b.getAttribute(attr) === val;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
  }

  function writeUrl() {
    var q = new URLSearchParams();
    if (state.range !== "month") q.set("range", state.range);
    if (state.metric !== "cost") q.set("metric", state.metric);
    if (state.group !== "mode") q.set("group", state.group);
    var s = q.toString();
    try { history.replaceState(null, "", location.pathname + (s ? "?" + s : "")); } catch (e) {}
  }

  function render() {
    sessions = CP.sessions();
    var w = windowFor(state.range);
    var end = w.start + w.days * DAY;
    var cur = sessions.filter(function (s) { return inWin(s, w.start, end); });
    var prev = sessions.filter(function (s) { return inWin(s, w.prevStart, w.prevEnd); });
    document.getElementById("range-line").textContent = w.label;
    syncSeg("range", "data-range", state.range);
    syncSeg("metric", "data-metric", state.metric);
    syncSeg("group", "data-group", state.group);
    state.focus = null;
    document.getElementById("tip").hidden = true;
    renderBudget();
    renderSummary(w, cur, prev);
    renderChart(w, cur);
    renderBreakdown(cur);
    renderTop(cur);
    writeUrl();
  }

  function segGroup(id, attr, key) {
    var el = document.getElementById(id);
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[" + attr + "]");
      if (!b) return;
      state[key] = b.getAttribute(attr);
      render();
    });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var btns = Array.prototype.slice.call(el.querySelectorAll("[" + attr + "]"));
      var i = btns.findIndex(function (b) { return b.getAttribute(attr) === state[key]; });
      i = (i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length;
      state[key] = btns[i].getAttribute(attr);
      render();
      el.querySelector("[" + attr + '="' + state[key] + '"]').focus();
      e.preventDefault();
    });
  }
  segGroup("range", "data-range", "range");
  segGroup("metric", "data-metric", "metric");
  segGroup("group", "data-group", "group");

  var rt;
  if (window.ResizeObserver) {
    new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(function () { renderChart(windowFor(state.range), sessions.filter(function (s) { var w = windowFor(state.range); return inWin(s, w.start, w.start + w.days * DAY); })); }, 80); }).observe(chartEl);
  }

  renderRates();
  render();
})();
