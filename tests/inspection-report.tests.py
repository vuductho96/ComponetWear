import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ComponentLife'))
from inspection_report import ReportTemplate, Package, configured_template, number, report_result, column, TAG

ROOT = Path(__file__).resolve().parents[1]


def cases():
    return [
        ['R0.400', '+0.01', '+0.02', 0.41, 'OK'],
        ['R0.400', '+0.02', '+0.01', 0.43, 'NG'],
        ['C0.400', '-0.01', '-0.02', 0.385, 'OK'],
        ['C0.400', '-0.02', '-0.01', 0.400, 'NG'],
        ['PHI0.400', '-0.01', '+0.01', 'PHI0.410', 'OK'],
        ['36°13\'22"', '-0°0\'1"', '+0°0\'1"', '36°13\'24"', 'OK'],
        ['36°13\'22"', '-0°0\'1"', '+0°0\'1"', '36°13\'23"', 'OK'],
        [0.5, 0, 0.001, 0.501, 'OK'],
        [0.5, 0, 0.001, 0.5011, 'NG'],
        ['Ø0.400', '-0.01', '+0.01', 0.39, 'OK'],
        ['-0°30\'0"', '-0°0\'1"', '+0°0\'1"', -0.5, 'OK'],
        [0.4, None, 0.01, 0.4, 'NG'],
        ['36°60\'0"', '-0°0\'1"', '+0°0\'1"', 37, 'NG'],
        ['Ø0,400', '-0,01', '+0,01', '0,410', 'OK'],
        ["28°4'21'", '-0.01', '+0.01', '28°03\'45"', 'OK'],
        ["28°4'21'", '-0.01', '+0.01', '28°03\'44"', 'OK'],
        ['0°30\'', '-0.01', '+0.01', '0°29\'', 'OK'],
        ['0°30\'', '-0.01', '+0.01', '1°00\'', 'NG'],
        ['4°25\'12"', None, None, '4°00\'00"', 'OK'],
        ['30°', None, None, '30.000', 'OK'],
        ['30°', None, None, '31.000', 'NG'],
        ['30°', None, None, 'broken', 'NG'],
        ['30°', None, 0.1, '30.000', 'NG'],
        ['30°', 'bad', 'bad', '30.000', 'NG'],
        ['4°17ʹ21ʺ', '-0.05', '0.05', "4°12'20''", 'OK'],
        ['4°17ʹ21ʺ', '-0.05', '0.05', '4°12ʹ20ʺ', 'OK'],
        ['4°17ʹ21ʺ', '-0.05', '0.05', '5°12ʹ20ʺ', 'NG'],
        ['4°17ʹ21ʺ', '-0.05', '0.05', "4°25'60''", 'NG'],
        ["2°51'45''", '-0.05', '0.05', "2°44'68''", 'NG'],
        ['90°', '-0.5', '0.5', 90, 'OK'],
        ['34°59′31″', '-0.01', '0.01', '34°59′26″', 'OK'],
        ['28°4′21″', '-0.01', '0.01', '28°04′20″', 'OK'],
    ]


def fixture(root, repetitions=1):
    import xml.etree.ElementTree as ET
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
    parts['xl/styles.xml'] = ET.tostring(template.styles, encoding='utf-8')
    source = root / 'source.xlsx'
    with ZipFile(source, 'w') as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return template, source, rows


def moved_template(root):
    """A revised form: three new heading rows, two leading columns, no old formulas."""
    import re
    import xml.etree.ElementTree as ET
    from inspection_report import column
    package = Package(configured_template(ROOT))
    sheet = package.sheets[0][2]
    def shift(reference):
        def moved(match):
            c = sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(match[2][::-1]))
            return match[1] + column(c + 2) + match[3] + str(int(match[4]) + 3)
        return re.sub(r'(\$?)([A-Z]{1,3})(\$?)(\d+)', moved, reference)
    for row in sheet.find(TAG('sheetData')):
        row.set('r', str(int(row.get('r')) + 3))
        for cell in row:
            cell.set('r', shift(cell.get('r')))
            formula = cell.find(TAG('f'))
            if formula is not None:
                for child in list(cell):
                    cell.remove(child)
                cell.attrib.pop('t', None)
    for node in sheet.findall('.//' + TAG('mergeCell')):
        node.set('ref', shift(node.get('ref')))
    for address, sign in [('E22', '+'), ('F22', '-')]:
        cell = next(c for c in sheet.findall('.//' + TAG('c')) if c.get('r') == address)
        for child in list(cell):
            cell.remove(child)
        cell.set('t', 'inlineStr'); ET.SubElement(ET.SubElement(cell, TAG('is')), TAG('t')).text = sign
    sheet.find(TAG('dimension')).set('ref', shift(sheet.find(TAG('dimension')).get('ref')))
    for node in sheet.find(TAG('cols')):
        node.set('min', str(int(node.get('min')) + 2)); node.set('max', str(int(node.get('max')) + 2))
    for node in package.workbook.find(TAG('definedNames')):
        node.text = shift(node.text)
    package.parts[package.sheets[0][1]] = ET.tostring(sheet, encoding='utf-8')
    package.parts['xl/workbook.xml'] = ET.tostring(package.workbook, encoding='utf-8')
    for name in list(package.parts):
        if name.startswith('xl/drawings/drawing') and name.endswith('.xml'):
            drawing = ET.fromstring(package.parts[name])
            for node in drawing.iter():
                if node.tag.endswith('}row'):
                    node.text = str(int(node.text) + 3)
                elif node.tag.endswith('}col'):
                    node.text = str(int(node.text) + 2)
            package.parts[name] = ET.tostring(drawing, encoding='utf-8')
    output = root / 'moved-template.xlsx'
    with ZipFile(output, 'w') as archive:
        for name, payload in package.parts.items():
            archive.writestr(name, payload)
    return output


class ReportTests(unittest.TestCase):
    def test_ambiguous_template_metadata_is_rejected(self):
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = moved_template(root)
            package = Package(path)
            row = ET.SubElement(package.sheets[0][2].find(TAG('sheetData')), TAG('row'), r='1')
            cell = ET.SubElement(row, TAG('c'), r='A1', t='inlineStr')
            ET.SubElement(ET.SubElement(cell, TAG('is')), TAG('t')).text = 'Parts Name'
            package.parts[package.sheets[0][1]] = ET.tostring(package.sheets[0][2], encoding='utf-8')
            with ZipFile(path, 'w') as archive:
                for name, payload in package.parts.items():
                    archive.writestr(name, payload)
            with self.assertRaisesRegex(ValueError, 'nhiều vùng part'):
                ReportTemplate(path)

    def test_template_regions_follow_labels_after_rows_and_columns_move(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, source, _ = fixture(root)
            template = ReportTemplate(moved_template(root))
            self.assertEqual((template.header, template.first, template.last), (21, 23, 62))
            self.assertEqual(template.layout['columns'], [3, 4, 6, 5] + list(range(7, 18)))
            self.assertEqual(template.layout['targets']['part'], 'E14')
            self.assertEqual(template.layout['judgement'], 'R17')
            output = root / 'adapted.xlsx'
            template.build(source, {}, output)
            package = Package(output)
            cells = package.cells(package.sheets[0][2])
            self.assertEqual(package.value(cells['E14']), 'TEST214')
            self.assertEqual(package.value(cells['F23']), '+0.01')
            self.assertEqual(package.value(cells['E23']), '+0.02')
            self.assertEqual([package.value(cells['R' + str(template.first + i)]) for i in range(len(cases()))], [c[-1] for c in cases()])
            self.assertIn('COUNT(AG23:AI23)', cells['R23'].find(TAG('f')).text)
            self.assertIn('MIN(AJ23:AS23)', cells['R23'].find(TAG('f')).text)
            self.assertEqual(package.value(cells['R17']), 'REJECTED')
            self.assertIn('Appearance', package.value(cells['C63']))
            self.assertTrue(all('$R$68' in n.text for n in package.workbook.find(TAG('definedNames'))))

    def test_sheet_names_show_points_and_disambiguate_samples(self):
        from inspection_report import sheet_names
        page = lambda points, samples=range(1, 11): (list(samples), [[point] for point in points], {})
        self.assertEqual(sheet_names([page(range(1, 41)), page(range(41, 51))]), ['Inspection 1-40', 'Inspection 41-50'])
        self.assertEqual(sheet_names([page([40]), page([40], range(11, 21)), page([40])]), ['Inspection 40 S1-10', 'Inspection 40 S11-20', 'Inspection 40 S1-10 (2)'])
        names = sheet_names([page(['1' * 40 + '/A']), page(['1' * 40 + '/B'])])
        self.assertEqual(len(set(names)), 2)
        self.assertTrue(all(len(name) <= 31 and not any(c in name for c in '[]\\/:*?') for name in names))

    def test_forty_points_fit_one_sheet_and_continuation_preserves_footer(self):
        import inspection_report
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template, source, _ = fixture(root)
            rows = [[point, 1, 0, 0, 'C', 1] + [None] * 9 for point in range(1, 41)]
            original = inspection_report.read_source
            inspection_report.read_source = lambda *_: ({}, [(list(range(1, 11)), rows), (list(range(1, 11)), [[41, 1, 0, 0, 'C', 1] + [None] * 9])])
            try:
                output = root / 'points.xlsx'
                template.build(source, {}, output)
            finally:
                inspection_report.read_source = original
            package = Package(output)
            self.assertEqual([sheet.get('name') for sheet, _, _ in package.sheets], ['Inspection 1-40', 'Inspection 41'])
            cells = package.cells(package.sheets[0][2])
            self.assertEqual(package.value(cells['A59']), 40)
            self.assertIn('Appearance', package.value(cells['A60']))
            self.assertIn('Prepare by', package.value(cells['A64']))
            self.assertEqual(package.sheets[0][2].find(TAG('dimension')).get('ref'), 'A1:AS65')
            self.assertIn('A61:P61', [n.get('ref') for n in package.sheets[0][2].findall('.//' + TAG('mergeCell'))])
            self.assertTrue(all('$P$65' in node.text for node in package.workbook.find(TAG('definedNames'))))
            import xml.etree.ElementTree as ET
            drawing = ET.fromstring(package.parts['xl/drawings/report1.xml'])
            anchors = [int(n.text) for n in drawing.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}row')]
            self.assertIn(63, anchors)
            self.assertNotIn(62, anchors)
            for _, _, sheet in package.sheets:
                judgement = package.cells(sheet)['P14'].find(TAG('f')).text
                for name in ('Inspection 1-40', 'Inspection 41'):
                    self.assertIn("'" + name + "'!", judgement)

    def test_source_precision_sample_decimals_and_specification_only_bold(self):
        from decimal import Decimal
        import xml.etree.ElementTree as ET
        from inspection_report import ReportRow
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template = ReportTemplate(configured_template(ROOT))
            row = ReportRow([1, Decimal('0.3'), Decimal('-0.01'), 0, 'C', '0.3', '0,300', 0] + [None] * 7)
            row.source_formats = ['General', '"R"0.00', '0.00', '0']
            parts = dict(template.parts)
            parts[template.path] = template.fill({}, [row], list(range(1, 11)), 'Inspection 1', ['Inspection 1'], ['OK'])
            parts['xl/styles.xml'] = ET.tostring(template.styles, encoding='utf-8')
            source = root / 'source.xlsx'
            with ZipFile(source, 'w') as archive:
                for name, payload in parts.items():
                    archive.writestr(name, payload)
            output = root / 'report.xlsx'
            ReportTemplate(configured_template(ROOT)).build(source, {}, output)
            package = Package(output)
            cells = package.cells(package.sheets[0][2])
            addresses = [c + str(template.first) for c in ('B', 'C', 'D', 'F', 'G', 'H')]
            self.assertEqual([package.format_of(cells[a]) for a in addresses], ['"R"0.00', '0.00', '0', '0.000', '0.000', '0.000'])
            self.assertEqual([cells[a].get('t') for a in addresses], [None] * 6)
            self.assertEqual([Decimal(cells[a].find(TAG('v')).text) for a in addresses], [Decimal('0.3'), Decimal('-0.01'), 0, Decimal('0.3'), Decimal('0.3'), 0])
            styles = ET.fromstring(package.parts['xl/styles.xml'])
            xfs, fonts = styles.find(TAG('cellXfs')), styles.find(TAG('fonts'))
            bold = lambda c: fonts[int(xfs[int(cells[c + str(template.first)].get('s', '0'))].get('fontId', '0'))].find(TAG('b')) is not None
            self.assertEqual([bold(chr(65 + i)) for i in range(16)], [True] * 4 + [False] * 12)

    def test_numbers_and_classification(self):
        for nominal, a, b, actual, expected in cases():
            self.assertEqual(report_result([1, nominal, a, b, 'B', actual] + [None] * 9), expected)
        self.assertIsNone(number('36°60\'0"'))

    def test_appearance_only_for_samples_with_measurements(self):
        import xml.etree.ElementTree as ET
        template = ReportTemplate(configured_template(ROOT))
        rows = [[1, '1', '-0.1', '0.1', 'C', 0, None, ' ', '1.200'] + [None] * 6]
        sheet = ET.fromstring(template.fill({}, rows, list(range(1, 11)), 'Inspection', ['Inspection'], ['NG']))
        cells = template.package.cells(sheet)
        appearance = template.layout['appearanceRow']
        self.assertIsNotNone(appearance)
        values = [template.package.value(cells.get(column(c) + str(appearance))) for c in template.layout['columns'][5:]]
        self.assertEqual(values, ['OK', None, None, 'OK'] + [None] * 6)
        empty = ET.fromstring(template.fill({}, [], list(range(1, 11)), 'Inspection', ['Inspection'], []))
        empty_cells = template.package.cells(empty)
        self.assertTrue(all(template.package.value(empty_cells.get(column(c) + str(appearance))) is None for c in template.layout['columns'][5:]))

    def test_degree_samples_show_units_without_changing_numeric_values(self):
        import xml.etree.ElementTree as ET
        from decimal import Decimal
        template = ReportTemplate(configured_template(ROOT))
        row = [1, '90°', '-0.5', '0.5', 'C', 90, '90.125'] + [None] * 8
        sheet = ET.fromstring(template.fill({}, [row], list(range(1, 11)), 'Inspection', ['Inspection'], ['OK']))
        cells = template.package.cells(sheet)
        for c, expected in [('F', Decimal(90)), ('G', Decimal('90.125'))]:
            cell = cells[c + str(template.first)]
            self.assertEqual(template.package.value(cell, preserve_number=True), expected)
            xf = template.styles.find(TAG('cellXfs'))[int(cell.get('s'))]
            fmt = next(x.get('formatCode') for x in template.styles.find(TAG('numFmts')) if x.get('numFmtId') == xf.get('numFmtId'))
            self.assertEqual(fmt, '0"°"' if c == 'F' else '0.###############"°"')

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
            expected_pages = (len(rows) + 39) // 40
            self.assertEqual(stats['pages'], expected_pages)
            self.assertEqual(len(Package(output).sheets), expected_pages)

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
        moved = moved_template(target)
        (target / 'expected.json').write_text(json.dumps({'first': template.first, 'cases': cases(), 'spec': template.browser_spec('fixture-template.xlsx'), 'template': str(configured_template(ROOT)), 'movedTemplate': str(moved)}, ensure_ascii=False), encoding='utf-8')
        print('Native formula fixture ready')
    else:
        unittest.main()
