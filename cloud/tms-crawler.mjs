import { getDecryptedTmsCredentials, getTmsSecurityMetadata } from "./tms-crypto.mjs";

const TMS_BASE_URL = "http://iriso.tmssmart.vn";

// User-Agent & Headers chuẩn trình duyệt Chrome trên Windows để Trend Micro / WAF không chặn
const HUMAN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Connection": "keep-alive"
};

const sleep = ms => new Promise(res => setTimeout(res, ms));

/**
 * Thu thập dữ liệu thực tế từ TMS Smart an toàn (Human-like delays, chuẩn headers)
 */
export async function syncTmsOnCloud(env) {
  const credentials = getDecryptedTmsCredentials();

  try {
    // 1. Đăng nhập TMS giả lập người dùng
    const loginRes = await fetch(`${TMS_BASE_URL}/api/v1/users/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...HUMAN_HEADERS
      },
      body: JSON.stringify({ credentials }),
      cf: { connectTimeout: 7000 }
    });

    if (!loginRes.ok) {
      throw new Error(`TMS login failed with status ${loginRes.status}`);
    }

    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    if (!token) throw new Error("TMS token not returned");

    // Khoảng nghỉ tự nhiên (jitter) 350ms - 550ms
    await sleep(350 + Math.floor(Math.random() * 200));

    // 2. Tải danh sách 44 máy ép với header đầy đủ
    const machRes = await fetch(
      `${TMS_BASE_URL}/api/v1/machineInformations/?offset=0&limit=100&sortBy=machineNumber.asc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-function-id": "681990befe7996cddbfc8581",
          ...HUMAN_HEADERS
        }
      }
    );
    const machData = await machRes.json();
    const machines = machData.data?.list || machData.data || [];

    // Nghỉ nhẹ 300ms
    await sleep(300 + Math.floor(Math.random() * 150));

    // TMS stores manufacture dates at UTC+7 midnight.
    const localToday = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const dateKey = date => date.toISOString().slice(0, 10);
    const today = dateKey(localToday);
    const yesterdayDate = new Date(localToday);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = dateKey(yesterdayDate);
    const tmsDate = key => `${key}T17:00:00.000Z`;

    const loadDay = async key => {
      const response = await fetch(
        `${TMS_BASE_URL}/api/v1/dailyMachineChecklists/?offset=0&limit=300&dateOfManufacture=${encodeURIComponent(tmsDate(key))}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-function-id": "68244a138783288f699a0871",
            ...HUMAN_HEADERS
          }
        }
      );
      if (!response.ok) throw new Error(`TMS checklist failed with status ${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload.data) ? payload.data : payload.data?.list || [];
    };

    // Tải tuần tự có delay 400ms thay vì burst đồng thời dồn dập
    const listYesterday = await loadDay(yesterday);
    await sleep(400 + Math.floor(Math.random() * 200));
    const listToday = await loadDay(today);

    // 4. Lấy base json từ D1 hoặc asset
    let appData = await getLatestTmsDataFromD1(env);
    if (!appData) {
      const assetRes = await env.ASSETS.fetch(new Request("https://localhost/data/mold-maintenance-data.json"));
      if (assetRes.ok) appData = await assetRes.json();
    }
    if (!appData) appData = { records: [] };

    // 5. Tính toán và cập nhật số liệu
    const stats = {};
    machines.forEach(m => {
      const code = (m.machineNumber || m.itemCode || "").toUpperCase();
      stats[code] = {
        machineNo: code,
        prodToday: 0,
        scrapToday: 0,
        shotsToday: 0,
        prodYesterday: 0,
        scrapYesterday: 0,
        shotsYesterday: 0,
        cavity: 1,
        cavityStr: "1/1",
        cycleTime: 0,
        moldNo: "",
        moldName: "",
        byMold: {}
      };
    });

    const ingest = (documents, dayKey) => documents.forEach(doc => {
      const code = (doc.machineNo || "").toUpperCase();
      if (!stats[code]) return;
      (doc.itemList || []).forEach(it => {
        const prod = Number(it.totalProduction) || 0;
        const scrap = Number(it.totalNg) || 0;
        const cavityText = String(it.qtyStandardMold || "");
        const cavity = Number.parseInt(cavityText.split("/")[0], 10);
        const itemShots = cavity > 0 ? Math.round((prod + scrap) / cavity) : 0;
        const suffix = dayKey === today ? "Today" : "Yesterday";
        stats[code][`prod${suffix}`] += prod;
        stats[code][`scrap${suffix}`] += scrap;
        stats[code][`shots${suffix}`] += itemShots;
        const moldNo = String(it.moldNo || "").trim().toUpperCase();
        if (moldNo) {
          const byMold = stats[code].byMold[moldNo] ||= {
            moldNo,
            prodToday: 0, scrapToday: 0, shotsToday: 0,
            prodYesterday: 0, scrapYesterday: 0, shotsYesterday: 0,
            cavity: cavity || 1,
            cavityStr: cavityText || "1/1",
            cycleTime: Number.parseFloat(it.cycleCalMold) || 0,
            moldName: it.moldName || ""
          };
          byMold[`prod${suffix}`] += prod;
          byMold[`scrap${suffix}`] += scrap;
          byMold[`shots${suffix}`] += itemShots;
          if (cavity > 0) {
            byMold.cavity = cavity;
            byMold.cavityStr = cavityText;
          }
        }
        if (it.qtyStandardMold) {
          stats[code].cavityStr = it.qtyStandardMold;
          stats[code].cavity = cavity || stats[code].cavity;
        }
        if (it.cycleCalMold) stats[code].cycleTime = parseFloat(it.cycleCalMold) || stats[code].cycleTime;
        if (it.moldNo) stats[code].moldNo = it.moldNo;
        if (it.moldName) stats[code].moldName = it.moldName;
      });
    });
    ingest(listYesterday, yesterday);
    ingest(listToday, today);

    // Merge vào appData
    let totalShotsToday = 0;
    let totalOutputToday = 0;
    let totalScrapToday = 0;

    if (!Array.isArray(appData.records)) appData.records = [];
    const recordsByMachine = new Map();
    appData.records.forEach(record => {
      const machine = String(record.machineNo || "").toUpperCase();
      if (!recordsByMachine.has(machine)) recordsByMachine.set(machine, []);
      recordsByMachine.get(machine).push(record);
    });
    const updatedRecords = [];
    appData.records.forEach(r => {
      const live = stats[String(r.machineNo || "").toUpperCase()];
      if (!live) return;
      const moldCode = String(r.moldNo || "").toUpperCase();
      const moldLive = live.byMold[moldCode] || (Object.keys(live.byMold).length === 1 ? Object.values(live.byMold)[0] : null);
      if (!moldLive && Object.keys(live.byMold).length > 1) return;
      const row = moldLive ? { ...r, moldNo: moldLive.moldNo, cavity: moldLive.cavity, cavityStr: moldLive.cavityStr, cycleTime: moldLive.cycleTime, productRunning: moldLive.moldName || r.productRunning } : r;
      const dayData = moldLive || live;
      const oldTodayShots = Number(row.todayShots) || 0;
      const oldTodayKey = row._tmsShotDate;
      const existingCycleBase = Number(row._tmsCycleBaseShots);
      const existingLifeBase = Number(row._tmsLifeBaseShots);
      const initialCycleShots = Number(row.currentCycleShots) || Number(row.m1_800k) || 0;
      const initialLifeShots = Number(row.totalLifeShots) || 0;
      const cycleBase = oldTodayKey === today
        ? (Number.isFinite(existingCycleBase) ? existingCycleBase : Math.max(0, initialCycleShots - oldTodayShots))
        : (Number.isFinite(existingCycleBase) ? existingCycleBase + (oldTodayKey ? oldTodayShots : 0) : initialCycleShots);
      const lifeBase = oldTodayKey === today
        ? (Number.isFinite(existingLifeBase) ? existingLifeBase : Math.max(0, initialLifeShots - oldTodayShots))
        : (Number.isFinite(existingLifeBase) ? existingLifeBase + (oldTodayKey ? oldTodayShots : 0) : initialLifeShots);

      row.yesterdayProdOutputPcs = dayData.prodYesterday;
      row.yesterdayScrapPcs = dayData.scrapYesterday;
      row.yesterdayShots = dayData.shotsYesterday;

      row.todayProdOutputPcs = dayData.prodToday;
      row.todayScrapPcs = dayData.scrapToday;
      row.todayShots = dayData.shotsToday;
      row._tmsShotDate = today;
      row._tmsCycleBaseShots = cycleBase;
      row._tmsLifeBaseShots = lifeBase;
      row.currentCycleShots = cycleBase + dayData.shotsToday;
      row.totalLifeShots = lifeBase + dayData.shotsToday;

      row.prodOutputPcs = dayData.prodToday;
      row.prodScrapPcs = dayData.scrapToday;
      row.actualShotsToday = dayData.shotsToday;

      if (!row.dailyMonthData) row.dailyMonthData = {};
      row.dailyMonthData[yesterday.slice(-2)] = { prodOutput: dayData.prodYesterday, shots: dayData.shotsYesterday, scrap: dayData.scrapYesterday };
      row.dailyMonthData[today.slice(-2)] = { prodOutput: dayData.prodToday, shots: dayData.shotsToday, scrap: dayData.scrapToday };
      updatedRecords.push(row);
    });

    for (const [machineNo, live] of Object.entries(stats)) {
      const existing = recordsByMachine.get(machineNo) || [];
      for (const moldLive of Object.values(live.byMold)) {
        if (existing.some(r => String(r.moldNo || "").toUpperCase() === moldLive.moldNo)) continue;
        const base = existing[0] || { machineNo, machineStatus: "Unknown" };
        const masterMold = (appData.excelMasterMolds || []).find(m => 
          String(m.mold || "").toUpperCase() === moldLive.moldNo ||
          (m.oldMold && String(m.oldMold).toUpperCase() === moldLive.moldNo) ||
          (m.newMold && String(m.newMold).toUpperCase() === moldLive.moldNo)
        );
        const initialLife = Number(masterMold?.total_life ?? base.totalLifeShots) || 0;
        const initialCycle = Number(masterMold?.m1_800k ?? base.currentCycleShots) || 0;
        const row = {
          ...base,
          machineNo,
          moldNo: moldLive.moldNo,
          series: masterMold?.series || base.series || "-",
          cavity: moldLive.cavity,
          cavityStr: moldLive.cavityStr,
          cycleTime: moldLive.cycleTime,
          productRunning: moldLive.moldName || base.productRunning || "",
          isHighImpact: masterMold?.is_high_impact ?? base.isHighImpact ?? false,
          yesterdayProdOutputPcs: moldLive.prodYesterday,
          yesterdayScrapPcs: moldLive.scrapYesterday,
          yesterdayShots: moldLive.shotsYesterday,
          todayProdOutputPcs: moldLive.prodToday,
          todayScrapPcs: moldLive.scrapToday,
          todayShots: moldLive.shotsToday,
          currentCycleShots: initialCycle + moldLive.shotsToday,
          totalLifeShots: initialLife + moldLive.shotsToday,
          _tmsShotDate: today,
          _tmsCycleBaseShots: initialCycle,
          _tmsLifeBaseShots: initialLife,
          prodOutputPcs: moldLive.prodToday,
          prodScrapPcs: moldLive.scrapToday,
          actualShotsToday: moldLive.shotsToday,
          dailyMonthData: { ...(base.dailyMonthData || {}),
            [yesterday.slice(-2)]: { prodOutput: moldLive.prodYesterday, shots: moldLive.shotsYesterday, scrap: moldLive.scrapYesterday },
            [today.slice(-2)]: { prodOutput: moldLive.prodToday, shots: moldLive.shotsToday, scrap: moldLive.scrapToday }
          }
        };
        updatedRecords.push(row);
      }
    }
    appData.records = updatedRecords;
    const masterByMold = new Map();
    (appData.excelMasterMolds || []).forEach(m => {
      if (m.mold) masterByMold.set(String(m.mold).toUpperCase(), m);
      if (m.oldMold && m.oldMold !== '-') masterByMold.set(String(m.oldMold).toUpperCase(), m);
      if (m.newMold && m.newMold !== '-') masterByMold.set(String(m.newMold).toUpperCase(), m);
    });
    appData.records.forEach(record => {
      const master = masterByMold.get(String(record.moldNo || "").toUpperCase());
      if (master) master.total_life = Math.max(Number(master.total_life) || 0, Number(record.totalLifeShots) || 0);
    });

    Object.values(stats).forEach(live => {
      totalShotsToday += live.shotsToday;
      totalOutputToday += live.prodToday;
      totalScrapToday += live.scrapToday;
    });

    appData.totalShotsToday = totalShotsToday;
    appData.totalOutputToday = totalOutputToday;
    appData.totalScrapToday = totalScrapToday;
    appData.lastUpdated = new Date().toISOString();

    // 6. Lưu vào Cloudflare D1
    await saveTmsDataToD1(env, appData);

    return {
      success: true,
      source: "live_tms_cloud",
      updatedAt: appData.lastUpdated,
      totalShotsToday,
      totalOutputToday,
      security: getTmsSecurityMetadata()
    };
  } catch (err) {
    console.warn("[TMS CLOUD CRAWL WARNING]", err.message);
    // Nếu mạng LAN của TMS cần relay/push, lấy bản D1 gần nhất
    const cached = await getLatestTmsDataFromD1(env);
    return {
      success: false,
      source: "d1_persisted",
      note: "Dữ liệu được duy trì an toàn trên Cloudflare D1",
      updatedAt: cached?.lastUpdated || new Date().toISOString(),
      security: getTmsSecurityMetadata()
    };
  }
}

/**
 * Lưu dữ liệu đã cào vào Cloudflare D1
 */
export async function saveTmsDataToD1(env, data) {
  if (!env.DB) return false;
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO tms_sync_data (id, data, updated_at) VALUES ('current', ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at"
  )
    .bind(jsonStr, now)
    .run();
  return true;
}

/**
 * Lấy dữ liệu gần nhất từ Cloudflare D1
 */
export function filterValidMolds(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(m => {
    if (!m || !m.mold) return false;
    const code = String(m.mold).trim().toUpperCase();
    if (code.includes('TÊN KHUÔN') || code.includes('MOLD NAME') || code.includes('ITEM NAME')) return false;
    if (/^\d+CAV$/i.test(code)) return false;
    if (code === '-' || code.length < 3) return false;
    return true;
  });
}

export async function getLatestTmsDataFromD1(env) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT data, updated_at FROM tms_sync_data WHERE id='current'"
  ).first();
  if (!row || !row.data) return null;
  try {
    const parsed = JSON.parse(row.data);
    if (parsed && Array.isArray(parsed.excelMasterMolds)) {
      parsed.excelMasterMolds = filterValidMolds(parsed.excelMasterMolds);
    }
    return parsed;
  } catch {
    return null;
  }
}
