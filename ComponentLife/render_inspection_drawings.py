"""Render local PDF originals into view-only web images. Never publishes or edits a PDF."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path


def render_one(job):
    sha, source, cache_dir, output_dir = job
    cache = Path(cache_dir) / sha
    cache.mkdir(parents=True, exist_ok=True)
    info_path = cache / 'pages.json'
    pages = None
    if info_path.exists():
        try:
            candidate = json.loads(info_path.read_text(encoding='utf-8'))
            if candidate and all((cache / name).is_file() for name in candidate):
                pages = candidate
        except (OSError, ValueError):
            pass
    if pages is None:
        import pymupdf as fitz
        from PIL import Image
        pages = []
        with fitz.open(source) as document:
            for index, page in enumerate(document):
                scale = 3200 / max(page.rect.width, page.rect.height)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                image = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
                name = f'{sha}-v1-p{index + 1:04}.webp'
                temp = cache / (name + '.tmp')
                image.save(temp, format='WEBP', quality=95, method=0)
                temp.replace(cache / name)
                pages.append(name)
        if not pages:
            raise ValueError(f'Empty drawing: {sha}')
        info_path.write_text(json.dumps(pages), encoding='utf-8')
    output = Path(output_dir)
    for name in pages:
        target = output / name
        if not target.exists():
            try:
                os.link(cache / name, target)
            except OSError:
                import shutil
                shutil.copyfile(cache / name, target)
    from inspection_points import point_map
    return sha, pages, point_map(cache, pages, output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf-root', required=True)
    parser.add_argument('--hashes', required=True)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--catalog', required=True)
    args = parser.parse_args()
    hashes = json.loads(Path(args.hashes).read_text(encoding='utf-8-sig'))
    Path(args.output).mkdir(parents=True, exist_ok=True)
    jobs = [(sha, str(Path(args.pdf_root) / (sha + '.pdf')), args.cache, args.output) for sha in hashes]
    catalog = {}
    with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
        for index, (sha, pages, points) in enumerate(pool.map(render_one, jobs), 1):
            catalog[sha] = {'pages': pages, 'pointMap': points}
            if index % 50 == 0 or index == len(jobs):
                print(f'Drawing previews: {index}/{len(jobs)}', flush=True)
    target = Path(args.catalog)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(catalog, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    temp.replace(target)


if __name__ == '__main__':
    main()
