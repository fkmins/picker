/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — Shared Utilities & Lightweight PDF Engine
   ═══════════════════════════════════════════════════════════════ */

// 1. Restore Flipkart flap wallpaper randomizer
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark-mode');
    }
  } catch (e) {}

  var wallpapers = [
    'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/9058b9427a302777.jpg',
    'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/addb7fb32c963374.png'
  ];
  var chosen = wallpapers[Math.floor(Math.random() * wallpapers.length)];
  var style = document.createElement('style');
  style.textContent = 'body::before{background-image:url("' + chosen + '")}';
  document.head.appendChild(style);
})();

(function (g) {
  'use strict';
  var FK = g.FK = {};

  FK.API_URL = 'https://script.google.com/macros/s/AKfycbwG40qfn0MTw9c6n21R3zkSqdR1Nb7sRHEH3MbuLrptD95wAfucauTOAn-z93vIxeEP/exec';

  var $ = FK.$ = function (id) { return document.getElementById(id); };

  FK.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };

  FK.isNA = function (v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return !s || s === 'N/A' || s === '#N/A' || s === 'NOT ASSIGNED';
  };

  FK.clean = function (v) { return FK.isNA(v) ? '' : String(v).trim(); };

  FK.titleCase = function (s) {
    return !s ? '' : String(s).toLowerCase().replace(/(^|[\s_\-])\w/g, function (m) { return m.toUpperCase(); });
  };

  FK.dateStamp = function () {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  };

  FK.isNetworkError = function (e) {
    return !!e && (e.name === 'TypeError' || e.name === 'AbortError' || /network/i.test(e.message || ''));
  };

  /* ── Local Storage ── */
  FK.store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };

  /* ── Toast Notifications ── */
  var toastTimer = null;
  FK.toast = function (msg, isErr, ms) {
    var t = $('toastText');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast-msg' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  };

  /* ── Theme ── */
  FK.syncThemeBtn = function () {
    var b = $('themeBtn');
    if (b) {
      var isDark = document.documentElement.classList.contains('dark-mode');
      b.textContent = isDark ? 'Damage Your Eyes' : 'Save Your Eyes';
    }
  };

  FK.toggleTheme = function () {
    var d = document.documentElement.classList.toggle('dark-mode');
    FK.store.set('theme', d ? 'dark' : 'light');
    FK.syncThemeBtn();
  };

  FK.hideLoader = function () {
    var l = $('appLoader');
    if (l && !l.classList.contains('hidden')) {
      l.classList.add('hidden');
      setTimeout(function () { l.style.display = 'none'; }, 450);
    }
  };

  FK.readCache = function (key) {
    try {
      var c = JSON.parse(FK.store.get(key) || 'null');
      return c && Array.isArray(c.data) ? c : null;
    } catch (e) { return null; }
  };

  FK.writeCache = function (key, data) {
    FK.store.set(key, JSON.stringify({ data: data, ts: Date.now() }));
  };

  /* ── Network & Offline Sync ── */
  FK.fetchJson = function (url, opts) {
    opts = opts || {};
    var init = { method: (opts.method || 'GET').toUpperCase(), redirect: 'follow' };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body) init.body = opts.body;
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  };

  FK.post = function (payload) {
    return FK.fetchJson(FK.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  };

  FK.syncOfflineQueue = function () {
    var q = JSON.parse(FK.store.get('fk_offline_exits') || '[]');
    if (!q.length || !navigator.onLine) return;
    FK.post({ action: 'exit', items: q.map(function (id) { return { id: id }; }) }).then(function (res) {
      if (res && res.status === 'Success') {
        FK.store.set('fk_offline_exits', '[]');
        FK.toast('Offline edits synced.');
      }
    }).catch(function () {});
  };
  g.addEventListener('online', FK.syncOfflineQueue);

  FK.trapFocus = function (modal) {
    var focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    modal.onkeydown = function (e) {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
  };

  /* ── PDF Helpers (jsPDF + AutoTable) ── */
  var loaded = {};
  FK.loadScript = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = function () { delete loaded[src]; s.remove(); rej(new Error('Load failed: ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  };

  FK.ensureJsPdf = function () {
    if (g.jspdf && g.jspdf.jsPDF && g.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(function () {
        return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js');
      });
  };

  FK.pdf = {
    safe: function (s) {
      return String(s == null ? '' : s).normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineWidth: 0.25,
      lineColor: [0, 0, 0],
      fontSize: 10
    },
    bodyStyles: {
      halign: 'center',
      valign: 'middle',
      textColor: [0, 0, 0],
      fontSize: 9.5,
      lineWidth: 0.25,
      lineColor: [0, 0, 0],
      cellPadding: 3,
      overflow: 'linebreak'
    },
    countCell: function (cell) {
      var v = parseInt(cell.raw, 10);
      if (isNaN(v)) return;
      if (v > 20) { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27]; }
      else if (v >= 10) { cell.styles.fillColor = [254, 240, 138]; cell.styles.textColor = [133, 77, 14]; }
      else { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52]; }
    },
    pageNumbers: function (doc) {
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 120, 120);
        // Exact format requested
        var txt = 'Page ' + i + ' of ' + n + ' | Flipkart Minutes East L&D | Generated: ' + FK.dateStamp();
        doc.text(txt, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 7, { align: 'center' });
      }
    },
    centeredPair: function (doc, y, label, value, url) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(9);
      var lw = doc.getTextWidth(label);
      doc.setFont('helvetica', 'normal').setFontSize(9);
      var vw = doc.getTextWidth(value);
      var x = (pw - (lw + 2 + vw)) / 2;
      doc.setFont('helvetica', 'bold').setTextColor(186, 8, 67).text(label, x, y);
      doc.setFont('helvetica', 'normal').setTextColor(40, 116, 240);
      if (url) doc.textWithLink(value, x + lw + 2, y, { url: url });
      else doc.text(value, x + lw + 2, y);
    },
    /* ── Mobile-Safe Center-Aligned Login Guide (Generous spacing, Zero overlap) ── */
    loginGuide: function (doc) {
      var pw = doc.internal.pageSize.getWidth(); // 210 mm
      var M = 15; // 15 mm margin
      var y = 14;
      var PLAY = 'https://play.google.com/store/apps/details?id=com.disprz';
      var APPLE = 'https://apps.apple.com/in/app/disprz/id1458716803';

      // Title: "Picker Login Guide"
      doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(186, 8, 67);
      doc.text('Picker Login Guide', pw / 2, y, { align: 'center' });
      y += 5;

      // Divider Line
      doc.setDrawColor(212, 175, 55).setLineWidth(0.4).line(M, y, pw - M, y);
      y += 7.5;

      // Step 1: Download Disprz App (Blue Icon)
      doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(0, 0, 0);
      doc.text('Step 1: Download the Disprz App (blue icon)', pw / 2, y, { align: 'center' });
      y += 6.5;

      // App Links (Centered)
      FK.pdf.centeredPair(doc, y, 'Play Store:', PLAY, PLAY);
      y += 5.5;
      FK.pdf.centeredPair(doc, y, 'App Store:', APPLE, APPLE);
      y += 8.5;

      // 3 Centered Boxes with ample space (No overlapping possible)
      var gap = 4, bw = (pw - 2 * M - 2 * gap) / 3, boxH = 10.5;

      // Box 1: Organisational URL (Border Red, Inside Yellow)
      var x1 = M;
      doc.setFillColor(254, 240, 138); // Yellow inside
      doc.setDrawColor(220, 38, 38);   // Border red
      doc.setLineWidth(0.4);
      doc.roundedRect(x1, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(0, 0, 0);
      doc.text('URL: edl.disprz.com', x1 + bw / 2, y + 6.8, { align: 'center' });

      // Box 2: User ID
      var x2 = M + bw + gap;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.3);
      doc.roundedRect(x2, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(0, 0, 0);
      doc.text('User: Casper ID (no "ca")', x2 + bw / 2, y + 6.8, { align: 'center' });

      // Box 3: Password (Border Red, Inside Yellow)
      var x3 = M + 2 * (bw + gap);
      doc.setFillColor(254, 240, 138); // Yellow inside
      doc.setDrawColor(220, 38, 38);   // Border red
      doc.setLineWidth(0.4);
      doc.roundedRect(x3, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(0, 0, 0);
      doc.text('Password: Edl@123', x3 + bw / 2, y + 6.8, { align: 'center' });

      y += boxH + 6.5;

      // Bottom Divider Line
      doc.setDrawColor(212, 175, 55).setLineWidth(0.4).line(M, y, pw - M, y);
      return y + 8;
    },
    title: function (doc, text, y) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(0, 0, 0);
      var lines = doc.splitTextToSize(FK.pdf.safe(text), pw - 30);
      doc.text(lines, pw / 2, y, { align: 'center' });
      return y + lines.length * 5.5 + 2;
    }
  };

  /* ── Interactive Google Sheet Generation Screen ── */
  FK.createInteractiveGSheetWindow = function () {
    var win = window.open('about:blank', '_blank');
    if (!win) return null;

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Google Sheet Generation | Flipkart Minutes</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">' +
      '<style>' +
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:Inter,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;}' +
      '.card{background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:22px;padding:36px 28px;max-width:480px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.5);}' +
      '.brand{font-size:18px;font-weight:900;margin-bottom:16px;}' +
      '.fk-yellow{color:#FFD200;font-style:italic;}' +
      '.fk-red{color:#BA0843;text-transform:uppercase;}' +
      '.spinner{width:46px;height:46px;border:3px solid rgba(255,255,255,0.15);border-top-color:#FFD200;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.h1{font-size:20px;font-weight:900;color:#fff;margin-bottom:10px;}' +
      '.sub{font-size:13.5px;color:#94a3b8;margin-bottom:22px;line-height:1.5;}' +
      '.guide-box{background:rgba(254,240,138,0.1);border:1px solid rgba(254,240,138,0.3);border-radius:12px;padding:12px;font-size:12px;color:#fde047;margin-bottom:20px;}' +
      '.btn-open{display:none;background:#10b981;color:#fff;text-decoration:none;padding:12px 26px;border-radius:50px;font-weight:800;font-size:14px;cursor:pointer;border:none;margin-top:8px;}' +
      '</style></head><body>' +
      '<div class="card">' +
      '<div class="brand"><span class="fk-yellow">Flipkart</span> <span class="fk-red">Minutes</span></div>' +
      '<div class="spinner" id="spinner"></div>' +
      '<h1 class="h1" id="mainTitle">Google Sheet generation under process</h1>' +
      '<p class="sub" id="subTitle">Please wait while the workbook, Login Guide, and Anyone-with-link permissions are generated...</p>' +
      '<div class="guide-box">' +
      '<strong>Quick Login Info:</strong><br>' +
      'URL: <strong>edl.disprz.com</strong> | Password: <strong>Edl@123</strong><br>' +
      'User: <strong>Casper ID (no "ca")</strong>' +
      '</div>' +
      '<a href="#" target="_self" class="btn-open" id="openBtn">Open Google Sheet Now ↗</a>' +
      '</div>' +
      '</body></html>';

    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (e) {}

    return {
      win: win,
      done: function (url) {
        try {
          if (!win || win.closed) {
            window.open(url, '_blank');
            return;
          }
          var doc = win.document;
          var sp = doc.getElementById('spinner');
          if (sp) { sp.style.borderColor = '#10b981'; sp.style.animation = 'none'; sp.innerHTML = '<span style="color:#10b981;font-size:24px;line-height:40px">✓</span>'; }
          var mt = doc.getElementById('mainTitle');
          if (mt) mt.textContent = 'Google Sheet Ready!';
          var st = doc.getElementById('subTitle');
          if (st) st.textContent = 'Redirecting to your spreadsheet...';
          var btn = doc.getElementById('openBtn');
          if (btn) { btn.href = url; btn.style.display = 'inline-block'; }
          setTimeout(function () {
            try { win.location.href = url; } catch (e) {}
          }, 1000);
        } catch (e) {
          window.open(url, '_blank');
        }
      },
      error: function (errMsg) {
        try {
          if (!win || win.closed) return;
          var doc = win.document;
          var sp = doc.getElementById('spinner');
          if (sp) { sp.style.borderColor = '#ef4444'; sp.style.animation = 'none'; sp.innerHTML = '<span style="color:#ef4444;font-size:24px;line-height:40px">✕</span>'; }
          var mt = doc.getElementById('mainTitle');
          if (mt) { mt.textContent = 'Generation Failed'; mt.style.color = '#ef4444'; }
          var st = doc.getElementById('subTitle');
          if (st) st.textContent = errMsg || 'An error occurred while generating the Google Sheet.';
        } catch (e) {}
      }
    };
  };

  FK.registerSW = function () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    }
  };

  FK.delegate = function (handlers) {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el && !el.disabled && handlers[el.getAttribute('data-action')]) {
        handlers[el.getAttribute('data-action')](el, e);
      }
    });
  };
})(window);
