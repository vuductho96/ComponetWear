"""Publish byte-identical Excel workbooks and encrypted copies of original PDFs."""
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import time

import pymupdf
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspection_report import ReportTemplate, Package, configured_template
_report_worker_template = None


def initialize_report_worker(template_path):
    global _report_worker_template
    _report_worker_template = ReportTemplate(template_path)


def build_report_task(arguments):
    target, original_name, record, signature = arguments
    target = Path(target)
    source = target / original_name
    package = Package(source)
    if not any(package.header(sheet) is not None for _, _, sheet in package.sheets):
        raise ValueError('Cannot map this source workbook to the inspection template: ' + record['file'])
    temp = target / (record['id'] + '.report.tmp')
    stats = _report_worker_template.build(source, record, temp)
    name = digest(temp) + '.xlsx'
    temp.replace(target / name)
    return record['id'], {'signature': signature, 'name': name, **stats}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if path.exists() and path.read_text(encoding='utf-8-sig') == text:
        return
    temp = path.with_suffix('.json.tmp')
    temp.write_text(text, encoding='utf-8')
    temp.replace(path)


def encrypt_original(arguments):
    root, target, identifier, visual_check, password = arguments
    source = root / '.cloud-publish/inspection-pdf-source' / (identifier + '.pdf')
    if digest(source) != identifier:
        raise ValueError('Original PDF fingerprint differs')
    temp = target / (identifier + '.tmp')
    with pymupdf.open(source) as doc:
        if doc.needs_pass:
            raise ValueError('Cannot read an already locked source PDF')
        pages = len(doc)
        pixels = doc[0].get_pixmap(matrix=pymupdf.Matrix(.5, .5)).samples if visual_check else None
        doc.save(temp, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=secrets.token_urlsafe(24),
                 user_pw=password, permissions=pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ,
                 garbage=3, deflate=True)
    with pymupdf.open(temp) as check:
        if not check.needs_pass or check.authenticate('invalid-password') or not check.authenticate(password):
            raise ValueError('PDF password verification failed')
        if len(check) != pages:
            raise ValueError('PDF page count changed')
        if pixels is not None:
            preview = check[0].get_pixmap(matrix=pymupdf.Matrix(.5, .5))
            if preview.samples != pixels:
                raise ValueError('PDF drawing rendering changed')
            preview.save(root / '.cloud-publish/public-download-pdf-preview.png')
    name = digest(temp) + '.pdf'
    temp.replace(target / name)
    return identifier, name


def prepare(root):
    root = Path(root).resolve()
    work = root / '.cloud-publish'
    work.mkdir(exist_ok=True)
    with (work / 'inspection-downloads.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0'); lock.flush()
        deadline = time.monotonic() + 1200
        notified = False
        while True:
            try:
                lock.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError('Another download preparation is still running')
                if not notified:
                    print('Another download preparation is running; waiting for it to finish.', flush=True)
                    notified = True
                time.sleep(1)
        try:
            return _prepare_unlocked(root)
        finally:
            lock.seek(0)
            if os.name == 'nt':
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def _prepare_unlocked(root):
    root = Path(root).resolve()
    work = root / '.cloud-publish'
    target = root / 'ComponentLife/data/inspection/downloads'
    target.mkdir(parents=True, exist_ok=True)
    work.mkdir(exist_ok=True)
    summary = json.loads((target.parent / 'summary.json').read_text(encoding='utf-8-sig'))
    config = json.loads((root / 'inspection.config.json').read_text(encoding='utf-8-sig'))
    source_root = Path(config['sourcePath']).resolve()
    password_file = work / 'inspection-download-password.txt'
    password = os.environ.get('COMPONENTLIFE_PDF_PASSWORD') or password_file.read_text(encoding='utf-8-sig').strip()
    if not password or len(password.encode('utf-8')) > 127:
        raise ValueError('Invalid private PDF password configuration')
    password_hash = hashlib.sha256(password.encode('utf-8')).hexdigest()
    cache_file = work / 'inspection-download-cache.json'
    try:
        cache = json.loads(cache_file.read_text(encoding='utf-8'))
        if cache.get('passwordHash') != password_hash and cache.get('password') != password:
            cache = {}
    except (FileNotFoundError, ValueError):
        cache = {}
    excel_cache, pdf_cache = cache.get('excel', {}), cache.get('pdf', {})
    report_cache = cache.get('reports', {})
    report_template = None
    report_signature = None
    if (root / 'inspection-report.config.json').exists():
        template_path = configured_template(root)
        report_template = ReportTemplate(template_path)
        report_signature = [digest(template_path), 'inspection-report-v1', digest(Path(__file__).with_name('inspection_report.py'))]
    result = {'schemaVersion': 1, 'excel': {}, 'pdf': {}}
    new_excel, new_pdf, new_reports = 0, 0, 0
    report_jobs = []
    identifiers = sorted({d['id'] for r in summary['records'] for d in r['drawings']})
    for identifier in identifiers:
        if len(identifier) != 64 or any(c not in '0123456789abcdef' for c in identifier):
            raise ValueError('Invalid drawing identifier')
    pending = [identifier for identifier in identifiers if not pdf_cache.get(identifier) or not (target / pdf_cache[identifier]).exists()]
    arguments = [(root, target, identifier, index == 0, password) for index, identifier in enumerate(pending)]
    def remember(result):
        nonlocal new_pdf
        identifier, name = result
        pdf_cache[identifier] = name
        new_pdf += 1
        if new_pdf % 25 == 0:
            write_json(cache_file, {'passwordHash': password_hash, 'excel': excel_cache, 'pdf': pdf_cache, 'reports': report_cache})
            print(f'Prepared {new_pdf}/{len(pending)} additional locked PDFs', flush=True)
    # PyMuPDF runs in separate processes; no shared document/thread state.
    if len(pending) > 8:
        with ProcessPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(encrypt_original, args) for args in arguments]
            for future in as_completed(futures):
                remember(future.result())
    else:
        for args in arguments:
            remember(encrypt_original(args))
    for record in summary['records']:
        original = source_root.joinpath(*record['lot'].split(' / '), record['file']).resolve()
        if not original.is_relative_to(source_root) or original.suffix.lower() not in ('.xlsx', '.xlsm'):
            raise ValueError('Invalid Excel source path')
        if not original.exists():
            cached_name = excel_cache.get(record['id'], {}).get('name', '')
            cached_copy = target / cached_name
            if (not cached_name or Path(cached_name).name != cached_name or
                    not cached_copy.is_file() or digest(cached_copy) != cached_name.split('.')[0]):
                raise FileNotFoundError('Excel source missing and no verified published copy: ' + record['id'])
            # Keep the existing snapshot downloadable if a source has moved since export.
            print('Using verified previous Excel copy for missing source: ' + record['id'], flush=True)
            original = cached_copy
        stat = original.stat()
        signature = [str(original), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]
        cached = excel_cache.get(record['id'], {})
        output_name = cached.get('name', '')
        if cached.get('signature') != signature or not output_name or not (target / output_name).exists():
            name = digest(original) + original.suffix.lower()
            output = target / name
            if not output.exists():
                temp = target / (name + '.tmp')
                shutil.copyfile(original, temp)
                if digest(temp) != name.split('.')[0]:
                    raise ValueError('Excel changed while copying; retry after saving')
                temp.replace(output)
            after = original.stat()
            if signature[1:] != [after.st_size, after.st_mtime_ns, after.st_ctime_ns]:
                raise ValueError('Excel changed while copying; retry after saving')
            output_name = name
            excel_cache[record['id']] = {'signature': signature, 'name': name}
            new_excel += 1
        download_name = record['file']
        if report_template:
            report_input = [output_name, *report_signature, record.get('part'), record.get('mold'), record.get('measuredDate')]
            report = report_cache.get(record['id'], {})
            previous = report.get('signature', [])
            # Migrate the initial cache format: report bytes depend on the template and report engine,
            # not on unrelated publisher/locking code changes.
            if (len(previous) == len(report_input) and previous[:2] == report_input[:2]
                    and previous[3:] == report_input[3:] and isinstance(previous[2], str)
                    and len(previous[2]) == 64 and all(c in '0123456789abcdef' for c in previous[2])):
                report['signature'] = report_input
            if report.get('signature') != report_input or not (target / report.get('name', '')).is_file():
                report_jobs.append((str(target), output_name, record, report_input))
            else:
                output_name = report['name']
            download_name = Path(record['file']).stem + '.xlsx'
        result['excel'][record['id']] = {'url': 'data/inspection/downloads/' + output_name, 'name': download_name}
        for drawing in record['drawings']:
            identifier = drawing['id']
            if identifier in result['pdf']:
                continue
            if len(identifier) != 64 or any(c not in '0123456789abcdef' for c in identifier):
                raise ValueError('Invalid drawing identifier')
            pdf_name = pdf_cache.get(identifier, '')
            result['pdf'][identifier] = {'url': 'data/inspection/downloads/' + pdf_name}
    def remember_report(result_item):
        nonlocal new_reports
        identifier, report = result_item
        report_cache[identifier] = report
        new_reports += 1
        if new_reports % 25 == 0:
            write_json(cache_file, {'passwordHash': password_hash, 'excel': excel_cache, 'pdf': pdf_cache, 'reports': report_cache})
            print(f'Prepared {new_reports}/{len(report_jobs)} updated template reports', flush=True)
    if len(report_jobs) > 8:
        with ProcessPoolExecutor(max_workers=4, initializer=initialize_report_worker, initargs=(str(template_path),)) as pool:
            futures = [pool.submit(build_report_task, args) for args in report_jobs]
            for future in as_completed(futures):
                remember_report(future.result())
    elif report_jobs:
        initialize_report_worker(str(template_path))
        for args in report_jobs:
            remember_report(build_report_task(args))
    if report_template:
        if digest(template_path) != report_signature[0]:
            raise ValueError('Report template changed during generation; save it and publish again')
        for identifier in result['excel']:
            result['excel'][identifier]['url'] = 'data/inspection/downloads/' + report_cache[identifier]['name']
    # Publish the index last so every advertised download exists already.
    write_json(cache_file, {'passwordHash': password_hash, 'excel': excel_cache, 'pdf': pdf_cache, 'reports': report_cache})
    write_json(target.parent / 'downloads.json', result)
    print(f"Downloads ready: {len(result['excel'])} Excel, {len(result['pdf'])} PDF; updated {new_excel} sources / {new_reports} template reports / {new_pdf} PDF.", flush=True)
    return result


if __name__ == '__main__':
    prepare(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
