/* ═══════════════════════════════════════════════════════════════
   FK Minutes — shared helpers (index.html + completion.html)
   Loaded with <script defer>, so it runs before DOMContentLoaded.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  var FK = g.FK = {};

  /* ── single place for the backend URL ── */
  FK.API_URL = 'https://script.google.com/macros/s/AKfycbxH_jWtTRoLLJHZc7N2JHzfkq7n1virJkuYQbS3mx_onClfwac0UuIsn5jltaA2X4kn/exec';

  var $ = FK.$ = function (id) { return document.getElementById(id); };

  /* ── text helpers ── */
  FK.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  FK.isNA = function (v) {
    if (v == null) return true;
    var s = String(v).trim().toUpperCase();
    return !s || s === 'N/A' || s === '#N/A' || s === '#NA';
  };
  FK.clean = function (v) { return FK.isNA(v) ? '' : String(v).trim(); };
  FK.titleCase = function (s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/(^|[\s_\-])\w/g, function (m) { return m.toUpperCase(); });
  };
  FK.dateStamp = function () {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  };

  /* ── toast (one element, auto-hides) ── */
  var toastTimer = null;
  FK.toast = function (msg, isErr, ms) {
    var t = $('toastText'); if (!t) return;
    t.textContent = msg;
    t.className = 'toast-msg' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  };
  FK.toastLink = function (msg, url, label, ms) {
    var t = $('toastText'); if (!t) return;
    t.textContent = msg + ' ';
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
    t.appendChild(a);
    t.className = 'toast-msg live';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 15000);
  };

  /* ── theme / loader / wallpaper ── */
  FK.syncThemeBtn = function () {
    var b = $('themeBtn'); if (!b) return;
    b.textContent = document.documentElement.classList.contains('dark-mode') ? 'Damage Your Eyes' : 'Save Your Eyes';
  };
  FK.toggleTheme = function () {
    var d = document.documentElement.classList.toggle('dark-mode');
    try { localStorage.setItem('theme', d ? 'dark' : 'light'); } catch (e) { /* private mode */ }
    FK.syncThemeBtn();
  };
  FK.hideLoader = function () {
    var l = $('appLoader'); if (!l || l.classList.contains('hidden')) return;
    l.classList.add('hidden');
    setTimeout(function () { l.style.display = 'none'; }, 450);
  };
  FK.setWallpaper = function (list) {
    var url = list[Math.floor(Math.random() * list.length)];
    var s = document.createElement('style');
    s.textContent = 'body::before{background-image:url("' + url + '")}';
    document.head.appendChild(s);
  };

  /* ── network ── GET retries twice; POST never auto-retries unless asked (avoids duplicate exports) */
  FK.fetchJson = function (url, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase(), post = method === 'POST';
    var timeout = opts.timeout || (post ? 60000 : 30000);
    var retries = opts.retries != null ? opts.retries : (post ? 0 : 2);
    function attempt(n) {
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, timeout);
      var init = { method: method, redirect: 'follow', signal: ctl.signal };
      if (opts.headers) init.headers = opts.headers;
      if (opts.body) init.body = opts.body;
      return fetch(url, init)
        .then(function (r) { clearTimeout(timer); return r.text(); })
        .then(function (txt) {
          try { return JSON.parse(txt); } catch (e) { throw new Error('Invalid response from server'); }
        })
        .catch(function (err) {
          clearTimeout(timer);
          if (n < retries) {
            return new Promise(function (res) { setTimeout(res, 900 * (n + 1)); }).then(function () { return attempt(n + 1); });
          }
          throw err;
        });
    }
    return attempt(0);
  };
  FK.post = function (payload, opts) {
    opts = opts || {};
    return FK.fetchJson(FK.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload),
      timeout: opts.timeout, retries: opts.retries
    });
  };

  /* ── lazy-loaded PDF libs (pinned versions + SRI) ── */
  var loaded = {};
  FK.loadScript = function (src, integrity) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      if (integrity) s.integrity = integrity;
      s.onload = res;
      s.onerror = function () { delete loaded[src]; rej(new Error('Could not load ' + src.split('/').pop())); };
      document.head.appendChild(s);
    });
    return loaded[src];
  };
  FK.ensureJsPdf = function () {
    if (g.jspdf && typeof g.jspdf.jsPDF === 'function' && g.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        'sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfcEqDTTHgtNA==')
      .then(function () {
        return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
          'sha512-03CCNkeosDFN2zCCu4vLpu3pJfZcrL48F3yB8k87ejT+OVMwco7IH3FW02vtbGhdncS6gyYZ/duYaC/K62xQPQ==');
      })
      .then(function () { if (!g.jspdf) throw new Error('PDF library failed to load'); });
  };

  /* ── PDF helpers ── */
  FK.pdf = {
    /* jsPDF's built-in fonts are Latin-1 only: map typographic chars, drop accents, '?' for the rest */
    safe: function (s) {
      return String(s == null ? '' : s)
        .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
    },
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle',
                  lineWidth: 0.2, lineColor: [90, 90, 90], fontSize: 10 },
    bodyStyles: { halign: 'center', valign: 'middle', textColor: [0, 0, 0], fontSize: 9.5, lineWidth: 0.2,
                  lineColor: [90, 90, 90], cellPadding: 2.6, overflow: 'linebreak' },
    /* green / amber / red by count */
    countCell: function (cell) {
      var v = parseInt(cell.raw, 10);
      if (isNaN(v)) return;
      if (v > 20) { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27]; }
      else if (v >= 10) { cell.styles.fillColor = [254, 240, 138]; cell.styles.textColor = [133, 77, 14]; }
      else { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52]; }
    },
    statusCell: function (cell) {
      var v = String(cell.raw);
      if (v === 'Pending') { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27]; cell.styles.fontStyle = 'bold'; }
      else if (v === 'Completed') { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52]; cell.styles.fontStyle = 'bold'; }
    },
    pageNumbers: function (doc) {
      var pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 120, 120);
        doc.text('Page ' + i + ' of ' + n + '   |   Generated ' + FK.dateStamp(), pw / 2, ph - 7, { align: 'center' });
      }
    },
    /* "Label  value" on one centred line (value may be a link) */
    centeredPair: function (doc, y, label, value, url) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(9);
      var lw = doc.getTextWidth(label);
      doc.setFont('helvetica', 'normal');
      var vw = doc.getTextWidth(value);
      var x = (pw - (lw + 2 + vw)) / 2;
      doc.setFont('helvetica', 'bold').setTextColor(40, 116, 240).text(label, x, y);
      doc.setFont('helvetica', 'normal').setTextColor(0, 0, 180);
      if (url) doc.textWithLink(value, x + lw + 2, y, { url: url }); else doc.text(value, x + lw + 2, y);
    },
    loginGuide: function (doc) {
      var pw = doc.internal.pageSize.getWidth(), M = 15, y = 15;
      doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(40, 116, 240)
         .text('Login Guide for Picker', pw / 2, y, { align: 'center' });
      y += 5;
      doc.setDrawColor(212, 175, 55).setLineWidth(0.5).line(M, y, pw - M, y);
      y += 8;
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0, 0, 0)
         .text('Step 1: Download the Disprz App (blue icon)', pw / 2, y, { align: 'center' });
      y += 7;
      FK.pdf.centeredPair(doc, y, 'Play Store:', 'https://play.google.com/store/apps/details?id=com.disprz',
        'https://play.google.com/store/apps/details?id=com.disprz');
      y += 6;
      FK.pdf.centeredPair(doc, y, 'App Store:', 'https://apps.apple.com/in/app/disprz/id1458716803',
        'https://apps.apple.com/in/app/disprz/id1458716803');
      y += 9;

      var gap = 5, bw = (pw - 2 * M - 2 * gap) / 3, boxes = ['URL: edl.disprz.com', 'User: Casper ID (no "ca")', 'Password: Edl@123'];
      boxes.forEach(function (txt, i) {
        var x = M + i * (bw + gap);
        doc.setFillColor(254, 226, 226).roundedRect(x, y, bw, 11, 2, 2, 'F');
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0).text(txt, x + bw / 2, y + 6.8, { align: 'center' });
      });
      y += 17;
      doc.setDrawColor(212, 175, 55).setLineWidth(0.5).line(M, y, pw - M, y);
      return y + 9;
    },
    /* wrapped, centred heading; returns next y */
    title: function (doc, text, y) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(0, 0, 0);
      var lines = doc.splitTextToSize(FK.pdf.safe(text), pw - 30);
      doc.text(lines, pw / 2, y, { align: 'center' });
      return y + lines.length * 5.5 + 1;
    }
  };

  /* ── PWA install ── */
  var deferredPrompt = null;
  function isStandalone() {
    return (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) || g.navigator.standalone === true;
  }
  function isIOS() { return /iphone|ipad|ipod/i.test(g.navigator.userAgent) && !g.MSStream; }
  function updateInstallUi() {
    var btn = $('installBtn'), card = $('pwaInstallCard');
    if (btn) btn.hidden = isStandalone();
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('pwaDismissed') === '1'; } catch (e) { /* ignore */ }
    if (card) card.hidden = !(deferredPrompt && !dismissed && !isStandalone());
  }
  g.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferredPrompt = e; updateInstallUi();
  });
  g.addEventListener('appinstalled', function () {
    deferredPrompt = null; updateInstallUi(); FK.toast('App installed successfully!');
  });
  FK.install = function () {
    if (deferredPrompt) {
      var p = deferredPrompt; deferredPrompt = null; updateInstallUi();
      p.prompt();
      p.userChoice.then(function (c) { if (c.outcome === 'accepted') FK.toast('Installing...'); });
      return;
    }
    if (isStandalone()) { FK.toast('App is already installed.'); return; }
    FK.toast(isIOS()
      ? 'iPhone / iPad: tap Share, then "Add to Home Screen".'
      : 'Open the browser menu and choose "Install app" or "Add to Home screen".', false, 6000);
  };
  FK.dismissInstall = function () {
    try { sessionStorage.setItem('pwaDismissed', '1'); } catch (e) { /* ignore */ }
    var c = $('pwaInstallCard'); if (c) c.hidden = true;
  };
  FK.initInstallUi = updateInstallUi;

  /* ── service worker (reload only on UPDATE, never on first install) ── */
  FK.registerSW = function () {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloading) { reloading = true; g.location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      setInterval(function () { reg.update().catch(function () {}); }, 5 * 60 * 1000);
    }).catch(function () { /* e.g. file:// */ });
  };

  /* ── snow ── */
  FK.initSnow = function () {
    if (g.matchMedia && g.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    var cvs = $('snowCanvas'); if (!cvs) return;
    var ctx = cvs.getContext('2d'), w, h, flakes = [], on = true, N = g.innerWidth < 768 ? 14 : 36;
    function size() { w = cvs.width = g.innerWidth; h = cvs.height = g.innerHeight; }
    function make(top) {
      return { x: Math.random() * w, y: top ? -5 : Math.random() * h, r: Math.random() * 2.5 + .7, sp: Math.random() * .8 + .18,
               dr: Math.random() * .5 - .25, op: Math.random() * .4 + .18, wb: Math.random() * Math.PI * 2, ws: Math.random() * .02 + .005 };
    }
    function seed() { flakes = []; for (var i = 0; i < N; i++) flakes.push(make(false)); }
    function tick() {
      if (!on) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.wb += f.ws; f.y += f.sp; f.x += f.dr + Math.sin(f.wb) * .35;
        if (f.y > h + 5) flakes[i] = f = make(true);
        if (f.x > w + 5) f.x = -5; else if (f.x < -5) f.x = w + 5;
        ctx.globalAlpha = f.op; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    g.addEventListener('resize', function () { size(); seed(); }, { passive: true });
    document.addEventListener('visibilitychange', function () { var was = on; on = !document.hidden; if (on && !was) tick(); });
    size(); seed(); tick();
  };

  /* ── data-action click delegation (no inline onclick anywhere) ── */
  FK.delegate = function (handlers) {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el || el.disabled) return;
      var fn = handlers[el.getAttribute('data-action')];
      if (fn) fn(el, e);
    });
  };
})(window);
