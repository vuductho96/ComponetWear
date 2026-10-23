const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
function findMiniflare() {
  if (process.env.MINIFLARE_PATH) return require(process.env.MINIFLARE_PATH);
  const cache = path.join(process.env.LOCALAPPDATA, "npm-cache", "_npx");
  for (const folder of fs.readdirSync(cache)) {
    const file = path.join(cache, folder, "node_modules", "miniflare");
    if (fs.existsSync(file)) return require(file);
  }
  throw Error("Install Wrangler 4.86.0 to run workerd integration tests.");
}
test("D1 accounts, sessions, cloud policy and direct asset authorization in workerd", async () => {
  const { Miniflare } = findMiniflare();
  const summary = {
    schemaVersion: 1,
    generatedAt: "2026-10-23",
    records: [
      {
        id: "a",
        file: "Inspection test.xlsx",
        part: "test",
        mold: "M",
        detailFile: "detail-01.json",
        drawings: [],
        quality: "NG",
        ngSamples: 1,
        points: 1,
        samples: 1,
        lot: "private-folder",
      },
    ],
  };
  const details = { a: [[1, "90°", -0.5, 0.5, 1, "92°", 89.5, 90.5, 2, "NG"]] };
  const assets = {
    "/data/inspection/summary.json": summary,
    "/data/inspection/detail-01.json": details,
    "/data/inspection/downloads.json": {
      excel: { a: { url: "secret.xlsx" } },
      pdf: { drawing: { url: "drawing.pdf" } },
      reportTemplate: { url: "template.xlsx" },
    },
    "/data/version.json": { snapshotId: "test", files: ["secret"] },
    "/data/stock-data.json": { secret: "business" },
  };
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(root, "cloud/worker.mjs"),
    compatibilityDate: "2026-05-03",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: { PUBLISH_VERIFY_TOKEN: "test-verifier" },
    serviceBindings: {
      ASSETS: (request) => {
        const key = new URL(request.url).pathname;
        return assets[key]
          ? Response.json(assets[key])
          : new Response("asset", {
              headers: { "Content-Type": "text/plain" },
            });
      },
    },
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const sql of fs
      .readFileSync(path.join(root, "cloud/migrations/0001_auth.sql"), "utf8")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
    for (const sql of fs
      .readFileSync(
        path.join(root, "cloud/migrations/0002_permissions.sql"),
        "utf8",
      )
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
    const { passwordHash } = await import("../cloud/auth-crypto.mjs");
    await db
      .prepare("INSERT INTO auth_users VALUES(?,?,?,'admin',0,?)")
      .bind(
        "admin",
        "vuductho.th@gmail.com",
        await passwordHash("AdminPassword-test-123"),
        Date.now(),
      )
      .run();
    const call = (url, method = "GET", data, extra = {}) =>
      mf.dispatchFetch("https://local.test" + url, {
        method,
        headers: {
          Origin: "https://local.test",
          "Content-Type": "application/json",
          ...extra,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    let response = await call("/data/inspection/summary.json"),
      data = await response.json();
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(data.records[0].quality, undefined);
    assert.equal(data.records[0].lot, undefined);
    data = await (await call("/data/inspection/detail-01.json")).json();
    assert.equal(data.a[0][5], null);
    assert.equal(data.a[0][9], null);
    assert.equal((await call("/data/stock-data.json")).status, 403);
    assert.equal(
      (await call("/data/inspection/downloads/" + "a".repeat(64) + ".xlsx"))
        .status,
      403,
    );
    assert.equal(
      (await call("/data/inspection/downloads/" + "a".repeat(64) + ".pdf"))
        .status,
      200,
    );
    assert.equal((await call("/api/admin/users")).status, 401);
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "vuductho.th@gmail.com",
          password: "wrong",
        })
      ).status,
      401,
    );
    response = await call("/api/auth/login", "POST", {
      username: "vuductho.th@gmail.com",
      password: "AdminPassword-test-123",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const admin = await response.json(),
      cookie = response.headers.get("set-cookie").split(";")[0],
      headers = { Cookie: cookie, "X-CSRF-Token": admin.csrf };
    assert.match(
      response.headers.get("set-cookie"),
      /Secure; HttpOnly; SameSite=Strict/,
    );
    const stored = await db
      .prepare("SELECT token_hash FROM auth_sessions")
      .first();
    assert.notEqual(stored.token_hash, cookie.split("=")[1]);
    assert.equal(
      (await call("/data/stock-data.json", "GET", null, headers)).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users",
          "POST",
          { username: "staff1", password: "StaffPassword-test-123" },
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users",
          "POST",
          { username: "staff1", password: "StaffPassword-test-123" },
          headers,
        )
      ).status,
      201,
    );
    response = await call("/api/auth/login", "POST", {
      username: "staff1",
      password: "StaffPassword-test-123",
    });
    assert.equal(response.status, 200);
    const staff = await response.json(),
      staffHeaders = {
        Cookie: response.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": staff.csrf,
      };
    assert.equal(
      (await call("/api/admin/users", "GET", null, staffHeaders)).status,
      403,
    );
    const policy = {
      records: ["file", "part"],
      details: ["point", "sample"],
      previewDrawing: false,
      downloadPDF: false,
      downloadExcel: false,
    };
    assert.equal(
      (
        await call(
          "/api/admin/settings",
          "PUT",
          { version: 0, policy },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin/settings",
          "PUT",
          { version: 0, policy },
          headers,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "/api/admin/settings",
          "PUT",
          { version: 1, policy: { ...policy, downloadExcel: true } },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/data/inspection/downloads/" + "a".repeat(64) + ".pdf"))
        .status,
      403,
    );
    assert.deepEqual(
      (await (await call("/api/auth/session")).json()).policy,
      policy,
    );
    const users = await (
        await call("/api/admin/users", "GET", null, headers)
      ).json(),
      staffId = users.find((u) => u.username === "staff1").id;
    const permissionsUrl = "/api/admin/users/" + staffId + "/permissions";
    const limited = { tabs: ["inspection"], inspection: policy };
    assert.equal(
      (
        await call(
          permissionsUrl,
          "PUT",
          { version: 0, permissions: limited },
          staffHeaders,
        )
      ).status,
      403,
      "Staff cannot grant their own tabs",
    );
    assert.equal(
      (
        await call(
          permissionsUrl,
          "PUT",
          { version: 0, permissions: limited },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          permissionsUrl,
          "PUT",
          { version: 0, permissions: limited },
          headers,
        )
      ).status,
      409,
    );
    let staffSession = await (
      await call("/api/auth/session", "GET", null, staffHeaders)
    ).json();
    assert.deepEqual(staffSession.tabs, ["inspection"]);
    assert.deepEqual(staffSession.policy, policy);
    assert.equal(
      (await call("/data/stock-data.json", "GET", null, staffHeaders)).status,
      403,
    );
    assert.equal(
      (await call("/dimension-ocr/index.html", "GET", null, staffHeaders))
        .status,
      403,
    );
    assert.equal((await call("/dimension-ocr/index.html")).status, 200);
    assert.equal(
      (
        await (
          await call(
            "/data/inspection/detail-01.json",
            "GET",
            null,
            staffHeaders,
          )
        ).json()
      ).a[0][9],
      null,
    );
    const { fullPermissions } = await import("../cloud/policy.mjs");
    assert.equal(
      (
        await call(
          permissionsUrl,
          "PUT",
          { version: 1, permissions: fullPermissions },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/data/stock-data.json", "GET", null, staffHeaders)).status,
      200,
    );
    assert.equal(
      (
        await (
          await call(
            "/data/inspection/detail-01.json",
            "GET",
            null,
            staffHeaders,
          )
        ).json()
      ).a[0][9],
      "NG",
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "PATCH",
          { disabled: true },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/auth/session", "GET", null, staffHeaders)).status,
      200,
    );
    assert.equal(
      (
        await (
          await call("/api/auth/session", "GET", null, staffHeaders)
        ).json()
      ).user,
      null,
    );
    assert.equal(
      (await call("/data/stock-data.json", "GET", null, staffHeaders)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "PATCH",
          { disabled: false },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "PATCH",
          { password: "NewPassword-test-123" },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "staff1",
          password: "StaffPassword-test-123",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "staff1",
          password: "NewPassword-test-123",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/admin",
          "PATCH",
          { disabled: true },
          headers,
        )
      ).status,
      403,
    );
    const deletionLogin = await call("/api/auth/login", "POST", {
      username: "staff1",
      password: "NewPassword-test-123",
    });
    const deletionSession = await deletionLogin.json(),
      deletionHeaders = {
        Cookie: deletionLogin.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": deletionSession.csrf,
      };
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "DELETE",
          { confirmUsername: "staff1" },
          deletionHeaders,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/admin",
          "DELETE",
          { confirmUsername: "vuductho.th@gmail.com" },
          headers,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "DELETE",
          { confirmUsername: "wrong" },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users/" + staffId,
          "DELETE",
          { confirmUsername: "staff1" },
          headers,
        )
      ).status,
      200,
    );
    for (const [table, column] of [
      ["auth_users", "id"],
      ["auth_permissions", "user_id"],
      ["auth_sessions", "user_id"],
    ])
      assert.equal(
        (
          await db
            .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`)
            .bind(staffId)
            .first()
        ).n,
        0,
      );
    assert.equal(
      (
        await (
          await call("/api/auth/session", "GET", null, deletionHeaders)
        ).json()
      ).user,
      null,
    );
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "staff1",
          password: "NewPassword-test-123",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/api/admin/users",
          "POST",
          {
            username: "staff1",
            password: "RecreatedPassword-123",
            permissions: { ...fullPermissions, tabs: [] },
          },
          headers,
        )
      ).status,
      201,
    );
    const recreatedLogin = await call("/api/auth/login", "POST", {
        username: "staff1",
        password: "RecreatedPassword-123",
      }),
      recreated = await recreatedLogin.json();
    assert.notEqual(recreated.user.id, staffId);
    const recreatedHeaders = {
      Cookie: recreatedLogin.headers.get("set-cookie").split(";")[0],
    };
    assert.deepEqual(
      (
        await (
          await call("/api/auth/session", "GET", null, recreatedHeaders)
        ).json()
      ).tabs,
      [],
    );
    assert.equal(
      (
        await call(
          "/data/inspection/summary.json",
          "GET",
          null,
          recreatedHeaders,
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/data/stock-data.json", "GET", null, recreatedHeaders))
        .status,
      403,
    );
    assert.equal(
      (await call("/api/auth/logout", "POST", {}, headers)).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/users", "GET", null, headers)).status,
      401,
    );
    assert.equal(
      (
        await call("/data/stock-data.json", "GET", null, {
          Authorization: "Bearer test-verifier",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/admin/users", "GET", null, {
          Authorization: "Bearer test-verifier",
        })
      ).status,
      401,
    );
    for (let i = 0; i < 10; i++)
      await call("/api/auth/login", "POST", {
        username: "missing",
        password: "wrong",
      });
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "missing",
          password: "wrong",
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await call(
          "/api/auth/login",
          "POST",
          { username: "staff1", password: "NewPassword-test-123" },
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
  } finally {
    await mf.dispose();
  }
});
