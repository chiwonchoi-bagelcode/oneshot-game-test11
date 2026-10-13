/* 잉크 밀물 — 화면·입력·진행 (sim.js 위에 얹는다) */
(function () {
  'use strict';
  var VERSION = 'v0.1.0', BUILD = '20261012';
  var COLORS = { R: '#e5484d', Y: '#f2c21b', B: '#3b82f6', O: '#f97316', P: '#8b5cf6', G: '#22c55e', K: '#2a2a2e' };
  var NAMES = { R: '빨강', Y: '노랑', B: '파랑', O: '주황', P: '보라', G: '초록', K: '검정' };
  var SAVE_KEY = 'ink-tide-progress-v1';

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var el = {
    title: document.getElementById('lv-title'), tut: document.getElementById('tutorial'),
    palette: document.getElementById('palette'), overlay: document.getElementById('overlay'),
    ovTitle: document.getElementById('ov-title'), ovBody: document.getElementById('ov-body'),
    ovBtns: document.getElementById('ov-btns'), levels: document.getElementById('levels'),
    levelList: document.getElementById('level-list'), status: document.getElementById('status'),
    btnRestart: document.getElementById('btn-restart'), btnLevels: document.getElementById('btn-levels'),
    btnPause: document.getElementById('btn-pause'), btnCloseLevels: document.getElementById('btn-close-levels'),
    ver: document.getElementById('version')
  };
  el.ver.textContent = VERSION + ' · ' + BUILD;

  var progress = loadProgress();
  window.InkDebug = { get state() { return state; } }; // 자동 검수용 읽기 전용 접근
  var order = window.PROGRESSION.order;
  var state = { levelId: null, sim: null, started: false, paused: false, finished: false, acc: 0, last: 0, cell: 0, ox: 0, oy: 0, ripples: [], audio: null };

  function loadProgress() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || { cleared: {} }; } catch (e) { return { cleared: {} }; } }
  function saveProgress() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* 저장 불가 환경 */ } }
  function isUnlocked(i) { return i === 0 || !!progress.cleared[order[i - 1]]; }

  /* ---------- 레벨 로드 ---------- */
  function loadLevel(id) {
    var def = window.LEVELS[id];
    if (!def) { el.status.textContent = '레벨을 찾을 수 없습니다: ' + id; return; }
    state.levelId = id; state.sim = new window.InkSim.Sim(def);
    state.started = false; state.paused = false; state.finished = false; state.acc = 0; state.ripples = [];
    var n = order.indexOf(id) + 1;
    el.title.textContent = n + '. ' + def.title;
    el.tut.textContent = def.tutorial || '';
    el.tut.style.display = def.tutorial ? '' : 'none';
    el.overlay.classList.add('hidden'); el.levels.classList.add('hidden');
    el.btnPause.textContent = '일시정지';
    renderPalette(); resize(); setStatus();
    location.hash = id;
  }

  function setStatus() {
    var s = state.sim;
    if (!s) return;
    if (state.finished) return;
    if (state.paused) el.status.textContent = '일시정지';
    else if (!state.started) el.status.textContent = '빈 칸을 눌러 첫 방울을 떨어뜨리세요';
    else if (s.remaining() > 0) el.status.textContent = '번지는 중 · 남은 잉크 ' + s.remaining();
    else el.status.textContent = '번지는 중…';
  }

  function renderPalette() {
    var s = state.sim; el.palette.innerHTML = '';
    s.palette.forEach(function (ink, i) {
      var d = document.createElement('div');
      d.className = 'chip' + (i < s.pi ? ' used' : i === s.pi ? ' next' : '');
      d.style.background = COLORS[ink.c];
      d.textContent = ink.n === Infinity ? '∞' : ink.n;
      d.title = NAMES[ink.c] + (ink.n === Infinity ? ' · 끝까지 번짐' : ' · ' + ink.n + '칸');
      el.palette.appendChild(d);
    });
  }

  /* ---------- 레이아웃 ---------- */
  function resize() {
    var s = state.sim; if (!s) return;
    var wrap = canvas.parentElement, dpr = window.devicePixelRatio || 1;
    var W = wrap.clientWidth, H = wrap.clientHeight;
    var cell = Math.floor(Math.min((W - 16) / s.w, (H - 16) / s.h));
    cell = Math.max(18, Math.min(cell, 72));
    state.cell = cell; state.ox = Math.floor((W - cell * s.w) / 2); state.oy = Math.floor((H - cell * s.h) / 2);
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  /* ---------- 입력 ---------- */
  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    if (!state.sim || state.paused || state.finished) return;
    var r = canvas.getBoundingClientRect();
    var x = Math.floor((ev.clientX - r.left - state.ox) / state.cell);
    var y = Math.floor((ev.clientY - r.top - state.oy) / state.cell);
    if (!state.sim.inBounds(x, y)) return;
    var idx = state.sim.idx(x, y);
    if (state.sim.canDrop(idx)) {
      var c = state.sim.nextInk().c;
      state.sim.drop(idx);
      state.ripples.push({ x: x, y: y, t: performance.now(), c: c });
      state.started = true; renderPalette(); setStatus(); beep(c);
    } else {
      state.ripples.push({ x: x, y: y, t: performance.now(), c: null });
    }
  });

  function beep(c) {
    try {
      if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
      var a = state.audio, o = a.createOscillator(), g = a.createGain();
      o.frequency.value = { R: 330, Y: 440, B: 262 }[c] || 392;
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, a.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.25);
      o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.3);
    } catch (e) { /* 오디오 불가 환경 */ }
  }

  el.btnRestart.addEventListener('click', function () { loadLevel(state.levelId); });
  el.btnLevels.addEventListener('click', function () { showLevels(); });
  el.btnCloseLevels.addEventListener('click', function () { el.levels.classList.add('hidden'); });
  el.btnPause.addEventListener('click', function () {
    if (state.finished) return;
    state.paused = !state.paused; el.btnPause.textContent = state.paused ? '계속' : '일시정지'; setStatus();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', function () {
    var id = location.hash.slice(1);
    if (id && id !== state.levelId && window.LEVELS[id] && isUnlocked(order.indexOf(id))) loadLevel(id);
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') loadLevel(state.levelId);
    if (e.key === 'p' || e.key === 'P' || e.key === ' ') el.btnPause.click();
    if (e.key === 'Escape') el.levels.classList.add('hidden');
  });

  function showLevels() {
    el.levelList.innerHTML = '';
    order.forEach(function (id, i) {
      var def = window.LEVELS[id], b = document.createElement('button');
      b.className = 'lv' + (progress.cleared[id] ? ' cleared' : '') + (isUnlocked(i) ? '' : ' locked');
      b.textContent = (i + 1) + '. ' + def.title + (progress.cleared[id] ? ' ✓' : '');
      b.disabled = !isUnlocked(i);
      b.addEventListener('click', function () { loadLevel(id); });
      el.levelList.appendChild(b);
    });
    el.levels.classList.remove('hidden');
  }

  /* ---------- 시뮬레이션 틱 ---------- */
  function finish() {
    var s = state.sim, ev = s.evaluate();
    state.finished = true;
    var i = order.indexOf(state.levelId), next = order[i + 1];
    el.ovBtns.innerHTML = '';
    if (ev.ok) {
      progress.cleared[state.levelId] = true; saveProgress();
      el.ovTitle.textContent = '물들였다!';
      el.ovBody.textContent = s.tick + '틱 만에 모든 칸이 제 색을 찾았습니다.';
      el.status.textContent = '클리어';
      if (next) addBtn('다음 레벨', function () { loadLevel(next); }, true);
      else { el.ovBody.textContent += ' 모든 레벨을 끝냈습니다. 고맙습니다!'; }
      addBtn('다시 하기', function () { loadLevel(state.levelId); });
    } else {
      var miss = ev.targets.filter(function (m) { return !m; }).length;
      var wet = ev.dry.filter(function (d) { return !d.ok; }).length;
      var parts = [];
      if (miss) parts.push('목표 ' + miss + '칸이 다른 색입니다');
      if (wet) parts.push('말라 있어야 할 ' + wet + '칸이 젖었습니다');
      el.ovTitle.textContent = '아직 아니에요';
      el.ovBody.textContent = parts.join(' · ') + '. 떨어뜨릴 자리나 타이밍을 바꿔 보세요.';
      el.status.textContent = '실패';
      addBtn('다시 하기', function () { loadLevel(state.levelId); }, true);
    }
    addBtn('레벨 목록', showLevels);
    el.overlay.classList.remove('hidden');
  }
  function addBtn(label, fn, primary) {
    var b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary';
    b.addEventListener('click', fn); el.ovBtns.appendChild(b);
  }

  function frame(now) {
    var s = state.sim;
    if (s) {
      var dt = Math.min(100, now - state.last); state.last = now;
      if (state.started && !state.paused && !state.finished) {
        state.acc += dt;
        while (state.acc >= s.level.tickMs) {
          state.acc -= s.level.tickMs;
          if (s.done()) { finish(); break; }
          s.step(); setStatus();
          if (s.done()) { state.acc = Math.min(state.acc, 0); }
        }
      }
      draw(now);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 그리기 ---------- */
  function cellRect(i) { var x = i % state.sim.w, y = (i - x) / state.sim.w; return { x: state.ox + x * state.cell, y: state.oy + y * state.cell }; }

  function draw(now) {
    var s = state.sim, c = state.cell; if (!s) return;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    // 종이
    ctx.fillStyle = '#f7f3ea';
    rr(state.ox - 6, state.oy - 6, c * s.w + 12, c * s.h + 12, 10); ctx.fill();
    var progressTick = state.paused ? 0 : state.acc / s.level.tickMs;
    for (var i = 0; i < s.cells.length; i++) {
      var r = cellRect(i), cx = r.x + c / 2, cy = r.y + c / 2;
      if (s.walls[i]) { ctx.fillStyle = '#3d3a44'; rr(r.x + 1, r.y + 1, c - 2, c - 2, 4); ctx.fill(); continue; }
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, c - 1, c - 1);
      if (s.dry[i]) {
        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = s.cells[i] ? '#d33' : '#b8b0a2'; ctx.lineWidth = 1.5;
        rr(r.x + 4, r.y + 4, c - 8, c - 8, 5); ctx.stroke(); ctx.restore();
      }
      var cell = s.cells[i];
      if (cell) {
        var age = (s.tick - cell.born) + progressTick;
        var k = Math.min(1, age / 1.0), ease = 1 - Math.pow(1 - k, 3);
        ctx.fillStyle = COLORS[cell.c];
        if (cell.mixed) {
          ctx.globalAlpha = 0.95; rr(r.x + 1.5, r.y + 1.5, c - 3, c - 3, 5); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(cx, cy, c * 0.14, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.globalAlpha = 0.85 + 0.15 * ease; ctx.beginPath(); blob(cx, cy, (c / 2 - 1) * (0.35 + 0.65 * ease), i); ctx.fill(); ctx.globalAlpha = 1;
          if (ease >= 1) { ctx.fillStyle = COLORS[cell.c]; ctx.globalAlpha = 0.9; rr(r.x + 1.5, r.y + 1.5, c - 3, c - 3, 5); ctx.fill(); ctx.globalAlpha = 1; }
        }
      }
      if (s.seeds[i]) {
        ctx.fillStyle = COLORS[s.seeds[i]]; ctx.beginPath(); ctx.arc(cx, cy, c * 0.14 + Math.sin(now / 300 + i) * 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // 목표 링
    s.targets.forEach(function (t) {
      var r = cellRect(t.idx), cx = r.x + c / 2, cy = r.y + c / 2, cell = s.cells[t.idx], met = cell && cell.c === t.c;
      ctx.lineWidth = met ? 3 : 2.5; ctx.strokeStyle = met ? '#ffffff' : COLORS[t.c];
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.3, 0, Math.PI * 2); ctx.stroke();
      if (met) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - c * 0.14, cy); ctx.lineTo(cx - c * 0.03, cy + c * 0.12); ctx.lineTo(cx + c * 0.16, cy - c * 0.12); ctx.stroke(); }
      else if (cell) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(cx, cy, c * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = COLORS[t.c]; ctx.stroke(); ctx.fillStyle = COLORS[t.c]; ctx.beginPath(); ctx.arc(cx, cy, c * 0.12, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = COLORS[t.c]; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(cx, cy, c * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    });
    // 파문
    state.ripples = state.ripples.filter(function (p) { return now - p.t < 500; });
    state.ripples.forEach(function (p) {
      var k = (now - p.t) / 500, cx = state.ox + p.x * c + c / 2, cy = state.oy + p.y * c + c / 2;
      ctx.strokeStyle = p.c ? COLORS[p.c] : '#999'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, c * (0.2 + 0.6 * k), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    });
    if (state.paused) {
      ctx.fillStyle = 'rgba(247,243,234,0.6)'; ctx.fillRect(state.ox - 6, state.oy - 6, c * s.w + 12, c * s.h + 12);
      ctx.fillStyle = '#333'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('일시정지', W / 2, H / 2);
    }
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function blob(cx, cy, rad, seed) {
    var n = 10; for (var k = 0; k <= n; k++) {
      var a = k / n * Math.PI * 2, w = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.08 * Math.cos(a * 5 + seed * 0.7);
      var px = cx + Math.cos(a) * rad * w, py = cy + Math.sin(a) * rad * w;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /* ---------- 시작 ---------- */
  var startId = location.hash.slice(1);
  if (!window.LEVELS[startId] || !isUnlocked(order.indexOf(startId))) {
    startId = order[0];
    for (var i = 0; i < order.length; i++) if (!progress.cleared[order[i]] && isUnlocked(i)) { startId = order[i]; break; }
  }
  loadLevel(startId);
  requestAnimationFrame(function (t) { state.last = t; frame(t); });
})();
