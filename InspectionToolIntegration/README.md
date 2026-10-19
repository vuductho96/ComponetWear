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

**Sửa nhanh** opens **Auto fill kết quả — DỮ LIỆU TEST** for every row currently shown in the quick preview. It creates simulated measurements within the nominal/tolerance interval, retains separate samples, and reports missing tolerances. **Tạo lại** regenerates samples; **Xuất CSV TEST** writes a separate file with an explicit IsTest column. Original measurement cells and Excel workbooks are not changed by simulation. Existing direct measurement editing still uses the save helper, which fixes cache keys after successful saves and retains pending edits on failure.
