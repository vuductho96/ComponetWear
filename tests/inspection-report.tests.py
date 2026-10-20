import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ComponentLife'))
from inspection_report import ReportTemplate, Package, configured_template, number, report_result, TAG

ROOT = Path(__file__).resolve().parents[1]


def cases():
    return [
        ['R0.400', '+0.01', '+0.02', 0.41, 'OK'],
        ['R0.400', '+0.02', '+0.01', 0.43, 'NG'],
        ['C0.400', '-0.01', '-0.02', 0.385, 'OK'],
        ['C0.400', '-0.02', '-0.01', 0.400, 'NG'],
        ['PHI0.400', '-0.01', '+0.01', 'PHI0.410', 'OK'],
        ['36°13\'22"', '-0°0\'1"', '+0°0\'1"', '36°13\'24"', 'NG'],
        ['36°13\'22"', '-0°0\'1"', '+0°0\'1"', '36°13\'23"', 'OK'],
        [0.5, 0, 0.001, 0.501, 'OK'],
        [0.5, 0, 0.001, 0.5011, 'NG'],
        ['Ø0.400', '-0.01', '+0.01', 0.39, 'OK'],
        ['-0°30\'0"', '-0°0\'1"', '+0°0\'1"', -0.5, 'OK'],
        [0.4, None, 0.01, 0.4, 'UNRATED'],
        ['36°60\'0"', '-0°0\'1"', '+0°0\'1"', 37, 'UNRATED'],
        ['Ø0,400', '-0,01', '+0,01', '0,410', 'OK'],
    ]


def fixture(root, repetitions=1):
    template = ReportTemplate(configured_template(ROOT))
    rows = []
    for repeat in range(repetitions):
        for i, (nominal, a, b, actual, expected) in enumerate(cases()):
            rows.append([repeat * len(cases()) + i + 1, nominal, a, b, 'B', actual] + [None] * 9)
    # Place test input into an ordinary source worksheet without authoring a second template.
    input_rows = rows[:template.last - template.first + 1]
    parts = dict(template.parts)
    parts[template.path] = template.fill({'part': 'TEST214', 'mold': 'MF00307', 'quantity': 16}, input_rows,
                                       list(range(11, 21)), 'Inspection 1', ['Inspection 1'], [report_result(r) for r in input_rows])
    source = root / 'source.xlsx'
    with ZipFile(source, 'w') as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return template, source, rows


class ReportTests(unittest.TestCase):
    def test_numbers_and_classification(self):
        for nominal, a, b, actual, expected in cases():
            self.assertEqual(report_result([1, nominal, a, b, 'B', actual] + [None] * 9), expected)
        self.assertIsNone(number('36°60\'0"'))

    def test_template_preservation_formulas_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, rows = fixture(root)
            before = source.read_bytes()
            output = root / 'report.xlsx'
            stats = template.build(source, {}, output)
            self.assertEqual(stats['samples'], len(cases()))
            self.assertEqual(source.read_bytes(), before)
            result = Package(output)
            cells = result.cells(result.sheets[0][2])
            for i, case in enumerate(cases()):
                self.assertEqual(result.value(cells['P' + str(template.first + i)]), case[-1])
                self.assertIsNotNone(cells['P' + str(template.first + i)].find(TAG('f')))
            self.assertEqual(result.value(cells['F' + str(template.header)]), 11)
            self.assertEqual(result.value(cells['C11']), 'TEST214')
            self.assertEqual(result.value(cells['P14']), 'REJECTED')
            for name, payload in template.parts.items():
                if name.startswith('xl/media/'):
                    self.assertEqual(result.parts[name], payload)
            self.assertNotIn('xl/calcChain.xml', result.parts)
            second = root / 'same.xlsx'
            template.build(source, {}, second)
            self.assertEqual(output.read_bytes(), second.read_bytes())

    def test_continuation_pages_keep_all_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, rows = fixture(root, 4)
            import inspection_report
            original = inspection_report.read_source
            inspection_report.read_source = lambda *_: ({'part': 'TEST'}, [(list(range(1, 11)), rows)])
            try:
                output = root / 'multi.xlsx'
                stats = template.build(source, {}, output)
            finally:
                inspection_report.read_source = original
            self.assertEqual(stats['rows'], len(cases()) * 4)
            self.assertEqual(stats['samples'], len(cases()) * 4)
            self.assertEqual(stats['pages'], 2)
            self.assertEqual(len(Package(output).sheets), 2)

    def test_sample_overflow_preserves_sample_labels(self):
        from inspection_report import read_source
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, _ = fixture(root)
            package = Package(source)
            sheet = package.sheets[0][2]
            cells = package.cells(sheet)
            for col, label in [('P', 21), ('Q', 22), ('R', 'Remark/Ghi chu')]:
                cell = cells.get(col + str(template.header))
                if cell is None:
                    header_row = next(r for r in sheet.find(TAG('sheetData')) if r.get('r') == str(template.header))
                    cell = ET.SubElement(header_row, TAG('c'))
                cell.clear(); cell.set('r', col + str(template.header))
                if isinstance(label, int):
                    ET.SubElement(cell, TAG('v')).text = str(label)
                else:
                    cell.set('t', 'inlineStr'); ET.SubElement(ET.SubElement(cell, TAG('is')), TAG('t')).text = label
            for col in ['P', 'Q']:
                cell = cells.get(col + str(template.first))
                if cell is None:
                    first_row = next(r for r in sheet.find(TAG('sheetData')) if r.get('r') == str(template.first))
                    cell = ET.SubElement(first_row, TAG('c'))
                cell.clear(); cell.set('r', col + str(template.first)); ET.SubElement(cell, TAG('v')).text = '0.41'
            package.parts[package.sheets[0][1]] = ET.tostring(sheet, encoding='utf-8')
            with ZipFile(source, 'w') as archive:
                for name, payload in package.parts.items(): archive.writestr(name, payload)
            _, groups = read_source(source, {})
            self.assertEqual(len(groups), 2)
            self.assertEqual(groups[1][0][:2], [21, 22])
            self.assertEqual(groups[1][1][0][5:7], [number('0.41')] * 2)

    def test_each_source_sheet_keeps_its_own_part_header(self):
        import inspection_report
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, rows = fixture(root)
            original = inspection_report.read_source
            inspection_report.read_source = lambda *_: ({}, [(list(range(1, 11)), rows[:1], {'part': '609A'}), (list(range(1, 11)), rows[:1], {'part': '609B'})])
            try:
                output = root / 'two-parts.xlsx'
                template.build(source, {}, output)
            finally:
                inspection_report.read_source = original
            result = Package(output)
            self.assertEqual([result.value(result.cells(sheet).get('C11')) for _, _, sheet in result.sheets], ['609A', '609B'])

    def test_download_cache_rebuilds_when_template_changes(self):
        import shutil
        import prepare_inspection_downloads as downloads
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, _ = fixture(root)
            shutil.copyfile(configured_template(ROOT), root / 'template.xlsx')
            (root / 'inspection-report.config.json').write_text(json.dumps({'template': 'template.xlsx'}))
            (root / 'inspection.config.json').write_text(json.dumps({'sourcePath': str(root)}))
            store = root / '.cloud-publish'; store.mkdir()
            (store / 'inspection-download-password.txt').write_text('fixture-only-password')
            data = root / 'ComponentLife/data/inspection'; data.mkdir(parents=True)
            record = {'id': 'template-fixture', 'lot': '', 'file': source.name, 'part': 'TEST', 'mold': 'MF00307', 'drawings': []}
            (data / 'summary.json').write_text(json.dumps({'records': [record]}))
            first = downloads.prepare(root)
            self.assertEqual(first, downloads.prepare(root))
            old = Package(root / 'template.xlsx')
            old.parts['xl/sharedStrings.xml'] = old.parts['xl/sharedStrings.xml'].replace(b'Initial release', b'Updated release')
            with ZipFile(root / 'template.xlsx', 'w') as archive:
                for name, payload in old.parts.items(): archive.writestr(name, payload)
            second = downloads.prepare(root)
            self.assertEqual(first['excel'][record['id']]['url'], second['excel'][record['id']]['url'])
            self.assertNotEqual(first['reportTemplate']['url'], second['reportTemplate']['url'])
            self.assertEqual((root / 'ComponentLife' / first['excel'][record['id']]['url']).read_bytes(), source.read_bytes())


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--native-fixture':
        target = ROOT / '.cloud-publish/report-native-test'
        target.mkdir(exist_ok=True)
        template, source, rows = fixture(target)
        template.build(source, {}, target / 'report.xlsx')
        (target / 'expected.json').write_text(json.dumps({'first': template.first, 'cases': cases(), 'spec': template.browser_spec('fixture-template.xlsx'), 'template': str(configured_template(ROOT))}, ensure_ascii=False), encoding='utf-8')
        print('Native formula fixture ready')
    else:
        unittest.main()
