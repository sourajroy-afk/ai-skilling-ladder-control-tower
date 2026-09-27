/* AI Skill Ladder Control Tower: shared client runtime */
(function () {
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem("tower-theme"); } catch (e) { return null; } })();
  if (saved) root.setAttribute("data-theme", saved);

  window.Tower = {
    palette: { beam: "#FFE600", blue: "#188CE5", teal: "#27ACAA", green: "#2DB757", orange: "#FF6D00",
               magenta: "#B14891", red: "#FF4136", lilac: "#9C82D4", grey: "#747480", silver: "#C4C4CD" },
    charts: {},
    css(name) { return getComputedStyle(root).getPropertyValue(name).trim(); },
    fmt(n, d = 1) { if (n === null || n === undefined || isNaN(n)) return "–"; return Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: 0 }); },
    inr(n) { return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }); },
    csrfToken() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m ? m.content : "";
    },
    async api(url, body, method) {
      const verb = method || (body ? "POST" : "GET");
      const opt = { method: verb, headers: { "Content-Type": "application/json" } };
      if (verb !== "GET" && verb !== "HEAD") opt.headers["X-CSRF-Token"] = this.csrfToken();
      if (body) opt.body = JSON.stringify(body);
      const r = await fetch(url, opt);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(j.error || ("Request failed: " + r.status));
        e.status = r.status; e.body = j;
        throw e;
      }
      return j;
    },
    toast(msg) {
      let t = document.querySelector(".toast");
      if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
      t.textContent = msg; t.classList.add("show");
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
    },
    /* Persistent, dismissible banner for failures a 2.6s toast could hide (failed API calls, lost connections). */
    errorBanner(msg) {
      let b = document.querySelector(".err-banner");
      if (!b) {
        b = document.createElement("div"); b.className = "err-banner"; b.setAttribute("role", "alert");
        b.innerHTML = '<span class="msg"></span><button type="button" class="close" aria-label="Dismiss">×</button>';
        b.querySelector(".close").addEventListener("click", () => b.classList.remove("show"));
        document.body.appendChild(b);
      }
      b.querySelector(".msg").textContent = msg;
      b.classList.add("show");
    },
    /* Generic tab-toggle: buttons with data-t="key" show/hide sibling sections with id="tab-key". */
    tabs(root, opts) {
      opts = opts || {};
      const el = typeof root === "string" ? document.querySelector(root) : root;
      if (!el) return null;
      const btns = [...el.querySelectorAll("button[data-t]")];
      const keys = opts.tabs || btns.map(b => b.dataset.t);
      const show = t => {
        btns.forEach(b => b.classList.toggle("on", b.dataset.t === t));
        keys.forEach(k => { const s = document.getElementById("tab-" + k); if (s) s.classList.toggle("hide", k !== t); });
        if (opts.onShow) opts.onShow(t);
        if (opts.hash) history.replaceState(null, "", "#" + t);
      };
      btns.forEach(b => b.addEventListener("click", () => show(b.dataset.t)));
      let start = btns.find(b => b.classList.contains("on"))?.dataset.t || keys[0];
      if (opts.hash) { const h = location.hash.slice(1); if (keys.includes(h)) start = h; }
      show(start);
      return { show };
    },
    /* Export any table.tbl to a downloadable CSV, reading data-v for numeric cells where present. */
    exportTableCSV(table, filename) {
      if (typeof table === "string") table = document.querySelector(table);
      if (!table) return;
      const esc = v => { v = String(v ?? "").replace(/\s+/g, " ").trim(); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const rows = [];
      const head = [...table.querySelectorAll("thead th")].map(th => esc(th.textContent));
      if (head.length) rows.push(head.join(","));
      table.querySelectorAll("tbody tr").forEach(tr => {
        if (tr.offsetParent === null && !tr.closest(".hide")) return;
        rows.push([...tr.children].map(td => esc(td.dataset.v ?? td.textContent)).join(","));
      });
      const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename || "export.csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    applyChartTheme() {
      if (!window.Chart) return;
      const text = this.css("--text-2"), grid = this.css("--line-soft");
      Chart.defaults.color = text;
      Chart.defaults.borderColor = grid;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = 12;
      Chart.defaults.plugins.legend.labels.boxWidth = 10;
      Chart.defaults.plugins.legend.labels.boxHeight = 10;
      Chart.defaults.plugins.tooltip.backgroundColor = "#1A1A24";
      Chart.defaults.plugins.tooltip.borderColor = "#3A3A4A";
      Chart.defaults.plugins.tooltip.borderWidth = 1;
      Chart.defaults.plugins.tooltip.padding = 10;
      Chart.defaults.plugins.tooltip.titleColor = "#FFE600";
      Chart.defaults.maintainAspectRatio = false;
      Chart.defaults.animation.duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
      Chart.defaults.animation.easing = "easeOutQuart";
      Chart.defaults.transitions.active = { animation: { duration: 250 } };
    },
    /* Create a chart, or morph an existing one in place so values animate from old to new. */
    chart(id, cfg) {
      const el = document.getElementById(id);
      if (!el || !window.Chart) return null;
      const ex = this.charts[id];
      const sameShape = ex && ex.canvas === el && ex.config.type === cfg.type &&
        ex.data.datasets.length === (cfg.data.datasets || []).length &&
        ex.data.datasets.every((d, i) => (d.type || null) === (cfg.data.datasets[i].type || null));
      if (sameShape) {
        ex.data.labels = cfg.data.labels;
        cfg.data.datasets.forEach((nd, i) => {
          const od = ex.data.datasets[i];
          Object.keys(nd).forEach(k => { if (k !== "data") od[k] = nd[k]; });
          if (Array.isArray(od.data) && od.data.length === nd.data.length) nd.data.forEach((v, j) => { od.data[j] = v; });
          else od.data = nd.data;
        });
        if (cfg.options) ex.options = cfg.options;
        ex.update();
        return ex;
      }
      if (ex) ex.destroy();
      this.charts[id] = new Chart(el, cfg);
      return this.charts[id];
    },
    /* Count a number from its previous value to a new one. fmt(v) returns the display string. */
    tween(el, to, fmt, dur) {
      if (!el) return;
      if (typeof el === "string") el = document.getElementById(el);
      if (!el) return;
      fmt = fmt || (v => Math.round(v).toLocaleString("en-IN"));
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const from = (typeof el._tv === "number" && isFinite(el._tv)) ? el._tv : to;
      el._tv = to;
      cancelAnimationFrame(el._raf);
      if (reduce || from === to || !isFinite(to)) { el.innerHTML = fmt(to); return; }
      const t0 = performance.now(), d = dur || 650;
      const step = now => {
        const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3);
        el.innerHTML = fmt(from + (to - from) * e);
        if (k < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    },
    pulse(el) { if (!el) return; el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); },
    /* Paint a range input's filled portion up to the thumb (Chrome/Edge/Safari; Firefox uses ::-moz-range-progress natively). */
    paintRange(el) {
      if (!el) return;
      const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100, val = parseFloat(el.value);
      const pct = max > min ? Math.min(100, Math.max(0, (val - min) / (max - min) * 100)) : 0;
      el.style.setProperty("--fill", pct + "%");
    },
    refreshCharts() {
      this.applyChartTheme();
      Object.values(this.charts).forEach(c => {
        if (c.options.scales) Object.values(c.options.scales).forEach(s => {
          if (s.grid) s.grid.color = this.css("--line-soft");
          if (s.ticks) s.ticks.color = this.css("--text-2");
          if (s.title) s.title.color = this.css("--text-3");
        });
        if (c.options.plugins && c.options.plugins.legend && c.options.plugins.legend.labels) c.options.plugins.legend.labels.color = this.css("--text-2");
        c.update("none");
      });
    },
    spark(id, data, color) {
      const el = document.getElementById(id);
      if (!el || !data || !data.length) return;
      const w = 200, h = 30, pad = 3;
      const min = Math.min(...data), max = Math.max(...data);
      const flat = max - min < 1e-9;
      const pts = data.map((v, i) => {
        const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
        const y = flat ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2);
        return [x, y];
      });
      const line = pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
      const area = "0," + h + " " + line + " " + w + "," + h;
      const c = color || "#FFE600";
      const last = pts[pts.length - 1];
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Trend">
        <polygon points="${area}" fill="${c}" opacity="${flat ? 0 : 0.12}"></polygon>
        <polyline points="${line}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" ${flat ? 'stroke-dasharray="4 4" opacity="0.6"' : ""}></polyline>
        <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${c}"></circle></svg>`;
      el.title = flat ? "No change across 2026 to 2031" : "2026 to 2031 trend";
    },
    sortable(table) {
      table.querySelectorAll("th.sortable").forEach((th, idx) => {
        if (!th.title) th.title = `Sort by ${th.textContent.trim()}`;
        th.setAttribute("aria-sort", "none");
        th.addEventListener("click", () => {
          const col = [...th.parentNode.children].indexOf(th);
          const dir = th.dataset.dir === "asc" ? "desc" : "asc";
          table.querySelectorAll("th").forEach(h => { delete h.dataset.dir; h.setAttribute("aria-sort", "none"); });
          th.dataset.dir = dir;
          th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
          const rows = [...table.tBodies[0].rows];
          rows.sort((a, b) => {
            const av = a.cells[col].dataset.v ?? a.cells[col].textContent.trim();
            const bv = b.cells[col].dataset.v ?? b.cells[col].textContent.trim();
            const an = parseFloat(av), bn = parseFloat(bv);
            const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
            return dir === "asc" ? cmp : -cmp;
          });
          rows.forEach(r => table.tBodies[0].appendChild(r));
        });
      });
    },
    drawer: {
      _trap(e) {
        const d = document.getElementById("drawer");
        if (e.key !== "Tab") return;
        const items = [...d.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      },
      open(html) {
        const d = document.getElementById("drawer"), b = document.getElementById("drawerBack");
        d.querySelector(".drawer-body").innerHTML = html;
        d.classList.add("open"); b.classList.add("open");
        d.setAttribute("aria-hidden", "false");
        this._returnFocus = document.activeElement;
        d.querySelector(".close").focus();
        document.addEventListener("keydown", this._trap);
      },
      close() {
        const d = document.getElementById("drawer");
        d.classList.remove("open");
        document.getElementById("drawerBack").classList.remove("open");
        d.setAttribute("aria-hidden", "true");
        document.removeEventListener("keydown", Tower.drawer._trap);
        if (this._returnFocus && document.body.contains(this._returnFocus)) this._returnFocus.focus();
        this._returnFocus = null;
      }
    }
  };

  /* ---------- cross-page search (Ctrl/Cmd+K) ---------- */
  function initSearch() {
    const dataEl = document.getElementById("searchIndex");
    let items = [];
    try { items = JSON.parse(dataEl ? dataEl.textContent : "[]"); } catch (e) { items = []; }
    const btn = document.getElementById("searchBtn");
    let modal, input, list, active = -1, filtered = [];
    const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

    function build() {
      modal = document.createElement("div");
      modal.className = "cmdk-back";
      modal.innerHTML = `<div class="cmdk" role="dialog" aria-modal="true" aria-label="Search the tower">
        <input type="text" id="cmdkInput" placeholder="Search pages, interventions, ladder levels, gates, states…" autocomplete="off" aria-label="Search">
        <div class="cmdk-list" id="cmdkList" role="listbox"></div>
        <div class="cmdk-hint">↑↓ to move &middot; Enter to open &middot; Esc to close</div>
      </div>`;
      document.body.appendChild(modal);
      input = modal.querySelector("#cmdkInput");
      list = modal.querySelector("#cmdkList");
      modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
      input.addEventListener("input", render);
      input.addEventListener("keydown", onKey);
    }
    function render() {
      const q = input.value.trim().toLowerCase();
      filtered = !q ? items.slice(0, 10) : items.filter(i => (i.label + " " + (i.sub || "")).toLowerCase().includes(q)).slice(0, 20);
      active = filtered.length ? 0 : -1;
      list.innerHTML = filtered.map((i, idx) => `<a href="${i.href}" role="option" class="${idx === active ? "on" : ""}" data-i="${idx}"><b>${esc(i.label)}</b><span class="muted small">${esc(i.sub || "")}</span></a>`).join("")
        || '<div class="empty" style="padding:20px 12px"><b>No matches</b>Try a different word.</div>';
      list.querySelectorAll("a").forEach(a => a.addEventListener("mouseenter", () => setActive(+a.dataset.i)));
    }
    function setActive(i) { active = i; [...list.children].forEach((el, idx) => el.classList.toggle("on", idx === i)); const el = list.children[i]; if (el) el.scrollIntoView({ block: "nearest" }); }
    function onKey(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (filtered.length) setActive((active + 1) % filtered.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (filtered.length) setActive((active - 1 + filtered.length) % filtered.length); }
      else if (e.key === "Enter") { e.preventDefault(); const f = filtered[active]; if (f) location.href = f.href; }
      else if (e.key === "Escape") { closeModal(); }
    }
    function openModal() { if (!modal) build(); modal.classList.add("open"); input.value = ""; render(); input.focus(); }
    function closeModal() { if (modal) modal.classList.remove("open"); }
    if (btn) btn.addEventListener("click", openModal);
    document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openModal(); } });
    return { open: openModal };
  }

  /* ---------- first-run guided tour ---------- */
  function initTour() {
    const STEPS = [
      { sel: ".brand", text: "This is the Control Tower: pages tracking VACR, the North Star KPI, from learning to verified work." },
      { sel: ".nav", text: "The sidebar groups every page by Overview, Diagnose, Design, Decide, Deliver, Engage and Evidence." },
      { sel: ".scenario-pill", text: "Every page reads from one active scenario. Switch it here and every chart on every page updates." },
      { sel: "#searchBtn", text: "Press Ctrl/Cmd+K, or click here, to jump straight to any page, intervention, ladder level, gate or state." },
      { sel: "#helpBtn", text: "Come back here any time for keyboard shortcuts, or to replay this tour." }
    ];
    let i = 0, spot, tip, active = false;
    function build() {
      spot = document.createElement("div"); spot.className = "tour-spot";
      tip = document.createElement("div"); tip.className = "tour-tip";
      tip.innerHTML = '<p class="tour-text"></p><div class="row mt-12"><button type="button" class="btn ghost" id="tourSkip">Skip</button><span class="spacer"></span><span class="small muted" id="tourN"></span><button type="button" class="btn primary" id="tourNext">Next</button></div>';
      document.body.append(spot, tip);
      tip.querySelector("#tourSkip").addEventListener("click", end);
      tip.querySelector("#tourNext").addEventListener("click", next);
      window.addEventListener("resize", () => { if (active) place(); });
    }
    function place() {
      const step = STEPS[i];
      const el = document.querySelector(step.sel);
      if (!el) return next();
      const r = el.getBoundingClientRect();
      spot.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
      tip.querySelector(".tour-text").textContent = step.text;
      tip.querySelector("#tourN").textContent = (i + 1) + " of " + STEPS.length;
      tip.querySelector("#tourNext").textContent = i === STEPS.length - 1 ? "Done" : "Next";
      let top = r.bottom + 14, left = Math.min(Math.max(r.left, 12), window.innerWidth - 320);
      if (top + 140 > window.innerHeight) top = Math.max(12, r.top - 150);
      tip.style.cssText = `left:${left}px;top:${top}px`;
      spot.classList.add("show"); tip.classList.add("show"); active = true;
    }
    function next() { i++; if (i >= STEPS.length) return end(); place(); }
    function end() {
      if (spot) spot.classList.remove("show");
      if (tip) tip.classList.remove("show");
      active = false;
      try { localStorage.setItem("tower-tour-seen", "1"); } catch (e) {}
    }
    function start() { i = 0; if (!spot) build(); place(); }
    return { start };
  }

  document.addEventListener("DOMContentLoaded", () => {
    Tower.applyChartTheme();
    Tower.search = initSearch();
    Tower.tour = initTour();
    const helpBtn = document.getElementById("helpBtn");
    const HELP_HTML = `<h2 style="font-size:20px">Keyboard shortcuts &amp; help</h2>
      <dl class="kv mt-16">
        <dt>Search everywhere</dt><dd><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd></dd>
        <dt>Close a panel</dt><dd><kbd>Esc</kbd></dd>
        <dt>Sort a table</dt><dd>Click a column header</dd>
        <dt>Toggle sidebar</dt><dd>Menu icon, top left</dd>
        <dt>Toggle theme</dt><dd>Sun/moon icon, top right</dd>
      </dl>
      <button type="button" class="btn primary mt-16" id="tourReplay">Replay the guided tour</button>`;
    if (helpBtn) helpBtn.addEventListener("click", () => Tower.drawer.open(HELP_HTML));
    document.getElementById("drawer").addEventListener("click", e => {
      if (e.target && e.target.id === "tourReplay") { Tower.drawer.close(); setTimeout(() => Tower.tour.start(), 300); }
    });
    let seenTour = false;
    try { seenTour = localStorage.getItem("tower-tour-seen") === "1"; } catch (e) {}
    if (!seenTour) setTimeout(() => Tower.tour.start(), 900);

    const tbtn = document.getElementById("themeToggle");
    if (tbtn) tbtn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("tower-theme", next); } catch (e) {}
      Tower.refreshCharts();
    });

    const mbtn = document.getElementById("menuBtn");
    const navb = document.querySelector(".drawer-back.navb");
    const mobile = () => window.matchMedia("(max-width: 1024px)").matches;
    const setExpanded = () => {
      const open = mobile() ? document.body.classList.contains("nav-open") : !document.body.classList.contains("nav-collapsed");
      if (mbtn) mbtn.setAttribute("aria-expanded", String(open));
    };
    try { if (localStorage.getItem("tower-nav") === "collapsed") document.body.classList.add("nav-collapsed"); } catch (e) {}
    if (mbtn) mbtn.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      if (mobile()) {
        document.body.classList.toggle("nav-open");
      } else {
        document.body.classList.toggle("nav-collapsed");
        try { localStorage.setItem("tower-nav", document.body.classList.contains("nav-collapsed") ? "collapsed" : "open"); } catch (err) {}
        setTimeout(() => Object.values(Tower.charts).forEach(c => { try { c.resize(); } catch (err) {} }), 260);
      }
      setExpanded();
    });
    if (navb) navb.addEventListener("click", () => { document.body.classList.remove("nav-open"); setExpanded(); });
    document.querySelectorAll(".side .nav a").forEach(a => a.addEventListener("click", () => { if (mobile()) document.body.classList.remove("nav-open"); }));
    window.addEventListener("resize", () => { if (!mobile()) document.body.classList.remove("nav-open"); setExpanded(); });
    setExpanded();

    const sel = document.getElementById("scenarioSelect");
    if (sel) sel.addEventListener("change", async () => {
      try { await Tower.api("/api/active", { id: sel.value }); location.reload(); }
      catch (e) { Tower.errorBanner("Could not switch scenario: " + e.message); }
    });
    const copyLink = document.getElementById("copyScenarioLink");
    if (copyLink) copyLink.addEventListener("click", async () => {
      const url = location.origin + location.pathname + "?scenario=" + encodeURIComponent(sel ? sel.value : "");
      try { await navigator.clipboard.writeText(url); Tower.toast("Scenario link copied"); }
      catch (e) { Tower.toast(url); }
    });

    const db = document.getElementById("drawerBack");
    if (db && !db.classList.contains("navb")) db.addEventListener("click", Tower.drawer.close);
    document.querySelectorAll("#drawer .close").forEach(b => b.addEventListener("click", Tower.drawer.close));
    document.addEventListener("keydown", e => { if (e.key === "Escape") { Tower.drawer.close(); document.body.classList.remove("nav-open"); } });

    document.querySelectorAll("table.tbl").forEach(t => Tower.sortable(t));

    document.querySelectorAll(".form-row input[type=range]").forEach(inp => {
      if (inp.title) return;
      const label = inp.closest(".form-row").querySelector("label");
      if (label) inp.title = label.textContent.trim();
    });
    document.querySelectorAll('input[type=range]').forEach(el => {
      Tower.paintRange(el);
      el.addEventListener("input", () => Tower.paintRange(el));
    });
    document.querySelectorAll("[data-p], .preset").forEach(el => { if (!el.title && el.dataset.p) el.title = "Apply the " + el.textContent.trim() + " preset"; });
  });
})();
