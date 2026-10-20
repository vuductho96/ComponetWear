"""Refresh Rapid's Excel formulas from the browser report implementation."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ComponentLife'))
from inspection_report import clean_formula, numeric_formula, column, row_result_formula

refs = ['B', 'C', 'D'] + [column(i) for i in range(6, 16)]
payload = {
    'result': row_result_formula('@COUNT@', '@CLEAN@', '@N@', '@B@', '@ACTUALS@', '@LO@', '@HI@'),
    'clean': [clean_formula(c + '@ROW@') for c in refs],
    'number': [numeric_formula(c + '@ROW@', column(18 + i) + '@ROW@') for i, c in enumerate(refs)],
}
(Path(__file__).parent / 'MeasurementContract.formulas.json').write_text(
    json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
