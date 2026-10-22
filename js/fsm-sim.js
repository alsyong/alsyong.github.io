// 일반 몬스터 범용 AI FSM 시뮬레이터
// 상태·전이 번호·연산 순서는 기획서(대기 3-1 ~ 사망 8-2)를 따르고, 수치는 시연용 가정값이다.
(function () {
  var root = document.getElementById('fsm-sim');
  if (!root) return;
  var cv = root.querySelector('.sim-canvas');
  var ctx = cv.getContext('2d');
  var stateEl = root.querySelector('.sim-state');
  var logEl = root.querySelector('.sim-log');
  var hpEl = root.querySelector('.sim-hp');
  var mpEl = root.querySelector('.sim-mp');
  var skEl = root.querySelector('.sim-skill');
  var W = 640, H = 400;

  // ---- 가정값 (화면의 '시뮬레이터에 넣은 수치' 표와 동일) ----
  var CFG = {
    chaseRange: 120, activeRange: 170, patrolRange: 70, minRange: 36,
    moveSpeed: 70, returnSpeed: 170, pauseTime: 1.2,
    maxHp: 100, maxMp: 100, ccDuration: 2, corpseDuration: 2, respawn: 1.2,
    castTime: 0.5, playerSpeed: 140, playerRange: 150, playerDamage: 15
  };
  var SKILLS = [
    { id: 1, name: '독침', skillRange: 90, skillCool: 5, skillMP: 30 },
    { id: 2, name: '할퀴기', skillRange: 40, skillCool: 1.2, skillMP: 0 }
  ];
  var FIRST = { x: 230, y: 200 };
  var PATROL_VEC = [{ x: 175, y: 160 }, { x: 290, y: 150 }, { x: 285, y: 250 }, { x: 185, y: 248 }];
  var NAMES = { idle: '대기', chase: '추격', attack: '공격', 'return': '복귀', cc: '이상', dead: '사망' };

  var opt = { patrol: 'flowMove', firstAttack: true, invincible: false };
  var m, p, fx, clock;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function moveTo(o, g, speed, dt) {
    var d = dist(o, g);
    if (d < 0.5) return true;
    var step = Math.min(d, speed * dt);
    o.x += (g.x - o.x) / d * step; o.y += (g.y - o.y) / d * step;
    return dist(o, g) < 0.5;
  }

  function reset() {
    m = {
      x: FIRST.x, y: FIRST.y, state: 'idle', camp: 'Monster',
      curHp: CFG.maxHp, curMp: CFG.maxMp, moveSpeed: CFG.moveSpeed,
      curTarget: null, selectedSkill: null, cool: SKILLS.map(function () { return 0; }),
      curVecIndex: 0, goalVec: null, pauseTimer: 0, ccTimer: 0, castTimer: 0,
      corpseTimer: 0, gone: false, respawnTimer: 0
    };
    p = { x: 520, y: 200, camp: 'Player', dest: null, isInvincible: opt.invincible };
    fx = []; clock = 0;
    logEl.innerHTML = '';
    log(null, 'idle', '시작', '초기좌표에서 대기');
    paintFsm();
  }

  // ---- 기록 ----
  function log(no, to, from, why) {
    var li = document.createElement('li');
    var tag = no ? '<b class="sim-no">' + no + '</b>' : '<b class="sim-no sim-no-0">·</b>';
    li.innerHTML = tag + '<span><em>' + (from === '시작' ? '' : NAMES[from] + ' → ') + NAMES[to] + '</em>' + why + '</span>';
    logEl.insertBefore(li, logEl.firstChild);
    while (logEl.children.length > 7) logEl.removeChild(logEl.lastChild);
  }
  function go(to, no, why) {
    var from = m.state;
    m.state = to;
    log(no, to, from, why);
    paintFsm(no);
    enter(to);
  }
  var lastEdge = null, edgeTimer = 0;
  function paintFsm(no) {
    root.querySelectorAll('.sim-nodes g').forEach(function (g) {
      g.classList.toggle('on', g.getAttribute('data-s') === m.state);
    });
    if (no) { lastEdge = String(no); edgeTimer = 1.4; }
    root.querySelectorAll('[data-e]').forEach(function (e) {
      e.classList.toggle('on', e.getAttribute('data-e') === lastEdge && edgeTimer > 0);
    });
  }

  function enter(s) {
    if (s === 'attack') {
      // 5. 공격 상태: 선정된 스킬 사용
      var sk = SKILLS[m.selectedSkill];
      m.cool[m.selectedSkill] = sk.skillCool;
      m.curMp -= sk.skillMP;
      m.castTimer = CFG.castTime;
      fx.push({ type: 'skill', name: sk.name, range: sk.skillRange, t: CFG.castTime, max: CFG.castTime });
    } else if (s === 'return') {
      // 6. 복귀: 데이터 변경 (목표좌표 = 초기좌표, 이동속도 = 복귀속도)
      m.goalVec = { x: FIRST.x, y: FIRST.y };
      m.moveSpeed = CFG.returnSpeed;
    } else if (s === 'idle') {
      m.goalVec = null; m.pauseTimer = 0;
    } else if (s === 'dead') {
      // 8-2. 모든 프로세스 중단, 시체 유지
      m.corpseTimer = CFG.corpseDuration;
      m.curTarget = null;
    }
  }

  // ---- 연산 ----
  // 3-4. 타겟 선정 연산: 추격범위 내, 진영이 다르고, 비무적인 대상 중 가장 가까운 대상
  function selectTarget() {
    var best = null, bd = Infinity;
    [p].forEach(function (c) {
      var d = dist(m, c);
      if (d > CFG.chaseRange) return;
      if (c.camp === m.camp) return;
      if (c.isInvincible) return;
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  // 4-4. 스킬 선정 연산: 목록 순서대로 쿨타임, 마나, 사거리 검사
  function selectSkill(toTarget) {
    for (var n = 0; n < SKILLS.length; n++) {
      var s = SKILLS[n];
      if (m.cool[n] <= 0 && m.curMp >= s.skillMP && toTarget <= s.skillRange) return n;
    }
    return null;
  }
  // 3-2 / 3-3. 순찰 연산
  function patrol(dt) {
    if (opt.patrol === 'notMove') return;
    if (m.pauseTimer > 0) { m.pauseTimer -= dt; if (m.pauseTimer <= 0) m.goalVec = null; return; }
    if (!m.goalVec) {
      if (opt.patrol === 'flowMove') {
        m.goalVec = PATROL_VEC[m.curVecIndex];
      } else {
        // 순찰범위를 반지름으로 하는 원 안에서 위치 가능한 좌표를 다시 뽑는다
        var g, tries = 0;
        do {
          var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * CFG.patrolRange;
          g = { x: FIRST.x + Math.cos(a) * r, y: FIRST.y + Math.sin(a) * r };
          tries++;
        } while (!reachable(g) && tries < 20);
        m.goalVec = g;
      }
    }
    if (moveTo(m, m.goalVec, m.moveSpeed, dt)) {
      m.pauseTimer = CFG.pauseTime;
      if (opt.patrol === 'flowMove') m.curVecIndex = (m.curVecIndex + 1) % PATROL_VEC.length;
    }
  }
  function reachable(g) { return g.x > 20 && g.x < W - 20 && g.y > 20 && g.y < H - 20; }

  // 8-1. 피격 연산
  function hit(cc) {
    if (m.state === 'dead') return;
    var d = dist(m, p);
    if (d > CFG.playerRange) { flash('사거리 밖 (' + CFG.playerRange + ')'); return; }
    var dmg = cc ? 0 : CFG.playerDamage;
    if (!m.curTarget) { m.curTarget = p; m.why = '피격: 공격자를 타겟으로 선정'; } // 타겟이 없으면 공격자를 타겟으로
    m.curHp -= dmg;
    fx.push({ type: 'hit', t: 0.35, max: 0.35, cc: cc });
    if (m.curHp <= 0) { m.curHp = 0; go('dead', 9, 'HP가 0 이하'); return; }
    if (cc) {
      if (m.state === 'cc') { m.ccTimer = CFG.ccDuration; log(null, 'cc', 'cc', '같은 상태이상 재피격, 지속시간 갱신'); return; }
      m.ccTimer = CFG.ccDuration;
      go('cc', 7, '기절 효과가 있는 스킬에 피격');
    }
  }
  var msg = '', msgT = 0;
  function flash(t) { msg = t; msgT = 1.2; }

  // ---- 상태별 갱신 ----
  function update(dt) {
    clock += dt;
    if (edgeTimer > 0) { edgeTimer -= dt; if (edgeTimer <= 0) paintFsm(); }
    if (msgT > 0) msgT -= dt;
    fx = fx.filter(function (f) { f.t -= dt; return f.t > 0; });

    // 플레이어 이동
    if (p.dest && moveTo(p, p.dest, CFG.playerSpeed, dt)) p.dest = null;
    var k = keys, kx = (k.ArrowRight || k.d ? 1 : 0) - (k.ArrowLeft || k.a ? 1 : 0), ky = (k.ArrowDown || k.s ? 1 : 0) - (k.ArrowUp || k.w ? 1 : 0);
    if (kx || ky) { var l = Math.hypot(kx, ky); p.x += kx / l * CFG.playerSpeed * dt; p.y += ky / l * CFG.playerSpeed * dt; p.dest = null; }
    p.x = Math.max(12, Math.min(W - 12, p.x)); p.y = Math.max(12, Math.min(H - 12, p.y));

    if (m.state === 'dead') {
      if (!m.gone) { m.corpseTimer -= dt; if (m.corpseTimer <= 0) { m.gone = true; m.respawnTimer = CFG.respawn; } }
      else { m.respawnTimer -= dt; if (m.respawnTimer <= 0) respawn(); }
      return;
    }
    for (var i = 0; i < m.cool.length; i++) if (m.cool[i] > 0) m.cool[i] -= dt;

    var t = m.curTarget, d = t ? dist(m, t) : Infinity, home = dist(m, FIRST);
    switch (m.state) {
      case 'idle':
        patrol(dt);
        if (!m.curTarget && opt.firstAttack) { m.curTarget = selectTarget(); if (m.curTarget) m.why = '선공형: 추격범위 안의 가장 가까운 적을 타겟으로 선정'; }
        if (m.curTarget) { go('chase', 1, m.why || '선정된 타겟이 남아 있음'); m.why = null; }
        break;
      case 'chase':
        if (d > CFG.chaseRange) { go('return', 2, '타겟이 추격범위 밖'); break; }
        if (home > CFG.activeRange) { go('return', 2, '행동범위를 벗어남'); break; }
        var n = selectSkill(d);
        if (n !== null) { m.selectedSkill = n; go('attack', 3, SKILLS[n].name + ' 선정 (사거리 ' + SKILLS[n].skillRange + ' 안)'); break; }
        if (d > CFG.minRange) moveTo(m, t, m.moveSpeed, dt);
        break;
      case 'attack':
        m.castTimer -= dt;
        if (m.castTimer > 0) break;
        if (home > CFG.activeRange) go('return', 5, '스킬 사용 후, 행동범위를 벗어남');
        else if (d <= CFG.chaseRange) go('chase', 4, '스킬 사용 후, 타겟이 추격범위 안');
        else go('return', 5, '스킬 사용 후, 타겟이 추격범위 밖');
        break;
      case 'return':
        if (moveTo(m, m.goalVec, m.moveSpeed, dt)) {
          // 데이터 초기화: 쿨타임, 체력, 마나, 이동속도, 선정 타겟
          m.cool = SKILLS.map(function () { return 0; });
          m.curHp = CFG.maxHp; m.curMp = CFG.maxMp; m.moveSpeed = CFG.moveSpeed; m.curTarget = null;
          m.curVecIndex = 0;
          go('idle', 6, '초기좌표 도착, 체력·마나·쿨타임·타겟 초기화');
        }
        break;
      case 'cc':
        m.ccTimer -= dt;
        if (m.ccTimer <= 0) { m.moveSpeed = CFG.moveSpeed; m.selectedSkill = null; go('idle', 8, '상태이상 해제'); }
        break;
    }
  }
  function respawn() {
    m.x = FIRST.x; m.y = FIRST.y; m.curHp = CFG.maxHp; m.curMp = CFG.maxMp; m.moveSpeed = CFG.moveSpeed;
    m.cool = SKILLS.map(function () { return 0; }); m.curTarget = null; m.gone = false; m.curVecIndex = 0;
    m.state = 'idle'; enter('idle');
    log(null, 'idle', '시작', '다시 생성 (시연용)');
    paintFsm();
  }

  // ---- 그리기 ----
  var col = {};
  function readColors() {
    var cs = getComputedStyle(root);
    ['--c', '--text', '--text-muted', '--line', '--bg-soft', '--card', '--accent-text', '--red-num', '--gold'].forEach(function (k) {
      col[k] = cs.getPropertyValue(k).trim();
    });
  }
  var K = 1; // 좁은 화면에서 글자·말을 키우는 배율
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function label(t, x, y, c, size, weight) {
    ctx.font = (weight || 600) + ' ' + Math.round((size || 12) * K) + 'px Freesentation, sans-serif';
    ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y);
  }
  function draw() {
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    var cw = cv.getBoundingClientRect().width || W;
    K = Math.max(1, Math.min(2.2, 560 / cw));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col['--bg-soft']; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = col['--line']; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
    for (var gx = 40; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 40; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    ctx.globalAlpha = 1;

    // 행동범위 (초기좌표 기준)
    ctx.setLineDash([6, 6]); ctx.strokeStyle = col['--c']; ctx.lineWidth = 1.5;
    circle(FIRST.x, FIRST.y, CFG.activeRange); ctx.stroke();
    label('행동범위', FIRST.x, FIRST.y - CFG.activeRange + 12, col['--c'], 11);
    // 순찰
    ctx.setLineDash([2, 5]); ctx.strokeStyle = col['--text-muted'];
    if (opt.patrol === 'flowMove') {
      ctx.beginPath(); PATROL_VEC.forEach(function (v, i) { i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.closePath(); ctx.stroke();
      PATROL_VEC.forEach(function (v, i) { ctx.fillStyle = col['--text-muted']; circle(v.x, v.y, 2.5); ctx.fill(); label(String(i + 1), v.x + 9, v.y - 8, col['--text-muted'], 10, 500); });
    } else if (opt.patrol === 'randomMove') {
      circle(FIRST.x, FIRST.y, CFG.patrolRange); ctx.stroke();
    }
    ctx.setLineDash([]);
    // 초기좌표
    ctx.strokeStyle = col['--text-muted']; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(FIRST.x - 5, FIRST.y - 5); ctx.lineTo(FIRST.x + 5, FIRST.y + 5); ctx.moveTo(FIRST.x + 5, FIRST.y - 5); ctx.lineTo(FIRST.x - 5, FIRST.y + 5); ctx.stroke();

    var alive = m.state !== 'dead';
    // 추격범위 (몬스터 현재좌표 기준)
    if (alive) {
      ctx.globalAlpha = 0.12; ctx.fillStyle = col['--c']; circle(m.x, m.y, CFG.chaseRange); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = col['--c']; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      label('추격범위', m.x, m.y + CFG.chaseRange - 10 * K, col['--c'], 11);
    }
    // 플레이어 공격 사거리
    ctx.setLineDash([3, 4]); ctx.strokeStyle = col['--accent-text']; ctx.globalAlpha = 0.3;
    circle(p.x, p.y, CFG.playerRange); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 0.7;
    label('내 공격 사거리', p.x, p.y - CFG.playerRange + 10 * K, col['--accent-text'], 10, 500); ctx.globalAlpha = 1;
    // 이동 목적지
    if (p.dest) { ctx.strokeStyle = col['--accent-text']; circle(p.dest.x, p.dest.y, 5); ctx.stroke(); }
    // 타겟 연결선
    if (m.curTarget && alive) {
      ctx.strokeStyle = col['--red-num']; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // 스킬 효과
    fx.forEach(function (f) {
      var a = f.t / f.max;
      if (f.type === 'skill') {
        ctx.globalAlpha = 0.25 + 0.5 * a; ctx.fillStyle = col['--red-num'];
        circle(m.x, m.y, f.range * (1.1 - a * 0.6)); ctx.globalAlpha = 0.18 * a + 0.05; ctx.fill(); ctx.globalAlpha = 1;
        label(f.name, m.x, m.y - 30 * K, col['--red-num'], 13, 800);
      } else if (f.type === 'hit') {
        ctx.strokeStyle = f.cc ? col['--gold'] : col['--accent-text']; ctx.lineWidth = 3; ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.globalAlpha = 1;
      }
    });
    // 몬스터
    if (!m.gone) {
      ctx.globalAlpha = alive ? 1 : 0.25 + 0.5 * Math.max(0, m.corpseTimer / CFG.corpseDuration);
      ctx.fillStyle = m.state === 'cc' ? col['--gold'] : (alive ? col['--c'] : col['--text-muted']);
      circle(m.x, m.y, 15 * K); ctx.fill();
      label(alive ? 'M' : '✕', m.x, m.y + 1, '#111317', 14, 900);
      ctx.globalAlpha = 1;
      label(NAMES[m.state], m.x, m.y + 27 * K, col['--text'], 12, 800);
      if (m.state === 'cc') label('기절 ' + Math.max(0, m.ccTimer).toFixed(1) + 's', m.x, m.y - 26 * K, col['--gold'], 12, 700);
    }
    // 플레이어
    if (p.isInvincible) { ctx.strokeStyle = col['--gold']; ctx.lineWidth = 2; circle(p.x, p.y, 17 * K); ctx.stroke(); }
    ctx.fillStyle = col['--accent-text']; circle(p.x, p.y, 12 * K); ctx.fill();
    label('P', p.x, p.y + 1, '#111317', 13, 900);
    if (msgT > 0) label(msg, p.x, p.y - 24 * K, col['--text'], 12, 700);

    // HUD / 상태 문구
    hpEl.textContent = NAMES[m.state] + ' · HP ' + Math.ceil(m.curHp) + '/' + CFG.maxHp;
    mpEl.textContent = 'MP ' + Math.round(m.curMp);
    skEl.textContent = SKILLS.map(function (s, i) { return s.name + ' ' + (m.cool[i] > 0 ? m.cool[i].toFixed(1) + 's' : '준비'); }).join(' · ');
    var d = m.curTarget && m.state !== 'dead' ? Math.round(dist(m, m.curTarget)) : null;
    hpEl.textContent += d !== null ? ' · 타겟까지 ' + d : '';
    if (m.state !== lastShown) { stateEl.innerHTML = '현재 상태 <strong>' + NAMES[m.state] + '</strong>'; lastShown = m.state; }
  }
  var lastShown = null;

  // ---- 입력 ----
  var keys = {};
  function toWorld(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  var dragging = false;
  cv.addEventListener('pointerdown', function (e) { dragging = true; p.dest = toWorld(e); try { cv.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  cv.addEventListener('pointermove', function (e) { if (dragging) p.dest = toWorld(e); });
  cv.addEventListener('pointerup', function () { dragging = false; });
  cv.addEventListener('pointercancel', function () { dragging = false; });
  cv.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].indexOf(k) >= 0) { keys[k] = true; e.preventDefault(); }
    if (k === ' ' || k === 'j') { hit(false); e.preventDefault(); }
    if (k === 'k') { hit(true); e.preventDefault(); }
  });
  cv.addEventListener('keyup', function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = false; });
  cv.addEventListener('blur', function () { keys = {}; });

  root.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.getAttribute('data-act');
      if (a === 'hit') hit(false);
      else if (a === 'stun') hit(true);
      else if (a === 'reset') reset();
    });
  });
  root.querySelectorAll('[data-opt]').forEach(function (el) {
    el.addEventListener('change', function () {
      var k = el.getAttribute('data-opt');
      opt[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'invincible') p.isInvincible = opt.invincible;
      if (k === 'patrol') { m.goalVec = null; m.pauseTimer = 0; m.curVecIndex = 0; }
    });
  });

  // ---- 실행: 화면에 보일 때만 ----
  var running = false, last = 0;
  function frame(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    update(dt); draw();
    requestAnimationFrame(frame);
  }
  function start() { if (running) return; running = true; readColors(); last = performance.now(); requestAnimationFrame(frame); }
  function stop() { running = false; }
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  cv.setAttribute('tabindex', '0');
  reset(); readColors(); draw();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { en.forEach(function (e) { e.isIntersecting ? start() : stop(); }); }, { threshold: 0.15 }).observe(cv);
  } else start();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!running) draw(); });
})();
