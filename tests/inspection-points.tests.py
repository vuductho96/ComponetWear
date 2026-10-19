"""Run with the configured local Python runtime; OCR weights remain private."""
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ComponentLife'))
from inspection_points import locate_points

class PointMappingTests(unittest.TestCase):
    def test_only_numbered_red_circles_have_page_coordinates(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = []
            for page, label in enumerate(('2', '12'), 1):
                image = Image.new('RGB', (800, 600), 'white')
                draw = ImageDraw.Draw(image)
                font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 29)
                draw.ellipse((250, 150, 310, 210), outline='red', width=2)
                draw.text((280, 180), label, font=font, fill='red', anchor='mm')
                draw.text((500, 350), '42', font=font, fill='red') # no circle
                draw.ellipse((80, 80, 140, 140), outline='black', width=2)
                draw.text((110, 110), '99', font=font, fill='black', anchor='mm')
                path = Path(folder) / f'{page}.png'; image.save(path); paths.append(path)
            found = locate_points(paths)['points']
            self.assertEqual(set(found), {'2', '12'})
            for label, page in [('2', 1), ('12', 2)]:
                mark = found[label][0]
                self.assertEqual(mark['page'], page)
                self.assertAlmostEqual(mark['x'], 280 / 800, places=2)
                self.assertAlmostEqual(mark['y'], 180 / 600, places=2)
                self.assertGreaterEqual(mark['confidence'], .92)

if __name__ == '__main__':
    unittest.main()
