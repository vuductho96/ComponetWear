# Inspection Tool integration

`InspectionTool.WebPublish.ps1` is the source of the Publish button installed in the local Inspection Tool. Copy it beside `InspectionTool.ps1`. Create `InspectionWebPublish.config.json` there containing `{"projectRoot":"C:\\path\\to\\ComponetlifeApp"}`.

Load the module after the app controls/save handlers are defined, immediately before `Application.Run($form)`:

```powershell
$webPublishModule = Join-Path $PSScriptRoot 'InspectionTool.WebPublish.ps1'
if (Test-Path -LiteralPath $webPublishModule) { . $webPublishModule }
```

The button starts `Publish-Inspection-Web.ps1` in the background and reads local status only while a manual run is active. The existing app stays open. `Publish-Web.bat` offers the same action from a separate window.

## Auto fill test results in measurement preview

Copy `InspectionTool.QuickEdit.ps1` and `InspectionTool.DimensionSave.ps1` beside the desktop app, then load the QuickEdit module after the preview controls and edit handlers are initialized:

```powershell
$quickEditModule = Join-Path $PSScriptRoot 'InspectionTool.QuickEdit.ps1'
if (Test-Path -LiteralPath $quickEditModule) { . $quickEditModule }
```

**Sửa nhanh** fills Actual values within nominal/tolerance limits for visible NG rows and saves to the original Excel cells in one save. Existing OK rows and hidden samples remain unchanged. Each operation creates a timestamped `.bak` in `.inspection-backups` before saving. Nominal values, tolerance cells, macros and workbook comments are preserved; no notes or dialogs are added. Missing tolerance rows are skipped. The preview and quality counts refresh after a successful save. Save failures keep the previous preview/cache values.

## Public report downloads

People with the website link can download an `.xlsx` inspection report using the configured MMFD-I-F-067 template, plus the original locked PDF drawing. No login is required.

Publishing runs `ComponentLife/prepare_inspection_downloads.ps1`. It retains the original Excel bytes and publishes one template plus a compact mapping/formula specification. It does not generate filled reports during Publish. Clicking Excel or the row ZIP button invokes `js/inspection-report.js` to parse the source and create the report entirely in the browser. Generated reports are not uploaded or stored on the server. The row ZIP contains that generated Excel and the original PDF copies.

Select the template in `inspection-report.config.json`. Every download fetches the latest index, so replacing the template and publishing automatically changes subsequent downloads. Unchanged sources/templates use immutable content hashes. Source workbooks stay untouched, including `.xlsm`; downloaded reports use `.xlsx` and do not copy source VBA. More points or samples create continuation sheets with the original point/sample labels. Each source worksheet retains its own part/material/date metadata. Unknown source layouts fail clearly rather than producing an empty or mis-mapped report.

The supplied template layout, revision details, logos and signatures are preserved. Nominal/tolerance formats come from the source workbook. Numeric Actual displays three decimals; DMS Actual stays as DMS text. Missing/unparseable measured values are NG, and signed tolerances use the actual minimum and maximum bounds. Numeric helpers outside the print area drive real OK/NG and report judgement formulas, verified in native Excel and browser fixtures. `inspection_report.py` supplies template detection/formula patterns and a reference renderer; production downloads are built in JavaScript.

Rapid auto samples and Inspection Quick Fill share the same formatter and validation. Degree-only Nominal prefers its own value when permitted by signed tolerances. DMS samples keep the degree component and stay near Nominal, varying minutes/seconds only. Quick Fill writes comparison formulas to the edited source rows, preserves DMS text and retains backups before editing.

DMS evaluation follows the requested local rule: when Nominal includes degrees plus minutes/seconds, compare only the whole degree component using truncation toward zero. Matching degree components are OK regardless of minute/second differences or the tolerance cells. Different degree components or unparseable angles are NG. Degree-only and linear dimensions retain the normal signed tolerance check. Desktop scan, inline edits, web results and generated Excel formulas share this rule.

PDF passwords are read privately from `.cloud-publish/inspection-download-password.txt` (or `COMPONENTLIFE_PDF_PASSWORD`), never added to public metadata, HTML, tooltips or browser scripts. Download preparation has a shared process lock; concurrent Publish runs wait instead of writing the same temporary file.

Degree-only angles with both tolerance cells empty also compare whole degrees. Partially missing or invalid tolerances remain NG.

Inspection Tool additionally marks measured rows NG when the source Remark/Result cell contains a cached Excel error such as #VALUE! or #REF!, even when Actual passes. This source-formula policy is desktop-only and preserves the original workbook. Scan cache version: v8.

Angle formula helpers now start at AT and skip merged/occupied value cells, preserving source drawing blocks such as S3:AB56. Native Rapid export and Inspection Quick Fill share this layout. Regression tests exercise merged drawing blocks in both native Excel and EPPlus saves.

Convert-InspectionDecimalAngles.ps1 accepts an audited JSON plan (file, part, cell, nominal, actual). Preview is the default; -Apply preserves numeric angle magnitude while changing decimal-degree Actual to DMS, recalculates real Excel formulas on a temporary copy, verifies protected image/VBA parts, and backs up originals. Packed digits and ambiguous angle values are rejected; they are never regenerated.
