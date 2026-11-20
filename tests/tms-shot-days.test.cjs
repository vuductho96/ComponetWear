const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('automation plans before threshold and closes only with consecutive settled TMS data', async () => {
  const { automaticMoldPlans } = await import('../cloud/mold-automation.mjs');
  const shotDays = Object.fromEntries([10000, 10000, 8000, 2000, 0, 0].map((shots, index) => [
    `2026-01-0${index + 1}`, { complete: true, incomplete: [], molds: { M1591: shots } }
  ]));
  const data = {
    shotAsOfDate: '2026-01-05',
    excelMasterMolds: [{ mold: 'I13086B01', oldMold: 'M1591', lastYearRemaining: 350000 }],
    shotDays
  };
  const [proposal] = automaticMoldPlans(data, '2026-01-05');
  assert.equal(proposal.milestone, '30k-1');
  assert.equal(proposal.plannedDate, '2026-01-05');
  assert.equal(proposal.closedDate, null);
  data.shotAsOfDate = '2026-01-06';
  const [closed] = automaticMoldPlans(data, '2026-01-06');
  assert.equal(closed.shots, 30000);
  assert.equal(closed.closedDate, '2026-01-04');
  shotDays['2026-01-02'].incomplete = ['M1591'];
  assert.deepEqual(automaticMoldPlans(data, '2026-01-06'), []);
  assert.deepEqual(automaticMoldPlans(data, '2026-01-07'), []);
});

test('TMS checklist counts each cavity against the mold and replaces repeat observations', async () => {
  const { recordShotDay, tmsManufactureDate } = await import('../cloud/tms-shot-days.mjs');
  assert.equal(tmsManufactureDate('2027-01-01'), '2026-12-31T17:00:00.000Z');
  const snapshot = {};
  const items = [
    { moldNo: 'MOLD-A', totalProduction: 110, totalNg: 10, qtyStandardMold: '2/2' },
    { moldNo: 'MOLD-B', totalProduction: 80, qtyStandardMold: '4/4' },
    { moldNo: 'MOLD-C', totalProduction: 80 }
  ];
  recordShotDay(snapshot, '2026-12-31', [{ machineNo: '01', itemList: items }], '2027-01-01');
  assert.deepEqual(snapshot.shotDays['2026-12-31'].molds, { 'MOLD-A': 60, 'MOLD-B': 20 });
  assert.deepEqual(snapshot.shotDays['2026-12-31'].incomplete, ['MOLD-C']);
  recordShotDay(snapshot, '2026-12-31', [{ itemList: [items[1]] }], '2027-01-01');
  assert.deepEqual(snapshot.shotDays['2026-12-31'].molds, { 'MOLD-B': 20 });
});

test('closing the shot dialog does not save a computed suggestion as maintenance performed', async () => {
  const writes = [];
  const fields = {
    mm_shot_0: { value: '' },
    mm_date_0: { value: '' },
    mm_ktv_0: { value: '' },
    mm_note_0: { value: '' }
  };
  const context = {
    window: {},
    console,
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(args) },
    document: { addEventListener() {}, getElementById: id => fields[id] || null },
    fetch: () => { throw Error('Unexpected write'); },
    alert: message => { throw Error(message); }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source.replace('getData: () => rawData,', `getData: () => rawData,
    loadShotDialog: () => {
      activeShotModalMold = 'H10109S01';
      activeShotModalTab = '400k';
      active400kRowsData = [{name: '400k-1', num: 1, suggestedShot: '1.716.668', isClosed: false, isEligible: true }];
    },`), context);
  const module = context.window.MoldMaintenance;
  module.loadShotDialog();
  await module.save400kExcelTable();
  assert.deepEqual(writes, []);
});

test('annual mold summary and workbook carry December separately from January production', async () => {
  const ExcelJS = require('../ComponentLife/js/exceljs.min.js');
  class FixtureWorkbook extends ExcelJS.Workbook {
    addWorksheet(...args) {
      const sheet = super.addWorksheet(...args);
      const addRow = sheet.addRow.bind(sheet);
      sheet.addRow = (values, ...options) => addRow(Array.isArray(values) ? Array.from(values) : values, ...options);
      return sheet;
    }
  }
  let downloaded;
  const context = {
    window: {},
    console,
    ExcelJS: { Workbook: FixtureWorkbook },
    Blob,
    fetch: async () => ({ ok: false }),
    alert: message => { throw new Error(message); },
    URL: { createObjectURL(blob) { downloaded = blob; return 'blob:fixture'; }, revokeObjectURL() {} },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener() {},
      getElementById: () => null,
      createElement: () => ({ click() {}, remove() {} }),
      body: { append() {} }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source.replace('getData: () => rawData,', `getData: () => rawData,
    loadFixture: (data, year) => { rawData = data; selectedYear = year; },`), context);
  const module = context.window.MoldMaintenance;
  const data = {
    records: [],
    excelMasterMolds: [{ mold: 'MOLD-A', monthlyHistory: { M12: 200 }, lastYearRemaining: 50 }],
    shotAsOfDate: '2027-01-01',
    automaticMaintenance: [{ mold: 'MOLD-A', milestone: '25', planned_date: '2027-01-12', closed_date: '2027-01-13', shots: 2500000 }],
    shotDays: {
      '2026-12-31': { molds: { 'MOLD-A': 200 }, complete: true, incomplete: [] },
      '2027-01-01': { molds: { 'MOLD-A': 20 }, complete: true, incomplete: [] }
    }
  };
  module.loadFixture(data, '2027');
  const [nextYear] = module.getAllUnifiedMolds();
  assert.equal(nextYear.lastYearRemaining, 250);
  assert.equal(nextYear.monthlyHistory.M1, 20);
  assert.equal(nextYear.monthlyHistory.M12, undefined);
  assert.equal(nextYear.totalYear, 270);
  await module.exportExcel();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloaded.arrayBuffer());
  assert.equal(workbook.getWorksheet('Khuôn Tiêu Chuẩn').getCell('D6').value, 250);
  assert.equal(workbook.getWorksheet('Khuôn Tiêu Chuẩn').getCell('E6').value, 20);
  const standardSheet = workbook.getWorksheet('Khuôn Tiêu Chuẩn');
  const planRow = standardSheet.getRows(7, standardSheet.rowCount - 6).find(row => String(row.getCell('E').value).startsWith('Chốt 2.5M'));
  assert.ok(planRow, 'automatic closure is written to January in the MMFD maintenance matrix');
  assert.match(standardSheet.getCell(`E${planRow.number + 1}`).value, /Plan .*Chốt/);
  const dailySheet = workbook.getWorksheet('Shot ngay theo khuon');
  const exportedDay = dailySheet.getRows(1, dailySheet.rowCount).find(row => row.getCell(3).value === '2027-01-01');
  assert.equal(exportedDay?.getCell(5).value, 20);
  module.loadFixture(data, '2026');
  const [previousYear] = module.getAllUnifiedMolds();
  assert.equal(previousYear.monthlyHistory.M12, 200);
  assert.equal(previousYear.totalYear, 250);
});

test('manual milestone closing operates normally and takes precedence when auto mode is active', async () => {
  const writes = [];
  const context = {
    window: {},
    console,
    fetch: async (url, options) => {
      writes.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: id => {
        if (id === 'mm_shot_0') return { value: '405000' };
        if (id === 'mm_plan_0') return { value: '2026-03-01' };
        if (id === 'mm_date_0') return { value: '2026-03-05' };
        if (id === 'mm_ktv_0') return { value: 'TECH-01' };
        if (id === 'mm_note_0') return { value: 'Manual override OK' };
        return null;
      }
    },
    alert: message => { throw Error(message); }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source.replace('getData: () => rawData,', `getData: () => rawData,
    loadManualFixture: (data) => {
      rawData = data;
      activeShotModalMold = 'H10109S01';
      activeShotModalTab = '400k';
      active400kRowsData = [{
        name: '400k-1',
        num: 1,
        actualShot: '',
        planDate: '',
        date: '',
        ktv: '',
        note: '',
        isClosed: false,
        isEligible: true
      }];
    },`), context);
  const module = context.window.MoldMaintenance;
  const fixtureData = {
    records: [],
    excelMasterMolds: [{
      mold: 'H10109S01',
      totalYear: 410000,
      completedMilestones: [],
      milestoneDetails: {}
    }],
    automaticMaintenance: [{
      mold: 'H10109S01',
      milestone: '400k-1',
      planned_date: '2026-02-28',
      closed_date: '2026-03-04',
      shots: 400000
    }]
  };
  module.loadManualFixture(fixtureData);

  // Perform manual save
  await module.save400kExcelTable();

  // Verify write occurred
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.mold, 'H10109S01');
  assert.ok(writes[0].body.completedMilestones.includes('400k-1') || writes[0].body.completedMilestones.includes(1));
  assert.equal((writes[0].body.milestoneDetails['400k-1'] || writes[0].body.milestoneDetails['1']).closedShots, 405000);
  assert.equal((writes[0].body.milestoneDetails['400k-1'] || writes[0].body.milestoneDetails['1']).tech, 'TECH-01');

  // Verify cycles info gives absolute priority to manual entries
  const cycles = module.get400kCyclesInfo(fixtureData.excelMasterMolds[0], true);
  const cycle1 = cycles.find(c => c.num === 1);
  assert.equal(cycle1.isClosed, true);
  assert.equal(cycle1.closedShots, 405000);
  assert.equal(cycle1.tech, 'TECH-01');
  assert.equal(cycle1.date, '2026-03-05');
  assert.equal(cycle1.planDate, '2026-03-01');
});

test('modal rows correctly display closed cycles with checkmarks, shots, dates, ktv and note from mold milestoneDetails', () => {
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;
  const moldData = {
    mold: 'H10109S01',
    isHighImpact: true,
    totalYear: 1728243,
    completedMilestones: [1, '400k-1', 2, '400k-2', 3, '400k-3', 4, '400k-4'],
    milestoneDetails: {
      '1': { planDate: '2026-01-08', date: '2026-01-13', tech: 'KTV-TUAN', closedShots: 392515, note: 'Bảo dưỡng định kỳ 400K-1 đạt' },
      '2': { planDate: '2026-04-14', date: '2026-04-18', tech: 'KTV-MANH', closedShots: 394180, note: 'Bảo dưỡng định kỳ 400K-2 đạt' },
      '3': { planDate: '2026-07-16', date: '2026-07-21', tech: 'KTV-TRUNG', closedShots: 391650, note: 'Bảo dưỡng định kỳ 400K-3 đạt' },
      '4': { planDate: '2026-10-09', date: '2026-10-14', tech: 'KTV-THANG', closedShots: 395420, note: 'Bảo dưỡng định kỳ 400K-4 đạt' },
      '5': { planDate: '2026-12-15', date: '', tech: '', closedShots: 0, note: 'Dự kiến 400K-5' }
    }
  };
  const cycles = module.get400kCyclesInfo(moldData, true);
  assert.equal(cycles.length, 8);
  assert.equal(cycles[0].isClosed, true);
  assert.equal(cycles[0].date, '2026-01-13');
  assert.equal(cycles[0].tech, 'KTV-TUAN');
  assert.equal(cycles[0].closedShots, 392515);
  assert.ok(cycles[0].closedShots > 390000 && cycles[0].closedShots < 400000);

  // Cữ 2, 3, 4 bảo dưỡng tự động nằm trong khoảng SOP 390k < bd < 400k với số lẻ chi tiết
  assert.equal(cycles[1].isClosed, true);
  assert.equal(cycles[1].date, '2026-04-18');
  assert.equal(cycles[1].tech, 'KTV-MANH');
  assert.equal(cycles[1].closedShots, 394180);
  assert.ok(cycles[1].closedShots > 390000 && cycles[1].closedShots < 400000);

  assert.equal(cycles[2].isClosed, true);
  assert.equal(cycles[2].date, '2026-07-21');
  assert.equal(cycles[2].tech, 'KTV-TRUNG');
  assert.equal(cycles[2].closedShots, 391650);
  assert.ok(cycles[2].closedShots > 390000 && cycles[2].closedShots < 400000);

  assert.equal(cycles[3].isClosed, true);
  assert.equal(cycles[3].date, '2026-10-14');
  assert.equal(cycles[3].tech, 'KTV-THANG');
  assert.equal(cycles[3].closedShots, 395420);
  assert.ok(cycles[3].closedShots > 390000 && cycles[3].closedShots < 400000);

  assert.equal(cycles[4].isClosed, false);
  assert.equal(cycles[4].planDate, '2026-12-15');
  assert.equal(cycles[4].shots, 128243);
});

test('H18015S01: 400k cycles reset to 0 after each maintenance; cycle 4 tracks 122,222 shots from zero', () => {
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;
  const moldData = {
    mold: 'H18015S01',
    isHighImpact: true,
    totalYear: 1322222,
    completedMilestones: [1, '400k-1', 2, '400k-2', 3, '400k-3'],
    milestoneDetails: {
      '1': { planDate: '2026-01-12', date: '2026-01-16', tech: 'KTV-THANG', closedShots: 392150, note: 'Bảo dưỡng cữ 1' },
      '2': { planDate: '2026-02-04', date: '2026-02-09', tech: 'KTV-TUAN', closedShots: 395340, note: 'Bảo dưỡng cữ 2' },
      '3': { planDate: '2026-09-07', date: '2026-09-11', tech: 'KTV-MANH', closedShots: 393820, note: 'Bảo dưỡng cữ 3' },
      '4': { planDate: '2026-12-30', date: '', tech: '', closedShots: 0, note: 'Kế hoạch cữ 4' }
    }
  };
  const cycles = module.get400kCyclesInfo(moldData, true);
  assert.equal(cycles[0].isClosed, true);
  assert.equal(cycles[0].closedShots, 392150);
  assert.ok(cycles[0].closedShots > 390000 && cycles[0].closedShots < 400000);

  // Cữ 2 và 3 reset về 0, hiển thị số shot chu kỳ trong khoảng 390k < bd < 400k
  assert.equal(cycles[1].isClosed, true);
  assert.equal(cycles[1].closedShots, 395340);
  assert.ok(cycles[1].closedShots > 390000 && cycles[1].closedShots < 400000);

  assert.equal(cycles[2].isClosed, true);
  assert.equal(cycles[2].closedShots, 393820);
  assert.ok(cycles[2].closedShots > 390000 && cycles[2].closedShots < 400000);

  // Cữ 4 đang chạy từ 0 và đạt đúng 122.222 shot
  assert.equal(cycles[3].isClosed, false);
  assert.equal(cycles[3].shots, 122222);
});

test('Standard molds: DO NOT apply 400K cycle (-), follow 2.5M milestone (2.48M plan, 2.49M warning, >=2.5M due)', () => {
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;

  // 1. Khuôn tiêu chuẩn H9827S12, H9637S15, H9637C14: render400kCell phải trả về '-'
  const m9827 = { mold: 'H9827S12', isHighImpact: false, totalYear: 1992583 };
  const cell9827 = module.render400kCell(m9827);
  assert.ok(cell9827.includes('>-<'), 'H9827S12 must render "-" in 400K column');
  assert.ok(cell9827.includes('Không áp dụng mốc 400K'), 'H9827S12 title must indicate not applying 400K');

  const m9637s15 = { mold: 'H9637S15', isHighImpact: false, totalYear: 2456011 };
  const cell9637 = module.render400kCell(m9637s15);
  assert.ok(cell9637.includes('>-<'), 'H9637S15 must render "-" in 400K column');

  const m9637c14 = { mold: 'H9637C14', isHighImpact: false, totalYear: 2136662 };
  const cellC14 = module.render400kCell(m9637c14);
  assert.ok(cellC14.includes('>-<'), 'H9637C14 must render "-" in 400K column');

  // 2. Không tự động suy luận chu kỳ 400K cho khuôn tiêu chuẩn
  const cycles9637 = module.get400kCyclesInfo(m9637s15, true);
  const closedCount = cycles9637.filter(c => c.isClosed).length;
  assert.equal(closedCount, 0, 'Standard mold must NOT auto-pass 400K cycles');

  // 3. Chu kỳ chuẩn SOP cho khuôn tiêu chuẩn tại mốc 2.5M:
  // - 2.480.000 shot: Tím (Plan trước 20K)
  const stPlan = module.computeMoldPlanAndStatus(false, 2482000, 2482000, []);
  assert.equal(stPlan.plan, 2500000);
  assert.equal(stPlan.status, 'plan');
  assert.equal(stPlan.statusColor, 'purple');

  // - 2.490.000 <= shot < 2.500.000: Vàng/Cam (Báo bảo dưỡng trước 10K)
  const stWarn = module.computeMoldPlanAndStatus(false, 2495000, 2495000, []);
  assert.equal(stWarn.plan, 2500000);
  assert.equal(stWarn.status, 'warning');
  assert.equal(stWarn.statusColor, 'orange');

  // - >= 2.500.000: Đỏ (Vượt mốc)
  const stDue = module.computeMoldPlanAndStatus(false, 2505000, 2505000, []);
  assert.equal(stDue.plan, 2500000);
  assert.equal(stDue.status, 'due');
  assert.equal(stDue.statusColor, 'red');

  // - < 2.480.000: An toàn
  const stSafe = module.computeMoldPlanAndStatus(false, 2456011, 2456011, []);
  assert.equal(stSafe.plan, 2500000);
  assert.equal(stSafe.status, 'safe');
  assert.equal(stSafe.statusColor, 'green');
});

test('High-Impact molds (e.g. H18015S01, H10109S01): 400K cycles apply with realistic diverse shots in 390k-400k range', () => {
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;

  // Khuôn High-Impact H18015S01 có mốc 400K
  const mHigh = {
    mold: 'H18015S01',
    isHighImpact: true,
    totalYear: 1322222,
    completedMilestones: ['400k-1', '400k-2', '400k-3'],
    milestoneDetails: {
      '400k-1': { planDate: '2026-01-12', date: '2026-01-16', tech: 'KTV-THANH', closedShots: 395200, note: 'Bảo dưỡng 400K-1' },
      '400k-2': { planDate: '2026-04-04', date: '2026-04-09', tech: 'KTV-TUAN', closedShots: 393100, note: 'Bảo dưỡng 400K-2' },
      '400k-3': { planDate: '2026-09-07', date: '2026-09-11', tech: 'KTV-MANH', closedShots: 396400, note: 'Bảo dưỡng 400K-3' }
    }
  };

  const cycles = module.get400kCyclesInfo(mHigh, true);
  assert.equal(cycles[0].isClosed, true);
  assert.equal(cycles[1].isClosed, true);
  assert.equal(cycles[2].isClosed, true);
  assert.equal(cycles[3].isClosed, false);
  assert.equal(cycles[3].shots, 122222);

  // Ô 400K hiển thị số shot cữ hiện tại
  const cellHtml = module.render400kCell(mHigh);
  assert.ok(cellHtml.includes('122.222'), 'H18015S01 must display 122.222 in 400K cell');
  assert.ok(!cellHtml.includes('>-<'), 'High impact mold must NOT render "-" in 400K cell');
});

test('H10109S01: High-Impact mold completing 400k-4 does NOT trigger or close 3.0M milestone (no false checkmark)', () => {
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;

  const moldData = {
    mold: 'H10109S01',
    isHighImpact: true,
    totalYear: 1728243,
    totalAccumulatedYear: 1728243,
    completedMilestones: ['400k-1', '400k-2', '400k-3', '400k-4'],
    closedMilestones: ['400k-1', '400k-2', '400k-3', '400k-4'],
    milestoneDetails: {
      '400k-1': { planDate: '2026-01-08', date: '2026-01-13', tech: 'KTV-TUAN', closedShots: 392515, note: 'Bảo dưỡng 400K-1' },
      '400k-2': { planDate: '2026-04-14', date: '2026-04-18', tech: 'KTV-MANH', closedShots: 394180, note: 'Bảo dưỡng 400K-2' },
      '400k-3': { planDate: '2026-07-16', date: '2026-07-21', tech: 'KTV-TRUNG', closedShots: 391650, note: 'Bảo dưỡng 400K-3' },
      '400k-4': { planDate: '2026-10-09', date: '2026-10-14', tech: 'KTV-THANG', closedShots: 395420, note: 'Bảo dưỡng định kỳ 400K-4' },
      '400k-5': { planDate: '2026-12-15', date: '', tech: '', closedShots: 0, note: 'Kế hoạch 400K-5' }
    }
  };

  // 1. Cữ 400k-4 phải chốt thành công trong modal 400K
  const cycles = module.get400kCyclesInfo(moldData, true);
  assert.equal(cycles[3].isClosed, true);
  assert.equal(cycles[3].date, '2026-10-14');
  assert.equal(cycles[3].closedShots, 395420);

  // 2. Mốc 3.0M (num = 4) TUYỆT ĐỐI KHÔNG ĐƯỢC CHỐT (isMajorMilestoneClosed phải false)
  assert.equal(module.isMajorMilestoneClosed(moldData, 4), false, 'Milestone 3.0M must NOT be closed for High-Impact mold at 1.7M shots');

  // 3. Detail của mốc lớn 3.0M không được lấy nhầm detail của cữ 400k-4
  const majorDetail = module.getMajorMilestoneDetail(moldData, 4);
  assert.equal(majorDetail, null, 'Milestone 3.0M detail must be null, not 400K-4 detail');

  // 4. Kể cả nếu closedMilestones có chứa số 4 do cache cũ, isMajorMilestoneClosed vẫn bảo vệ và trả về false
  const dirtyMoldData = {
    ...moldData,
    closedMilestones: [1, 2, 3, 4, '400k-1', '400k-2', '400k-3', '400k-4']
  };
  assert.equal(module.isMajorMilestoneClosed(dirtyMoldData, 4), false, 'Dirty cache with number 4 must still NOT close 3.0M for High-Impact mold');
});

test('Standard molds auto-maintenance: triggers plan before 20k, closes on maintenance date before 10k, safe shots < target', async () => {
  const { automaticMoldPlans } = await import('../cloud/mold-automation.mjs');

  // Khuôn tiêu chuẩn H9637S15 có lastYearRemaining = 2.470.000 shots
  // Ngày 1: 5.000 shots -> 2.475.000 (< 2.480.000, chưa đến plan)
  // Ngày 2: 7.000 shots -> 2.482.000 (>= 2.480.000, kích hoạt planCrossing trước 20k)
  // Ngày 3: 10.000 shots -> 2.492.000 (>= 2.490.000, kích hoạt crossing trước 10k và chốt bảo dưỡng)
  const shotDays = {
    '2026-01-01': { complete: true, incomplete: [], molds: { H9637S15: 5000 } },
    '2026-01-02': { complete: true, incomplete: [], molds: { H9637S15: 7000 } },
    '2026-01-03': { complete: true, incomplete: [], molds: { H9637S15: 10000 } },
    '2026-01-04': { complete: true, incomplete: [], molds: { H9637S15: 0 } },
    '2026-01-05': { complete: true, incomplete: [], molds: { H9637S15: 0 } }
  };

  const data = {
    shotAsOfDate: '2026-01-05',
    excelMasterMolds: [{ mold: 'H9637S15', is_high_impact: false, lastYearRemaining: 2470000 }],
    shotDays
  };

  const plans = automaticMoldPlans(data, '2026-01-05');
  assert.equal(plans.length, 1);
  const plan25 = plans[0];
  assert.equal(plan25.milestone, '25');
  assert.equal(plan25.target, 2500000);
  // Ngày plan kích hoạt trước 20k
  assert.equal(plan25.plannedDate, '2026-01-02');
  // Ngày chốt kích hoạt trước 10k
  assert.equal(plan25.closedDate, '2026-01-03');
  // Số shot chốt an toàn < 2.500.000
  assert.ok(plan25.shots >= 2490000 && plan25.shots < 2500000, `Shots must be in 2.49M..2.5M, got ${plan25.shots}`);

  // Test frontend tích hợp automaticMaintenance cho mốc lớn
  const context = {
    window: {},
    console,
    fetch: async () => ({ ok: true }),
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] || null; },
      setItem(key, value) { this._data[key] = String(value); }
    },
    document: {
      addEventListener() {},
      getElementById: () => null
    },
    alert: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/mold-maintenance.js'), 'utf8');
  vm.runInContext(source, context);
  const module = context.window.MoldMaintenance;

  const moldWithAuto = {
    mold: 'H9637S15',
    isHighImpact: false,
    totalYear: 2492000,
    closedMilestones: []
  };

  // Nạp automaticMaintenance vào dữ liệu
  const appData = {
    records: [],
    excelMasterMolds: [moldWithAuto],
    automaticMaintenance: [
      { mold: 'H9637S15', milestone: '25', target: 2500000, shots: 2492000, planned_date: '2026-01-02', closed_date: '2026-01-03' }
    ]
  };
  module.setRawDataForTesting(appData);
  // isMajorMilestoneClosed nhận diện tự động chốt
  assert.equal(module.isMajorMilestoneClosed(moldWithAuto, 25), true);
  // getMajorMilestoneDetail trả về chi tiết chốt tự động
  const autoDetail = module.getMajorMilestoneDetail(moldWithAuto, 25);
  assert.ok(autoDetail, 'Auto detail must exist');
  assert.equal(autoDetail.date, '2026-01-03');
  assert.equal(autoDetail.planDate, '2026-01-02');
  assert.equal(autoDetail.closedShots, 2492000);
  assert.equal(autoDetail.tech, 'AUTO-TMS');
});
