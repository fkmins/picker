/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — shared helpers
   ═══════════════════════════════════════════════════════════════ */
try {
  if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark-mode');
  }
} catch(e) {}

(function (g) {
  'use strict';
  var FK = g.FK = {};
  
  FK.API_URL = 'https://script.google.com/macros/s/AKfycbwG40qfn0MTw9c6n21R3zkSqdR1Nb7sRHEH3MbuLrptD95wAfucauTOAn-z93vIxeEP/exec';
  
  var $ = FK.$ = function (id) { return document.getElementById(id); };

  FK.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  FK.isNA = function (v) { var s = String(v).trim().toUpperCase(); return !s || s === 'N/A' || s === '#N/A' || s === 'NOT ASSIGNED'; };
  FK.clean = function (v) { return FK.isNA(v) ? '' : String(v).trim(); };
  FK.titleCase = function (s) { return !s ? '' : String(s).toLowerCase().replace(/(^|[\s_\-])\w/g, function (m) { return m.toUpperCase(); }); };
  FK.dateStamp = function () { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear(); };
  FK.isNetworkError = function (e) { return !!e && (e.name === 'TypeError' || e.name === 'AbortError'); };

  FK.store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  
  var toastTimer = null;
  FK.toast = function (msg, isErr, ms) {
    var t = $('toastText'); if (!t) return;
    t.textContent = msg; t.className = 'toast-msg' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  };
  
  FK.syncThemeBtn = function () { var b = $('themeBtn'); if (b) b.textContent = document.documentElement.classList.contains('dark-mode') ? 'Damage Your Eyes' : 'Save Your Eyes'; };
  FK.toggleTheme = function () {
    var d = document.documentElement.classList.toggle('dark-mode');
    FK.store.set('theme', d ? 'dark' : 'light'); FK.syncThemeBtn();
  };
  
  FK.hideLoader = function () { var l = $('appLoader'); if (l && !l.classList.contains('hidden')) { l.classList.add('hidden'); setTimeout(function () { l.style.display = 'none'; }, 450); }};

  FK.readCache = function (key) {
    try {
      var c = JSON.parse(FK.store.get(key) || 'null');
      return c && Array.isArray(c.data) ? c : null;
    } catch (e) { return null; }
  };
  FK.writeCache = function (key, data) { FK.store.set(key, JSON.stringify({ data: data, ts: Date.now() })); };

  /* ── Network & Offline Sync Queue ── */
  FK.fetchJson = function (url, opts) {
    opts = opts || {};
    var init = { method: (opts.method || 'GET').toUpperCase(), redirect: 'follow' };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body) init.body = opts.body;
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error('Server returned HTTP ' + r.status);
      return r.json();
    });
  };

  FK.post = function (payload) {
    return FK.fetchJson(FK.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  };

  FK.syncOfflineQueue = function() {
    var q = JSON.parse(FK.store.get('fk_offline_exits') || '[]');
    if (!q.length || !navigator.onLine) return;
    FK.post({ action: 'exit', items: q.map(function(id) { return {id: id}; }) }).then(function(res) {
      if(res && res.status === 'Success') { FK.store.set('fk_offline_exits', '[]'); FK.toast('Offline edits synced.'); }
    }).catch(function(){});
  };
  g.addEventListener('online', FK.syncOfflineQueue);

  /* ── Accessibility Focus Trap ── */
  FK.trapFocus = function(modal) {
    var focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if(!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    modal.onkeydown = function(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
  };

  /* ── Notifications Loop ── */
  FK.startNotificationLoop = function() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    setInterval(function () {
      new Notification('Flipkart Minutes', { body: 'It has been 4 hours. Check dashboard for pending pickers!', icon: 'icons/icon-192.png' });
    }, 4 * 60 * 60 * 1000); 
  };
  if ('Notification' in window && Notification.permission === 'granted') FK.startNotificationLoop();

  /* ── PWA Install & Notification Merge ── */
  var deferredPrompt = null;
  function isStandalone() { return (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) || g.navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(g.navigator.userAgent) && !g.MSStream; }
  
  function updateInstallUi() {
    var btn = $('installBtn'), card = $('pwaInstallCard');
    if (btn) btn.hidden = isStandalone(); 
    var dismissed = FK.store.get('pwaDismissed') === '1';
    if (card) card.hidden = !(deferredPrompt && !dismissed && !isStandalone());
  }
  
  g.addEventListener('DOMContentLoaded', updateInstallUi);
  g.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; updateInstallUi(); });
  g.addEventListener('appinstalled', function () { 
    deferredPrompt = null; updateInstallUi(); 
    if($('installBtn')) $('installBtn').hidden = true;
    FK.toast('App installed successfully!'); 
  });
  
  FK.install = function () {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission().then(function(p) { if(p === 'granted') FK.startNotificationLoop(); });
    }
    if (deferredPrompt) {
      var p = deferredPrompt; deferredPrompt = null; updateInstallUi();
      p.prompt();
      p.userChoice.then(function (c) { if (c.outcome === 'accepted') FK.toast('Installing...'); });
      return;
    }
    if (isStandalone()) { FK.toast('App is already installed.'); return; }
    FK.toast(isIOS() ? 'iPhone / iPad: tap Share, then "Add to Home Screen".' : 'Open the browser menu and choose "Install app" or "Add to Home screen".', false, 6000);
  };
  
  FK.dismissInstall = function () { FK.store.set('pwaDismissed', '1'); var c = $('pwaInstallCard'); if (c) c.hidden = true; };
  FK.initInstallUi = updateInstallUi;

  /* ── PDF Helpers ── */
  var loaded = {};
  FK.loadScript = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = function () { delete loaded[src]; s.remove(); rej(new Error('Load failed')); };
      document.head.appendChild(s);
    }); return loaded[src];
  };
  
  FK.ensureJsPdf = function () {
    if (g.jspdf && g.jspdf.jsPDF && g.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(function () { return FK.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js'); });
  };
  
  FK.pdf = {
    safe: function (s) { return String(s == null ? '' : s).normalize('NFKD').replace(/[^\x20-\x7E]/g, '?'); },
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle', lineWidth: 0.2, lineColor: [90, 90, 90], fontSize: 10 },
    bodyStyles: { halign: 'center', valign: 'middle', textColor: [0, 0, 0], fontSize: 9.5, lineWidth: 0.2, lineColor: [90, 90, 90], cellPadding: 2.6, overflow: 'linebreak' },
    
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
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 120, 120);
        doc.text('Page ' + i + ' of ' + n + ' | Generated ' + FK.dateStamp(), doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 7, { align: 'center' });
      }
    },
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
      var PLAY = 'https://play.google.com/store/apps/details?id=com.disprz';
      var APPLE = 'https://apps.apple.com/in/app/disprz/id1458716803';
      
      doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(40, 116, 240).text('Login Guide for Picker', pw / 2, y, { align: 'center' });
      y += 5; doc.setDrawColor(212, 175, 55).setLineWidth(0.5).line(M, y, pw - M, y);
      y += 8; doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0, 0, 0).text('Step 1: Download the Disprz App (blue icon)', pw / 2, y, { align: 'center' });
      y += 7; FK.pdf.centeredPair(doc, y, 'Play Store:', PLAY, PLAY);
      y += 6; FK.pdf.centeredPair(doc, y, 'App Store:', APPLE, APPLE);
      y += 9;

      var gap = 5, bw = (pw - 2 * M - 2 * gap) / 3, boxes = ['URL: edl.disprz.com', 'User: Casper ID (no "ca")', 'Password: Edl@123'];
      boxes.forEach(function (txt, i) {
        var x = M + i * (bw + gap);
        doc.setFillColor(254, 226, 226).roundedRect(x, y, bw, 11, 2, 2, 'F');
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0).text(txt, x + bw / 2, y + 6.8, { align: 'center' });
      });
      
      y += 17; doc.setDrawColor(212, 175, 55).setLineWidth(0.5).line(M, y, pw - M, y);
      return y + 9;
    },
    title: function (doc, text, y) {
      var pw = doc.internal.pageSize.getWidth(); doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(0, 0, 0);
      var lines = doc.splitTextToSize(FK.pdf.safe(text), pw - 30); doc.text(lines, pw / 2, y, { align: 'center' });
      return y + lines.length * 5.5 + 1;
    }
  };

  /* ── Service Worker & Delegation ── */
  FK.registerSW = function () { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function(){}); };
  
  FK.delegate = function (handlers) {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el && !el.disabled && handlers[el.getAttribute('data-action')]) handlers[el.getAttribute('data-action')](el, e);
    });
  };
})(window);
