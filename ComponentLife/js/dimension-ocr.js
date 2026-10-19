'use strict';

const dimensionOcrUrl = new URL('dimension-ocr/index.html', document.baseURI).href;

function initDimensionOcr() {
  const frame = document.getElementById('dimensionOcrFrame');
  if (!frame || frame.dataset.started) return;
  frame.dataset.started = 'true';
  const status = document.getElementById('dimensionOcrStatus');
  status.hidden = false; status.textContent = 'Đang mở Dimension OCR…';
  frame.addEventListener('load', () => { status.hidden = true; });
  for (const [id, target] of [['dimensionOcrModeOcr', 'tab-ocr'], ['dimensionOcrModeCad', 'tab-cad']]) {
    document.getElementById(id).addEventListener('click', () => {
      const button = frame.contentDocument?.getElementById(target);
      if (!button || typeof button.onclick !== 'function') return;
      button.click();
      document.getElementById('dimensionOcrModeOcr').setAttribute('aria-pressed', String(target === 'tab-ocr'));
      document.getElementById('dimensionOcrModeCad').setAttribute('aria-pressed', String(target === 'tab-cad'));
    });
  }
  frame.addEventListener('error', () => {
    status.hidden = false;
    status.textContent = 'Chưa mở được Dimension OCR. Kiểm tra kết nối hoặc chọn Mở riêng.';
  });
  // Start only when requested. Keep the same frame across tabs to preserve the open drawing.
  frame.src = dimensionOcrUrl;
}

async function toggleDimensionOcrFullscreen() {
  const workspace = document.getElementById('dimensionOcrWorkspace');
  try {
    if (document.fullscreenElement === workspace) await document.exitFullscreen();
    else await workspace.requestFullscreen();
  } catch (error) {
    const status = document.getElementById('dimensionOcrStatus');
    status.hidden = false;
    status.textContent = 'Trình duyệt chưa cho phép toàn màn hình. Bạn có thể chọn Mở riêng.';
  }
}

document.addEventListener('fullscreenchange', () => {
  document.getElementById('dimensionOcrFullscreen').textContent = document.fullscreenElement === document.getElementById('dimensionOcrWorkspace') ? 'Thoát toàn màn hình' : 'Toàn màn hình';
});
