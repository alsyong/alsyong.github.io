(function () {
  'use strict';

  // ---------- 계산 엔진(Web Worker) ----------
  const pyo = new URLSearchParams(location.search).get('pyodide');
  const worker = new Worker('worker.js' + (pyo && pyo.startsWith('/') ? '?pyodide=' + encodeURIComponent(pyo) : ''));
  let seq = 0;
  const pending = new Map();
  let engineReady = false;
  const statusEl = document.getElementById('engine-status');

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { statusEl.querySelector('span').textContent = m.text; return; }
    if (m.type === 'ready') { onEngineReady(); return; }
    if (m.type === 'fatal') {
      statusEl.classList.add('err');
      statusEl.querySelector('span').textContent = '엔진을 불러오지 못했습니다. 새로고침해 주세요.';
      return;
    }
    if (m.type === 'result') {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error));
    }
  };
  worker.onerror = () => {
    statusEl.classList.add('err');
    statusEl.querySelector('span').textContent = '엔진을 불러오지 못했습니다. 새로고침해 주세요.';
  };
  function call(fn, ...args) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, fn, args });
    });
  }

  // ---------- 상태 ----------
  const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const STAT_KO = { hp: 'HP', atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드' };
  let CAT = null;            // species, items, natures, moveLabels, abilityLabels, examples
  const SPECIES = new Map(); // slug -> {slug,label,nameKo,nameEn}
  const ITEM_LABEL = new Map();
  const OPTS = new Map();    // slug -> {abilities, moves}
  let ICONS = new Set();

  const emptyMine = () => ({ speciesSlug: '', item: '', ability: '', nature: 'Hardy', moves: ['', '', '', ''],
    abilityPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, megaCapable: false });
  const emptyOpp = () => ({ speciesSlug: '', item: '', ability: '', moves: ['', '', '', ''] });

  let mine = load('bt-mine') || Array.from({ length: 6 }, emptyMine);
  let opps = load('bt-opps') || Array.from({ length: 6 }, emptyOpp);

  function load(k) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) && v.length === 6 ? v : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem('bt-mine', JSON.stringify(mine)); localStorage.setItem('bt-opps', JSON.stringify(opps)); } catch (e) {} }

  // ---------- 공용 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function iconSlug(slug) {
    if (!slug) return null;
    if (ICONS.has(slug)) return slug;
    const base = slug.replace(/-mega(-[xyz])?$/, '').replace(/-(gmax|totem)$/, '');
    if (ICONS.has(base)) return base;
    const first = slug.split('-')[0];
    return ICONS.has(first) ? first : null;
  }
  function iconHTML(slug, size = '') {
    const sp = SPECIES.get(slug);
    const s = iconSlug(slug);
    const cls = 'pk-icon' + (size ? ' ' + size : '') + (slug ? '' : ' empty');
    if (s) return `<span class="${cls}"><img src="icons/${s}.webp" alt="" loading="lazy" decoding="async"></span>`;
    return `<span class="${cls}"><span class="ph" aria-hidden="true">${sp ? esc(sp.nameKo.slice(0, 1)) : '+'}</span></span>`;
  }
  const speciesName = (slug) => (SPECIES.get(slug) || {}).label || slug;
  const enName = (slug) => { const sp = SPECIES.get(slug); return sp ? sp.nameEn : ''; };
  const moveLabel = (en) => (CAT && CAT.moveLabels[en]) || en;
  const itemLabel = (en) => ITEM_LABEL.get(en) || en;
  const abilityLabel = (en) => (CAT && CAT.abilityLabels[en]) || en;

  async function options(slug) {
    if (!slug) return { abilities: [], moves: [] };
    if (OPTS.has(slug)) return OPTS.get(slug);
    const o = JSON.parse(await call('species_options', slug));
    const v = o.ok ? o : { abilities: [], moves: [] };
    OPTS.set(slug, v);
    return v;
  }

  // ---------- 자동완성 입력 ----------
  function combo(input, { source, onPick, icons = false, allowEmpty = true }) {
    const wrap = input.parentElement;
    const list = document.createElement('ul');
    list.className = 'combo-list'; list.hidden = true; list.setAttribute('role', 'listbox');
    list.id = 'cl-' + Math.random().toString(36).slice(2);
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
    let items = [], active = -1, picked = null;

    function render() {
      const q = input.value.trim().toLowerCase();
      const all = source();
      items = (q ? all.filter((o) => o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q) || (o.value || '').toLowerCase().includes(q)) : all).slice(0, 60);
      active = items.length ? 0 : -1;
      list.innerHTML = items.length
        ? items.map((o, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">${icons ? iconHTML(o.value, 'xs') : ''}<span>${esc(o.label)}${o.sub ? ` <small>${esc(o.sub)}</small>` : ''}</span></li>`).join('')
        : '<li class="none">결과 없음</li>';
      open(true);
    }
    function open(v) { list.hidden = !v; input.setAttribute('aria-expanded', String(v)); }
    function choose(i) {
      const o = items[i]; if (!o) return;
      picked = o; input.value = o.label; open(false); onPick(o);
    }
    function mark() { list.querySelectorAll('li[data-i]').forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === active))); const el = list.querySelector(`li[data-i="${active}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }

    input.addEventListener('focus', () => { input.select(); render(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (list.hidden && (e.key === 'ArrowDown')) { render(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
      else if (e.key === 'Enter') { if (!list.hidden && active >= 0) { e.preventDefault(); choose(active); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.stopPropagation(); e.preventDefault(); open(false); } }
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        open(false);
        const text = input.value.trim();
        if (!text && allowEmpty) { if (picked) { picked = null; onPick(null); } return; }
        const exact = source().find((o) => o.label === text || o.value === text || (o.sub && o.sub.toLowerCase() === text.toLowerCase()));
        if (exact) { if (!picked || picked.value !== exact.value) { picked = exact; input.value = exact.label; onPick(exact); } else input.value = exact.label; }
        else input.value = picked ? picked.label : '';
      }, 120);
    });
    return {
      set(value, label) { picked = value ? { value, label } : null; input.value = value ? label : ''; },
    };
  }

  const speciesSource = () => CAT.species.map((s) => ({ value: s.slug, label: s.label, sub: s.nameEn }));
  const itemSource = () => CAT.items.map((i) => ({ value: i.value, label: i.label, sub: i.value }));

  // ---------- 1. 내 파티 ----------
  function renderMine() {
    const box = $('#my-slots');
    box.innerHTML = mine.map((m, i) => {
      if (!m.speciesSlug) {
        return `<button class="slot is-empty" type="button" data-i="${i}">${iconHTML('', '')}<span class="s-main"><span class="s-name">${i + 1}번 칸 비어 있음</span><span class="s-meta">눌러서 포켓몬 정하기</span></span></button>`;
      }
      const moves = m.moves.filter(Boolean).map((x) => `<span>${esc(moveLabel(x))}</span>`).join('');
      return `<button class="slot" type="button" data-i="${i}" aria-label="${i + 1}번 ${esc(speciesName(m.speciesSlug))} 편집">${iconHTML(m.speciesSlug)}<span class="s-main">
        <span class="s-name">${esc(speciesName(m.speciesSlug))} <span class="s-en">${esc(enName(m.speciesSlug))}</span>${m.megaCapable ? '<span class="badge-mega">메가</span>' : ''}</span>
        <span class="s-meta">${esc(m.item ? itemLabel(m.item) : '도구 없음')} · ${esc(m.ability ? abilityLabel(m.ability) : '특성 미정')}</span>
        <span class="s-moves">${moves || '<span>기술 미정</span>'}</span></span></button>`;
    }).join('');
  }
  $('#my-slots').addEventListener('click', (e) => { const b = e.target.closest('.slot'); if (b) openEditor(+b.dataset.i); });

  // ---------- 편집 창 ----------
  const dlg = $('#editor');
  let edIndex = -1, draft = null, edCombos = {}, statsTimer = null;

  function buildEditorOnce() {
    $('#ed-nature').innerHTML = CAT.natures.map((n) => `<option value="${esc(n.value)}">${esc(n.label)}</option>`).join('');
    $('#ed-ap').innerHTML = STAT_KEYS.map((k) => `<label class="ap-cell"><span>${STAT_KO[k]}</span><input type="number" inputmode="numeric" min="0" max="32" step="1" data-k="${k}" aria-label="${STAT_KO[k]} 능력 포인트"><b data-s="${k}">-</b></label>`).join('');
    edCombos.species = combo($('#ed-species'), { source: speciesSource, icons: true, onPick: (o) => setDraftSpecies(o ? o.value : '') });
    edCombos.item = combo($('#ed-item'), { source: itemSource, onPick: (o) => { draft.item = o ? o.value : ''; } });
    edCombos.moves = [...document.querySelectorAll('.ed-move')].map((inp) => combo(inp, {
      source: () => (OPTS.get(draft.speciesSlug) || { moves: [] }).moves.map((m) => ({ value: m.value, label: m.label, sub: m.value })),
      onPick: (o) => { draft.moves[+inp.dataset.i] = o ? o.value : ''; },
    }));
    $('#ed-ability').addEventListener('change', (e) => { draft.ability = e.target.value; });
    $('#ed-nature').addEventListener('change', (e) => { draft.nature = e.target.value; queueStats(); });
    $('#ed-mega').addEventListener('change', (e) => { draft.megaCapable = e.target.checked; });
    $('#ed-ap').addEventListener('input', (e) => {
      const inp = e.target.closest('input'); if (!inp) return;
      let v = parseInt(inp.value, 10); if (isNaN(v)) v = 0; v = Math.max(0, Math.min(32, v));
      draft.abilityPoints[inp.dataset.k] = v; updateApTotal(); queueStats();
    });
    $('#ed-ap').addEventListener('change', (e) => { const inp = e.target.closest('input'); if (inp) inp.value = draft.abilityPoints[inp.dataset.k]; });
    $('#ed-close').addEventListener('click', () => dlg.close());
    $('#ed-cancel').addEventListener('click', () => dlg.close());
    $('#ed-empty').addEventListener('click', () => { mine[edIndex] = emptyMine(); save(); renderMine(); dlg.close(); });
    $('#ed-save').addEventListener('click', saveEditor);
  }

  async function setDraftSpecies(slug) {
    const changed = draft.speciesSlug !== slug;
    draft.speciesSlug = slug;
    $('#ed-icon').src = iconSlug(slug) ? `icons/${iconSlug(slug)}.webp` : 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const o = await options(slug);
    if (changed) { draft.ability = ''; draft.moves = ['', '', '', '']; edCombos.moves.forEach((c) => c.set('', '')); }
    const sel = $('#ed-ability');
    sel.innerHTML = '<option value="">특성 선택</option>' + o.abilities.map((a) => `<option value="${esc(a.value)}">${esc(a.label)}</option>`).join('');
    if (!draft.ability && o.abilities.length === 1) draft.ability = o.abilities[0].value;
    sel.value = draft.ability || '';
    queueStats();
  }

  function updateApTotal() {
    const t = STAT_KEYS.reduce((s, k) => s + (draft.abilityPoints[k] || 0), 0);
    const el = $('#ed-ap-total'); el.textContent = `${t} / 66`; el.classList.toggle('over', t > 66);
    return t;
  }
  function queueStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(async () => {
      if (!draft.speciesSlug) { STAT_KEYS.forEach((k) => { $(`[data-s="${k}"]`).textContent = '-'; }); return; }
      try {
        const r = JSON.parse(await call('calc_stats', draft.speciesSlug, JSON.stringify(draft.abilityPoints), draft.nature || 'Hardy'));
        if (r.ok) STAT_KEYS.forEach((k) => { $(`[data-s="${k}"]`).textContent = r.stats[k] ?? '-'; });
      } catch (e) { /* 표시만 생략 */ }
    }, 150);
  }

  async function openEditor(i) {
    if (!CAT) return;
    edIndex = i;
    draft = JSON.parse(JSON.stringify(mine[i]));
    $('#ed-title').textContent = `${i + 1}번 칸 편집`;
    edCombos.species.set(draft.speciesSlug, draft.speciesSlug ? speciesName(draft.speciesSlug) : '');
    edCombos.item.set(draft.item, draft.item ? itemLabel(draft.item) : '');
    $('#ed-nature').value = draft.nature || 'Hardy';
    $('#ed-mega').checked = !!draft.megaCapable;
    STAT_KEYS.forEach((k) => { $(`#ed-ap input[data-k="${k}"]`).value = draft.abilityPoints[k] || 0; });
    updateApTotal();
    $('#ed-ap-msg').textContent = '각 0~32, 합계 최대 66. 아래 숫자는 레벨 50 실수치입니다.';
    const keepAbility = draft.ability, keepMoves = draft.moves.slice();
    await setDraftSpecies(draft.speciesSlug);
    draft.ability = keepAbility; $('#ed-ability').value = keepAbility || '';
    draft.moves = keepMoves; edCombos.moves.forEach((c, j) => c.set(keepMoves[j], keepMoves[j] ? moveLabel(keepMoves[j]) : ''));
    if (!dlg.open) dlg.showModal();
    if (!draft.speciesSlug) $('#ed-species').focus();
  }

  function saveEditor() {
    const t = updateApTotal();
    if (t > 66) { $('#ed-ap-msg').textContent = '능력 포인트 합계가 66을 넘었습니다. 줄여 주세요.'; return; }
    if (!draft.speciesSlug) { mine[edIndex] = emptyMine(); }
    else {
      if (draft.megaCapable) mine.forEach((m, j) => { if (j !== edIndex) m.megaCapable = false; });
      mine[edIndex] = draft;
    }
    save(); renderMine(); dlg.close();
  }

  $('#my-example').addEventListener('click', () => {
    mine = CAT.exampleParty.slice(0, 6).map((p) => ({ speciesSlug: p.speciesSlug, item: p.item || '', ability: p.ability || '', nature: p.nature || 'Hardy',
      moves: [...(p.moves || []), '', '', '', ''].slice(0, 4), abilityPoints: Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, p.abilityPoints || {}), megaCapable: !!p.megaCapable }));
    while (mine.length < 6) mine.push(emptyMine());
    save(); renderMine();
  });
  $('#my-clear').addEventListener('click', () => { mine = Array.from({ length: 6 }, emptyMine); save(); renderMine(); });

  // ---------- 2. 상대 파티 ----------
  function renderOpps() {
    const box = $('#opp-slots');
    box.innerHTML = opps.map((o, i) => `
      <div class="opp${o.speciesSlug ? ' filled' : ''}" data-i="${i}">
        <div class="opp-top"><span class="opp-n">${i + 1}</span><span class="opp-ico">${iconHTML(o.speciesSlug, 'sm')}</span>
          <div class="combo"><input class="o-species" autocomplete="off" placeholder="상대 ${i + 1} 포켓몬" aria-label="상대 ${i + 1} 포켓몬"></div></div>
        <details${(o.item || o.ability || o.moves.some(Boolean)) ? ' open' : ''}><summary>도구 · 특성 · 기술 직접 입력 (선택)</summary>
          <div class="opp-detail">
            <div class="combo"><input class="o-item" autocomplete="off" placeholder="도구 (비우면 자동)" aria-label="상대 ${i + 1} 도구"></div>
            <select class="o-ability" aria-label="상대 ${i + 1} 특성"><option value="">특성 (비우면 자동)</option></select>
            <div class="moves2">${[0, 1, 2, 3].map((j) => `<div class="combo"><input class="o-move" data-j="${j}" autocomplete="off" placeholder="기술 ${j + 1}" aria-label="상대 ${i + 1} 기술 ${j + 1}"></div>`).join('')}</div>
          </div></details>
      </div>`).join('');

    box.querySelectorAll('.opp').forEach((card) => {
      const i = +card.dataset.i; const o = opps[i];
      const sc = combo(card.querySelector('.o-species'), { source: speciesSource, icons: true, onPick: async (p) => {
        const slug = p ? p.value : '';
        if (slug !== o.speciesSlug) { o.speciesSlug = slug; o.ability = ''; o.moves = ['', '', '', '']; save(); }
        card.querySelector('.opp-ico').innerHTML = iconHTML(slug, 'sm');
        card.classList.toggle('filled', !!slug);
        fillOppDetail(card, o);
      } });
      sc.set(o.speciesSlug, o.speciesSlug ? speciesName(o.speciesSlug) : '');
      const ic = combo(card.querySelector('.o-item'), { source: itemSource, onPick: (p) => { o.item = p ? p.value : ''; save(); } });
      ic.set(o.item, o.item ? itemLabel(o.item) : '');
      card.querySelector('.o-ability').addEventListener('change', (e) => { o.ability = e.target.value; save(); });
      card._moveCombos = [...card.querySelectorAll('.o-move')].map((inp) => combo(inp, {
        source: () => (OPTS.get(o.speciesSlug) || { moves: [] }).moves.map((m) => ({ value: m.value, label: m.label, sub: m.value })),
        onPick: (p) => { o.moves[+inp.dataset.j] = p ? p.value : ''; save(); },
      }));
      fillOppDetail(card, o);
    });
  }
  async function fillOppDetail(card, o) {
    const sel = card.querySelector('.o-ability');
    const op = await options(o.speciesSlug);
    sel.innerHTML = '<option value="">특성 (비우면 자동)</option>' + op.abilities.map((a) => `<option value="${esc(a.value)}">${esc(a.label)}</option>`).join('');
    sel.value = o.ability || '';
    card._moveCombos.forEach((c, j) => c.set(o.moves[j], o.moves[j] ? moveLabel(o.moves[j]) : ''));
  }
  $('#opp-example').addEventListener('click', () => {
    opps = CAT.exampleOpponents.slice(0, 6).map((p) => ({ speciesSlug: p.speciesSlug, item: p.item || '', ability: p.ability || '', moves: [...(p.moves || []), '', '', '', ''].slice(0, 4) }));
    while (opps.length < 6) opps.push(emptyOpp());
    save(); renderOpps();
  });
  $('#opp-clear').addEventListener('click', () => { opps = Array.from({ length: 6 }, emptyOpp); save(); renderOpps(); });

  // ---------- 계산 ----------
  const calcBtn = $('#calc'), calcMsg = $('#calc-msg');
  calcBtn.addEventListener('click', async () => {
    const myParty = mine.map((m, i) => ({ ...m, slot: i + 1, nickname: '', level: 50, moves: m.moves.filter(Boolean) })).filter((m) => m.speciesSlug);
    const oppParty = opps.filter((o) => o.speciesSlug).map((o) => ({ speciesSlug: o.speciesSlug, item: o.item, ability: o.ability, moves: o.moves.filter(Boolean) }));
    if (myParty.length < 3) { calcMsg.textContent = '내 파티에 포켓몬을 3마리 이상 넣어 주세요.'; return; }
    if (myParty.some((m) => m.moves.length === 0)) { calcMsg.textContent = '내 파티의 모든 포켓몬에 기술을 1개 이상 넣어 주세요.'; return; }
    if (!oppParty.length) { calcMsg.textContent = '상대 포켓몬을 1마리 이상 골라 주세요.'; return; }
    if (myParty.filter((m) => m.megaCapable).length > 1) { calcMsg.textContent = '메가진화 후보는 1마리만 정할 수 있습니다.'; return; }

    calcMsg.textContent = '';
    calcBtn.disabled = true; calcBtn.textContent = '계산 중…';
    const sec = $('#result-sec'); sec.hidden = false;
    $('#result').innerHTML = '<div class="loading-box">조합을 비교하고 있습니다. 잠시만 기다려 주세요.</div>';
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const r = JSON.parse(await call('recommend', JSON.stringify(myParty), JSON.stringify(oppParty)));
      renderResult(r);
    } catch (e) {
      $('#result').innerHTML = `<div class="warn-box">계산 중 오류가 발생했습니다: ${esc(e.message)}</div>`;
    } finally {
      calcBtn.disabled = false; calcBtn.textContent = '선출 추천 계산하기';
    }
  });

  function summaryOf(lines) {
    const line = (lines || []).find((l) => l.startsWith('대응:'));
    const text = line ? line.split(':').slice(1).join(':').trim() : '상세 대처법 확인';
    const clean = text.replace(/^[✓⚠↔]\s*/, '');
    let cls = 'keep', mk = '✓';
    if (/불리하지만|주의|재검토/.test(text)) { cls = 'warn'; mk = '⚠'; }
    else if (/교체/.test(text)) { cls = 'switch'; mk = '↔'; }
    return `<span class="v-mark ${cls}" aria-hidden="true">${mk}</span> ${esc(clean)}`;
  }
  function lineHTML(l) {
    const k = l.indexOf(':');
    if (k > 0 && k < 14) return `<li><b>${esc(l.slice(0, k))}</b><span>${esc(l.slice(k + 1).trim())}</span></li>`;
    return `<li><b>·</b><span>${esc(l)}</span></li>`;
  }

  let lastResult = null, rankIdx = 0;
  function renderResult(r) {
    lastResult = r; rankIdx = 0;
    if (!r.results || !r.results.length) {
      $('#result').innerHTML = `<div class="warn-box">추천 결과를 만들 수 없었습니다. ${esc((r.warnings || []).join(' '))}</div>`;
      return;
    }
    drawRank();
  }
  function drawRank() {
    const r = lastResult; const x = r.results[rankIdx];
    const tabs = r.results.map((y, i) => `<button class="rank-tab" type="button" role="tab" aria-selected="${i === rankIdx}" data-r="${i}">${y.rank}위 조합</button>`).join('');
    const picks = x.chosen.map((slug, i) => `<div class="pick${slug === x.lead ? ' lead' : ''}">${iconHTML(slug, 'sm')}<span>${slug === x.lead ? '<span class="lead-tag">선봉</span>' : ''}${esc(x.chosen_display[i] || speciesName(slug))}</span></div>`).join('');
    const score = Math.max(0, Math.min(100, Number(x.score_100) || 0));
    const vs = x.per_opponent.map((row, i) => `
      <details class="vs"${i === 0 ? ' open' : ''}><summary>${iconHTML(row.opponent, 'sm')}<span class="v-name">${esc(row.opponent_display || speciesName(row.opponent))}</span><span class="v-sum">${summaryOf(row.reasoning_lines)}</span><span class="chev" aria-hidden="true">›</span></summary>
        <ul class="v-lines">${row.reasoning_lines.map(lineHTML).join('')}</ul></details>`).join('');
    const fills = (r.fill_notes || []).filter((f) => f.notes && f.notes.length);
    const notes = `
      <div class="res-notes">
        ${fills.length ? `<details><summary>자동으로 채운 상대 정보 보기 (${fills.length}마리)</summary><ul>${fills.map((f) => `<li><b>${esc(speciesName(f.slug))}</b>: ${esc(f.notes.map(prettyNote).join(' / '))}</li>`).join('')}</ul></details>` : ''}
        ${(r.warnings || []).length ? `<div class="warn-box">${r.warnings.map(esc).join('<br>')}</div>` : ''}
      </div>`;
    $('#result').innerHTML = `
      <div class="rank-tabs" role="tablist" aria-label="추천 순위">${tabs}</div>
      <div class="res-card">
        <div class="res-top">
          <div>
            <p class="meta-label">선출 3마리</p>
            <div class="pick-row">${picks}</div>
          </div>
          <div>
            <p class="meta-label">총점</p>
            <div class="score"><b>${score.toFixed(1)}</b><span>/ 100점</span></div>
            <div class="score-bar" aria-hidden="true"><i style="width:${score}%"></i></div>
          </div>
        </div>
        ${x.lead ? `<div class="lead-box" style="margin-top:20px"><strong>선봉 추천: ${esc(x.lead_display || speciesName(x.lead))}</strong><p>${esc(x.lead_reasoning || '')}</p></div>` : ''}
        <h3 class="res-h">상대 선봉별 대처법</h3>
        <div class="vs-list">${vs}</div>
        ${notes}
      </div>`;
    $('#result').querySelectorAll('.rank-tab').forEach((b) => b.addEventListener('click', () => { rankIdx = +b.dataset.r; drawRank(); }));
  }
  function prettyNote(n) {
    // "도구=Delphoxite(자동)" → "도구: 마폭시나이트" 처럼 한글로
    const m = n.match(/^(도구|특성|기술)=(.*?)(\(자동\))?$/);
    if (!m) return n;
    const [, k, v] = m;
    if (k === '도구') return `도구 ${itemLabel(v)}`;
    if (k === '특성') return `특성 ${abilityLabel(v)}`;
    return '기술 ' + v.split(',').map((s) => moveLabel(s.trim())).join(', ');
  }

  // ---------- 시작 ----------
  async function onEngineReady() {
    try {
      const [cat, icons] = await Promise.all([call('catalog').then(JSON.parse), fetch('icons/index.json').then((r) => r.json()).catch(() => [])]);
      CAT = cat; ICONS = new Set(icons);
      CAT.species.forEach((s) => SPECIES.set(s.slug, s));
      CAT.items.forEach((i) => ITEM_LABEL.set(i.value, i.label));
      buildEditorOnce();
      if (!mine.some((m) => m.speciesSlug)) $('#my-example').click(); else renderMine();
      renderOpps();
      engineReady = true;
      statusEl.classList.add('ok');
      statusEl.querySelector('span').textContent = '계산 엔진 준비 완료';
      calcBtn.disabled = false;
    } catch (e) {
      console.error('init failed', e);
      statusEl.classList.add('err');
      statusEl.querySelector('span').textContent = '데이터를 불러오지 못했습니다. 새로고침해 주세요.';
    }
  }
  // 엔진 준비 전에도 칸 모양은 먼저 보여 준다
  $('#my-slots').innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="slot is-empty"><span class="pk-icon empty"></span><span class="s-main"><span class="s-name">${i + 1}번 칸</span><span class="s-meta">불러오는 중</span></span></div>`).join('');
})();
