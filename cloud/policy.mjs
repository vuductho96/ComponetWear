export const recordKeys = [
  "file",
  "part",
  "mold",
  "month",
  "measuredDate",
  "source",
  "counts",
  "quality",
  "drawing",
  "lot",
  "receivedDate",
  "quantity",
];
export const detailKeys = [
  "point",
  "nominal",
  "minus",
  "plus",
  "limits",
  "sample",
  "actual",
  "deviation",
  "result",
];
export const tabKeys = [
  "overview",
  "month",
  "stock",
  "chart",
  "inspection",
  "dimensionocr",
];
export const fullPolicy = {
  records: [...recordKeys],
  details: [...detailKeys],
  previewDrawing: true,
  downloadPDF: true,
  downloadExcel: true,
};
export const fullPermissions = { tabs: [...tabKeys], inspection: fullPolicy };
export function validatePermissions(input) {
  if (
    !input ||
    !Array.isArray(input.tabs) ||
    input.tabs.some((tab) => !tabKeys.includes(tab)) ||
    new Set(input.tabs).size !== input.tabs.length
  )
    throw Object.assign(Error("Quyền xem tab không hợp lệ."), { status: 400 });
  return {
    tabs: [...input.tabs],
    inspection: validatePolicy(input.inspection),
  };
}
export const defaultPolicy = {
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
};
export function validatePolicy(input) {
  if (!input || typeof input !== "object")
    throw Object.assign(Error("Cấu hình không hợp lệ."), { status: 400 });
  const output = {};
  for (const [key, choices] of [
    ["records", recordKeys],
    ["details", detailKeys],
  ]) {
    if (
      !Array.isArray(input[key]) ||
      !input[key].length ||
      input[key].some((x) => !choices.includes(x)) ||
      new Set(input[key]).size !== input[key].length
    )
      throw Object.assign(Error("Danh sách cột không hợp lệ."), {
        status: 400,
      });
    output[key] = [...input[key]];
  }
  for (const key of ["previewDrawing", "downloadPDF", "downloadExcel"]) {
    if (typeof input[key] !== "boolean")
      throw Object.assign(Error("Quyền tải file không hợp lệ."), {
        status: 400,
      });
    output[key] = input[key];
  }
  if (
    output.downloadExcel &&
    (!recordKeys.every((k) => output.records.includes(k)) ||
      !detailKeys.every((k) => output.details.includes(k)))
  )
    throw Object.assign(
      Error(
        "Excel chứa đầy đủ dữ liệu: cần bật tất cả cột trước khi cho phép tải Excel.",
      ),
      { status: 400 },
    );
  return output;
}
export function projectSummary(data, policy) {
  const fields = {
    counts: ["points", "samples"],
    quality: ["quality", "ngSamples"],
    drawing: ["drawings", "drawingNotice"],
  };
  return {
    schemaVersion: data.schemaVersion,
    generatedAt: data.generatedAt,
    records: data.records.map((record) => {
      const out = {
        id: record.id,
        detailFile: record.detailFile,
        drawings: [],
      };
      for (const key of policy.records)
        for (const field of fields[key] || [key]) out[field] = record[field];
      if (!policy.previewDrawing)
        out.drawings = policy.downloadPDF
          ? out.drawings.map(({ id, name }) => ({ id, name, pages: [] }))
          : [];
      return out;
    }),
  };
}
export function projectDetails(data, policy) {
  const positions = {
    point: [0],
    nominal: [1],
    minus: [2],
    plus: [3],
    sample: [4],
    actual: [5],
    limits: [6, 7],
    deviation: [8],
    result: [9],
  };
  const allowed = new Set(policy.details.flatMap((key) => positions[key]));
  return Object.fromEntries(
    Object.entries(data).map(([id, rows]) => [
      id,
      rows.map((row) => row.map((value, i) => (allowed.has(i) ? value : null))),
    ]),
  );
}
