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
