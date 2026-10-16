/* heartbeat.js — Heartbeat, version polling, auto-reload */
'use strict';

function initHeartbeat() {
  const ping = () => {
    fetch("/api/heartbeat", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        if (data && data.closeUi) {
          window.open('', '_self', '');
          window.close();
        }
      })
      .catch(() => {});
  };
  ping();
  setInterval(ping, 1000);
  setInterval(checkDataVersionLoop, 1500);

  const notifyExit = () => {
    try {
      // Do not shut down backend server when tabs are closed, especially for remote Cloudflare viewers
      const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
      const urlParams = new URLSearchParams(window.location.search);
      if (isLocal && urlParams.get('autoclose') === '1') {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/shutdown");
        } else {
          fetch("/api/shutdown", { method: "POST", keepalive: true }).catch(() => {});
        }
      }
    } catch (e) {}
  };
  window.addEventListener("beforeunload", notifyExit);
  window.addEventListener("pagehide", notifyExit);
}
