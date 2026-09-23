/* Carbon Park console: shared shell (icons, rail, toasts, helpers). */
(function () {
  "use strict";

  var ICONS = {
    sessions: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9 9v11"/>',
    usage: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    sort: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
    up: '<path d="m7 14 5-5 5 5"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    left: '<path d="m14 7-5 5 5 5"/>',
    right: '<path d="m10 7 5 5-5 5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'
  };

  function icon(name, cls) {
    return '<svg class="icon ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var HUES = { maya: 152, jonah: 230, priya: 300, tom: 62, lena: 20, sam: 190 };
  function avatar(person, size) {
    var h = HUES[person.id] !== undefined ? HUES[person.id] : hashHue(person.name);
    return '<span class="avatar' + (size ? " " + size : "") + '" style="--h:' + h + '" aria-hidden="true">' + esc(CP.fmt.initials(person.name)) + "</span>";
  }
  function hashHue(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function statusBadge(status) {
    return '<span class="status ' + status + '"><span class="dot" aria-hidden="true"></span>' + CP.statuses[status].label + "</span>";
  }

  /* toasts */
  var toastWrap;
  function toast(message, opts) {
    opts = opts || {};
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "toasts";
      toastWrap.setAttribute("role", "status");
      toastWrap.setAttribute("aria-live", "polite");
      document.body.appendChild(toastWrap);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = "<span>" + esc(message) + "</span>";
    var timer;
    function close() { clearTimeout(timer); el.remove(); }
    if (opts.undo) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn sm";
      b.textContent = "Undo";
      b.addEventListener("click", function () { opts.undo(); close(); });
      el.appendChild(b);
    }
    toastWrap.appendChild(el);
    timer = setTimeout(function () { close(); if (opts.done) opts.done(); }, opts.duration || 5000);
    return close;
  }

  /* rail: workspace name, active count, current user */
  function hydrateRail() {
    var st = CP.store.read();
    document.querySelectorAll("[data-ws-name]").forEach(function (el) { el.textContent = st.workspace.name; });
    var active = CP.sessions().filter(function (s) { return s.status === "running" || s.status === "waiting"; }).length;
    document.querySelectorAll("[data-active-count]").forEach(function (el) {
      el.textContent = active || "";
      el.setAttribute("aria-label", active + " active");
    });
    var me = st.members.filter(function (m) { return m.id === "maya"; })[0] || st.members[0];
    var meEl = document.querySelector("[data-me]");
    if (meEl && me) {
      meEl.innerHTML = avatar(me) + '<div><div class="me-name">' + esc(me.name) + '</div><div class="me-role">' + esc(me.role) + "</div></div>";
    }
    var base = st.workspace.name;
    var page = document.body.getAttribute("data-page-title");
    if (page) document.title = page + " · " + base;
  }

  document.querySelectorAll("[data-icon]").forEach(function (el) {
    el.outerHTML = icon(el.getAttribute("data-icon"), el.getAttribute("data-class"));
  });

  window.UI = { icon: icon, esc: esc, avatar: avatar, statusBadge: statusBadge, toast: toast, hydrateRail: hydrateRail };
  hydrateRail();
})();
