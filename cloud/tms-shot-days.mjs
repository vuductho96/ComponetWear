export function tmsManufactureDate(date) {
  return new Date(Date.parse(date) - 7 * 3600000).toISOString();
}

export function recordShotDay(snapshot, date, documents, asOfDate) {
  const molds = {};
  const incomplete = new Set();
  let unidentified = false;
  for (const document of documents) {
    for (const item of document.itemList || []) {
      const code = String(item.moldNo || "").trim().toUpperCase();
      const quantity = (Number(item.totalProduction) || 0) + (Number(item.totalNg) || 0);
      if (!quantity) continue;
      if (!code || code === "-") {
        unidentified = true;
        continue;
      }
      const cavity = Number.parseInt(String(item.qtyStandardMold || "").split("/")[0], 10);
      if (!(cavity > 0)) {
        incomplete.add(code);
        continue;
      }
      molds[code] = (molds[code] || 0) + Math.round(quantity / cavity);
    }
  }
  snapshot.shotDays ||= {};
  snapshot.shotDays[date] = { molds, incomplete: [...incomplete], complete: !unidentified && documents.length < 300, observedAt: Date.now() };
  snapshot.shotAsOfDate = asOfDate;
}
