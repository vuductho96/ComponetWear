/* Permissions are authoritative on Worker/D1. Personal column visibility cannot grant access. */
"use strict";
window.ComponentAuth = {
  user: null,
  csrf: null,
  version: 0,
  tabs: ["inspection", "dimensionocr"],
  fields: null,
  policy: {
    records: [
      "file",
      "part",
      "mold",
      "month",
      "measuredDate",
      "source",
      "drawing",
    ],
    details: ["point", "nominal", "sample"],
    previewDrawing: true,
    downloadPDF: true,
    downloadExcel: false,
  },
  error: "",
  full() {
    return !!this.user;
  },
  admin() {
    return this.user?.role === "admin";
  },
  canTab(name) {
    return (
      this.admin() ||
      this.tabs.includes(
        ["dashboard", "report"].includes(name) ? "stock" : name,
      )
    );
  },
  permitted(kind, key) {
    return this.admin() || this.policy[kind]?.includes(key);
  },
  allowed(kind, key) {
    return (
      this.permitted(kind, key) &&
      (!this.fields?.[kind] || this.fields[kind].includes(key))
    );
  },
  capability(key) {
    return this.admin() || this.policy[key] === true;
  },
  async request(path, method = "GET", data) {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrf || "",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(result.error || "Không thể thực hiện thao tác.");
    return result;
  },
  apply() {
    document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
      tab.hidden = !this.canTab(tab.dataset.tab);
    });
    const button = document.getElementById("accountButton");
    if (button)
      button.textContent = this.user
        ? `◎ ${this.user.username}`
        : "◎ Đăng nhập";
    const quality = document.getElementById("inspectionQuality");
    if (quality) {
      quality.hidden = !this.allowed("records", "quality");
      if (quality.hidden) quality.value = "";
    }
    for (const [id, key] of [
      ["inspectionSource", "source"],
      ["inspectionMonth", "month"],
    ]) {
      const element = document.getElementById(id);
      if (element) {
        element.hidden = !this.allowed("records", key);
        if (element.hidden) element.value = "";
      }
    }
    document
      .querySelectorAll('[onclick*="exportInspectionResults"]')
      .forEach((button) => (button.hidden = !this.capability("downloadExcel")));
    const exportButton = document.getElementById("btnExportReport");
    if (exportButton) exportButton.hidden = !this.capability("downloadExcel");
    document.body.classList.toggle("guest-mode", !this.full());
    document.body.classList.remove("auth-loading");
  },
};
// A restored history entry must re-check D1, rather than revive an old authenticated DOM.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
ComponentAuth.ready = (async () => {
  try {
    Object.assign(
      ComponentAuth,
      await ComponentAuth.request("/api/auth/session"),
    );
    if (ComponentAuth.user) {
      try {
        ComponentAuth.fields = JSON.parse(
          localStorage.getItem(
            "componentlife-fields-" + ComponentAuth.user.id,
          ) || "null",
        );
        if (
          ComponentAuth.fields &&
          (ComponentAuth.fields.accessVersion !== ComponentAuth.accessVersion ||
            !["records", "details"].every((key) =>
              Array.isArray(ComponentAuth.fields[key]),
            ))
        )
          ComponentAuth.fields = null;
      } catch {
        ComponentAuth.fields = null;
      }
    }
  } catch (error) {
    ComponentAuth.error = "Đăng nhập chưa sẵn sàng: " + error.message;
  }
  ComponentAuth.apply();
})();
function accountEscape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function closeAccountDialog() {
  const dialog = document.getElementById("accountDialog");
  dialog?.close();
  dialog?.remove();
}
function accountDialog(title, content) {
  closeAccountDialog();
  const dialog = document.createElement("dialog");
  dialog.id = "accountDialog";
  dialog.className = "account-dialog";
  dialog.innerHTML = `<div class="account-heading"><h2>${title}</h2><button type="button" aria-label="Đóng" onclick="closeAccountDialog()">×</button></div>${content}<p id="accountStatus" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
async function accountSubmit(event, action) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  const status = event.target
    .closest("dialog")
    ?.querySelector("#accountStatus");
  if (status) status.textContent = "Đang xử lý…";
  try {
    await action();
  } catch (error) {
    if (status?.isConnected) status.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}
function clearAccountCaches() {
  for (const key of Object.keys(localStorage))
    if (/componentlife|^componentMaster|^shootData/i.test(key))
      localStorage.removeItem(key);
}
function openAccount() {
  if (!ComponentAuth.user) {
    const dialog = accountDialog(
      "Đăng nhập",
      `<p>Đăng nhập để mở đầy đủ các tab và dữ liệu nội bộ.</p><form id="loginForm"><label>Email / Username<input name="username" autocomplete="username" required maxlength="100"></label><label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="account-primary" type="submit">Đăng nhập</button></form>`,
    );
    if (ComponentAuth.error)
      document.getElementById("accountStatus").textContent =
        ComponentAuth.error;
    dialog.querySelector("form").onsubmit = (e) =>
      accountSubmit(e, async () => {
        const data = Object.fromEntries(new FormData(e.target));
        await ComponentAuth.request("/api/auth/login", "POST", data);
        clearAccountCaches();
        location.reload();
      });
    return;
  }
  const dialog = accountDialog(
    "Tài khoản",
    `<p><strong>${accountEscape(ComponentAuth.user.username)}</strong> · ${ComponentAuth.admin() ? "Admin" : "Staff"}</p><div class="account-actions">${ComponentAuth.admin() ? '<button onclick="openAccountUsers()">Quản lý tài khoản</button><button onclick="openGuestFields()">Cột hiển thị cho khách</button>' : ""}<button onclick="openPasswordChange()">Đổi mật khẩu</button><button id="logoutButton">Đăng xuất</button></div>`,
  );
  dialog.querySelector("#logoutButton").onclick = async (event) => {
    event.target.disabled = true;
    try {
      await ComponentAuth.request("/api/auth/logout", "POST", {});
      clearAccountCaches();
      location.reload();
    } catch (error) {
      document.getElementById("accountStatus").textContent = error.message;
      event.target.disabled = false;
    }
  };
}
function openPasswordChange() {
  const dialog = accountDialog(
    "Đổi mật khẩu",
    `<form><label>Mật khẩu hiện tại<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Mật khẩu mới (ít nhất 10 ký tự)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label><label>Nhập lại mật khẩu mới<input name="confirm" type="password" autocomplete="new-password" minlength="10" required></label><button type="submit" class="account-primary">Lưu và đăng nhập lại</button></form>`,
  );
  dialog.querySelector("form").onsubmit = (e) =>
    accountSubmit(e, async () => {
      const data = Object.fromEntries(new FormData(e.target));
      if (data.password !== data.confirm)
        throw Error("Hai mật khẩu chưa khớp.");
      await ComponentAuth.request("/api/auth/password", "POST", data);
      clearAccountCaches();
      location.reload();
    });
}
async function openAccountUsers() {
  if (!ComponentAuth.admin()) return;
  const dialog = accountDialog(
    "Quản lý tài khoản",
    `<form id="createUserForm"><h3>Tạo tài khoản Staff</h3><label>Username<input name="username" autocomplete="off" required minlength="3" maxlength="100"></label><label>Mật khẩu (ít nhất 10 ký tự)<input name="password" type="password" autocomplete="new-password" required minlength="10"></label>${accountTabsMarkup(["inspection", "dimensionocr"])}<button class="account-primary" type="submit">Tạo tài khoản</button></form><div id="accountUsers">Đang tải tài khoản…</div>`,
  );
  async function render() {
    const users = await ComponentAuth.request("/api/admin/users"),
      host = dialog.querySelector("#accountUsers");
    host.replaceChildren();
    for (const user of users) {
      const row = document.createElement("div");
      row.className = "account-user";
      const name = document.createElement("span");
      name.textContent = `${user.username} · ${user.role}${user.disabled ? " · Đã khóa" : ""}`;
      row.append(name);
      if (user.role !== "admin") {
        const toggle = document.createElement("button");
        toggle.textContent = user.disabled ? "Mở khóa" : "Khóa";
        toggle.onclick = async () => {
          toggle.disabled = true;
          try {
            await ComponentAuth.request(
              "/api/admin/users/" + user.id,
              "PATCH",
              { disabled: !user.disabled },
            );
            await render();
          } catch (e) {
            document.getElementById("accountStatus").textContent = e.message;
            toggle.disabled = false;
          }
        };
        const reset = document.createElement("button");
        reset.textContent = "Đặt lại mật khẩu";
        reset.onclick = () => {
          const form = document.createElement("form");
          form.innerHTML =
            '<label>Mật khẩu mới<input name="password" type="password" autocomplete="new-password" required minlength="10"></label><button type="submit">Lưu mật khẩu</button>';
          form.onsubmit = (e) =>
            accountSubmit(e, async () => {
              await ComponentAuth.request(
                "/api/admin/users/" + user.id,
                "PATCH",
                { password: new FormData(form).get("password") },
              );
              await render();
              document.getElementById("accountStatus").textContent =
                "Đã đặt lại mật khẩu và thu hồi phiên đăng nhập cũ.";
            });
          reset.replaceWith(form);
        };
        const permissions = document.createElement("button");
        permissions.textContent = "Phân quyền";
        permissions.onclick = () => openAccountPermissions(user);
        const remove = document.createElement("button");
        remove.textContent = "Xóa vĩnh viễn";
        remove.className = "account-danger";
        remove.onclick = () => openAccountDelete(user);
        row.append(toggle, reset, permissions, remove);
      }
      host.append(row);
    }
  }
  dialog.querySelector("#createUserForm").onsubmit = (e) =>
    accountSubmit(e, async () => {
      const form = new FormData(e.target),
        data = Object.fromEntries(form);
      data.permissions = {
        tabs: form.getAll("tabs"),
        inspection: accountFullPolicy(),
      };
      await ComponentAuth.request("/api/admin/users", "POST", data);
      e.target.reset();
      await render();
      document.getElementById("accountStatus").textContent =
        "Đã tạo tài khoản Staff trên Cloudflare D1.";
    });
  try {
    await render();
  } catch (error) {
    document.getElementById("accountStatus").textContent = error.message;
  }
}
const guestFieldLabels = {
  records: {
    file: "File hồ sơ",
    part: "Part",
    mold: "Mold",
    month: "Tháng",
    measuredDate: "Ngày đo",
    source: "Nguồn",
    counts: "Điểm / Mẫu",
    quality: "Chất lượng / NG",
    drawing: "Bản vẽ",
    lot: "Thư mục / Lô",
    receivedDate: "Ngày nhận",
    quantity: "Số lượng",
  },
  details: {
    point: "Point",
    nominal: "Nominal",
    minus: "Dung sai −",
    plus: "Dung sai +",
    limits: "LSL / USL",
    sample: "Sample",
    actual: "Actual",
    deviation: "Sai lệch Δ",
    result: "Kết quả OK / NG",
  },
};
function openGuestFields() {
  if (!ComponentAuth.admin()) return;
  const policy = ComponentAuth.guestPolicy || ComponentAuth.policy;
  const dialog = accountDialog(
    "Cột hiển thị cho khách",
    `<p>Áp dụng chung cho người chưa đăng nhập. Tài khoản đã đăng nhập xem theo quyền admin cấp riêng.</p><form id="guestPolicyForm">${Object.entries(
      guestFieldLabels,
    )
      .map(
        ([section, fields]) =>
          `<fieldset><legend>${section === "records" ? "Danh sách hồ sơ" : "Xem nhanh điểm đo"}</legend><div class="account-fields">${Object.entries(
            fields,
          )
            .map(
              ([key, label]) =>
                `<label><input type="checkbox" name="${section}" value="${key}" ${policy[section].includes(key) ? "checked" : ""}>${label}</label>`,
            )
            .join("")}</div></fieldset>`,
      )
      .join("")}<fieldset><legend>Bản vẽ và tải xuống</legend>${[
      ["previewDrawing", "Xem bản vẽ online"],
      ["downloadPDF", "Tải PDF gốc"],
      ["downloadExcel", "Tải / Export Excel (cần bật tất cả cột)"],
    ]
      .map(
        ([key, label]) =>
          `<label><input name="${key}" type="checkbox" ${policy[key] ? "checked" : ""}>${label}</label>`,
      )
      .join(
        "",
      )}</fieldset><button type="submit" class="account-primary">Lưu mặc định cho khách</button></form>`,
  );
  dialog.querySelector("form").onsubmit = (e) =>
    accountSubmit(e, async () => {
      const form = new FormData(e.target),
        policy = {
          records: form.getAll("records"),
          details: form.getAll("details"),
        };
      for (const key of ["previewDrawing", "downloadPDF", "downloadExcel"])
        policy[key] = form.has(key);
      Object.assign(
        ComponentAuth,
        await ComponentAuth.request("/api/admin/settings", "PUT", {
          version: ComponentAuth.version,
          policy,
        }),
      );
      document.getElementById("accountStatus").textContent =
        "Đã lưu trên Cloudflare D1. Khách nhận cấu hình khi mở / tải lại trang.";
    });
}
