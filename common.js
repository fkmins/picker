/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — Shared Utilities & Lightweight PDF Engine
   ═══════════════════════════════════════════════════════════════ */

// 1. Wallpaper auto-rotator that randomly selects Flipkart flap banner images
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

// 2. Preload Disprz Logo for crisp vector PDF embedding
var disprzLogoDataUrl = null;
(function preloadDisprzLogo() {
  try {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var cv = document.createElement('canvas');
        cv.width = img.naturalWidth || 100;
        cv.height = img.naturalHeight || 100;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        disprzLogoDataUrl = cv.toDataURL('image/png');
      } catch (e) {}
    };
    img.src = 'icons/disprz.logo.webp';
  } catch (e) {}
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
    return !s || s === 'N/A' || s === '#N/A' || s === 'NOT ASSIGNED' || s === '-';
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

  /* ── Theme Toggle ── */
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
      return c && c.data ? c : null;
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
      cellPadding: 2.8,
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
      // User request: No footer line on exported PDF
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
    /* ── Mobile & Desktop Safe Center-Aligned Login Guide ── */
    loginGuide: function (doc) {
      var pw = doc.internal.pageSize.getWidth(); // A4 mm = 210
      var M = 14; // 14 mm margin
      var y = 11;
      var PLAY = 'https://play.google.com/store/apps/details?id=com.disprz';
      var APPLE = 'https://apps.apple.com/in/app/disprz/id1458716803';

      if (disprzLogoDataUrl) {
        try {
          doc.addImage(disprzLogoDataUrl, 'PNG', (pw - 9) / 2, y, 9, 9);
          y += 13.5;
        } catch (e) {
          y += 2;
        }
      } else {
        y += 4;
      }

      // Title: "Picker Login Guide"
      doc.setFont('helvetica', 'bold').setFontSize(14.5).setTextColor(186, 8, 67);
      doc.text('Picker Login Guide', pw / 2, y, { align: 'center' });
      y += 5.5;

      // Gold Divider Line
      doc.setDrawColor(212, 175, 55).setLineWidth(0.4).line(M, y, pw - M, y);
      y += 7.5;

      // Step 1: Download Disprz App (Blue Icon)
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0, 0, 0);
      doc.text('Step 1: Download the Disprz App (blue icon)', pw / 2, y, { align: 'center' });
      y += 6;

      // App Links
      FK.pdf.centeredPair(doc, y, 'Android App Link: ', PLAY, PLAY);
      y += 5.5;
      FK.pdf.centeredPair(doc, y, 'iPhone App Link: ', APPLE, APPLE);
      y += 8.5;

      // 3 Centered Boxes with ample space (Zero overlap)
      var gap = 5, bw = (pw - 2 * M - 2 * gap) / 3, boxH = 13.5;

      // Box 1: Organisational URL (Border Red, Inside Yellow)
      var x1 = M;
      doc.setFillColor(254, 240, 138);
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.45);
      doc.roundedRect(x1, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(186, 8, 67);
      doc.text('Orginistaional Url', x1 + bw / 2, y + 5.2, { align: 'center' });
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0);
      doc.text('edl.disprz.com', x1 + bw / 2, y + 10.2, { align: 'center' });

      // Box 2: User ID (Casper ID without ca.)
      var x2 = M + bw + gap;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.35);
      doc.roundedRect(x2, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(71, 85, 105);
      doc.text('User ID', x2 + bw / 2, y + 4.8, { align: 'center' });
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(0, 0, 0);
      doc.text('Casper ID (456354)', x2 + bw / 2, y + 9.2, { align: 'center' });
      doc.setFont('helvetica', 'normal').setFontSize(6.8).setTextColor(100, 116, 139);
      doc.text('[without ca.]', x2 + bw / 2, y + 12.2, { align: 'center' });

      // Box 3: Password (Border Red, Inside Yellow)
      var x3 = M + 2 * (bw + gap);
      doc.setFillColor(254, 240, 138);
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.45);
      doc.roundedRect(x3, y, bw, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(186, 8, 67);
      doc.text('Password', x3 + bw / 2, y + 5.2, { align: 'center' });
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0);
      doc.text('Edl@123', x3 + bw / 2, y + 10.2, { align: 'center' });

      y += boxH + 6;

      // Bottom Divider Line
      doc.setDrawColor(212, 175, 55).setLineWidth(0.4).line(M, y, pw - M, y);
      return y + 8;
    },
    title: function (doc, text, y) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0, 0, 0);
      var lines = doc.splitTextToSize(FK.pdf.safe(text), pw - 28);
      doc.text(lines, pw / 2, y, { align: 'center' });
      return y + lines.length * 5.2 + 2;
    }
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
