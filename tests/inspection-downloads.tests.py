import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import pymupdf

spec = importlib.util.spec_from_file_location('downloads', Path(__file__).resolve().parents[1] / 'ComponentLife/prepare_inspection_downloads.py')
downloads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloads)


class OriginalDownloads(unittest.TestCase):
    def test_originals_encryption_and_incremental_update(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            excel = source / 'Inspection sample.xlsm'
            excel.write_bytes(b'Original macro workbook bytes\x00\x01')
            store = root / '.cloud-publish/inspection-pdf-source'
            store.mkdir(parents=True)
            pdf = root / 'original.pdf'
            with pymupdf.open() as doc:
                page = doc.new_page(width=300, height=200)
                page.insert_text((30, 70), 'Point 1: 25.92 +/- 0.005')
                doc.save(pdf)
            pdf_id = downloads.digest(pdf)
            (store / (pdf_id + '.pdf')).write_bytes(pdf.read_bytes())
            summary_dir = root / 'ComponentLife/data/inspection'
            summary_dir.mkdir(parents=True)
            (root / 'inspection.config.json').write_text(json.dumps({'sourcePath': str(source)}))
            summary = {'records': [{'id': 'sample', 'lot': '', 'file': excel.name, 'drawings': [{'id': pdf_id, 'name': 'original.pdf'}]}]}
            (summary_dir / 'summary.json').write_text(json.dumps(summary))
            manifest = downloads.prepare(root)
            target_excel = root / 'ComponentLife' / manifest['excel']['sample']['url']
            target_pdf = root / 'ComponentLife' / manifest['pdf'][pdf_id]['url']
            self.assertEqual(target_excel.read_bytes(), excel.read_bytes())
            with pymupdf.open(target_pdf) as doc:
                self.assertTrue(doc.needs_pass)
                self.assertFalse(doc.authenticate('4321'))
                self.assertTrue(doc.authenticate('7139'))
                self.assertEqual(len(doc), 1)
                self.assertFalse(doc.permissions & pymupdf.PDF_PERM_MODIFY)
                protected = doc[0].get_pixmap().samples
            with pymupdf.open(pdf) as doc:
                self.assertEqual(protected, doc[0].get_pixmap().samples)
                self.assertFalse(doc.needs_pass)
            self.assertEqual(downloads.digest(pdf), pdf_id)
            before = (summary_dir / 'downloads.json').read_bytes()
            self.assertEqual(downloads.prepare(root), manifest)
            self.assertEqual((summary_dir / 'downloads.json').read_bytes(), before)
            excel.write_bytes(b'Updated macro workbook bytes\x00\x01')
            updated = downloads.prepare(root)
            self.assertNotEqual(updated['excel']['sample']['url'], manifest['excel']['sample']['url'])
            self.assertEqual(updated['pdf'], manifest['pdf'])
            summary['records'][0]['lot'] = '..'
            (summary_dir / 'summary.json').write_text(json.dumps(summary))
            with self.assertRaises(ValueError):
                downloads.prepare(root)


if __name__ == '__main__':
    unittest.main()
