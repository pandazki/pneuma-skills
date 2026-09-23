// Pneuma Skills — copy buttons and the illustrative session rig

(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Copy buttons, announced through one polite live region
  const live = document.createElement("span");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      btn.classList.add("is-copied");
      live.textContent = "";
      requestAnimationFrame(() => { live.textContent = "Command copied to clipboard"; });
      clearTimeout(btn._t);
      btn._t = setTimeout(() => btn.classList.remove("is-copied"), 1800);
    });
  });

  const rig = document.getElementById("rig");
  if (!rig) return;

  const tabs = [...rig.querySelectorAll(".tab")];
  const pauseBtn = rig.querySelector(".pause");
  const word = document.getElementById("sel-word");
  const wsEl = document.getElementById("log-ws");
  const nameEl = document.getElementById("viewer-name");
  const fileEl = document.getElementById("viewer-file");

  const LAST = 5; // steps 0..4 animate, 5 is the settled hold
  const DUR = [1100, 1300, 1300, 1900, 1500, 2600];

  let sceneIdx = 0;
  let step = 0;
  let timer = null;
  let raf = null;
  let stepStart = 0;
  let paused = reduced;
  let locked = false; // after the visitor picks a tab, that scene loops instead of advancing
  let wordTarget = word.textContent;
  let wordTimer = null;

  const parts = (key) => ({
    log: rig.querySelector(`.log-lines[data-scene="${key}"]`),
    scene: rig.querySelector(`.scene[data-scene="${key}"]`),
  });

  function render(key, s) {
    const { log, scene } = parts(key);
    scene.dataset.step = s;
    [log, scene].forEach((root) => {
      root.querySelectorAll("[data-at]").forEach((el) => {
        el.classList.toggle("is-on", s >= +el.dataset.at);
      });
      root.querySelectorAll("[data-until]").forEach((el) => {
        el.classList.toggle("is-gone", s >= +el.dataset.until);
      });
      root.querySelectorAll("[data-class]").forEach((el) => {
        el.dataset.class.split(",").forEach((rule) => {
          const [cls, range] = rule.split(":");
          const [a, b] = range.split("-").map(Number);
          el.classList.toggle(cls, s >= a && (Number.isNaN(b) || b === undefined ? true : s < b));
        });
      });
    });
    // highlight the newest agent line
    const lines = [...log.querySelectorAll("li")];
    let latest = null;
    lines.forEach((li) => {
      li.classList.remove("is-latest");
      if (s >= +li.dataset.at) latest = li;
    });
    if (latest && s < LAST) latest.classList.add("is-latest");
  }

  function setWord(text) {
    if (wordTarget === text) return;
    wordTarget = text;
    clearTimeout(wordTimer);
    if (reduced) { word.textContent = text; return; }
    word.classList.add("is-out");
    wordTimer = setTimeout(() => {
      word.textContent = wordTarget;
      word.classList.remove("is-out");
    }, 260);
  }

  function show(idx) {
    sceneIdx = idx;
    tabs.forEach((t, i) => {
      const on = i === idx;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      t.style.setProperty("--p", on && !paused ? 0 : 1);
      const { log, scene } = parts(t.dataset.scene);
      log.hidden = !on;
      scene.hidden = !on;
    });
    const tab = tabs[idx];
    const strip = tab.parentNode;
    if (tab.offsetLeft < strip.scrollLeft || tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: tab.offsetLeft - 8, behavior: reduced ? "auto" : "smooth" });
    }
    const { scene } = parts(tab.dataset.scene);
    wsEl.textContent = scene.dataset.ws;
    nameEl.textContent = scene.dataset.name;
    fileEl.textContent = scene.dataset.file;
    setWord(tab.dataset.word);
  }

  function meter() {
    cancelAnimationFrame(raf);
    const tab = tabs[sceneIdx];
    const total = DUR.reduce((a, b) => a + b, 0);
    const done = DUR.slice(0, step).reduce((a, b) => a + b, 0);
    const tick = () => {
      const t = Math.min(1, (done + (performance.now() - stepStart)) / total);
      tab.style.setProperty("--p", t);
      if (!paused) raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function schedule() {
    clearTimeout(timer);
    if (paused) return;
    stepStart = performance.now();
    meter();
    timer = setTimeout(() => {
      if (step < LAST) {
        step += 1;
        render(tabs[sceneIdx].dataset.scene, step);
      } else {
        const next = locked ? sceneIdx : (sceneIdx + 1) % tabs.length;
        show(next);
        step = 0;
        render(tabs[next].dataset.scene, 0);
      }
      schedule();
    }, DUR[step]);
  }

  function go(idx, userPicked) {
    if (userPicked) locked = true;
    show(idx);
    step = paused || userPicked && reduced ? LAST : 0;
    render(tabs[idx].dataset.scene, step);
    schedule();
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => go(i, true));
    t.addEventListener("keydown", (e) => {
      const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const n = (keys[e.key] + tabs.length) % tabs.length;
      tabs[n].focus();
      go(n, true);
    });
  });

  // The button names the action it will take next: "Pause demo" while the
  // demo runs, "Play demo" once it is paused.
  function labelPause() {
    pauseBtn.setAttribute("aria-label", paused ? "Play demo" : "Pause demo");
    pauseBtn.dataset.paused = paused;
  }

  function setPaused(p) {
    paused = p;
    labelPause();
    if (p) {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    } else {
      if (step >= LAST) { step = 0; render(tabs[sceneIdx].dataset.scene, 0); }
      schedule();
    }
  }
  pauseBtn.addEventListener("click", () => setPaused(!paused));

  // Offscreen: stop the clock; back on screen: resume unless the visitor paused.
  let userPaused = false;
  pauseBtn.addEventListener("click", () => { userPaused = paused; });
  if ("IntersectionObserver" in window && !reduced) {
    new IntersectionObserver(([entry]) => {
      if (userPaused) return;
      if (entry.isIntersecting && paused) setPaused(false);
      else if (!entry.isIntersecting && !paused) setPaused(true);
    }, { threshold: 0.2 }).observe(rig);
  }

  // Initial state: every scene settled, so hidden panels are complete if revealed
  tabs.forEach((t) => render(t.dataset.scene, LAST));
  labelPause();
  if (reduced) pauseBtn.hidden = true;
  go(0);
})();
