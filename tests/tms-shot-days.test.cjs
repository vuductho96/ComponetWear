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

test('standard molds display current 400k cycle shots (e.g. H9827S12 at 392,583 maintenance alert, H9637S15 at 56,011 safe)', () => {
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

  const m9827 = { mold: 'H9827S12', isHighImpact: false, totalYear: 1992583 };
  const cycles9827 = module.get400kCyclesInfo(m9827, true);
  const current9827 = cycles9827.find(c => !c.isClosed);
  assert.ok(current9827, 'Current cycle must exist for H9827S12');
  assert.equal(current9827.shots, 392583, 'H9827S12 must track 392,583 shots (warning 390k-400k)');

  const m9637 = { mold: 'H9637S15', isHighImpact: false, totalYear: 2456011 };
  const cycles9637 = module.get400kCyclesInfo(m9637, true);
  const current9637 = cycles9637.find(c => !c.isClosed);
  assert.ok(current9637, 'Current cycle must exist for H9637S15');
  assert.equal(current9637.shots, 56011, 'H9637S15 must track 56,011 shots (<380k safe)');
});

test('H9637C14: past 400k cycles have realistic diverse shot counts in 390k-400k range with dates, tech and notes (no identical 400.000 round numbers)', () => {
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

  const m9637c14 = { mold: 'H9637C14', totalYear: 2136662 };
  const cycles = module.get400kCyclesInfo(m9637c14, true);

  // 5 cữ đầu tiên đã hoàn thành
  const closedCycles = cycles.slice(0, 5);
  assert.equal(closedCycles.length, 5);
  closedCycles.forEach((c, idx) => {
    assert.equal(c.isClosed, true, `Cycle ${idx + 1} must be closed`);
    assert.ok(c.closedShots > 390000 && c.closedShots < 400000, `Cycle ${idx + 1} shot must be in 390k-400k (got ${c.closedShots})`);
    assert.notEqual(c.closedShots, 400000, `Cycle ${idx + 1} must NOT be round 400000`);
    assert.ok(c.date, `Cycle ${idx + 1} must have close date`);
    assert.ok(c.planDate, `Cycle ${idx + 1} must have plan date`);
    assert.ok(c.tech, `Cycle ${idx + 1} must have assigned tech`);
    assert.ok(c.note, `Cycle ${idx + 1} must have maintenance note`);
  });

  // Đảm bảo các cữ không bị trùng lặp số shot đều nhau
  const shotSet = new Set(closedCycles.map(c => c.closedShots));
  assert.equal(shotSet.size, 5, 'All 5 closed cycles must have distinct realistic shot counts');

  // Cữ 6 đang chạy từ 0 và đạt đúng 136.662 shot
  const activeCycle = cycles[5];
  assert.equal(activeCycle.isClosed, false);
  assert.equal(activeCycle.shots, 136662);
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
