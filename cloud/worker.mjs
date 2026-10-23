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
} from "./policy.mjs";

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
async function body(request) {
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
    if (size > 8192) {
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
  if (path === "/api/auth/session" && request.method === "GET")
    return json({
      user: publicUser(user),
      csrf: user?.csrf || null,
      ...(await settings(env)),
    });
  if (request.method !== "GET") sameOrigin(request);
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
  if (!user) fail("Vui lòng đăng nhập.", 401);
  if (
    request.method !== "GET" &&
    !equal(request.headers.get("x-csrf-token"), user.csrf)
  )
    fail("Phiên thao tác không hợp lệ. Hãy tải lại trang.", 403);
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
    return json({ version: data.version + 1, policy });
  }
  if (path === "/api/admin/users" && request.method === "GET")
    return json(
      (
        await env.DB.prepare(
          "SELECT id,username,role,disabled,created_at FROM auth_users ORDER BY created_at",
        ).all()
      ).results,
    );
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
    await env.DB.prepare("INSERT INTO auth_users VALUES(?,?,?,'staff',0,?)")
      .bind(id, username, await passwordHash(data.password), Date.now())
      .run();
    await audit(env, user, "create-staff", id);
    return json({ ok: true }, 201);
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
      if (user) return privateResponse(await env.ASSETS.fetch(request));
      const { policy } = await settings(env);
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
