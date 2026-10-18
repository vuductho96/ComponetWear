/* heartbeat.js — Heartbeat, version polling, auto-reload */
'use strict';

function initHeartbeat() {
  let failedHeartbeats = 0;
  let heartbeatTimer = null;
  let versionTimer = null;

  const ping = () => {
    fetch("/api/heartbeat", { method: "POST" })
      .then(r => {
        if (!r.ok) {
          failedHeartbeats++;
          if (failedHeartbeats >= 3) {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (versionTimer) clearInterval(versionTimer);
          }
          return null;
        }
        failedHeartbeats = 0;
        return r.json();
      })
      .then(data => {
        if (data && data.closeUi) {
          window.open('', '_self', '');
          window.close();
        }
      })
      .catch(() => {
        failedHeartbeats++;
        if (failedHeartbeats >= 3) {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (versionTimer) clearInterval(versionTimer);
        }
      });
  };
  ping();
  heartbeatTimer = setInterval(ping, 2000);
  versionTimer = setInterval(checkDataVersionLoop, 3000);

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
