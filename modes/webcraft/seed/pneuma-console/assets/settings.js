/* Settings page: validated form with save bar, members, API keys. */
(function () {
  "use strict";

  var esc = UI.esc, icon = UI.icon, fmt = CP.fmt;
  var ME = "maya";
  var EMAIL = /^[^\s@,]+@[^\s@,]+\.[a-z]{2,}$/i;
  var form = document.getElementById("settings-form");
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- form model ---------- */

  function fromStore() {
    var st = CP.store.read();
    return {
      name: st.workspace.name, slug: st.workspace.slug,
      backend: st.defaults.backend, model: st.defaults.model, idleMinutes: String(st.defaults.idleMinutes), deployApproval: !!st.defaults.deployApproval,
      monthly: String(st.budget.monthly), alertAt: String(st.budget.alertAt), emailAlerts: !!st.budget.emailAlerts, recipients: st.budget.recipients
    };
  }
  var saved = fromStore();
  var touched = {};

  function fillModels(backend, value) {
    var sel = $("f-model");
    sel.innerHTML = Object.keys(CP.models).filter(function (k) { return CP.models[k].backend === backend; }).map(function (k) {
      return '<option value="' + k + '">' + CP.models[k].label + " (" + k + ")</option>";
    }).join("");
    if (value && sel.querySelector('option[value="' + value + '"]')) sel.value = value;
  }

  function load(v) {
    $("f-name").value = v.name;
    $("f-slug").value = v.slug;
    $("f-backend").value = v.backend;
    fillModels(v.backend, v.model);
    $("f-idle").value = v.idleMinutes;
    $("f-approval").checked = v.deployApproval;
    $("f-budget").value = v.monthly;
    $("f-alert").value = v.alertAt;
    $("f-email").checked = v.emailAlerts;
    $("f-recipients").value = v.recipients;
    touched = {};
    syncDerived();
    validate(false);
  }

  function read() {
    return {
      name: $("f-name").value, slug: $("f-slug").value,
      backend: $("f-backend").value, model: $("f-model").value, idleMinutes: $("f-idle").value.trim(), deployApproval: $("f-approval").checked,
      monthly: $("f-budget").value.trim(), alertAt: $("f-alert").value.trim(), emailAlerts: $("f-email").checked, recipients: $("f-recipients").value
    };
  }

  function errors(v) {
    var e = {};
    if (!v.name.trim()) e.name = "Enter a workspace name.";
    else if (v.name.trim().length > 40) e.name = "Keep the name to 40 characters or fewer.";
    if (!/^[a-z0-9-]{3,32}$/.test(v.slug)) e.slug = /[A-Z]/.test(v.slug) ? "Use lowercase letters only." : "Use 3 to 32 lowercase letters, numbers, or hyphens.";
    else if (/^-|-$/.test(v.slug)) e.slug = "The slug can't start or end with a hyphen.";
    var idle = Number(v.idleMinutes);
    if (v.idleMinutes === "" || !isFinite(idle) || idle < 5 || idle > 240) e.idle = "Enter a number from 5 to 240.";
    var b = Number(v.monthly);
    if (v.monthly === "" || !isFinite(b) || b < 0) e.budget = "Enter a budget of $0 or more. Use 0 for no budget.";
    else if (b > 100000) e.budget = "Budgets above $100,000 need a billing contact. Enter a lower amount.";
    var a = Number(v.alertAt);
    if (v.alertAt === "" || !isFinite(a) || a < 50 || a > 100) e.alert = "Enter a percentage from 50 to 100.";
    if (v.emailAlerts) {
      var list = v.recipients.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var bad = list.filter(function (s) { return !EMAIL.test(s); });
      if (!list.length) e.rec = "Add at least one address, or turn off email alerts.";
      else if (bad.length) e.rec = "Not a valid email: " + bad[0] + ".";
    }
    return e;
  }

  var FIELD_ERR = { name: ["f-name", "e-name"], slug: ["f-slug", "e-slug"], idle: ["f-idle", "e-idle"], budget: ["f-budget", "e-budget"], alert: ["f-alert", "e-alert"], rec: ["f-recipients", "e-rec"] };

  function validate(all) {
    var e = errors(read());
    Object.keys(FIELD_ERR).forEach(function (k) {
      var input = $(FIELD_ERR[k][0]), msg = $(FIELD_ERR[k][1]);
      var show = e[k] && (all || touched[k]);
      input.setAttribute("aria-invalid", show ? "true" : "false");
      msg.hidden = !show;
      msg.innerHTML = show ? icon("alert") + "<span>" + esc(e[k]) + "</span>" : "";
    });
    return e;
  }

  function isDirty() {
    var v = read();
    return Object.keys(v).some(function (k) { return String(v[k]) !== String(saved[k]); });
  }

  function syncDerived() {
    var b = Number($("f-budget").value), a = Number($("f-alert").value);
    $("h-alert").textContent = isFinite(b) && isFinite(a) && b > 0 && a >= 50 && a <= 100
      ? "Alert when spend reaches " + fmt.money0(b * a / 100) + "."
      : "Percentage of the monthly budget.";
    var rf = $("recipients-field"), on = $("f-email").checked;
    rf.setAttribute("aria-disabled", on ? "false" : "true");
    $("f-recipients").disabled = !on;
    var bar = $("savebar");
    var dirty = isDirty();
    bar.hidden = !dirty;
    window.onbeforeunload = dirty ? function () { return "You have unsaved changes."; } : null;
  }

  var ID_TO_KEY = { "f-name": "name", "f-slug": "slug", "f-idle": "idle", "f-budget": "budget", "f-alert": "alert", "f-recipients": "rec" };
  form.addEventListener("input", function (e) {
    if (e.target.id === "f-slug") {
      var pos = e.target.selectionStart;
      e.target.value = e.target.value.replace(/\s+/g, "-");
      try { e.target.setSelectionRange(pos, pos); } catch (err) {}
    }
    // Once a field has shown an error, re-check it as the user fixes it.
    if (ID_TO_KEY[e.target.id] && e.target.getAttribute("aria-invalid") === "true") validate(false);
    syncDerived();
  });
  form.addEventListener("change", function (e) {
    if (e.target.id === "f-backend") fillModels(e.target.value, null);
    if (e.target.id === "f-email") { validate(false); }
    syncDerived();
  });
  form.addEventListener("focusout", function (e) {
    var k = ID_TO_KEY[e.target.id];
    if (k) { touched[k] = true; validate(false); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errs = validate(true);
    var keys = Object.keys(errs);
    var bar = $("savebar");
    if (keys.length) {
      bar.classList.add("has-errors");
      $("savebar-text").textContent = keys.length === 1 ? "Fix 1 field before saving." : "Fix " + keys.length + " fields before saving.";
      $(FIELD_ERR[keys[0]][0]).focus();
      return;
    }
    var v = read();
    CP.store.patch(function (st) {
      st.workspace = { name: v.name.trim(), slug: v.slug };
      st.defaults = { backend: v.backend, model: v.model, idleMinutes: Number(v.idleMinutes), deployApproval: v.deployApproval };
      st.budget = {
        monthly: Number(v.monthly), alertAt: Number(v.alertAt), emailAlerts: v.emailAlerts,
        recipients: v.recipients.split(",").map(function (s) { return s.trim(); }).filter(Boolean).join(", ")
      };
    });
    saved = fromStore();
    load(saved);
    bar.classList.remove("has-errors");
    $("savebar-text").textContent = "You have unsaved changes.";
    UI.hydrateRail();
    UI.toast("Settings saved");
  });

  $("discard").addEventListener("click", function () {
    load(saved);
    $("savebar").classList.remove("has-errors");
    $("savebar-text").textContent = "You have unsaved changes.";
    UI.toast("Changes discarded");
  });

  /* ---------- members ---------- */

  function renderPeople() {
    var st = CP.store.read();
    var admins = st.members.filter(function (m) { return m.role === "Admin" && !m.pending; }).length;
    $("people").innerHTML = st.members.map(function (m) {
      var you = m.id === ME;
      var lastAdmin = m.role === "Admin" && admins <= 1 && !m.pending;
      var role = you
        ? '<span class="you">' + m.role + ", you</span>"
        : '<label><span class="visually-hidden">Role for ' + esc(m.name) + '</span><select class="select" data-role="' + m.id + '"' + (lastAdmin ? " disabled" : "") + ">" +
          ["Admin", "Editor", "Viewer"].map(function (r) { return "<option" + (r === m.role ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select></label>";
      var remove = you
        ? '<span class="spacer"></span>'
        : '<button type="button" class="btn ghost icon-only" data-remove="' + m.id + '" aria-label="Remove ' + esc(m.name) + '" title="Remove ' + esc(m.name) + '">' + icon("x") + "</button>";
      return "<li>" + UI.avatar(m, "lg") + '<div><div class="pname">' + esc(m.name) + (m.pending ? '<span class="pending">Invited</span>' : "") + '</div><div class="pmail"><span class="pemail">' +
        esc(m.email) + "</span>" + (m.title ? '<span class="ptitle">' + esc(m.title) + "</span>" : "") + "</div></div>" + role + remove + "</li>";
    }).join("");
  }

  $("people").addEventListener("change", function (e) {
    var id = e.target.getAttribute("data-role");
    if (!id) return;
    var prev;
    var st = CP.store.patch(function (s) {
      s.members.forEach(function (m) { if (m.id === id) { prev = m.role; m.role = e.target.value; } });
    });
    var m = st.members.filter(function (x) { return x.id === id; })[0];
    renderPeople();
    UI.toast(m.name + " is now " + (m.role === "Admin" ? "an " : "a ") + m.role, {
      undo: function () {
        CP.store.patch(function (s) { s.members.forEach(function (x) { if (x.id === id) x.role = prev; }); });
        renderPeople();
      }
    });
  });

  $("people").addEventListener("click", function (e) {
    var b = e.target.closest("[data-remove]");
    if (!b) return;
    var id = b.getAttribute("data-remove"), removed, index;
    CP.store.patch(function (s) {
      index = s.members.findIndex(function (m) { return m.id === id; });
      removed = s.members.splice(index, 1)[0];
    });
    renderPeople();
    var next = $("people").querySelectorAll("[data-remove]")[Math.max(0, index - 1)];
    if (next) next.focus(); else $("i-email").focus();
    UI.toast((removed.pending ? "Invite for " : "Removed ") + removed.name + (removed.pending ? " cancelled" : ""), {
      undo: function () {
        CP.store.patch(function (s) { s.members.splice(index, 0, removed); });
        renderPeople();
      }
    });
  });

  $("invite").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("i-email"), msg = $("e-invite");
    var email = input.value.trim().toLowerCase();
    var st = CP.store.read();
    var err = !email ? "Enter an email address to invite."
      : !EMAIL.test(email) ? "That doesn't look like an email address. Check for typos."
      : st.members.some(function (m) { return m.email.toLowerCase() === email; }) ? email + " is already a member or has a pending invite."
      : "";
    input.setAttribute("aria-invalid", err ? "true" : "false");
    msg.hidden = !err;
    msg.innerHTML = err ? icon("alert") + "<span>" + esc(err) + "</span>" : "";
    if (err) { input.focus(); return; }
    var local = email.split("@")[0].split(/[._-]/).filter(Boolean);
    var name = local.map(function (p) { return p[0].toUpperCase() + p.slice(1); }).join(" ") || email;
    var role = $("i-role").value;
    CP.store.patch(function (s) {
      s.members.push({ id: "inv_" + Date.now().toString(36), name: name, email: email, role: role, title: "", pending: true });
    });
    input.value = "";
    renderPeople();
    UI.toast("Invite sent to " + email);
  });
  $("i-email").addEventListener("input", function () {
    if (this.getAttribute("aria-invalid") === "true") { this.setAttribute("aria-invalid", "false"); $("e-invite").hidden = true; }
  });

  /* ---------- API keys ---------- */

  function relDay(ms) {
    if (!ms) return "Never";
    var days = Math.floor((CP.today0 + CP.DAY - ms) / CP.DAY);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return days + " days ago";
  }

  function renderKeys() {
    var st = CP.store.read();
    var html = '<thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col" class="hide-sm">Created</th><th scope="col" class="hide-sm">Last used</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>';
    if (!st.keys.length) html += '<tr class="none"><td colspan="5">No API keys. Create one for a CI job or a usage export.</td></tr>';
    st.keys.forEach(function (k) {
      html += '<tr><td class="kname">' + esc(k.name) + '</td><td><span class="mono">' + esc(k.prefix) + "…</span></td>" +
        '<td class="when hide-sm">' + fmt.date(k.created) + '</td><td class="when hide-sm">' + relDay(k.lastUsed) + "</td>" +
        '<td><button type="button" class="btn sm danger" data-revoke="' + k.id + '">Revoke</button></td></tr>';
    });
    $("keys-table").innerHTML = html + "</tbody>";
  }

  function randomKey() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", out = "";
    var buf = new Uint32Array(32);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 32; i++) out += chars[buf[i] % chars.length];
    return "pk_live_" + out;
  }

  $("new-key").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("k-name"), msg = $("e-key"), name = input.value.trim();
    var st = CP.store.read();
    var err = !name ? "Name the key so you can tell it apart later, for example “Nightly export”."
      : st.keys.some(function (k) { return k.name.toLowerCase() === name.toLowerCase(); }) ? "A key with that name already exists."
      : "";
    input.setAttribute("aria-invalid", err ? "true" : "false");
    msg.hidden = !err;
    msg.innerHTML = err ? icon("alert") + "<span>" + esc(err) + "</span>" : "";
    if (err) { input.focus(); return; }
    var key = randomKey();
    CP.store.patch(function (s) {
      s.keys.unshift({ id: "key_" + Date.now().toString(36), name: name, prefix: key.slice(0, 12), created: CP.now(), lastUsed: null });
    });
    input.value = "";
    renderKeys();
    $("reveal-name").textContent = name;
    $("reveal-key").textContent = key;
    $("reveal").hidden = false;
    $("reveal-copy").focus();
  });
  $("k-name").addEventListener("input", function () {
    if (this.getAttribute("aria-invalid") === "true") { this.setAttribute("aria-invalid", "false"); $("e-key").hidden = true; }
  });

  $("reveal-copy").addEventListener("click", function () {
    var b = this, text = $("reveal-key").textContent;
    function done() { b.innerHTML = icon("check") + "Copied"; setTimeout(function () { b.innerHTML = icon("copy") + "Copy"; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { selectKey(); done(); });
    else { selectKey(); document.execCommand && document.execCommand("copy"); done(); }
  });
  function selectKey() {
    var r = document.createRange(); r.selectNodeContents($("reveal-key"));
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  $("reveal-done").addEventListener("click", function () {
    $("reveal").hidden = true;
    $("reveal-key").textContent = "";
    $("k-name").focus();
  });

  $("keys-table").addEventListener("click", function (e) {
    var b = e.target.closest("[data-revoke]");
    if (!b) return;
    var id = b.getAttribute("data-revoke"), removed, index;
    CP.store.patch(function (s) {
      index = s.keys.findIndex(function (k) { return k.id === id; });
      removed = s.keys.splice(index, 1)[0];
    });
    renderKeys();
    UI.toast("Revoked “" + removed.name + "”", {
      undo: function () { CP.store.patch(function (s) { s.keys.splice(index, 0, removed); }); renderKeys(); }
    });
  });

  /* ---------- section nav ---------- */

  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  function mark(id) { links.forEach(function (a) { a.setAttribute("aria-current", a.getAttribute("href") === "#" + id ? "true" : "false"); }); }
  if (window.IntersectionObserver) {
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting ? en.boundingClientRect.top : null; });
      var best = null;
      links.forEach(function (a) {
        var id = a.getAttribute("href").slice(1);
        if (visible[id] !== null && visible[id] !== undefined && best === null) best = id;
      });
      if (best) mark(best);
    }, { rootMargin: "0px 0px -55% 0px" });
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) io.observe(s); });
  }
  links.forEach(function (a) { a.addEventListener("click", function () { mark(a.getAttribute("href").slice(1)); }); });
  mark(location.hash ? location.hash.slice(1) : "workspace");

  load(saved);
  renderPeople();
  renderKeys();
})();
