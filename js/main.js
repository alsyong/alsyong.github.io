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
