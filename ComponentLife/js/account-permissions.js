/* Only admins write access permissions; users can change their own visible allowed columns. */
"use strict";
const accountTabLabels = {
  overview: "Tổng quan",
  month: "Theo dõi tháng",
  stock: "Quản lý linh kiện",
  chart: "Phân tích & Biểu đồ",
  inspection: "Đo linh kiện",
  dimensionocr: "Kiểm tra kích thước IQC",
};
function accountTabsMarkup(tabs) {
  return `<fieldset><legend>Tab được phép sử dụng</legend><div class="account-fields">${Object.entries(
    accountTabLabels,
  )
    .map(
      ([key, label]) =>
        `<label><input type="checkbox" name="tabs" value="${key}" ${tabs.includes(key) ? "checked" : ""}>${label}</label>`,
    )
    .join("")}</div></fieldset>`;
}
function accountFullPolicy() {
  return {
    records: Object.keys(guestFieldLabels.records),
    details: Object.keys(guestFieldLabels.details),
    previewDrawing: true,
    downloadPDF: true,
    downloadExcel: true,
  };
}
function accountPolicyMarkup(policy) {
  return (
    Object.entries(guestFieldLabels)
      .map(
        ([section, labels]) =>
          `<fieldset><legend>${section === "records" ? "Các trường trong danh sách hồ sơ" : "Các trường trong Xem nhanh"}</legend><div class="account-fields">${Object.entries(
            labels,
          )
            .map(
              ([key, label]) =>
                `<label><input type="checkbox" name="${section}" value="${key}" ${policy[section].includes(key) ? "checked" : ""}>${label}</label>`,
            )
            .join("")}</div></fieldset>`,
      )
      .join("") +
    `<fieldset><legend>Bản vẽ / Tải xuống</legend>${[
      ["previewDrawing", "Xem bản vẽ"],
      ["downloadPDF", "Tải PDF gốc"],
      ["downloadExcel", "Tải / Export Excel (cần quyền xem đầy đủ các trường)"],
    ]
      .map(
        ([key, label]) =>
          `<label><input type="checkbox" name="${key}" ${policy[key] ? "checked" : ""}>${label}</label>`,
      )
      .join("")}</fieldset>`
  );
}
function accountPolicyFromForm(form) {
  return {
    records: form.getAll("records"),
    details: form.getAll("details"),
    previewDrawing: form.has("previewDrawing"),
    downloadPDF: form.has("downloadPDF"),
    downloadExcel: form.has("downloadExcel"),
  };
}
function openAccountDelete(user) {
  if (!ComponentAuth.admin()) return;
  const dialog = accountDialog(
    "Xóa tài khoản vĩnh viễn",
    `<p>Xóa <strong>${accountEscape(user.username)}</strong> và thu hồi mọi phiên đăng nhập. Thao tác không thể hoàn tác.</p><form><label>Nhập đúng username để xác nhận<input name="confirmUsername" required autocomplete="off"></label><button type="submit" class="account-danger">Xóa vĩnh viễn</button><button type="button" onclick="openAccountUsers()">Hủy</button></form>`,
  );
  dialog.querySelector("form").onsubmit = (e) =>
    accountSubmit(e, async () => {
      await ComponentAuth.request(
        "/api/admin/users/" + user.id,
        "DELETE",
        Object.fromEntries(new FormData(e.target)),
      );
      await openAccountUsers();
      document.getElementById("accountStatus").textContent =
        "Đã xóa vĩnh viễn tài khoản và mọi phiên đăng nhập.";
    });
}
function openAccountPermissions(user, policyOverride = null) {
  if (!ComponentAuth.admin() || user.role === "admin") return;
  const permissions = user.permissions || {
    tabs: Object.keys(accountTabLabels),
    inspection: accountFullPolicy(),
  };
  const dialog = accountDialog(
    "Phân quyền · " + accountEscape(user.username),
    `<p>Chỉ admin được cấp hoặc thu hồi quyền tab. Người dùng được sử dụng các tính năng của tab trong phạm vi dữ liệu được cấp.</p><form id="accountPermissionsForm">${accountTabsMarkup(permissions.tabs)}<button type="button" id="copyGuestPolicy">Dùng cấu hình trường giống khách</button>${accountPolicyMarkup(policyOverride || permissions.inspection)}<button class="account-primary" type="submit">Lưu quyền tài khoản</button><button type="button" onclick="openAccountUsers()">Quay lại</button></form>`,
  );
  dialog.querySelector("#copyGuestPolicy").onclick = () => {
    const tabs = new FormData(dialog.querySelector("form")).getAll("tabs");
    openAccountPermissions(
      { ...user, permissions: { ...permissions, tabs } },
      structuredClone(ComponentAuth.guestPolicy),
    );
  };
  dialog.querySelector("form").onsubmit = (e) =>
    accountSubmit(e, async () => {
      const form = new FormData(e.target);
      await ComponentAuth.request(
        "/api/admin/users/" + user.id + "/permissions",
        "PUT",
        {
          version: user.version || 0,
          permissions: {
            tabs: form.getAll("tabs"),
            inspection: accountPolicyFromForm(form),
          },
        },
      );
      await openAccountUsers();
      document.getElementById("accountStatus").textContent =
        "Đã lưu quyền trên Cloudflare D1. Tài khoản nhận giao diện mới khi tải lại trang.";
    });
}
function openInspectionFields() {
  if (!ComponentAuth.full() || !ComponentAuth.canTab("inspection")) return;
  const dialog = accountDialog(
    "Trường hiển thị của bạn",
    `<p>Chọn các trường trong phạm vi được admin cấp. Lần đầu sử dụng theo cấu hình admin.</p><form id="personalFieldsForm">${Object.entries(
      guestFieldLabels,
    )
      .map(
        ([section, labels]) =>
          `<fieldset><legend>${section === "records" ? "Danh sách hồ sơ" : "Xem nhanh điểm đo"}</legend><div class="account-fields">${Object.entries(
            labels,
          )
            .filter(([key]) => ComponentAuth.permitted(section, key))
            .map(
              ([key, label]) =>
                `<label><input type="checkbox" name="${section}" value="${key}" ${ComponentAuth.allowed(section, key) ? "checked" : ""}>${label}</label>`,
            )
            .join("")}</div></fieldset>`,
      )
      .join(
        "",
      )}<button type="submit" class="account-primary">Áp dụng</button><button type="button" id="resetPersonalFields">Theo mặc định admin</button>${ComponentAuth.admin() ? '<button type="button" onclick="openGuestFields()">Thiết lập cho khách</button>' : ""}</form>`,
  );
  const apply = (fields) => {
    if (fields) fields.accessVersion = ComponentAuth.accessVersion;
    ComponentAuth.fields = fields;
    if (fields)
      localStorage.setItem(
        "componentlife-fields-" + ComponentAuth.user.id,
        JSON.stringify(fields),
      );
    else
      localStorage.removeItem("componentlife-fields-" + ComponentAuth.user.id);
    ComponentAuth.apply();
    inspectionState.ngOnly = false;
    inspectionColumnFilters = {};
    inspectionColumnSort = null;
    renderInspectionList();
    renderInspectionDetail();
    closeAccountDialog();
  };
  dialog.querySelector("#resetPersonalFields").onclick = () => apply(null);
  dialog.querySelector("form").onsubmit = (e) =>
    accountSubmit(e, async () => {
      const form = new FormData(e.target),
        fields = {
          records: form.getAll("records"),
          details: form.getAll("details"),
        };
      if (!fields.records.length || !fields.details.length)
        throw Error("Chọn ít nhất một trường cho mỗi bảng.");
      apply(fields);
    });
}
