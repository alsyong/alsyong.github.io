// 영상: 클릭했을 때만 YouTube를 불러온다 (자동 재생 없음)
document.querySelectorAll('[data-youtube]').forEach(function (box) {
  box.addEventListener('click', function () {
    var id = box.getAttribute('data-youtube');
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
    iframe.title = box.getAttribute('data-title') || 'YouTube 영상';
    iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    box.replaceChildren(iframe);
    box.classList.add('is-playing');
  }, { once: true });
});

// 테마 전환 버튼 (기본: 어두운 테마)
(function () {
  var root = document.documentElement;
  var btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  function sync() {
    var light = root.getAttribute('data-theme') === 'light';
    btn.setAttribute('aria-label', light ? '어두운 테마로 바꾸기' : '밝은 테마로 바꾸기');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#ffffff' : '#111317');
  }
  btn.addEventListener('click', function () {
    var light = root.getAttribute('data-theme') !== 'light';
    if (light) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
    sync();
  });
  sync();
})();

// 이미지 확대 보기 (새 탭 대신 화면 위 창으로)
(function () {
  var SEL = 'a[href$=".webp"], .shots img, .tool-fig img';
  var triggers = Array.prototype.slice.call(document.querySelectorAll(SEL));
  if (!triggers.length) return;

  var box = document.createElement('dialog');
  box.className = 'lightbox';
  box.setAttribute('aria-label', '이미지 크게 보기');
  box.innerHTML =
    '<div class="lb-stage"><img class="lb-img" alt=""></div>' +
    '<div class="lb-bar">' +
      '<p class="lb-cap"></p>' +
      '<span class="lb-count"></span>' +
      '<button class="lb-btn lb-zoom" type="button" aria-label="확대 / 맞춤 전환">＋</button>' +
      '<a class="lb-btn lb-open" target="_blank" rel="noopener" aria-label="원본 새 탭에서 열기">↗</a>' +
      '<button class="lb-btn lb-close" type="button" aria-label="닫기">×</button>' +
    '</div>' +
    '<button class="lb-nav lb-prev" type="button" aria-label="이전 이미지">‹</button>' +
    '<button class="lb-nav lb-next" type="button" aria-label="다음 이미지">›</button>';
  document.body.appendChild(box);

  var stage = box.querySelector('.lb-stage');
  var img = box.querySelector('.lb-img');
  var cap = box.querySelector('.lb-cap');
  var count = box.querySelector('.lb-count');
  var zoomBtn = box.querySelector('.lb-zoom');
  var openLink = box.querySelector('.lb-open');
  var group = [], index = 0, zoomed = false;

  function info(el) {
    var a = el.tagName === 'A' ? el : el.closest('a');
    var im = el.tagName === 'IMG' ? el : el.querySelector('img');
    var fig = el.closest('figure');
    var fc = fig && fig.querySelector('figcaption');
    var text = (fc && fc.textContent.trim()) || (im && im.alt) || '';
    return { src: a ? a.getAttribute('href') : im.getAttribute('src'), caption: text };
  }
  function groupFor(el) {
    var scope = el.closest('.doc-feature, .proj, .tool-grid, .section') || document.body;
    return triggers.filter(function (t) { return scope.contains(t); });
  }
  function setZoom(on) {
    zoomed = on;
    box.classList.toggle('is-zoomed', on);
    zoomBtn.textContent = on ? '－' : '＋';
    if (on) { stage.scrollTop = 0; stage.scrollLeft = 0; }
  }
  function show(i) {
    index = (i + group.length) % group.length;
    var d = info(group[index]);
    setZoom(false);
    img.src = d.src; img.alt = d.caption;
    cap.textContent = d.caption;
    openLink.href = d.src;
    count.textContent = group.length > 1 ? (index + 1) + ' / ' + group.length : '';
    box.classList.toggle('single', group.length < 2);
  }
  function open(el) {
    group = groupFor(el);
    show(group.indexOf(el));
    if (!box.open) box.showModal();
    document.documentElement.classList.add('lb-lock');
  }

  triggers.forEach(function (t) {
    if (t.tagName === 'IMG') { t.setAttribute('tabindex', '0'); t.setAttribute('role', 'button'); }
    t.classList.add('zoomable');
    t.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // 새 탭 열기는 그대로 허용
      e.preventDefault(); open(t);
    });
    t.addEventListener('keydown', function (e) {
      if (t.tagName === 'IMG' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); }
    });
  });

  box.querySelector('.lb-close').addEventListener('click', function () { box.close(); });
  box.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
  box.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });
  zoomBtn.addEventListener('click', function () { setZoom(!zoomed); });
  img.addEventListener('click', function (e) {
    e.stopPropagation();
    var wasZoomed = zoomed;
    var r = img.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    setZoom(!wasZoomed);
    if (!wasZoomed) {
      requestAnimationFrame(function () {
        stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
      });
    }
  });
  stage.addEventListener('click', function (e) { if (e.target === stage) box.close(); });
  box.addEventListener('click', function (e) { if (e.target === box) box.close(); });
  box.addEventListener('close', function () { document.documentElement.classList.remove('lb-lock'); img.removeAttribute('src'); });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  });
  // 휴대폰: 좌우로 밀어서 넘기기 (확대 중이 아닐 때만)
  var sx = null;
  stage.addEventListener('touchstart', function (e) { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (sx === null || zoomed || group.length < 2) return;
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    sx = null;
  });
})();

// 배틀 보조 시연 영상: 화면에 보일 때만 소리 없이 재생, 정지 버튼, 움직임 줄이기 설정 존중
(function () {
  var v = document.querySelector('.demo-video');
  var btn = document.querySelector('.demo-toggle');
  if (!v || !btn) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var userPaused = reduce;
  function label() {
    var playing = !v.paused;
    btn.textContent = playing ? '❚❚' : '▶';
    btn.setAttribute('aria-label', playing ? '시연 영상 일시정지' : '시연 영상 재생');
  }
  btn.addEventListener('click', function () {
    if (v.paused) { userPaused = false; v.play().catch(function () {}); }
    else { userPaused = true; v.pause(); }
  });
  v.addEventListener('play', label); v.addEventListener('pause', label);
  label();
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting && !userPaused) { v.play().catch(function () {}); }
      else if (!e.isIntersecting && !v.paused) { v.pause(); }
    });
  }, { threshold: 0.4 }).observe(v);
})();

// 프로젝트 플레이 클립: GIF처럼 소리 없이 반복, 화면에 보일 때만 재생, 움직임 줄이기 설정이면 정지 화면
(function () {
  var clips = document.querySelectorAll('.loop-clip');
  if (!clips.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  function play(v) { if (v.preload === 'none') v.preload = 'auto'; v.play().catch(function () {}); }
  if (!('IntersectionObserver' in window)) { clips.forEach(play); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) play(e.target);
      else if (!e.target.paused) e.target.pause();
    });
  }, { threshold: 0.25 });
  clips.forEach(function (v) { io.observe(v); });
})();
