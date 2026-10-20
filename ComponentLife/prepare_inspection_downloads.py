"""Publish byte-identical Excel workbooks and encrypted copies of original PDFs."""
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import sys

import pymupdf

PASSWORD = '7139'


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
    root, target, identifier, visual_check = arguments
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
                 user_pw=PASSWORD, permissions=pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ,
                 garbage=3, deflate=True)
    with pymupdf.open(temp) as check:
        if not check.needs_pass or check.authenticate('4321') or not check.authenticate(PASSWORD):
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
    target = root / 'ComponentLife/data/inspection/downloads'
    target.mkdir(parents=True, exist_ok=True)
    work.mkdir(exist_ok=True)
    summary = json.loads((target.parent / 'summary.json').read_text(encoding='utf-8-sig'))
    config = json.loads((root / 'inspection.config.json').read_text(encoding='utf-8-sig'))
    source_root = Path(config['sourcePath']).resolve()
    cache_file = work / 'inspection-download-cache.json'
    try:
        cache = json.loads(cache_file.read_text(encoding='utf-8'))
        if cache.get('password') != PASSWORD:
            cache = {}
    except (FileNotFoundError, ValueError):
        cache = {}
    excel_cache, pdf_cache = cache.get('excel', {}), cache.get('pdf', {})
    result = {'schemaVersion': 1, 'pdfPassword': PASSWORD, 'excel': {}, 'pdf': {}}
    new_excel, new_pdf = 0, 0
    identifiers = sorted({d['id'] for r in summary['records'] for d in r['drawings']})
    for identifier in identifiers:
        if len(identifier) != 64 or any(c not in '0123456789abcdef' for c in identifier):
            raise ValueError('Invalid drawing identifier')
    pending = [identifier for identifier in identifiers if not pdf_cache.get(identifier) or not (target / pdf_cache[identifier]).exists()]
    arguments = [(root, target, identifier, index == 0) for index, identifier in enumerate(pending)]
    def remember(result):
        nonlocal new_pdf
        identifier, name = result
        pdf_cache[identifier] = name
        new_pdf += 1
        if new_pdf % 25 == 0:
            write_json(cache_file, {'password': PASSWORD, 'excel': excel_cache, 'pdf': pdf_cache})
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
        result['excel'][record['id']] = {'url': 'data/inspection/downloads/' + output_name, 'name': record['file']}
        for drawing in record['drawings']:
            identifier = drawing['id']
            if identifier in result['pdf']:
                continue
            if len(identifier) != 64 or any(c not in '0123456789abcdef' for c in identifier):
                raise ValueError('Invalid drawing identifier')
            pdf_name = pdf_cache.get(identifier, '')
            result['pdf'][identifier] = {'url': 'data/inspection/downloads/' + pdf_name}
    # Publish the index last so every advertised download exists already.
    write_json(cache_file, {'password': PASSWORD, 'excel': excel_cache, 'pdf': pdf_cache})
    write_json(target.parent / 'downloads.json', result)
    print(f"Downloads ready: {len(result['excel'])} Excel, {len(result['pdf'])} PDF; updated {new_excel} Excel / {new_pdf} PDF.", flush=True)
    return result


if __name__ == '__main__':
    prepare(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
