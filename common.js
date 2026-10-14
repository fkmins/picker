/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — Shared Helpers, PDF Engine & Interactive G-Sheet
   Theme: Flipkart Minutes (Crimson & Yellow)
   ═══════════════════════════════════════════════════════════════ */
try {
  if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark-mode');
  }
} catch (e) {}

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
    return !s || s === 'N/A' || s === '#N/A' || s === 'NOT ASSIGNED' || s === 'UNDEFINED';
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
      b.innerHTML = isDark ? '&#9728; Light Mode' : '&#9790; Dark Mode';
    }
  };

  FK.toggleTheme = function () {
    var d = document.documentElement.classList.toggle('dark-mode');
    FK.store.set('theme', d ? 'dark' : 'light');
    FK.syncThemeBtn();
  };

  /* ── Loader ── */
  FK.hideLoader = function () {
    var l = $('appLoader');
    if (l && !l.classList.contains('hidden')) {
      l.classList.add('hidden');
      setTimeout(function () { l.style.display = 'none'; }, 450);
    }
  };

  /* ── Cache Helpers ── */
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

  /* ── Focus Trap for Modals ── */
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

  /* ── Image to PNG DataURL (Supports WebP) ── */
  FK.getImageDataUrl = function (src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  };

  /* ── PDF Helpers (jsPDF + AutoTable) ── */
  var loaded = {};
  FK.loadScript = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = function () { delete loaded[src]; s.remove(); rej(new Error('Failed to load: ' + src)); };
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
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
      fontSize: 10
    },
    bodyStyles: {
      halign: 'center',
      valign: 'middle',
      textColor: [0, 0, 0],
      fontSize: 9.5,
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
      cellPadding: 3,
      overflow: 'linebreak'
    },
    countCell: function (cell) {
      var v = parseInt(cell.raw, 10);
      if (isNaN(v)) return;
      if (v > 20) { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27]; cell.styles.fontStyle = 'bold'; }
      else if (v >= 10) { cell.styles.fillColor = [254, 240, 138]; cell.styles.textColor = [133, 77, 14]; cell.styles.fontStyle = 'bold'; }
      else { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52]; cell.styles.fontStyle = 'bold'; }
    },
    pageNumbers: function (doc) {
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 120, 120);
        doc.text('Page ' + i + ' of ' + n + ' | Flipkart Minutes East L&D | Generated: ' + FK.dateStamp(),
          doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 7, { align: 'center' });
      }
    },
    centeredPair: function (doc, y, label, value, url) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(9);
      var lw = doc.getTextWidth(label);
      doc.setFont('helvetica', 'normal');
      var vw = doc.getTextWidth(value);
      var x = (pw - (lw + 2 + vw)) / 2;
      doc.setFont('helvetica', 'bold').setTextColor(186, 8, 67).text(label, x, y);
      doc.setFont('helvetica', 'normal').setTextColor(40, 116, 240);
      if (url) doc.textWithLink(value, x + lw + 2, y, { url: url });
      else doc.text(value, x + lw + 2, y);
    },
    loginGuide: function (doc, logoImg) {
      var pw = doc.internal.pageSize.getWidth(), M = 14, y = 14;
      var PLAY = 'https://play.google.com/store/apps/details?id=com.disprz';
      var APPLE = 'https://apps.apple.com/in/app/disprz/id1458716803';

      // Disprz Logo if available
      if (logoImg && logoImg.dataUrl) {
        var iw = 22, ih = (logoImg.height / logoImg.width) * iw;
        doc.addImage(logoImg.dataUrl, 'PNG', (pw - iw) / 2, y, iw, ih);
        y += ih + 4;
      }

      // Title
      doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(186, 8, 67)
        .text('Picker Login Guide', pw / 2, y, { align: 'center' });
      y += 4;
      doc.setDrawColor(225, 29, 72).setLineWidth(0.6).line(M, y, pw - M, y);
      y += 7;

      // App Download
      doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(0, 0, 0)
        .text('Step 1: Download the Disprz App (blue icon)', pw / 2, y, { align: 'center' });
      y += 6;
      FK.pdf.centeredPair(doc, y, 'Android App Link:', PLAY, PLAY);
      y += 5.5;
      FK.pdf.centeredPair(doc, y, 'iPhone App Link:', APPLE, APPLE);
      y += 8;

      // Credentials 3-Boxes (Border Red, Inside Yellow)
      var gap = 4, bw = (pw - 2 * M - 2 * gap) / 3;
      var boxes = [
        { label: 'Organisational URL', val: 'edl.disprz.com' },
        { label: 'User ID', val: 'Casper ID (no "ca")' },
        { label: 'Password', val: 'Edl@123' }
      ];

      boxes.forEach(function (b, i) {
        var x = M + i * (bw + gap);
        // Yellow fill (#FEF08A = [254, 240, 138]), Red border (#DC2626 = [220, 38, 38])
        doc.setFillColor(254, 240, 138);
        doc.setDrawColor(220, 38, 38);
        doc.setLineWidth(0.5);
        doc.roundedRect(x, y, bw, 13, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(153, 27, 27)
          .text(b.label, x + bw / 2, y + 4.8, { align: 'center' });
        doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(0, 0, 0)
          .text(b.val, x + bw / 2, y + 10, { align: 'center' });
      });

      y += 18;
      doc.setDrawColor(225, 29, 72).setLineWidth(0.6).line(M, y, pw - M, y);
      return y + 8;
    },
    title: function (doc, text, y) {
      var pw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0, 0, 0);
      var lines = doc.splitTextToSize(FK.pdf.safe(text), pw - 30);
      doc.text(lines, pw / 2, y, { align: 'center' });
      return y + lines.length * 6 + 1;
    }
  };

  /* ═══ Interactive Google Sheet Generation Screen ═══ */
  FK.createInteractiveGSheetWindow = function () {
    var win = window.open('about:blank', '_blank');
    if (!win) return null;

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Google Sheet Generation | Flipkart Minutes</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">' +
      '<style>' +
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:Inter,sans-serif;background:#0a0f1d;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;}' +
      '.card{background:rgba(18,24,40,0.96);border:1.5px solid rgba(225,29,72,0.3);border-radius:28px;padding:40px 32px;max-width:520px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.6),0 0 30px rgba(225,29,72,0.2);position:relative;overflow:hidden;}' +
      '.card::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#FFD200,#BA0843,#FFD200);}' +
      '.brand{font-size:20px;font-weight:900;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:6px;}' +
      '.fk-yellow{color:#FFD200;font-style:italic;}' +
      '.fk-red{color:#E11D48;text-transform:uppercase;}' +
      '.radar{width:70px;height:70px;border-radius:50%;border:4px solid rgba(225,29,72,0.2);border-top-color:#E11D48;border-right-color:#FFD200;animation:spin 1s linear infinite;margin:0 auto 24px;}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.h1{font-size:22px;font-weight:900;color:#FFFFFF;margin-bottom:12px;letter-spacing:-0.3px;}' +
      '.sub{font-size:14px;color:#94a3b8;margin-bottom:28px;line-height:1.5;}' +
      '.steps{display:flex;flex-direction:column;gap:12px;text-align:left;background:rgba(10,15,29,0.7);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:28px;}' +
      '.step{display:flex;align-items:center;gap:12px;font-size:13px;font-weight:700;color:#94a3b8;}' +
      '.step.active{color:#FFD200;}' +
      '.step.done{color:#10b981;}' +
      '.step-icon{width:20px;text-align:center;font-size:14px;}' +
      '.guide-preview{background:rgba(254,240,138,0.12);border:1px dashed #FFD200;border-radius:14px;padding:14px;font-size:12px;color:#FFD200;margin-bottom:24px;}' +
      '.btn-open{display:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;padding:14px 28px;border-radius:50px;font-weight:900;font-size:15px;box-shadow:0 4px 18px rgba(16,185,129,0.4);cursor:pointer;border:none;margin-top:10px;}' +
      '.btn-open:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(16,185,129,0.6);}' +
      '</style></head><body>' +
      '<div class="card">' +
      '<div class="brand"><span class="fk-yellow">Flipkart</span> <span class="fk-red">Minutes</span></div>' +
      '<div class="radar" id="radar"></div>' +
      '<h1 class="h1" id="mainTitle">Google Sheet generation under process</h1>' +
      '<p class="sub" id="subTitle">Please wait while the workbook, Login Guide, and Anyone-with-link permissions are configured...</p>' +
      '<div class="steps">' +
      '<div class="step done" id="s1"><span class="step-icon">✓</span> Fetching active pendency records</div>' +
      '<div class="step active" id="s2"><span class="step-icon">⟳</span> Structuring Google Sheets workbook</div>' +
      '<div class="step" id="s3"><span class="step-icon">○</span> Embedding Picker Login Guide</div>' +
      '<div class="step" id="s4"><span class="step-icon">○</span> Setting permission: Anyone with link can view</div>' +
      '</div>' +
      '<div class="guide-preview">' +
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
      updateStep: function (stepNum) {
        try {
          if (!win || win.closed) return;
          var doc = win.document;
          for (var i = 1; i <= 4; i++) {
            var el = doc.getElementById('s' + i);
            if (!el) continue;
            if (i < stepNum) {
              el.className = 'step done';
              el.querySelector('.step-icon').textContent = '✓';
            } else if (i === stepNum) {
              el.className = 'step active';
              el.querySelector('.step-icon').textContent = '⟳';
            } else {
              el.className = 'step';
              el.querySelector('.step-icon').textContent = '○';
            }
          }
        } catch (e) {}
      },
      done: function (url) {
        try {
          if (!win || win.closed) {
            window.open(url, '_blank');
            return;
          }
          var doc = win.document;
          for (var i = 1; i <= 4; i++) {
            var el = doc.getElementById('s' + i);
            if (el) { el.className = 'step done'; el.querySelector('.step-icon').textContent = '✓'; }
          }
          var radar = doc.getElementById('radar');
          if (radar) { radar.style.borderColor = '#10b981'; radar.style.animation = 'none'; radar.innerHTML = '<span style="font-size:36px;line-height:62px;color:#10b981">✓</span>'; }
          var mt = doc.getElementById('mainTitle');
          if (mt) mt.textContent = 'Google Sheet Ready!';
          var st = doc.getElementById('subTitle');
          if (st) st.textContent = 'Redirecting to your spreadsheet...';
          var btn = doc.getElementById('openBtn');
          if (btn) {
            btn.href = url;
            btn.style.display = 'inline-block';
          }
          setTimeout(function () {
            try { win.location.href = url; } catch (e) {}
          }, 1200);
        } catch (e) {
          window.open(url, '_blank');
        }
      },
      error: function (errMsg) {
        try {
          if (!win || win.closed) return;
          var doc = win.document;
          var radar = doc.getElementById('radar');
          if (radar) { radar.style.borderColor = '#ef4444'; radar.style.animation = 'none'; radar.innerHTML = '<span style="font-size:36px;line-height:62px;color:#ef4444">✕</span>'; }
          var mt = doc.getElementById('mainTitle');
          if (mt) { mt.textContent = 'Generation Failed'; mt.style.color = '#ef4444'; }
          var st = doc.getElementById('subTitle');
          if (st) st.textContent = errMsg || 'An error occurred while generating the Google Sheet.';
        } catch (e) {}
      }
    };
  };

  /* ── Service Worker & Event Delegation ── */
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
