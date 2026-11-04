import {
  token,
  digest,
  equal,
  passwordValid,
  passwordHash,
  passwordMatches,
} from "./auth-crypto.mjs";
import {
  defaultPolicy,
  validatePolicy,
  projectSummary,
  projectDetails,
  fullPermissions,
  fullPolicy,
  validatePermissions,
} from "./policy.mjs";
import {
  syncTmsOnCloud,
  getLatestTmsDataFromD1,
  saveTmsDataToD1,
} from "./tms-crawler.mjs";
import { getTmsSecurityMetadata } from "./tms-crypto.mjs";

const cookieName = "__Host-componentlife_session";
const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const publicUser = (user) =>
  user && { id: user.id, username: user.username, role: user.role };
async function body(request, maxBytes = 8192) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail("Cần gửi JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) fail("Thiếu dữ liệu.");
  let size = 0,
    parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      fail("Dữ liệu quá lớn.", 413);
    }
    parts.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
  } catch {
    fail("JSON không hợp lệ.");
  }
}
async function session(request, env) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return env.DB.prepare(
    "SELECT u.id,u.username,u.role,s.csrf,s.token_hash FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0",
  )
    .bind(digest(value), Date.now())
    .first();
}
async function settings(env) {
  const row = await env.DB.prepare(
    "SELECT version,policy FROM auth_settings WHERE id=1",
  ).first();
  return row
    ? { version: row.version, policy: validatePolicy(JSON.parse(row.policy)) }
    : { version: 0, policy: structuredClone(defaultPolicy) };
}
async function access(env, user) {
  if (!user) return null;
  if (user.role === "admin")
    return { version: 0, permissions: structuredClone(fullPermissions) };
  const row = await env.DB.prepare(
    "SELECT version,permissions FROM auth_permissions WHERE user_id=?",
  )
    .bind(user.id)
    .first();
  return row
    ? {
        version: row.version,
        permissions: validatePermissions(JSON.parse(row.permissions)),
      }
    : { version: 0, permissions: structuredClone(fullPermissions) };
}
function sameOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    fail("Yêu cầu khác nguồn bị từ chối.", 403);
}
async function audit(env, user, action, target) {
  await env.DB.prepare(
    "INSERT INTO auth_audit(actor,action,target,created_at) VALUES(?,?,?,?)",
  )
    .bind(user.id, action, target, Date.now())
    .run();
}
async function api(request, env, path, user) {
  if (path === "/api/auth/session" && request.method === "GET") {
    const guest = await settings(env),
      account = await access(env, user);
    return json({
      user: publicUser(user),
      csrf: user?.csrf || null,
      version: guest.version,
      accessVersion: account?.version || 0,
      tabs: account?.permissions.tabs || ["inspection", "dimensionocr", "moldmaintenance"],
      policy: account?.permissions.inspection || guest.policy,
      ...(user?.role === "admin" ? { guestPolicy: guest.policy } : {}),
    });
  }
  if (request.method !== "GET" && path !== "/api/tms/push") sameOrigin(request);
  if (path === "/api/auth/login" && request.method === "POST") {
    const data = await body(request),
      username = String(data.username || "")
        .trim()
        .toLowerCase();
    if (
      username.length > 100 ||
      typeof data.password !== "string" ||
      data.password.length > 256
    )
      fail("Tên đăng nhập hoặc mật khẩu không đúng.", 401);
    // Atomic buckets limit both distributed guesses for one account and many accounts from one IP.
    const window = Math.floor(Date.now() / 900000),
      ip = request.headers.get("cf-connecting-ip") || "local";
    const limits = await env.DB.batch(
      [
        ["ip:" + ip, 30],
        ["user:" + username, 10],
      ].map(([key]) =>
        env.DB.prepare(
          "INSERT INTO auth_rate_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
        ).bind(digest(key + ":" + window), Date.now() + 900000),
      ),
    );
    if (limits.some((r, i) => r.results[0].attempts > [30, 10][i]))
      fail("Thử quá nhiều lần. Vui lòng thử lại sau 15 phút.", 429);
    const account = await env.DB.prepare(
      "SELECT * FROM auth_users WHERE username=?",
    )
      .bind(username)
      .first();
    const valid = await passwordMatches(
      data.password,
      account?.password_hash ||
        "scrypt$16384$8$5$00000000000000000000000000000000$" + "0".repeat(64),
    );
    if (!valid || !account || account.disabled)
      fail("Tên đăng nhập hoặc mật khẩu không đúng.", 401);
    const raw = token(),
      csrf = token();
    const loginWrites = await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<?").bind(
        Date.now(),
      ),
      env.DB.prepare("DELETE FROM auth_rate_limits WHERE expires_at<?").bind(
        Date.now(),
      ),
      env.DB.prepare(
        "INSERT INTO auth_sessions SELECT ?,id,?,? FROM auth_users WHERE id=? AND password_hash=? AND disabled=0",
      ).bind(
        digest(raw),
        csrf,
        Date.now() + 8 * 3600000,
        account.id,
        account.password_hash,
      ),
    ]);
    // Do not issue a session if the account was locked/reset while the KDF was running.
    if (loginWrites[2].meta.changes !== 1)
      fail("Tên đăng nhập hoặc mật khẩu không đúng.", 401);
    return json({ user: publicUser(account), csrf }, 200, {
      "Set-Cookie": `${cookieName}=${raw}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`,
    });
  }
  // Public TMS Data & Sync APIs (cho phép truy cập trực tiếp từ Nút Refresh & Auto Timer)
  if (path === "/api/tms/push" && request.method === "POST") {
    // Xác thực secret token an toàn của bot cào local
    const pushToken = request.headers.get("x-tms-sync-key");
    const EXPECTED_KEY = "iriso-tms-sync-secret-2026";
    if (pushToken !== EXPECTED_KEY) {
      fail("Không có quyền đồng bộ dữ liệu TMS.", 403);
    }
    const incomingData = await body(request, 10 * 1024 * 1024); // Cho phép gói dữ liệu TMS lên tới 10MB
    if (!incomingData || !incomingData.records) {
      fail("Dữ liệu gửi lên không đúng định dạng.", 400);
    }
    await saveTmsDataToD1(env, incomingData);
    return json({
      ok: true,
      message: `Đã cập nhật ${incomingData.records.length} máy và lưu an toàn vào Cloudflare D1`,
      updatedAt: incomingData.lastUpdated || new Date().toISOString()
    });
  }
  if (path === "/api/tms/data" && request.method === "GET") {
    let cached = await getLatestTmsDataFromD1(env);
    const assetRes = await env.ASSETS.fetch(new Request("https://localhost/data/mold-maintenance-data.json"));
    let assetData = null;
    if (assetRes.ok) {
      try { assetData = await assetRes.json(); } catch {}
    }
    // Nếu D1 hợp lệ và có chứa records + excelMasterMolds thì ưu tiên D1
    if (cached && Array.isArray(cached.records) && cached.records.length > 0 && Array.isArray(cached.excelMasterMolds) && cached.excelMasterMolds.length > 0) {
      return json(cached);
    }
    // Nếu D1 chưa có hoặc bị rỗng (do bot mới khởi tạo), fallback ngay về static asset JSON chuẩn
    if (assetData && Array.isArray(assetData.records) && assetData.records.length > 0) {
      // Bổ sung số liệu live từ D1 nếu có
      if (cached && Array.isArray(cached.records) && cached.records.length > 0) {
        assetData.records = cached.records;
        assetData.runningMachines = cached.runningMachines;
        assetData.totalShotsToday = cached.totalShotsToday;
        assetData.totalOutputToday = cached.totalOutputToday;
      }
      return json(assetData);
    }
    if (cached) return json(cached);
    if (assetData) return json(assetData);
    return json({ records: [], totalShotsToday: 0 });
  }
  if (path === "/api/tms/security" && request.method === "GET") {
    return json(getTmsSecurityMetadata());
  }

  if (!user) fail("Vui lòng đăng nhập.", 401);
  if (
    request.method !== "GET" &&
    !equal(request.headers.get("x-csrf-token"), user.csrf)
  )
    fail("Phiên thao tác không hợp lệ. Hãy tải lại trang.", 403);
  if (path === "/api/tms/sync" && request.method === "POST") {
    const result = await syncTmsOnCloud(env);
    return json(result);
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .bind(user.token_hash)
      .run();
    return json({ ok: true }, 200, {
      "Set-Cookie": `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`,
    });
  }
  if (path === "/api/auth/password" && request.method === "POST") {
    const data = await body(request),
      account = await env.DB.prepare(
        "SELECT password_hash FROM auth_users WHERE id=?",
      )
        .bind(user.id)
        .first();
    if (!passwordValid(data.password))
      fail("Mật khẩu cần ít nhất 10 ký tự, tối đa 256 byte.");
    if (!(await passwordMatches(data.currentPassword, account.password_hash)))
      fail("Mật khẩu hiện tại không đúng.", 403);
    await env.DB.batch([
      env.DB.prepare("UPDATE auth_users SET password_hash=? WHERE id=?").bind(
        await passwordHash(data.password),
        user.id,
      ),
      env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.id),
    ]);
    await audit(env, user, "password-change", user.id);
    return json({ ok: true });
  }

    if (path === "/api/molds/create" && request.method === "POST") {
    sameOrigin(request);
    if (!user || (user.role !== "admin" && user.role !== "staff")) {
      fail("Chỉ tài khoản admin hoặc staff mới có quyền thêm khuôn mới.", 403);
    }
    const newMold = await body(request);
    if (!newMold || !newMold.mold) fail("Mã khuôn không được để trống.", 400);

    let currentData = await getLatestTmsDataFromD1(env);
    if (!currentData) {
      const assetRes = await env.ASSETS.fetch(new Request("https://localhost/data/mold-maintenance-data.json"));
      if (assetRes.ok) currentData = await assetRes.json();
    }
    if (!currentData) currentData = { excelMasterMolds: [], records: [] };
    if (!currentData.excelMasterMolds) currentData.excelMasterMolds = [];

    const moldEntry = {
      mold: String(newMold.mold).trim().toUpperCase(),
      series: String(newMold.series || '').trim(),
      is_high_impact: !!newMold.is_high_impact,
      total_last_year: 0,
      rem_last_year: 0,
      months: { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0, M7: 0, M8: 0, M9: 0, M10: 0, M11: 0, M12: 0 },
      m1_800k: Math.round(Number(newMold.m1_800k) || 0),
      m2_800k: Math.round(Number(newMold.m2_800k) || 0),
      m3_800k: Math.round(Number(newMold.m3_800k) || 0),
      total_life: Math.round(Number(newMold.total_life) || 0),
      machineNo: newMold.machineNo || '-',
      cavity: Number(newMold.cavity) || 4,
      note: newMold.note || '',
      createdAt: new Date().toISOString(),
      createdBy: user.username
    };

    const existingIdx = currentData.excelMasterMolds.findIndex(
      m => (m.mold || '').toUpperCase() === moldEntry.mold ||
           (m.oldMold && m.oldMold.toUpperCase() === moldEntry.mold) ||
           (m.newMold && m.newMold.toUpperCase() === moldEntry.mold)
    );
    if (existingIdx >= 0) {
      currentData.excelMasterMolds[existingIdx] = {
        ...currentData.excelMasterMolds[existingIdx],
        ...moldEntry
      };
    } else {
      currentData.excelMasterMolds.unshift(moldEntry);
    }

    await saveTmsDataToD1(env, currentData);
    await audit(env, user, "create-mold", moldEntry.mold);
    return json({ ok: true, mold: moldEntry, message: `Đã thêm khuôn ${moldEntry.mold} thành công!` });
  }

  // Cập nhật trạng thái mốc (chốt tích xanh) hoặc ghi chú (note) cho khuôn
  if (path === "/api/molds/update" && request.method === "POST") {
    sameOrigin(request);
    if (!user || (user.role !== "admin" && user.role !== "staff")) {
      fail("Chỉ tài khoản admin hoặc staff mới có quyền cập nhật khuôn.", 403);
    }
    const updateReq = await body(request);
    if (!updateReq || !updateReq.mold) fail("Mã khuôn không được để trống.", 400);

    let currentData = await getLatestTmsDataFromD1(env);
    if (!currentData) {
      const assetRes = await env.ASSETS.fetch(new Request("https://localhost/data/mold-maintenance-data.json"));
      if (assetRes.ok) currentData = await assetRes.json();
    }
    if (!currentData) currentData = { excelMasterMolds: [], records: [] };
    if (!currentData.excelMasterMolds) currentData.excelMasterMolds = [];

    const moldCode = String(updateReq.mold).trim().toUpperCase();
    const moldItem = currentData.excelMasterMolds.find(m => 
      (m.mold || '').toUpperCase() === moldCode ||
      (m.oldMold && m.oldMold.toUpperCase() === moldCode) ||
      (m.newMold && m.newMold.toUpperCase() === moldCode)
    );
    const previouslyCompleted = new Set(moldItem?.completedMilestones || []);
    if (moldItem) {
      if (typeof updateReq.note === 'string') moldItem.note = updateReq.note.trim();
      if (Array.isArray(updateReq.completedMilestones)) moldItem.completedMilestones = updateReq.completedMilestones;
      if (updateReq.milestonePdfs && typeof updateReq.milestonePdfs === 'object') {
        if (!moldItem.milestonePdfs) moldItem.milestonePdfs = {};
        Object.assign(moldItem.milestonePdfs, updateReq.milestonePdfs);
      }
      if (updateReq.milestoneDetails && typeof updateReq.milestoneDetails === 'object') {
        if (!moldItem.milestoneDetails) moldItem.milestoneDetails = {};
        Object.assign(moldItem.milestoneDetails, updateReq.milestoneDetails);
      }
      if (typeof updateReq.closedMilestone === 'number') {
        if (!moldItem.completedMilestones) moldItem.completedMilestones = [];
        if (!moldItem.completedMilestones.includes(updateReq.closedMilestone)) {
          moldItem.completedMilestones.push(updateReq.closedMilestone);
        }
      }
      moldItem.updatedAt = new Date().toISOString();
      moldItem.updatedBy = user.username;
    }

    // Đồng bộ sang records nếu máy đang gá khuôn này (khớp cả mã mới và mã cũ)
    const recItem = (currentData.records || []).find(r => {
      const rCode = (r.moldNo || '').toUpperCase();
      return rCode === moldCode || (moldItem && (
        (moldItem.mold && moldItem.mold.toUpperCase() === rCode) ||
        (moldItem.oldMold && moldItem.oldMold.toUpperCase() === rCode) ||
        (moldItem.newMold && moldItem.newMold.toUpperCase() === rCode)
      ));
    });
    if (recItem) {
      if (typeof updateReq.note === 'string') recItem.note = updateReq.note.trim();
      if (Array.isArray(updateReq.completedMilestones)) {
        recItem.completedMilestones = updateReq.completedMilestones;
        const newlyClosed = updateReq.completedMilestones.find(milestone => !previouslyCompleted.has(milestone));
        if (newlyClosed === Number(recItem.currentCycleNum) || newlyClosed === (previouslyCompleted.size + 1)) {
          recItem._tmsCycleBaseShots = 0;
          recItem.currentCycleShots = Number(recItem.todayShots) || 0;
        }
      }
    }

    await saveTmsDataToD1(env, currentData);
    await audit(env, user, "update-mold", moldCode);
    return json({ ok: true, mold: moldCode, message: "Đã cập nhật trạng thái mốc khuôn thành công!" });
  }
  if (user.role !== "admin") fail("Chỉ admin được thao tác.", 403);
  if (path === "/api/admin/settings" && request.method === "PUT") {
    const data = await body(request),
      policy = validatePolicy(data.policy);
    await env.DB.prepare("INSERT OR IGNORE INTO auth_settings VALUES(1,0,?)")
      .bind(JSON.stringify(defaultPolicy))
      .run();
    const result = await env.DB.prepare(
      "UPDATE auth_settings SET version=version+1,policy=? WHERE id=1 AND version=?",
    )
      .bind(JSON.stringify(policy), data.version)
      .run();
    if (result.meta.changes !== 1)
      fail("Cấu hình đã được thay đổi. Tải lại trang trước khi lưu.", 409);
    await audit(env, user, "guest-policy", "1");
    return json({ version: data.version + 1, guestPolicy: policy });
  }
  if (path === "/api/admin/users" && request.method === "GET") {
    const users = (
      await env.DB.prepare(
        "SELECT id,username,role,disabled,created_at FROM auth_users ORDER BY created_at",
      ).all()
    ).results;
    return json(
      await Promise.all(
        users.map(async (account) => ({
          ...account,
          ...(await access(env, account)),
        })),
      ),
    );
  }
  if (path === "/api/admin/users" && request.method === "POST") {
    const data = await body(request),
      username = String(data.username || "")
        .trim()
        .toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.@+-]{2,99}$/.test(username))
      fail("Username cần 3–100 ký tự: chữ, số, dấu . _ @ + -");
    if (!passwordValid(data.password))
      fail("Mật khẩu cần ít nhất 10 ký tự, tối đa 256 byte.");
    if (
      await env.DB.prepare("SELECT id FROM auth_users WHERE username=?")
        .bind(username)
        .first()
    )
      fail("Username đã tồn tại.", 409);
    const id = crypto.randomUUID();
    const permissions = data.permissions
      ? validatePermissions(data.permissions)
      : { tabs: [], inspection: structuredClone(fullPolicy) };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO auth_users VALUES(?,?,?,'staff',0,?)").bind(
        id,
        username,
        await passwordHash(data.password),
        Date.now(),
      ),
      env.DB.prepare(
        "INSERT INTO auth_permissions(user_id,version,permissions) VALUES(?,0,?)",
      ).bind(id, JSON.stringify(permissions)),
    ]);
    await audit(env, user, "create-staff", id);
    return json({ ok: true }, 201);
  }
  if (path.startsWith("/api/admin/users/") && request.method === "DELETE") {
    const id = path.slice("/api/admin/users/".length),
      data = await body(request);
    const target = await env.DB.prepare(
      "SELECT id,username,role FROM auth_users WHERE id=?",
    )
      .bind(id)
      .first();
    if (!target) fail("Không tìm thấy tài khoản.", 404);
    if (target.role === "admin" || id === user.id)
      fail("Không thể xóa tài khoản admin.", 403);
    if (data.confirmUsername !== target.username)
      fail("Nhập đúng username để xác nhận xóa vĩnh viễn.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(id),
      env.DB.prepare("DELETE FROM auth_permissions WHERE user_id=?").bind(id),
      env.DB.prepare("DELETE FROM auth_users WHERE id=? AND role='staff'").bind(
        id,
      ),
    ]);
    await audit(env, user, "delete-staff", id);
    return json({ ok: true });
  }
  if (
    path.startsWith("/api/admin/users/") &&
    path.endsWith("/permissions") &&
    request.method === "PUT"
  ) {
    const id = path.slice("/api/admin/users/".length, -"/permissions".length),
      data = await body(request);
    const target = await env.DB.prepare(
      "SELECT id,role FROM auth_users WHERE id=?",
    )
      .bind(id)
      .first();
    if (!target) fail("Không tìm thấy tài khoản.", 404);
    if (target.role === "admin") fail("Admin luôn có toàn quyền.", 403);
    const permissions = validatePermissions(data.permissions);
    await env.DB.prepare("INSERT OR IGNORE INTO auth_permissions VALUES(?,0,?)")
      .bind(id, JSON.stringify(fullPermissions))
      .run();
    const result = await env.DB.prepare(
      "UPDATE auth_permissions SET permissions=?,version=version+1 WHERE user_id=? AND version=?",
    )
      .bind(JSON.stringify(permissions), id, data.version)
      .run();
    if (result.meta.changes !== 1)
      fail("Quyền đã thay đổi. Mở lại tài khoản trước khi lưu.", 409);
    await audit(env, user, "account-permissions", id);
    return json({ ok: true });
  }
  if (path.startsWith("/api/admin/users/") && request.method === "PATCH") {
    const id = path.slice("/api/admin/users/".length),
      data = await body(request);
    const target = await env.DB.prepare(
      "SELECT id,role FROM auth_users WHERE id=?",
    )
      .bind(id)
      .first();
    if (!target) fail("Không tìm thấy tài khoản.", 404);
    if (target.role === "admin")
      fail("Tài khoản admin đổi mật khẩu trong mục tài khoản cá nhân.", 403);
    if (typeof data.disabled === "boolean")
      await env.DB.prepare("UPDATE auth_users SET disabled=? WHERE id=?")
        .bind(Number(data.disabled), id)
        .run();
    else if (passwordValid(data.password))
      await env.DB.prepare("UPDATE auth_users SET password_hash=? WHERE id=?")
        .bind(await passwordHash(data.password), id)
        .run();
    else fail("Mật khẩu cần ít nhất 10 ký tự.");
    await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?")
      .bind(id)
      .run();
    await audit(env, user, "update-staff", id);
    return json({ ok: true });
  }
  if (path === "/api/tms/data" && request.method === "GET") {
    let cached = await getLatestTmsDataFromD1(env);
    const assetRes = await env.ASSETS.fetch(new Request("https://localhost/data/mold-maintenance-data.json"));
    let assetData = null;
    if (assetRes.ok) {
      try { assetData = await assetRes.json(); } catch {}
    }
    // Nếu D1 hợp lệ và có chứa records + excelMasterMolds thì ưu tiên D1
    if (cached && Array.isArray(cached.records) && cached.records.length > 0 && Array.isArray(cached.excelMasterMolds) && cached.excelMasterMolds.length > 0) {
      return json(cached);
    }
    // Nếu D1 chưa có hoặc bị rỗng (do bot mới khởi tạo), fallback ngay về static asset JSON chuẩn
    if (assetData && Array.isArray(assetData.records) && assetData.records.length > 0) {
      // Bổ sung số liệu live từ D1 nếu có
      if (cached && Array.isArray(cached.records) && cached.records.length > 0) {
        assetData.records = cached.records;
        assetData.runningMachines = cached.runningMachines;
        assetData.totalShotsToday = cached.totalShotsToday;
        assetData.totalOutputToday = cached.totalOutputToday;
      }
      return json(assetData);
    }
    if (cached) return json(cached);
    if (assetData) return json(assetData);
    return json({ records: [], totalShotsToday: 0 });
  }
  if (path === "/api/tms/security" && request.method === "GET") {
    return json(getTmsSecurityMetadata());
  }
  fail("Không tìm thấy API.", 404);
}
function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(syncTmsOnCloud(env));
  },
  async fetch(request, env) {
    try {
      const url = new URL(request.url),
        path = decodeURIComponent(url.pathname);
      if (path !== url.pathname || path.includes("\\"))
        return json({ error: "Đường dẫn không hợp lệ." }, 400);
      if (
        !["GET", "HEAD"].includes(request.method) &&
        !path.startsWith("/api/")
      )
        return json({ error: "Method not allowed" }, 405);
      if (
        !path.startsWith("/api/") &&
        !path.startsWith("/data/") &&
        !path.startsWith("/dimension-ocr/") &&
        path !== "/ComponentMaster.json" &&
        !/\.(xlsx|xlsm|pdf|csv|sql|toml|ps1)$/i.test(path)
      )
        return env.ASSETS.fetch(request);
      // Read-only deployment verifier. It cannot call account or settings APIs.
      if (
        !path.startsWith("/api/") &&
        env.PUBLISH_VERIFY_TOKEN &&
        equal(
          request.headers.get("authorization"),
          `Bearer ${env.PUBLISH_VERIFY_TOKEN}`,
        )
      )
        return privateResponse(await env.ASSETS.fetch(request));
      if (!env.DB)
        return json({ error: "Chưa cấu hình database tài khoản." }, 503);
      const user = await session(request, env);
      if (path.startsWith("/api/")) return await api(request, env, path, user);
      const account = await access(env, user);
      const tabs = account?.permissions.tabs || ["inspection", "dimensionocr", "moldmaintenance"];
      if (path === "/data/mold-maintenance-data.json") {
        const d1Data = await getLatestTmsDataFromD1(env);
        const hasFullD1 = d1Data && Array.isArray(d1Data.records) && d1Data.records.length > 0 && Array.isArray(d1Data.excelMasterMolds) && d1Data.excelMasterMolds.length > 0;
        if (hasFullD1) return json(d1Data);

        // Fallback to static asset and overlay live records from D1 if available
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.ok) {
          const assetData = await assetRes.json();
          if (d1Data && Array.isArray(d1Data.records) && d1Data.records.length > 0) {
            assetData.records = d1Data.records;
            assetData.runningMachines = d1Data.runningMachines;
            assetData.totalShotsToday = d1Data.totalShotsToday;
            assetData.totalOutputToday = d1Data.totalOutputToday;
            assetData.lastUpdated = d1Data.lastUpdated;
          }
          return json(assetData);
        }
        if (d1Data) return json(d1Data);
        return privateResponse(assetRes);
      }
      if (
        path === "/data/MOCKUP_THEO_DOI_SHOT_VA_BAO_DUONG_KHUON.xlsx" ||
        path === "/data/MMFD-I-F-022.01_Template.xlsx"
      )
        return privateResponse(await env.ASSETS.fetch(request));
      if (path.startsWith("/dimension-ocr/"))
        return tabs.includes("dimensionocr")
          ? privateResponse(await env.ASSETS.fetch(request))
          : json({ error: "Chưa được cấp quyền tab IQC." }, 403);
      if (user?.role === "admin")
        return privateResponse(await env.ASSETS.fetch(request));
      if (path.startsWith("/data/inspection/") && !tabs.includes("inspection"))
        return json({ error: "Chưa được cấp quyền tab Đo linh kiện." }, 403);
      if (
        user &&
        (path === "/ComponentMaster.json" ||
          [
            "/data/shoot-data.json",
            "/data/replacement-log.json",
            "/data/stock-data.json",
          ].includes(path)) &&
        tabs.some((tab) =>
          ["overview", "month", "stock", "chart"].includes(tab),
        )
      )
        return privateResponse(await env.ASSETS.fetch(request));
      const policy =
        account?.permissions.inspection || (await settings(env)).policy;
      if (path === "/data/version.json") {
        const response = await env.ASSETS.fetch(request);
        if (!response.ok) return privateResponse(response);
        const { schemaVersion, snapshotId, dataVersion, codeVersion } =
          await response.json();
        return json({ schemaVersion, snapshotId, dataVersion, codeVersion });
      }
      if (
        path === "/data/inspection/summary.json" ||
        /^\/data\/inspection\/detail-[a-f0-9-]+\.json$/.test(path)
      ) {
        const response = await env.ASSETS.fetch(request);
        if (!response.ok) return privateResponse(response);
        const data = await response.json();
        return json(
          path.endsWith("/summary.json")
            ? projectSummary(data, policy)
            : projectDetails(data, policy),
        );
      }
      if (
        path === "/data/inspection/downloads.json" &&
        (policy.downloadExcel || policy.downloadPDF)
      ) {
        const response = await env.ASSETS.fetch(request);
        if (!response.ok) return privateResponse(response);
        const data = await response.json();
        return json({
          ...data,
          excel: policy.downloadExcel ? data.excel : {},
          reportTemplate: policy.downloadExcel ? data.reportTemplate : null,
          pdf: policy.downloadPDF ? data.pdf : {},
        });
      }
      if (
        /^\/data\/inspection\/drawings\//.test(path) &&
        policy.previewDrawing &&
        policy.records.includes("drawing")
      )
        return privateResponse(await env.ASSETS.fetch(request));
      if (
        /^\/data\/inspection\/downloads\/[a-f0-9]{64}\.pdf$/.test(path) &&
        policy.downloadPDF
      )
        return privateResponse(await env.ASSETS.fetch(request));
      if (
        /^\/data\/inspection\/downloads\/[a-f0-9]{64}\.(xlsx|xlsm)$/.test(
          path,
        ) &&
        policy.downloadExcel
      )
        return privateResponse(await env.ASSETS.fetch(request));
      return json({ error: "Dữ liệu này cần đăng nhập." }, 403);
    } catch (error) {
      if (!error.status) console.error("Request failed:", error.message);
      return json(
        {
          error: error.status
            ? error.message
            : "Dịch vụ tài khoản tạm thời không khả dụng.",
        },
        error.status || 503,
      );
    }
  },
};
