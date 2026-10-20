import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


class DownloadPreparationLock(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows publisher lock')
    def test_second_preparation_waits_then_reuses_complete_output(self):
        import msvcrt
        script = Path(__file__).resolve().parents[1] / 'ComponentLife/prepare_inspection_downloads.py'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            work = root / '.cloud-publish'; work.mkdir()
            (work / 'inspection-download-password.txt').write_text('fixture-password')
            source = root / 'source'; source.mkdir()
            (source / 'sample.xlsx').write_bytes(b'fixture workbook')
            (root / 'inspection.config.json').write_text(json.dumps({'sourcePath': str(source)}))
            data = root / 'ComponentLife/data/inspection'; data.mkdir(parents=True)
            (data / 'summary.json').write_text(json.dumps({'records': [{'id': 'fixture', 'lot': '', 'file': 'sample.xlsx', 'drawings': []}]}))
            with (work / 'inspection-downloads.lock').open('w+b') as lock:
                lock.write(b'0'); lock.flush(); lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                process = subprocess.Popen([sys.executable, str(script), str(root)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    time.sleep(1)
                    self.assertIsNone(process.poll())
                finally:
                    lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn('waiting for it to finish', stdout)
            index = json.loads((data / 'downloads.json').read_text())
            self.assertTrue((root / 'ComponentLife' / index['excel']['fixture']['url']).is_file())


if __name__ == '__main__':
    unittest.main()
