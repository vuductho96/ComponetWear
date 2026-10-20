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

## Public original downloads

People with the website link can download the selected inspection's original Excel workbook (including `.xlsm`) and its original PDF drawing. PDF download copies require the opening password **7139**; local originals remain unchanged. Online viewing and OCR behavior stay the same, and no login or account permissions are enabled.

Publishing runs `ComponentLife/prepare_inspection_downloads.ps1`. It copies Excel bytes unchanged, encrypts PDFs without rasterizing their pages, and writes an explicit download index after all files are ready. Only indexed files in `data/inspection/downloads/` are public. Persistent encryption/hash caches stay in `.cloud-publish`; unchanged originals are reused on later publishes.
