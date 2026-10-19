# Inspection Tool integration

`InspectionTool.WebPublish.ps1` is the source of the Publish button installed in the local Inspection Tool. Copy it beside `InspectionTool.ps1`. Create `InspectionWebPublish.config.json` there containing `{"projectRoot":"C:\\path\\to\\ComponetlifeApp"}`.

Load the module after the app controls/save handlers are defined, immediately before `Application.Run($form)`:

```powershell
$webPublishModule = Join-Path $PSScriptRoot 'InspectionTool.WebPublish.ps1'
if (Test-Path -LiteralPath $webPublishModule) { . $webPublishModule }
```

The button starts `Publish-Inspection-Web.ps1` in the background and reads local status only while a manual run is active. The existing app stays open. `Publish-Web.bat` offers the same action from a separate window.

## Quick edit in measurement preview

Copy `InspectionTool.QuickEdit.ps1` and `InspectionTool.DimensionSave.ps1` beside the desktop app. After its preview grid and CellEndEdit handler are initialized, load:

```powershell
$quickEditModule = Join-Path $PSScriptRoot 'InspectionTool.QuickEdit.ps1'
if (Test-Path -LiteralPath $quickEditModule) { . $quickEditModule }
```

Select a Point/Sample row, choose **Sửa nhanh**, enter the actual measurement, and save. It uses the existing grid edit handler to recalculate limits, deviation and OK/NG, then saves the original workbook. Cancel does not write. The save helper refreshes the file signature cache after every successful save so consecutive edits continue to work, and retains pending edit flags if saving fails.
