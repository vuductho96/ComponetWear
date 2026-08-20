/* screen-fit.js — Zoom and Fullscreen controls */
'use strict';

let _currentZoomScale = 1;

function applyZoomScale(scale, silent) {
  _currentZoomScale = scale;
  const app = document.querySelector('.app');
  if (app) {
    if (scale === 1) {
      app.style.transform = 'none';
      app.style.width = '100%';
    } else {
      app.style.transformOrigin = 'top left';
      app.style.transform = `scale(${scale})`;
      app.style.width = `${Math.round(100 / scale)}%`;
    }
  }
  if ($('zoomPercentVal')) $('zoomPercentVal').textContent = Math.round(scale * 100) + '%';
}

function initScreenFitEngine() {
  const storedZoom = parseFloat(localStorage.getItem('componentlife_zoom') || '1');
  applyZoomScale(storedZoom, true);
}

function adjustZoom(delta) {
  let newZoom = Math.round((_currentZoomScale + delta) * 100) / 100;
  newZoom = Math.max(0.60, Math.min(1.50, newZoom));
  localStorage.setItem('componentlife_zoom', newZoom.toString());
  applyZoomScale(newZoom, false);
}

function resetZoom() {
  localStorage.setItem('componentlife_zoom', '1');
  applyZoomScale(1, false);
  msg("Đã đặt lại tỷ lệ 100%", false, 1500);
}

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    if ($('btnFullScreen')) $('btnFullScreen').classList.add('active');
  } else {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if ($('btnFullScreen')) $('btnFullScreen').classList.remove('active');
  }
}

