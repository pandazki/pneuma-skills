/* Carbon Park console: sample data and shared store.
   Everything here is synthetic. Rates are illustrative, not published pricing. */
(function () {
  "use strict";

  // Fixed reference clock so the sample workspace reads the same on every load.
  var NOW = new Date(2026, 8, 23, 17, 10, 0).getTime();
  var LOADED = Date.now();
  var MIN = 60 * 1000;
  var DAY = 24 * 60 * MIN;

  function now() { return NOW + (Date.now() - LOADED); }

  var owners = [
    { id: "maya",  name: "Maya Chen",       role: "Admin",  title: "Design lead",        email: "maya.chen@carbonpark.dev" },
    { id: "jonah", name: "Jonah Reyes",     role: "Editor", title: "Frontend engineer",  email: "jonah.reyes@carbonpark.dev" },
    { id: "priya", name: "Priya Natarajan", role: "Editor", title: "Product manager",    email: "priya.n@carbonpark.dev" },
    { id: "tom",   name: "Tom Becker",      role: "Editor", title: "Marketing lead",     email: "tom.becker@carbonpark.dev" },
    { id: "lena",  name: "Lena Okafor",     role: "Editor", title: "UX researcher",      email: "lena.okafor@carbonpark.dev" },
    { id: "sam",   name: "Sam Whitfield",   role: "Viewer", title: "Data engineer",      email: "sam.whitfield@carbonpark.dev" }
  ];

  // USD per 1M tokens: input, output, cache read. Illustrative only.
  var models = {
    "claude-opus-5-5":  { label: "Opus 5.5",   backend: "claude-code", input: 5,   output: 25, cache: 0.5 },
    "claude-sonnet-5":  { label: "Sonnet 5",   backend: "claude-code", input: 3,   output: 15, cache: 0.3 },
    "claude-haiku-4-5": { label: "Haiku 4.5",  backend: "claude-code", input: 1,   output: 5,  cache: 0.1 },
    "gpt-5.4":          { label: "GPT-5.4",    backend: "codex",       input: 2.5, output: 15, cache: 0.25 }
  };

  var modes = {
    webcraft:  "WebCraft",
    slide:     "Slide",
    doc:       "Doc",
    diagram:   "Diagram",
    clipcraft: "ClipCraft",
    remotion:  "Remotion",
    illustrate:"Illustrate",
    gridboard: "GridBoard",
    draw:      "Draw"
  };

  var statuses = {
    running:   { label: "Running" },
    waiting:   { label: "Waiting" },
    completed: { label: "Completed" },
    failed:    { label: "Failed" },
    stopped:   { label: "Stopped" }
  };

  // title, mode, owner, preferred models
  var pool = [
    ["Pricing page refresh", "webcraft", "tom", ["claude-sonnet-5", "claude-haiku-4-5"]],
    ["Trail map landing page", "webcraft", "maya", ["claude-opus-5-5"]],
    ["Docs site navigation rebuild", "webcraft", "jonah", ["claude-sonnet-5", "gpt-5.4"]],
    ["Careers page with open roles", "webcraft", "tom", ["claude-sonnet-5"]],
    ["Status page redesign", "webcraft", "jonah", ["claude-opus-5-5", "gpt-5.4"]],
    ["Changelog template", "webcraft", "jonah", ["gpt-5.4", "claude-sonnet-5"]],
    ["Partner program microsite", "webcraft", "tom", ["claude-sonnet-5"]],
    ["Checkout error states", "webcraft", "maya", ["claude-opus-5-5", "claude-sonnet-5"]],
    ["Meetup registration page", "webcraft", "tom", ["claude-haiku-4-5"]],
    ["Accessibility fixes on signup form", "webcraft", "jonah", ["claude-sonnet-5"]],
    ["Q4 planning deck", "slide", "priya", ["claude-opus-5-5", "claude-sonnet-5"]],
    ["Board update, September", "slide", "priya", ["claude-opus-5-5"]],
    ["Customer research readout", "slide", "lena", ["claude-sonnet-5"]],
    ["Sales enablement: Team tier", "slide", "tom", ["claude-sonnet-5", "claude-haiku-4-5"]],
    ["All-hands: platform roadmap", "slide", "priya", ["claude-sonnet-5"]],
    ["Onboarding interview findings", "slide", "lena", ["claude-sonnet-5", "claude-opus-5-5"]],
    ["Pipeline cost review", "slide", "sam", ["gpt-5.4"]],
    ["RFC: session retention policy", "doc", "sam", ["gpt-5.4", "claude-opus-5-5"]],
    ["Incident review INC-2291", "doc", "sam", ["claude-opus-5-5"]],
    ["Research plan: admin workflows", "doc", "lena", ["claude-sonnet-5"]],
    ["PRD: usage alerts", "doc", "priya", ["claude-haiku-4-5", "claude-sonnet-5"]],
    ["Style guide v3 draft", "doc", "maya", ["claude-opus-5-5"]],
    ["API migration guide", "doc", "jonah", ["gpt-5.4"]],
    ["Interview guide, power users", "doc", "lena", ["claude-haiku-4-5"]],
    ["Ingest pipeline architecture", "diagram", "sam", ["gpt-5.4", "claude-opus-5-5"]],
    ["Auth flow sequence", "diagram", "jonah", ["claude-sonnet-5"]],
    ["Billing data model", "diagram", "sam", ["gpt-5.4"]],
    ["Onboarding journey map", "diagram", "lena", ["claude-sonnet-5"]],
    ["Team ownership map", "diagram", "priya", ["claude-haiku-4-5"]],
    ["Launch teaser, 30s cut", "clipcraft", "tom", ["claude-sonnet-5"]],
    ["Feature walkthrough: usage page", "clipcraft", "tom", ["claude-sonnet-5"]],
    ["Customer story rough cut", "clipcraft", "tom", ["claude-opus-5-5"]],
    ["Animated metrics recap, August", "remotion", "sam", ["gpt-5.4"]],
    ["Product intro motion graphic", "remotion", "maya", ["claude-opus-5-5"]],
    ["Blog header illustrations, set of 4", "illustrate", "maya", ["claude-opus-5-5"]],
    ["Empty state illustrations", "illustrate", "maya", ["claude-sonnet-5"]],
    ["Conference booth poster", "illustrate", "tom", ["claude-sonnet-5"]],
    ["Ops dashboard prototype", "gridboard", "sam", ["gpt-5.4", "claude-sonnet-5"]],
    ["Research synthesis board", "gridboard", "lena", ["claude-sonnet-5"]],
    ["Launch checklist board", "gridboard", "priya", ["claude-haiku-4-5"]],
    ["Wireframes: settings IA", "draw", "maya", ["claude-sonnet-5"]],
    ["Sketch: mobile nav options", "draw", "jonah", ["claude-haiku-4-5"]]
  ];

  // Tokens per runtime minute, by mode (includes cache reads).
  var intensity = {
    webcraft: 62000, slide: 54000, doc: 38000, diagram: 41000, clipcraft: 70000,
    remotion: 66000, illustrate: 30000, gridboard: 46000, draw: 28000
  };

  var failReasons = [
    "Context window exceeded while loading attached logs",
    "Rate limited by provider after 3 retries",
    "Viewer build failed: manifest.json lists a missing page",
    "Deploy to Cloudflare Pages rejected: token expired",
    "Export timed out after 10 minutes"
  ];
  var stopReasons = [
    "Stopped by owner",
    "Auto-stopped after 60 minutes waiting",
    "Stopped by owner after brief changed"
  ];
  var doneEvents = [
    "Exported static site",
    "Deck exported to PDF",
    "Final revision saved",
    "Published to Vercel preview",
    "Handed off to doc mode",
    "Owner closed the session"
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20260923);
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function makeId() {
    var s = "", chars = "abcdefghjkmnpqrstuvwxyz23456789";
    for (var i = 0; i < 6; i++) s += chars[Math.floor(rnd() * chars.length)];
    return "ses_" + s;
  }

  function tokensFor(mode, minutes) {
    var total = Math.round(minutes * intensity[mode] * (0.7 + rnd() * 0.6));
    var output = Math.round(total * (0.045 + rnd() * 0.03));
    var input = Math.round(total * (0.11 + rnd() * 0.06));
    return { input: input, output: output, cache: total - input - output };
  }

  function costFor(model, t) {
    var r = models[model];
    return (t.input * r.input + t.output * r.output + t.cache * r.cache) / 1e6;
  }

  var sessions = [];

  // Titles that only make sense once (a dated incident, a monthly update).
  var ONCE = ["Incident review INC-2291", "Board update, September", "Meetup registration page", "Blog header illustrations, set of 4",
    "Conference booth poster", "Animated metrics recap, August", "Customer research readout", "Status page redesign", "PRD: usage alerts",
    "Launch teaser, 30s cut", "Accessibility fixes on signup form", "Q4 planning deck"];
  var RESERVED = ["Incident review INC-2291", "Blog header illustrations, set of 4", "PRD: usage alerts", "Launch teaser, 30s cut",
    "Customer research readout", "Q4 planning deck", "Status page redesign", "Accessibility fixes on signup form"];
  var usedCount = {};
  var FOLLOW = [", revisions", ", follow-up", ", review fixes", ", copy pass"];
  function titleFor(entry) {
    var n = (usedCount[entry[0]] = (usedCount[entry[0]] || 0) + 1);
    return n === 1 ? entry[0] : entry[0] + FOLLOW[(n - 2) % FOLLOW.length];
  }
  function pickHistory() {
    for (;;) {
      var e = pick(pool), t = e[0];
      if (RESERVED.indexOf(t) > -1) continue;
      if (ONCE.indexOf(t) > -1 && usedCount[t]) continue;
      return e;
    }
  }

  function add(entry, startedAt, minutes, status, model, event, waitingSince) {
    var mode = entry[1];
    model = model || pick(entry[3]);
    var t = tokensFor(mode, minutes);
    sessions.push({
      id: makeId(),
      title: titleFor(entry),
      mode: mode,
      owner: entry[2],
      model: model,
      backend: models[model].backend,
      status: status,
      startedAt: startedAt,
      // Finished sessions carry a fixed runtime; active ones are measured live.
      minutes: status === "running" || status === "waiting" ? null : minutes,
      tokens: t,
      cost: costFor(model, t),
      event: event,
      waitingSince: waitingSince || null
    });
  }

  // History: 62 days back through yesterday.
  var today0 = new Date(2026, 8, 23).getTime();
  for (var d = 62; d >= 1; d--) {
    var dayStart = today0 - d * DAY;
    var dow = new Date(dayStart).getDay();
    var count = dow === 0 || dow === 6 ? Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 4);
    for (var i = 0; i < count; i++) {
      var entry = pickHistory();
      var start = dayStart + (8.5 + rnd() * 9) * 60 * MIN;
      var minutes = Math.round(6 + Math.pow(rnd(), 1.6) * 130);
      var roll = rnd();
      var status = roll < 0.06 ? "failed" : roll < 0.14 ? "stopped" : "completed";
      var event = status === "failed" ? pick(failReasons) : status === "stopped" ? pick(stopReasons) : pick(doneEvents);
      if (status === "failed") minutes = Math.max(4, Math.round(minutes * 0.45));
      add(entry, Math.round(start), minutes, status, null, event);
    }
  }

  function find(title) {
    for (var i = 0; i < pool.length; i++) if (pool[i][0] === title) return pool[i];
    throw new Error("Unknown title " + title);
  }
  function at(h, m) { return today0 + (h * 60 + m) * MIN; }

  // Today, hand-placed so the active states are all represented.
  add(find("Accessibility fixes on signup form"), at(9, 12), 47, "completed", "claude-sonnet-5", "Published to Vercel preview");
  add(find("Incident review INC-2291"), at(10, 30), 22, "failed", "claude-opus-5-5", "Context window exceeded while loading attached logs");
  add(find("Blog header illustrations, set of 4"), at(11, 5), 38, "completed", "claude-opus-5-5", "Final revision saved");
  add(find("PRD: usage alerts"), at(13, 40), 0, "waiting", "claude-haiku-4-5", "Asked for the default alert threshold", at(16, 44));
  add(find("Launch teaser, 30s cut"), at(14, 20), 0, "running", "claude-sonnet-5", "Encoding 1080p preview");
  add(find("Customer research readout"), at(15, 5), 0, "waiting", "claude-sonnet-5", "Asked which participant quotes can appear on slide 6", at(16, 52));
  add(find("Q4 planning deck"), at(15, 52), 0, "running", "claude-opus-5-5", "Rendering slide 14 of 22");
  add(find("Status page redesign"), at(16, 10), 0, "waiting", "claude-opus-5-5", "Needs approval to deploy to Cloudflare Pages", at(17, 1));
  add(find("Pricing page refresh"), at(16, 38), 0, "running", "claude-sonnet-5", "Editing pricing/plans.css");
  add(find("Ingest pipeline architecture"), at(16, 55), 0, "running", "gpt-5.4", "Laying out 18 nodes");

  // Active sessions: tokens reflect elapsed time at the reference clock.
  sessions.forEach(function (s) {
    if (s.minutes === null) {
      var m = (NOW - s.startedAt) / MIN;
      var work = s.waitingSince ? (s.waitingSince - s.startedAt) / MIN : m;
      s.tokens = tokensFor(s.mode, work);
      s.cost = costFor(s.model, s.tokens);
    }
  });

  sessions.sort(function (a, b) { return b.startedAt - a.startedAt; });

  /* ---------- persistent store ---------- */

  var DEFAULTS = {
    workspace: { name: "Carbon Park", slug: "carbon-park" },
    defaults: { backend: "claude-code", model: "claude-sonnet-5", idleMinutes: 60, deployApproval: true },
    budget: { monthly: 500, alertAt: 80, emailAlerts: true, recipients: "maya.chen@carbonpark.dev, priya.n@carbonpark.dev" },
    members: owners.map(function (o) { return { id: o.id, name: o.name, email: o.email, role: o.role, title: o.title }; }),
    keys: [
      { id: "key_ci", name: "CI deploy bot", prefix: "pk_live_7Hq2", created: today0 - 41 * DAY, lastUsed: today0 - 1 * DAY + 14 * 60 * MIN },
      { id: "key_ex", name: "Usage export (Sam)", prefix: "pk_live_c9Xm", created: today0 - 12 * DAY, lastUsed: today0 - 3 * DAY }
    ],
    overrides: {}
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var KEY = "carbon-park.console.v1";
  var store = {
    read: function () {
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
      var out = clone(DEFAULTS);
      if (saved) {
        ["workspace", "defaults", "budget"].forEach(function (k) {
          if (saved[k]) for (var p in saved[k]) out[k][p] = saved[k][p];
        });
        if (Array.isArray(saved.members)) out.members = saved.members;
        if (Array.isArray(saved.keys)) out.keys = saved.keys;
        if (saved.overrides) out.overrides = saved.overrides;
      }
      return out;
    },
    write: function (state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    },
    patch: function (fn) {
      var s = store.read(); fn(s); store.write(s); return s;
    },
    defaults: function () { return clone(DEFAULTS); }
  };

  // Apply stored session overrides (e.g. a session the user stopped).
  // Apply stored overrides, then the idle rule: a session waiting on its
  // owner longer than the workspace limit is stopped.
  function liveSessions() {
    var st = store.read(), ov = st.overrides;
    var idle = Number(st.defaults.idleMinutes) || 60;
    var t = now();
    return sessions.map(function (s) {
      var c = ov[s.id] ? Object.assign({}, s, ov[s.id]) : s;
      if (c.status === "waiting" && c.waitingSince && t - c.waitingSince > idle * MIN) {
        var stopAt = c.waitingSince + idle * MIN;
        c = Object.assign({}, c, { status: "stopped", minutes: (stopAt - c.startedAt) / MIN, event: "Auto-stopped after " + idle + " minutes waiting", autoStopped: true });
      }
      return c;
    });
  }

  function runtimeMin(s) {
    if (s.minutes !== null && s.minutes !== undefined) return s.minutes;
    return (now() - s.startedAt) / MIN;
  }
  function totalTokens(s) { return s.tokens.input + s.tokens.output + s.tokens.cache; }

  /* ---------- formatting ---------- */

  var fmt = {
    tokens: function (n) {
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2) + "M";
      if (n >= 1e3) return Math.round(n / 1e3) + "K";
      return String(n);
    },
    cost: function (n) {
      return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    money0: function (n) { return "$" + Math.round(n).toLocaleString("en-US"); },
    runtime: function (min) {
      if (min < 1) return Math.max(1, Math.round(min * 60)) + "s";
      var h = Math.floor(min / 60), m = Math.floor(min % 60);
      return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
    },
    clock: function (ms) {
      var d = new Date(ms);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    },
    when: function (ms) {
      var d0 = new Date(ms); d0.setHours(0, 0, 0, 0);
      var diff = Math.round((today0 - d0.getTime()) / DAY);
      if (diff === 0) return "Today " + fmt.clock(ms);
      if (diff === 1) return "Yesterday " + fmt.clock(ms);
      return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + fmt.clock(ms);
    },
    date: function (ms) {
      return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    },
    pct: function (n) { return (Math.round(n * 10) / 10).toFixed(1) + "%"; },
    initials: function (name) { return name.split(" ").map(function (p) { return p[0]; }).join("").slice(0, 2); }
  };

  window.CP = {
    NOW: NOW, DAY: DAY, MIN: MIN, today0: today0, now: now,
    owners: owners, models: models, modes: modes, statuses: statuses,
    sessions: liveSessions, runtimeMin: runtimeMin, totalTokens: totalTokens,
    store: store, fmt: fmt,
    owner: function (id) { for (var i = 0; i < owners.length; i++) if (owners[i].id === id) return owners[i]; return null; }
  };
})();
