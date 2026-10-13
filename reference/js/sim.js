/* 잉크 밀물 — 결정론 시뮬레이션 코어 (브라우저·Node 공용) */
(function (root) {
  'use strict';
  var PRIMARY = { R: true, Y: true, B: true };
  var MIX = { RY: 'O', YR: 'O', RB: 'P', BR: 'P', YB: 'G', BY: 'G' };

  function mixColor(a, b) {
    if (a === b) return a;
    return MIX[a + b] || 'K';
  }

  function parsePalette(list) {
    return (list || []).map(function (s) {
      var m = /^([RYB])(\d*)$/.exec(String(s).trim());
      if (!m) throw new Error('잘못된 팔레트 항목: ' + s);
      return { c: m[1], n: m[2] ? parseInt(m[2], 10) : Infinity };
    });
  }

  function parseLevel(def) {
    var rows = def.map;
    var h = rows.length, w = rows[0].length;
    var walls = {}, seeds = {}, targets = [], dry = {};
    for (var y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('맵 행 길이가 다릅니다: ' + def.id);
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x], idx = y * w + x;
        if (ch === '#') walls[idx] = true;
        else if (ch === 'r' || ch === 'y' || ch === 'b') seeds[idx] = ch.toUpperCase();
        else if (/[RYBOPG]/.test(ch)) targets.push({ idx: idx, x: x, y: y, c: ch });
        else if (ch === 'x') dry[idx] = true;
        else if (ch !== '.') throw new Error('알 수 없는 맵 문자 "' + ch + '" (' + def.id + ')');
      }
    }
    return {
      id: def.id, w: w, h: h, walls: walls, seeds: seeds, targets: targets, dry: dry,
      palette: parsePalette(def.palette), tickMs: def.tickMs || 400
    };
  }

  function Sim(def) {
    var L = parseLevel(def);
    this.level = L;
    this.w = L.w; this.h = L.h;
    this.walls = L.walls;
    this.seeds = Object.assign({}, L.seeds);   // 잠든 씨앗 (idx -> 색)
    this.dry = L.dry;
    this.targets = L.targets;
    this.palette = L.palette;
    this.pi = 0;                 // 다음에 쓸 팔레트 인덱스
    this.cells = new Array(L.w * L.h).fill(null); // {c, mixed, born}
    this.waves = [];
    this.tick = 0;
    this.events = [];
    this._waveId = 0;
  }

  Sim.prototype.inBounds = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; };
  Sim.prototype.idx = function (x, y) { return y * this.w + x; };
  Sim.prototype.nextInk = function () { return this.pi < this.palette.length ? this.palette[this.pi] : null; };
  Sim.prototype.remaining = function () { return this.palette.length - this.pi; };
  Sim.prototype.settled = function () { return this.waves.length === 0; };
  Sim.prototype.done = function () { return this.settled() && this.pi >= this.palette.length; };

  Sim.prototype.canDrop = function (idx) {
    return idx >= 0 && idx < this.cells.length && !this.walls[idx] && !this.seeds[idx] &&
      !this.cells[idx] && this.pi < this.palette.length;
  };

  Sim.prototype.drop = function (idx) {
    if (!this.canDrop(idx)) return false;
    var ink = this.palette[this.pi++];
    this.cells[idx] = { c: ink.c, mixed: false, born: this.tick };
    this.waves.push({ id: ++this._waveId, c: ink.c, frontier: [idx], left: ink.n });
    this.events.push({ type: 'drop', idx: idx, c: ink.c, tick: this.tick });
    return true;
  };

  Sim.prototype._neighbors = function (idx) {
    var w = this.w, x = idx % w, y = (idx - x) / w, out = [];
    if (x > 0) out.push(idx - 1);
    if (x < w - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - w);
    if (y < this.h - 1) out.push(idx + w);
    return out;
  };

  Sim.prototype.step = function () {
    var self = this, claims = {}, newWaves = [], tick = this.tick, cells = this.cells;
    this.waves.forEach(function (wave) {
      wave.next = [];
      wave.frontier.forEach(function (f) {
        self._neighbors(f).forEach(function (n) {
          if (self.walls[n]) return;
          if (self.seeds[n]) {               // 잠든 씨앗을 깨운다
            var sc = self.seeds[n];
            delete self.seeds[n];
            cells[n] = { c: sc, mixed: false, born: tick, seed: true };
            newWaves.push({ id: ++self._waveId, c: sc, frontier: [n], left: Infinity });
            self.events.push({ type: 'seed', idx: n, c: sc, tick: tick });
            return;
          }
          var cell = cells[n];
          if (!cell) {
            var cl = claims[n] || (claims[n] = []);
            cl.push(wave);
          } else if (!cell.mixed && cell.c !== wave.c && PRIMARY[cell.c] && PRIMARY[wave.c] && cell.born < tick) {
            cells[n] = { c: mixColor(cell.c, wave.c), mixed: true, born: tick };
            self.events.push({ type: 'mix', idx: n, c: cells[n].c, tick: tick });
          }
        });
      });
    });
    Object.keys(claims).forEach(function (k) {
      var n = +k, list = claims[k], colors = [];
      list.forEach(function (wv) { if (colors.indexOf(wv.c) < 0) colors.push(wv.c); });
      if (colors.length === 1) {
        cells[n] = { c: colors[0], mixed: false, born: tick };
        list.forEach(function (wv) { if (wv.next.indexOf(n) < 0) wv.next.push(n); });
        self.events.push({ type: 'fill', idx: n, c: colors[0], tick: tick });
      } else {
        var m = colors.length === 2 ? mixColor(colors[0], colors[1]) : 'K';
        cells[n] = { c: m, mixed: true, born: tick };
        self.events.push({ type: 'mix', idx: n, c: m, tick: tick });
      }
    });
    var alive = [];
    this.waves.forEach(function (wave) {
      wave.frontier = wave.next.filter(function (n) { return cells[n] && !cells[n].mixed; });
      wave.next = null;
      wave.left -= 1;
      if (wave.frontier.length && wave.left > 0) alive.push(wave);
    });
    this.waves = alive.concat(newWaves);
    this.tick += 1;
  };

  Sim.prototype.evaluate = function () {
    var self = this, ok = true;
    var targets = this.targets.map(function (t) {
      var cell = self.cells[t.idx], met = !!cell && cell.c === t.c;
      if (!met) ok = false;
      return met;
    });
    var dryOk = Object.keys(this.dry).map(function (k) {
      var fine = !self.cells[+k];
      if (!fine) ok = false;
      return { idx: +k, ok: fine };
    });
    return { ok: ok, targets: targets, dry: dryOk };
  };

  Sim.prototype.ascii = function () {
    var out = [];
    for (var y = 0; y < this.h; y++) {
      var row = '';
      for (var x = 0; x < this.w; x++) {
        var i = this.idx(x, y), c = this.cells[i];
        if (this.walls[i]) row += '#';
        else if (this.seeds[i]) row += this.seeds[i].toLowerCase();
        else if (c) row += c.mixed ? c.c : c.c.toLowerCase();
        else row += this.dry[i] ? 'x' : '.';
      }
      out.push(row);
    }
    return out.join('\n');
  };

  /* 해법 실행: drops = [{x,y,t}] (t = 첫 방울 기준 틱). 결과 {ok, sim, log} */
  function runSolution(def, drops, maxTicks) {
    var sim = new Sim(def), t = 0, log = [];
    var pending = drops.slice().sort(function (a, b) { return a.t - b.t; });
    maxTicks = maxTicks || 400;
    while (t < maxTicks) {
      while (pending.length && pending[0].t <= t) {
        var d = pending.shift(), idx = sim.idx(d.x, d.y);
        if (!sim.drop(idx)) log.push('t' + t + ': (' + d.x + ',' + d.y + ') 떨어뜨릴 수 없음');
      }
      if (!pending.length && sim.done()) break;
      sim.step(); t++;
    }
    var ev = sim.evaluate();
    return { ok: ev.ok && !log.length, eval: ev, sim: sim, log: log, ticks: t };
  }

  root.InkSim = { Sim: Sim, parseLevel: parseLevel, parsePalette: parsePalette, mixColor: mixColor, runSolution: runSolution };
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
