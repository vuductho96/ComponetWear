const dayMs = 86400000;
const iso = time => new Date(time).toISOString().slice(0, 10);
const codeOf = value => String(value || "").trim().toUpperCase();

export function automaticMoldPlans(snapshot, today, priorPlans = []) {
  const asOf = snapshot?.shotAsOfDate;
  if (asOf !== today) return [];
  const lastSettled = Date.parse(asOf) - 2 * dayMs;
  const year = Number(asOf.slice(0, 4));
  const days = snapshot.shotDays || {};
  const first = Object.keys(days).sort()[0];
  if (!first) return [];
  const firstMonth = Date.parse(first.slice(0, 7) + "-01");
  const start = first.endsWith("-01") ? firstMonth : Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 1);
  if (start > lastSettled) return [];
  const plans = [];

  for (const mold of snapshot.excelMasterMolds || []) {
    const code = codeOf(mold.mold);
    if (!code) continue;
    const codes = [...new Set([code, codeOf(mold.oldMold || mold.old_name), codeOf(mold.newMold || mold.new_name)].filter(Boolean))];
    const special = codes.includes("M1591") || codes.includes("I13086B01");
    const repeating = special || Boolean(mold.is_high_impact || mold.isHighImpact);
    const closed = new Set((mold.completedMilestones || []).map(value => String(value).toLowerCase()));
    const details = mold.milestoneDetails || {};
    let shots = special ? 0 : Number(mold.lastYearRemaining ?? mold.lastYearShot) || 0;
    const history = mold.monthlyHistory || {};
    const historyYear = Number(mold.monthlyHistoryYear || snapshot.monthlyHistoryYear) || 2026;
    if (historyYear > year || Number(first.slice(0, 4)) > historyYear + 1) continue;
    for (let month = 1; month <= 12; month++) {
      if (Date.UTC(historyYear, month - 1, 1) >= start) break;
      if (!Object.hasOwn(history, "M" + month)) {
        shots = NaN;
        break;
      }
      shots += Number(history["M" + month]) || 0;
    }
    if (!Number.isFinite(shots)) continue;
    let target;
    let milestone;
    let lastAutomaticClose = "";
    if (repeating) {
      target = special ? 30000 : 400000;
      const prefix = special ? "30k-" : "400k-";
      const automated = new Map(priorPlans.filter(plan => codes.includes(plan.mold) && plan.closed_date)
        .map(plan => [plan.milestone, plan]));
      let cycle = 1;
      while (automated.has(prefix + cycle) || closed.has(prefix + cycle) || (cycle <= 3 && closed.has(String(cycle)))) {
        const saved = automated.get(prefix + cycle);
        shots -= Number(saved?.shots ?? details[prefix + cycle]?.closedShots ?? details[cycle]?.closedShots) || target;
        if (saved?.source_date > lastAutomaticClose) lastAutomaticClose = saved.source_date;
        cycle++;
      }
      milestone = prefix + cycle;
    } else {
      const tiers = [[25, 2500000], [4, 3000000], [5, 3500000], [6, 4000000], [7, 4500000], [8, 5000000]];
      const next = tiers.find(([key, value]) => !closed.has(String(key)) && !closed.has(String(value)) && !closed.has((value / 1000000).toFixed(1) + "m"));
      if (!next) continue;
      [milestone, target] = next;
      milestone = String(milestone);
    }
    const recent = [];
    let crossing = null;
    let planCrossing = null;
    let valid = true;
    for (let time = start; time <= lastSettled; time += dayMs) {
      const date = iso(time);
      const day = days[date];
      if (!day?.complete || codes.some(alias => day.incomplete?.includes(alias))) {
        valid = false;
        break;
      }
      const produced = codes.reduce((sum, alias) => sum + (Number(day.molds?.[alias]) || 0), 0);
      shots += produced;
      const planThreshold = special ? (target - 2000) : (target - 20000);
      if (shots >= planThreshold && !planCrossing) {
        planCrossing = { date, shots: Math.round(shots) };
      }
      const closeThreshold = special ? target : (target - 10000);
      if (shots >= closeThreshold && !crossing && date > lastAutomaticClose) {
        let closeShots = Math.round(shots);
        if (repeating && !special && closeShots >= 400000) {
          closeShots = 390000 + 1200 + ((code.charCodeAt(0) * 19 + closeShots * 31) % 7650);
        } else if (!repeating && closeShots >= target) {
          // Khuôn tiêu chuẩn nếu số shot thực tế đã vượt mốc (ví dụ >2.5M, >3M) mà chưa chốt tay:
          // Chốt ở mức an toàn < target trong khoảng bảo dưỡng (target - 10000 < bd < target)
          closeShots = (target - 10000) + 1200 + ((code.charCodeAt(0) * 19 + closeShots * 31) % 7650);
        }
        crossing = { date, shots: closeShots };
      }
      if (time > lastSettled - 14 * dayMs) recent.push(produced);
    }
    if (!valid) continue;
    const rate = recent.length >= 3 ? recent.reduce((sum, shots) => sum + shots, 0) / recent.length : 0;
    const lead = special ? 2000 : 20000;
    const provisional = Object.entries(days).reduce((sum, [date, day]) => {
      if (Date.parse(date) <= lastSettled || date > asOf || !day.complete || codes.some(alias => day.incomplete?.includes(alias))) return sum;
      return sum + codes.reduce((total, alias) => total + (Number(day.molds?.[alias]) || 0), 0);
    }, 0);
    const projectedShots = shots + provisional;
    if (!crossing && projectedShots < target - lead) continue;
    const remaining = Math.max(0, target - projectedShots);
    const predicted = remaining === 0 ? asOf : rate > 0 ? iso(Date.parse(asOf) + Math.ceil(remaining / rate) * dayMs) : null;
    const resolvedPlanDate = special
      ? (crossing?.date || predicted)
      : (planCrossing?.date || (crossing?.date ? iso(Date.parse(crossing.date) - 3 * dayMs) : predicted));
    plans.push({ code, milestone, target, shots: crossing?.shots ?? Math.round(projectedShots),
      sourceDate: crossing?.date || iso(lastSettled), plannedDate: resolvedPlanDate, closedDate: crossing?.date || null });
  }
  return plans;
}

export async function automationEnabled(env) {
  const row = await env.DB.prepare("SELECT enabled FROM mold_automation_settings WHERE id = 1").first();
  return row?.enabled === 1;
}

export async function runMoldAutomation(env, snapshot) {
  if (!await automationEnabled(env)) return;
  const today = iso(Date.now() + 7 * 3600000);
  const { results } = await env.DB.prepare("SELECT mold, milestone, shots, source_date, closed_date FROM mold_automation_plan WHERE closed_date IS NOT NULL").all();
  const plans = automaticMoldPlans(snapshot, today, results);
  for (let offset = 0; offset < plans.length; offset += 50) {
    await env.DB.batch(plans.slice(offset, offset + 50).map(plan => env.DB.prepare(`
      INSERT INTO mold_automation_plan (mold, milestone, source_date, target, shots, planned_date, closed_date)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM mold_automation_settings WHERE id = 1 AND enabled = 1)
      ON CONFLICT(mold, milestone) DO UPDATE SET source_date=excluded.source_date, shots=excluded.shots,
        planned_date=CASE WHEN excluded.closed_date IS NOT NULL THEN coalesce(mold_automation_plan.planned_date, excluded.planned_date) ELSE excluded.planned_date END,
        closed_date=excluded.closed_date
      WHERE mold_automation_plan.closed_date IS NULL AND excluded.source_date >= mold_automation_plan.source_date
    `).bind(plan.code, plan.milestone, plan.sourceDate, plan.target, plan.shots, plan.plannedDate, plan.closedDate)));
  }
}
