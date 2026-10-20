"""Fill the supplied inspection template without rewriting its drawings or signatures."""
from copy import deepcopy
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import xml.etree.ElementTree as ET

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
ET.register_namespace('', NS)
ET.register_namespace('r', REL)
TAG = lambda name: '{' + NS + '}' + name


def column(index):
    result = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFD', str(text)).lower() if not unicodedata.combining(c))


def number(value):
    """Signed decimal degrees; prefixes do not change a dimension's magnitude."""
    if value is None or str(value).strip() == '':
        return None
    text = str(value).strip().upper().replace(',', '.').replace('\u2032', "'").replace('’', "'").replace('\u2033', '"').replace('”', '"').replace("''", '"').replace('º', '°').replace('−', '-')
    text = re.sub(r'PHI|[RCØΦϕ⌀\s]', '', text)
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?°\d+(?:\.\d+)?'\d+(?:\.\d+)?'", text):
        text = text[:-1] + '"'
    try:
        if '°' in text:
            match = re.fullmatch(r'([+-]?\d+(?:\.\d+)?)°(?:(\d+(?:\.\d+)?)\'(?:(\d+(?:\.\d+)?)")?)?', text)
            if not match:
                return None
            degrees, minutes, seconds = (Decimal(x or '0') for x in match.groups())
            if minutes >= 60 or seconds >= 60:
                return None
            sign = -1 if text.startswith('-') else 1
            return sign * (abs(degrees) + minutes / 60 + seconds / 3600)
        if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?', text):
            return None
        return Decimal(text)
    except InvalidOperation:
        return None


class ReportRow(list):
    """Measurements with the original Nominal/tolerance display formats."""


class Package:
    def __init__(self, path):
        with ZipFile(path) as archive:
            self.parts = {name: archive.read(name) for name in archive.namelist()}
        self.strings = []
        if 'xl/sharedStrings.xml' in self.parts:
            self.strings = [''.join(node.itertext()) for node in ET.fromstring(self.parts['xl/sharedStrings.xml'])]
        self.workbook = ET.fromstring(self.parts['xl/workbook.xml'])
        styles = ET.fromstring(self.parts['xl/styles.xml'])
        self.formats = {n.get('numFmtId'): n.get('formatCode', '') for n in styles.findall('.//' + TAG('numFmt'))}
        self.styles = list(styles.find(TAG('cellXfs')))
        relationships = ET.fromstring(self.parts['xl/_rels/workbook.xml.rels'])
        targets = {x.get('Id'): x.get('Target') for x in relationships}
        self.sheets = []
        for sheet in self.workbook.find(TAG('sheets')):
            target = targets[sheet.get('{' + REL + '}id')]
            name = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            self.sheets.append((sheet, name, ET.fromstring(self.parts[name])))

    def value(self, cell, preserve_number=False):
        if cell is None:
            return None
        value = cell.find(TAG('v'))
        if cell.get('t') == 'inlineStr':
            return ''.join(cell.find(TAG('is')).itertext())
        if value is None or value.text is None:
            return None
        if cell.get('t') == 's':
            return self.strings[int(value.text)]
        if cell.get('t') in ('str', 'e'):
            return value.text
        try:
            numeric = Decimal(value.text)
            if preserve_number:
                return numeric
            style_index = int(cell.get('s', '0'))
            fmt = self.formats.get(self.styles[style_index].get('numFmtId'), '') if style_index < len(self.styles) else ''
            prefix = re.match(r'^"([RCØΦ⌀])"', fmt)
            return str(numeric) + '°' if re.search('[°º]', fmt) else prefix[1] + str(numeric) if prefix else numeric
        except InvalidOperation:
            return value.text

    def format_of(self, cell):
        index = int(cell.get('s', '0')) if cell is not None else 0
        identifier = self.styles[index].get('numFmtId', '0') if index < len(self.styles) else '0'
        return self.formats.get(identifier, {'0': 'General', '1': '0', '2': '0.00', '3': '#,##0', '4': '#,##0.00'}.get(identifier, 'General'))

    def cells(self, sheet):
        return {cell.get('r'): cell for cell in sheet.findall('.//' + TAG('sheetData') + '/' + TAG('row') + '/' + TAG('c'))}

    def header(self, sheet):
        cells = self.cells(sheet)
        for cell in cells.values():
            if 'point/' in normalized(self.value(cell)) or normalized(self.value(cell)) in ('point', 'diem'):
                row = int(re.search(r'\d+', cell.get('r'))[0])
                if 'nominal' in normalized(self.value(cells.get('B' + str(row)))):
                    return row
        return None


def read_source(path, record):
    package = Package(path)
    result = []
    first_fields = None
    fields = dict(part=record.get('part', ''), mold=record.get('mold', ''), date=record.get('measuredDate', ''))
    labels = {'parts name': 'part', 'mold name': 'mold', 'date/': 'date', 'department/': 'department',
              'materia': 'material', 'hrc': 'hrc', 'qty/': 'quantity'}
    for _, _, sheet in package.sheets:
        header = package.header(sheet)
        if header is None:
            continue
        sheet_fields = dict(fields)
        cells = package.cells(sheet)
        for cell in cells.values():
            row = int(re.search(r'\d+', cell.get('r'))[0])
            if row >= header:
                continue
            text = normalized(package.value(cell))
            field = next((field for label, field in labels.items() if text.startswith(label)), None)
            if not field:
                continue
            start = re.match('[A-Z]+', cell.get('r'))[0]
            start_index = sum((ord(c) - 64) * 26 ** i for i, c in enumerate(start[::-1]))
            for col in range(start_index + 1, 17):
                value = package.value(cells.get(column(col) + str(row)))
                if value is None or str(value).strip() == '':
                    continue
                if any(normalized(value).startswith(label) for label in labels):
                    break
                sheet_fields[field] = value
                break
        if first_fields is None:
            first_fields = sheet_fields
        sample_columns = []
        for col in range(6, 101):
            value = package.value(cells.get(column(col) + str(header)))
            if value is not None and re.fullmatch(r'#?\d+', str(value)):
                sample_columns.append((col, value))
            elif value is not None and str(value).strip():
                break
        if not sample_columns:
            sample_columns = [(c, c - 5) for c in range(6, 16)]
        rows = []
        for source_row in sorted({int(re.search(r'\d+', address)[0]) for address in cells}):
            if source_row <= header:
                continue
            point = package.value(cells.get('A' + str(source_row)))
            nominal = package.value(cells.get('B' + str(source_row)))
            if point is None or not re.match(r'^\d+', str(point)) or nominal is None:
                continue
            rows.append((source_row, [package.value(cells.get(column(c) + str(source_row)), preserve_number=c in (2, 3, 4)) for c in range(1, 6)]))
        if rows:
            for offset in range(0, len(sample_columns), 10):
                batch = sample_columns[offset:offset + 10]
                samples = [v for _, v in batch] + [None] * (10 - len(batch))
                values = []
                for r, prefix in rows:
                    row = ReportRow(prefix + [package.value(cells.get(column(col) + str(r))) for col, _ in batch] + [None] * (10 - len(batch)))
                    row.source_formats = [package.format_of(cells.get(column(col) + str(r))) for col in range(1, 5)]
                    values.append(row)
                result.append((samples, values, sheet_fields))
    return fields, result or [([Decimal(i) for i in range(1, 11)], [], first_fields or fields)]


def clean_formula(reference):
    expression = f'SUBSTITUTE(UPPER(TRIM({reference}&"")),CHAR(160),"")'
    for old, new in [('PHI', ''), ('R', ''), ('C', ''), ('Ø', ''), ('Φ', ''), ('ϕ', ''), ('⌀', ''), ('−', '-'), ('º', '°'), (',', '.'), (' ', ''), ('′', "'"), ('’', "'")]:
        expression = f'SUBSTITUTE({expression},"{old}","{new}")'
    for old in ('″', '”', "''"):
        expression = f'SUBSTITUTE({expression},"{old}",CHAR(34))'
    # Accept the legacy seconds terminator only; minute/second range checks
    # still happen in numeric_formula, so a genuine bad angle stays NG.
    count = f'LEN({expression})-LEN(SUBSTITUTE({expression},"\'",""))'
    return f'IF(AND(({count})=2,RIGHT({expression},1)="\'",ISERROR(SEARCH(CHAR(34),{expression}))),LEFT({expression},LEN({expression})-1)&CHAR(34),{expression})'


def numeric_formula(raw, cleaned):
    # NUMBERVALUE specifies separators explicitly, independent of the user's Excel locale.
    value = lambda x: f'_xlfn.NUMBERVALUE({x},".",",")'
    deg = value(f'LEFT({cleaned},FIND("°",{cleaned})-1)')
    minute = value(f'MID({cleaned},FIND("°",{cleaned})+1,FIND("\'",{cleaned})-FIND("°",{cleaned})-1)')
    second = value(f'MID({cleaned},FIND("\'",{cleaned})+1,FIND(CHAR(34),{cleaned})-FIND("\'",{cleaned})-1)')
    minute = f'IF(ISNUMBER(SEARCH("\'",{cleaned})),{minute},0)'
    second = f'IF(ISNUMBER(SEARCH(CHAR(34),{cleaned})),{second},0)'
    degree_count = f'LEN({cleaned})-LEN(SUBSTITUTE({cleaned},"°",""))'
    minute_count = f'LEN({cleaned})-LEN(SUBSTITUTE({cleaned},"\'",""))'
    second_count = f'LEN({cleaned})-LEN(SUBSTITUTE({cleaned},CHAR(34),""))'
    structure = f'AND(({degree_count})=1,IF(ISNUMBER(SEARCH(CHAR(34),{cleaned})),AND(({second_count})=1,({minute_count})=1,RIGHT({cleaned},1)=CHAR(34)),IF(ISNUMBER(SEARCH("\'",{cleaned})),AND(({minute_count})=1,RIGHT({cleaned},1)="\'"),RIGHT({cleaned},1)="°")))'
    dms = f'IF(OR(NOT({structure}),{minute}<0,{minute}>=60,{second}<0,{second}>=60),"",IF(LEFT({cleaned},1)="-",-1,1)*(ABS({deg})+{minute}/60+{second}/3600))'
    return f'IF(ISNUMBER({raw}),{raw},IF({cleaned}="","",IFERROR(IF(ISNUMBER(SEARCH("°",{cleaned})),{dms},{value(cleaned)}),"")))'


def report_result(row):
    nominal, first, second = [number(v) for v in row[1:4]]
    measurements = [number(v) for v in row[5:15] if v is not None and str(v).strip()]
    if not measurements:
        return ''
    if re.search('[°º]', str(row[1])) and re.search('[\'"′″]', str(row[1])):
        return 'NG' if nominal is None or any(v is None or int(v) != int(nominal) for v in measurements) else 'OK'
    if None in (nominal, first, second) or any(v is None for v in measurements):
        return 'NG'
    lower, upper = nominal + min(first, second), nominal + max(first, second)
    epsilon = Decimal('0.0000001')
    return 'NG' if any(v < lower - epsilon or v > upper + epsilon for v in measurements) else 'OK'


def row_result_formula(count, cleaned, nominal, tolerance_last, actuals, lower, upper):
    standard = f'IF(OR(COUNT({nominal}:{tolerance_last})<3,COUNT({actuals})<>({count})),"NG",IF(OR(MIN({actuals})<{lower}-0.0000001,MAX({actuals})>{upper}+0.0000001),"NG","OK"))'
    dms = f'AND(ISNUMBER(SEARCH("°",{cleaned})),ISNUMBER(SEARCH("\'",{cleaned})))'
    degrees = f'IF(OR(COUNT({nominal})<1,COUNT({actuals})<>({count})),"NG",IF(AND(TRUNC(MIN({actuals}))=TRUNC({nominal}),TRUNC(MAX({actuals}))=TRUNC({nominal})),"OK","NG"))'
    return f'IF(({count})=0,"",IF({dms},{degrees},{standard}))'


def sheet_names(pages):
    def span(values):
        labels = [str(v).strip() for v in values if v is not None and str(v).strip()]
        return (labels[0] if labels[0] == labels[-1] else labels[0] + '-' + labels[-1]) if labels else ''

    bases = [('Inspection ' + span(row[0] for row in rows)) if rows else 'Inspection ' + str(i + 1)
             for i, (_, rows, _) in enumerate(pages)]
    counts, used, names = Counter(name.lower() for name in bases), set(), []
    for base, (samples, _, _) in zip(bases, pages):
        sample_span = span(samples)
        label = base + (' S' + sample_span if counts[base.lower()] > 1 and sample_span else '')
        label = re.sub(r"[\[\]\\/:*?'\x00-\x1f]", '-', label)
        name, index = label[:31], 2
        while name.lower() in used:
            suffix = ' (' + str(index) + ')'
            name = label[:31 - len(suffix)] + suffix
            index += 1
        used.add(name.lower()); names.append(name)
    return names


def template_layout(package, sheet):
    """Locate the form by labels and merged headers, never saved cell addresses."""
    cells = package.cells(sheet)
    position = lambda address: (sum((ord(c) - 64) * 26 ** i for i, c in enumerate(re.match('[A-Z]+', address)[0][::-1])), int(re.search(r'\d+', address)[0]))
    label = lambda value: re.sub(r'\s+', ' ', normalized(value or '').replace('đ', 'd')).strip()
    entries = [(address, *position(address), label(package.value(cell))) for address, cell in cells.items()]
    merges = []
    for node in sheet.findall('.//' + TAG('mergeCell')):
        start, end = (position(a) for a in node.get('ref').split(':'))
        merges.append((*start, *end))
    extent = lambda c, r: next((m for m in merges if m[0] == c and m[1] == r), (c, r, c, r))
    matches = lambda text, words: any(text == word or any(text.startswith(word + separator) for separator in ('/', ' ', ':')) for word in words)
    points = [e for e in entries if matches(e[3], ('point', 'diem')) and any(n[2] == e[2] and matches(n[3], ('nominal', 'nomial', 'danh nghia')) for n in entries)]
    if not points:
        raise ValueError('Template thiếu tiêu đề Point và Nominal trên cùng hàng.')
    if len(points) != 1:
        raise ValueError('Template có nhiều bảng Point/Nominal trên cùng sheet.')
    point = points[0]
    header = point[2]
    nearby = [e for e in entries if header <= e[2] <= header + 2]
    find = lambda words: next((e for e in nearby if matches(e[3], words)), None)
    nominal, tool, remark, tolerance = find(('nominal', 'nomial', 'danh nghia')), find(('tool', 'dung cu')), find(('remark', 'ghi chu')), find(('tol', 'tolerance', 'dung sai'))
    if any(e is None for e in (nominal, tool, remark, tolerance)):
        raise ValueError('Template cần có Nominal, Tol/Dung sai, Tool và Remark/Ghi chú.')
    tol_extent = extent(tolerance[1], tolerance[2])
    signs = {e[3].replace('−', '-'): e[1] for e in nearby if tol_extent[0] <= e[1] <= tol_extent[2] and e[3] in ('-', '−', '+')}
    if '-' not in signs or '+' not in signs:
        raise ValueError('Không nhận diện được hai cột Tol - và + của template.')
    samples = list(range(tool[1] + 1, remark[1]))
    if len(samples) != 10:
        raise ValueError('Template cần 10 cột Sample liên tiếp giữa Tool và Remark.')
    header_end = max(extent(e[1], e[2])[3] for e in (point, nominal, tool, remark, tolerance))
    for e in nearby:
        if samples[0] <= e[1] <= samples[-1] and ('details' in e[3] or 'chi tiet' in e[3]):
            header_end = max(header_end, extent(e[1], e[2])[3])
    first = header_end + 1
    footer = min((e[2] for e in entries if e[2] >= first and any(word in e[3] for word in ('ngoai quan', 'appearance', 'luu y:', 'prepare by'))), default=None)
    last = footer - 1 if footer is not None else first - 1
    if footer is None:
        while cells.get(column(remark[1]) + str(last + 1)) is not None and cells[column(remark[1]) + str(last + 1)].find(TAG('f')) is not None:
            last += 1
    if last < first:
        raise ValueError('Không xác định được cuối vùng điểm đo; cần dòng Ngoại quan/Appearance hoặc công thức Remark.')
    targets = {}
    aliases = {'part': ('parts name', 'part name', 'ten linh kien'), 'mold': ('mold name', 'ten khuon'), 'date': ('date', 'ngay kiem tra'), 'department': ('department', 'bo phan'), 'material': ('materia', 'material', 'nguyen lieu'), 'hrc': ('hrc', 'do cung'), 'quantity': ('qty', 'quantity', 'so luong')}
    for e in entries:
        if e[2] >= header:
            continue
        for field, words in aliases.items():
            if matches(e[3], words) or field == 'hrc' and e[3].startswith('hrc'):
                address = column(extent(e[1], e[2])[2] + 1) + str(e[2])
                if field in targets and targets[field] != address:
                    raise ValueError('Template có nhiều vùng ' + field + ', không tự chọn để tránh điền sai.')
                targets[field] = address
    judgement_label = next((e for e in entries if e[2] < header and matches(e[3], ('judgement', 'judgment', 'ket luan'))), None)
    judgement = (column(judgement_label[1]) + str(extent(judgement_label[1], judgement_label[2])[3] + 1)) if judgement_label else next((a for a, cell in cells.items() if cell.find(TAG('f')) is not None and 'COUNTIF(' in (cell.find(TAG('f')).text or '')), None)
    if judgement is None:
        raise ValueError('Template thiếu ô Judgement/Kết luận.')
    sample_header = max(range(header, header_end + 1), key=lambda r: sum(bool(re.fullmatch(r'#?\d+', str(package.value(cells.get(column(c) + str(r)))))) for c in samples))
    columns = [point[1], nominal[1], signs['-'], signs['+'], tool[1], *samples]
    return {'header': sample_header, 'first': first, 'last': last, 'columns': columns, 'remarkColumn': remark[1], 'helperColumn': max(*columns, remark[1]) + 2, 'targets': targets, 'judgement': judgement}


class ReportTemplate:
    def __init__(self, path):
        self.package = Package(path)
        candidates, errors = [], []
        for candidate in self.package.sheets:
            try:
                layout = template_layout(self.package, candidate[2])
                candidates.append((*candidate, layout))
            except ValueError as error:
                errors.append(str(error))
        if len(candidates) != 1:
            raise ValueError('Template cần đúng một biểu mẫu đo. ' + '; '.join(errors))
        self.sheet, self.path, self.xml, self.layout = candidates[0]
        self.header, self.first, self.last = (self.layout[key] for key in ('header', 'first', 'last'))
        self.parts = dict(self.package.parts)
        self.insert_count = max(0, 40 - (self.last - self.first + 1))
        self.insert_at = self.last + 1 if self.insert_count else None
        if self.insert_at is not None:
            insert_at = self.insert_at
            shift = lambda value: re.sub(r'(\$?[A-Z]{1,3}\$?)(\d+)', lambda m: m[1] + str(int(m[2]) + (self.insert_count if int(m[2]) >= insert_at else 0)), value)
            data = self.xml.find(TAG('sheetData'))
            last_row = next(row for row in data if int(row.get('r')) == self.last)
            for row in data:
                if int(row.get('r')) >= insert_at:
                    row.set('r', str(int(row.get('r')) + self.insert_count))
                    for cell in row:
                        cell.set('r', shift(cell.get('r')))
            for node in self.xml.findall('.//' + TAG('mergeCell')):
                node.set('ref', shift(node.get('ref')))
            for node in self.xml.findall('.//' + TAG('brk')):
                if int(node.get('id')) >= insert_at:
                    node.set('id', str(int(node.get('id')) + self.insert_count))
            for node in self.package.workbook.findall('.//' + TAG('definedName')):
                node.text = shift(node.text)
            for r in range(insert_at, insert_at + self.insert_count):
                row = deepcopy(last_row); row.set('r', str(r))
                for cell in row:
                    cell.set('r', re.sub(r'\d+$', str(r), cell.get('r')))
                    for child in list(cell):
                        cell.remove(child)
                    cell.attrib.pop('t', None)
                data.append(row)
            self.last += self.insert_count
        self.styles = ET.fromstring(self.parts['xl/styles.xml'])
        self.style_cache = {}
        self.emphasis_cache = {}
        self.font_cache = {}

    def browser_spec(self, url):
        raw_columns = [column(c) for c in self.layout['columns'][1:4] + self.layout['columns'][5:]]
        helper = self.layout['helperColumn']
        return {'schemaVersion': 1, 'url': url, 'header': self.header, 'first': self.first, 'last': self.last,
                'targets': self.layout['targets'], 'judgement': self.layout['judgement'],
                'columns': self.layout['columns'], 'remarkColumn': self.layout['remarkColumn'],
                'formulaBase': {'rawColumn': raw_columns[0], 'cleanColumn': column(helper)},
                'resultFormula': row_result_formula('@COUNT@', '@CLEAN@', '@N@', '@B@', '@ACTUALS@', '@LO@', '@HI@'),
                'cleanFormulas': [clean_formula(col + '@ROW@') for col in raw_columns],
                'numberFormulas': [numeric_formula(col + '@ROW@', column(helper + i) + '@ROW@') for i, col in enumerate(raw_columns)]}

    def numeric_style(self, base, code):
        key = (base, code)
        if key not in self.style_cache:
            formats = self.styles.find(TAG('numFmts'))
            if formats is None:
                formats = ET.Element(TAG('numFmts')); self.styles.insert(0, formats)
            identifier = max([163] + [int(x.get('numFmtId')) for x in formats]) + 1
            ET.SubElement(formats, TAG('numFmt'), numFmtId=str(identifier), formatCode=code)
            formats.set('count', str(len(formats)))
            styles = self.styles.find(TAG('cellXfs'))
            style = deepcopy(styles[int(base)])
            style.set('numFmtId', str(identifier)); style.set('applyNumberFormat', '1')
            self.style_cache[key] = str(len(styles)); styles.append(style); styles.set('count', str(len(styles)))
        return self.style_cache[key]

    def emphasis_style(self, base, bold):
        key = (base, bold)
        if key not in self.emphasis_cache:
            styles, fonts = self.styles.find(TAG('cellXfs')), self.styles.find(TAG('fonts'))
            style = deepcopy(styles[int(base)])
            font_id = int(style.get('fontId', '0'))
            font_key = (font_id, bold)
            if font_key not in self.font_cache:
                font = deepcopy(fonts[font_id])
                for node in list(font.findall(TAG('b'))):
                    font.remove(node)
                if bold:
                    ET.SubElement(font, TAG('b'))
                self.font_cache[font_key] = str(len(fonts))
                fonts.append(font); fonts.set('count', str(len(fonts)))
            style.set('fontId', self.font_cache[font_key]); style.set('applyFont', '1')
            self.emphasis_cache[key] = str(len(styles))
            styles.append(style); styles.set('count', str(len(styles)))
        return self.emphasis_cache[key]

    def fill(self, fields, rows, samples, page_name, names, page_results):
        sheet = deepcopy(self.xml)
        data = sheet.find(TAG('sheetData'))
        row_nodes = {int(row.get('r')): row for row in data}
        cells = self.package.cells(sheet)

        def put(address, value=None, formula=None, numeric_format=None):
            row_number = int(re.search(r'\d+', address)[0])
            if row_number not in row_nodes:
                row_nodes[row_number] = ET.SubElement(data, TAG('row'), r=str(row_number))
            cell = cells.get(address)
            if cell is None:
                cell = ET.SubElement(row_nodes[row_number], TAG('c'), r=address)
                cells[address] = cell
            for child in list(cell):
                cell.remove(child)
            cell.attrib.pop('t', None)
            if numeric_format:
                cell.set('s', self.numeric_style(cell.get('s', '0'), numeric_format))
            if formula:
                ET.SubElement(cell, TAG('f')).text = formula
                if isinstance(value, str):
                    cell.set('t', 'str')
                ET.SubElement(cell, TAG('v')).text = str(value) if value is not None else ''
            elif value is not None and value != '':
                if isinstance(value, (Decimal, float, int)):
                    ET.SubElement(cell, TAG('v')).text = str(value)
                else:
                    cell.set('t', 'inlineStr')
                    ET.SubElement(ET.SubElement(cell, TAG('is')), TAG('t')).text = str(value)

        columns, remark, helper = self.layout['columns'], self.layout['remarkColumn'], self.layout['helperColumn']
        for field, address in self.layout['targets'].items():
            put(address, fields.get(field), numeric_format='dd/mm/yyyy' if field == 'date' and isinstance(fields.get(field), Decimal) else None)
        for c, sample in zip(columns[5:], samples):
            put(column(c) + str(self.header), sample)
        for offset, r in enumerate(range(self.first, self.last + 1)):
            values = rows[offset] if offset < len(rows) else [None] * 15
            for col, value in enumerate(values, 1):
                if 6 <= col <= 15 and isinstance(value, str) and re.fullmatch(r'[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?', value.strip()):
                    value = number(value)
                if isinstance(value, str) and col != 5:
                    value = re.sub('phi', 'Ø', value, flags=re.I)
                source_formats = getattr(values, 'source_formats', ['General'] * 4)
                fmt = '0.000' if 6 <= col <= 15 else source_formats[col-1] if col in (2, 3, 4) else None
                put(column(columns[col - 1]) + str(r), value, numeric_format=fmt)
            # Inspectable numeric helpers outside the report's print area.
            raw_columns = [column(c) for c in columns[1:4] + columns[5:]]
            for i, raw_col in enumerate(raw_columns):
                raw, cleaned, numeric = raw_col + str(r), column(helper + i) + str(r), column(helper + 13 + i) + str(r)
                raw_value = values[i + 1 if i < 3 else i + 2]
                clean = '' if raw_value is None else re.sub(r'PHI|[RCØΦ\s]', '', str(raw_value).upper()).replace('′', "'").replace('″', '"')
                put(cleaned, clean, clean_formula(raw))
                numeric_value = number(raw_value)
                put(numeric, numeric_value if numeric_value is not None else '', numeric_formula(raw, cleaned), '0.###############')
            lo, hi = column(helper + 26) + str(r), column(helper + 27) + str(r)
            n = column(helper + 13) + str(r)
            actuals = column(helper + 16) + str(r) + ':' + column(helper + 25) + str(r)
            nominal, a, b = [number(v) for v in values[1:4]]
            valid = None not in (nominal, a, b)
            a_ref, b_ref = column(helper + 14) + str(r), column(helper + 15) + str(r)
            put(lo, nominal + min(a, b) if valid else '', f'IF(COUNT({n}:{b_ref})=3,{n}+MIN({a_ref}:{b_ref}),"")', '0.###############')
            put(hi, nominal + max(a, b) if valid else '', f'IF(COUNT({n}:{b_ref})=3,{n}+MAX({a_ref}:{b_ref}),"")', '0.###############')
            sample_range = column(columns[5]) + str(r) + ':' + column(columns[-1]) + str(r)
            count = f'COLUMNS({sample_range})-COUNTBLANK({sample_range})'
            formula = row_result_formula(count, column(helper) + str(r), n, b_ref, actuals, lo, hi)
            put(column(remark) + str(r), report_result(values), formula)
            repeated = any(number(str(sample).lstrip('#')) is not None and number(str(sample).lstrip('#')) >= 2
                           and value is not None and str(value).strip() != ''
                           for sample, value in zip(samples, values[5:]))
            for col in columns + [remark]:
                cell = cells.get(column(col) + str(r))
                if cell is not None:
                    cell.set('s', self.emphasis_style(cell.get('s', '0'), repeated and col in columns[:4]))
        for i, name in enumerate(['Nominal', 'Tolerance 1', 'Tolerance 2'] + ['Sample ' + str(v) for v in samples]):
            put(column(helper + 13 + i) + str(self.header), name)
        refs = ["'" + name.replace("'", "''") + f"'!{column(remark)}{self.first}:{column(remark)}{self.last}" for name in names]
        counts = lambda status: '+'.join(f'COUNTIF({ref},"{status}")' for ref in refs)
        judgement = 'REJECTED' if 'NG' in page_results else 'PASSED' if 'OK' in page_results else ''
        judgement_cell = self.layout['judgement']
        formula = f'IF(({counts("NG")})>0,"REJECTED",IF(({counts("OK")})>0,"PASSED",""))'
        put(judgement_cell, judgement, formula)
        cols = sheet.find(TAG('cols'))
        if cols is None:
            cols = ET.Element(TAG('cols')); sheet.insert(list(sheet).index(data), cols)
        # Remove empty template column formatting where the new helpers live.
        for item in list(cols):
            if int(item.get('min')) >= helper:
                cols.remove(item)
            elif int(item.get('max')) >= helper:
                item.set('max', str(helper - 1))
        ET.SubElement(cols, TAG('col'), min=str(helper), max=str(helper + 27), width='18', customWidth='1', hidden='1', outlineLevel='1')
        sheet.find(TAG('dimension')).set('ref', 'A1:' + column(helper + 27) + str(max(row_nodes)))
        for row in data:
            row[:] = sorted(row, key=lambda c: (len(re.match('[A-Z]+', c.get('r'))[0]), re.match('[A-Z]+', c.get('r'))[0]))
        data[:] = sorted(data, key=lambda x: int(x.get('r')))
        # Keep the surrounding native XML byte-for-byte: drawings, signatures, page setup, validations.
        raw = self.parts[self.path].decode('utf-8')
        for tag in ('sheetData', 'cols', 'dimension', 'mergeCells'):
            node = sheet.find(TAG(tag))
            replacement = ET.tostring(node, encoding='unicode')
            raw, count = re.subn(r'<' + tag + r'\b[^>]*(?:/>|>.*?</' + tag + r'>)', lambda _: replacement, raw, count=1, flags=re.S)
            if count != 1:
                raise ValueError('Cannot preserve template XML section: ' + tag)
        raw = re.sub(r'\s+codeName="[^"]*"', '', raw)
        return raw.encode('utf-8')

    def build(self, source, record, output):
        fields, source_sheets = read_source(source, record)
        pages = []
        capacity = 40
        for group in source_sheets:
            samples, rows = group[:2]
            page_fields = group[2] if len(group) > 2 else fields
            for offset in range(0, max(1, len(rows)), capacity):
                pages.append((samples, rows[offset:offset + capacity], page_fields))
        names = sheet_names(pages)
        results = [report_result(row) for _, rows, _ in pages for row in rows]
        workbook = deepcopy(self.package.workbook)
        relationships = ET.fromstring(self.parts['xl/_rels/workbook.xml.rels'])
        types = ET.fromstring(self.parts['[Content_Types].xml'])
        parts = dict(self.parts)
        workbook.find(TAG('sheets')).clear()
        for child in list(relationships):
            if child.get('Type', '').endswith(('/worksheet', '/calcChain')):
                relationships.remove(child)
        for child in list(types):
            if child.get('PartName', '').startswith('/xl/worksheets/') or child.get('PartName') == '/xl/calcChain.xml':
                types.remove(child)
        # Preserve non-form template sheets, if present in a future revision.
        other_sheets = [(s, p, x) for s, p, x in self.package.sheets if p != self.path]
        rid = 1 + max([0] + [int(x.get('Id')[3:]) for x in relationships if re.fullmatch(r'rId\d+', x.get('Id', ''))])
        originals = self.parts.get(self.path.replace('worksheets/', 'worksheets/_rels/') + '.rels')
        for i, (samples, rows, page_fields) in enumerate(pages):
            sheet_path = f'xl/worksheets/sheet{i + 1}.xml'
            parts[sheet_path] = self.fill(page_fields, rows, samples, names[i], names, results)
            if originals:
                sheet_rels = ET.fromstring(originals)
                for relationship in sheet_rels:
                    if relationship.get('Type', '').endswith('/drawing'):
                        target = relationship.get('Target')
                        original_drawing = 'xl/' + target.removeprefix('../')
                        clone = f'xl/drawings/report{i + 1}.xml'
                        parts[clone] = self.parts[original_drawing]
                        if self.insert_at is not None:
                            drawing = ET.fromstring(parts[clone])
                            for row in drawing.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}row'):
                                if int(row.text) >= self.insert_at - 1:
                                    row.text = str(int(row.text) + self.insert_count)
                            parts[clone] = ET.tostring(drawing, encoding='utf-8', xml_declaration=True)
                        old_rels = original_drawing.replace('drawings/', 'drawings/_rels/') + '.rels'
                        if old_rels in self.parts:
                            parts[clone.replace('drawings/', 'drawings/_rels/') + '.rels'] = self.parts[old_rels]
                        relationship.set('Target', f'../drawings/report{i + 1}.xml')
                        ET.SubElement(types, '{' + CT + '}Override', PartName='/' + clone, ContentType='application/vnd.openxmlformats-officedocument.drawing+xml')
                parts[f'xl/worksheets/_rels/sheet{i + 1}.xml.rels'] = ET.tostring(sheet_rels, encoding='utf-8', xml_declaration=True)
            sheet_id = 'rId' + str(rid); rid += 1
            ET.SubElement(workbook.find(TAG('sheets')), TAG('sheet'), name=names[i], sheetId=str(i + 1), attrib={'{' + REL + '}id': sheet_id})
            ET.SubElement(relationships, '{' + PKG + '}Relationship', Id=sheet_id, Type=REL + '/worksheet', Target=f'worksheets/sheet{i + 1}.xml')
            ET.SubElement(types, '{' + CT + '}Override', PartName='/' + sheet_path, ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
        if other_sheets:
            raise ValueError('Template includes extra sheets; configure their mappings before publication')
        defined = workbook.find(TAG('definedNames'))
        if defined is None:
            defined = ET.SubElement(workbook, TAG('definedNames'))
        original_names = list(defined)
        defined.clear()
        for i, name in enumerate(names):
            for existing in original_names:
                copy = deepcopy(existing); copy.set('localSheetId', str(i))
                copy.text = copy.text.replace("'" + self.sheet.get('name').replace("'", "''") + "'!", "'" + name + "'!")
                defined.append(copy)
        calc = workbook.find(TAG('calcPr'))
        if calc is None:
            calc = ET.SubElement(workbook, TAG('calcPr'))
        calc.set('calcMode', 'auto'); calc.set('fullCalcOnLoad', '1'); calc.set('forceFullCalc', '1')
        workbook_xml = self.parts['xl/workbook.xml'].decode('utf-8')
        for tag in ('sheets', 'definedNames', 'calcPr'):
            replacement = ET.tostring(workbook.find(TAG(tag)), encoding='unicode')
            workbook_xml, count = re.subn(r'<' + tag + r'\b[^>]*(?:/>|>.*?</' + tag + r'>)', lambda _: replacement, workbook_xml, count=1, flags=re.S)
            if not count:
                workbook_xml = workbook_xml.replace('</workbook>', replacement + '</workbook>')
        parts['xl/workbook.xml'] = workbook_xml.encode('utf-8')
        parts['xl/_rels/workbook.xml.rels'] = ET.tostring(relationships, encoding='utf-8', xml_declaration=True)
        parts['[Content_Types].xml'] = ET.tostring(types, encoding='utf-8', xml_declaration=True)
        styles_xml = self.parts['xl/styles.xml'].decode('utf-8')
        for tag in ('numFmts', 'fonts', 'cellXfs'):
            replacement = ET.tostring(self.styles.find(TAG(tag)), encoding='unicode')
            styles_xml, count = re.subn(r'<' + tag + r'\b[^>]*(?:/>|>.*?</' + tag + r'>)', lambda _: replacement, styles_xml, count=1, flags=re.S)
            if not count:
                styles_xml = styles_xml.replace('<fonts', replacement + '<fonts', 1)
        parts['xl/styles.xml'] = styles_xml.encode('utf-8')
        parts.pop('xl/calcChain.xml', None)
        # Remove dangling old sheet packages; all images and template signatures stay intact.
        for name in list(parts):
            match = re.fullmatch(r'xl/worksheets/(?:_rels/)?sheet(\d+)\.xml(?:\.rels)?', name)
            if match and int(match[1]) > len(pages):
                parts.pop(name)
        with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
            for name, payload in parts.items():
                entry = ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
                entry.compress_type = ZIP_DEFLATED
                archive.writestr(entry, payload)
        return {'pages': len(pages), 'rows': sum(len(rows) for _, rows, _ in pages),
                'samples': sum(sum(v is not None and str(v).strip() != '' for v in row[5:15]) for _, rows, _ in pages for row in rows)}


def configured_template(root):
    config = json.loads((root / 'inspection-report.config.json').read_text(encoding='utf-8-sig'))
    path = (root / config['template']).resolve()
    if not path.is_relative_to(root.resolve()) or path.suffix.lower() != '.xlsx':
        raise ValueError('Invalid report template path')
    return path
