$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$tool='C:/Users/415/Desktop/File đo linh kiện/InspectionTool.ps1'
$text=[IO.File]::ReadAllText($tool)
$rule=[regex]::Match($text,'(?m)^\$gridDimensions\.Columns\[7\]\.DefaultCellStyle\.Format = .+$').Value
$provider=[regex]::Match($text,'(?m)^\$gridDimensions\.Columns\[7\]\.DefaultCellStyle\.FormatProvider = .+$').Value
if(-not $rule -or -not $provider){throw 'Deviation display style missing'}
$gridDimensions=New-Object Windows.Forms.DataGridView
try {
    $gridDimensions.ColumnCount=8
    Invoke-Expression $rule
    Invoke-Expression $provider
    foreach($case in @(@((2.505-2.5),'0.005'),@((2.503-2.5),'0.003'),@((4.25-4.24),'0.01'),@((0.195-0.2),'-0.005'),@(0.000000001,'0.000000001'))) {
        $index=$gridDimensions.Rows.Add()
        $cell=$gridDimensions.Rows[$index].Cells[7]
        $cell.Value=$case[0]
        if($cell.FormattedValue -ne $case[1]){throw "Unexpected display: $($cell.FormattedValue)"}
        if($cell.Value -ne $case[0]){throw 'Underlying value was rounded'}
    }
    Write-Output 'PASS: Deviation display removes floating-point tails and preserves underlying values, signs and small deviations.'
} finally {$gridDimensions.Dispose()}
