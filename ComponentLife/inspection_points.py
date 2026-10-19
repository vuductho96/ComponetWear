"""Locate numbered red balloons in view images; originals and OCR model stay private."""
import hashlib
import json
from functools import lru_cache
from pathlib import Path

_recognizer = None


def recognizer():
    global _recognizer
    if _recognizer is None:
        import onnxruntime as ort
        root = Path(__file__).resolve().parent.parent / '.cloud-publish/inspection-ocr'
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(root / 'recognizer.onnx'), sess_options=options,
                                       providers=['CPUExecutionProvider'])
        characters = [''] + (root / 'characters.txt').read_text(encoding='utf-8-sig').splitlines() + [' ']
        _recognizer = session, characters
    return _recognizer


def read_number(mask):
    import cv2
    import numpy as np
    points = cv2.findNonZero(mask)
    if points is None:
        return None
    x, y, w, h = cv2.boundingRect(points)
    crop = cv2.copyMakeBorder(255 - mask[y:y+h, x:x+w], 5, 5, 5, 5,
                              cv2.BORDER_CONSTANT, value=255)
    width = min(320, int(np.ceil(48 * crop.shape[1] / crop.shape[0])))
    image = cv2.cvtColor(cv2.resize(crop, (width, 48)), cv2.COLOR_GRAY2RGB)
    tensor = np.zeros((1, 3, 48, max(32, int(np.ceil(width / 32)) * 32)), dtype='float32')
    tensor[0, :, :, :width] = (image.astype('float32') / 127.5 - 1).transpose(2, 0, 1)
    session, characters = recognizer()
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0][0]
    previous, text, scores = 0, '', []
    for row in output:
        index = int(row.argmax())
        if index and index != previous:
            text += characters[index]
            scores.append(float(row[index]))
        previous = index
    if not text.isascii() or not text.isdigit() or not 1 <= int(text) <= 999 or not scores:
        return None
    confidence = min(scores)
    return (str(int(text)), confidence) if confidence >= .92 else None


def locate_points(page_paths):
    import cv2
    import numpy as np
    points = {}
    for page_number, path in enumerate(page_paths, 1):
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f'Cannot read preview {path}')
        blue, green, red = (channel.astype('float32') for channel in cv2.split(image))
        mask = ((red > green * 1.35 + 20) & (red > blue * 1.35 + 20) & (red > 130)).astype('uint8') * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if not (10 <= w <= 120 and 10 <= h <= 120 and .72 <= w/h <= 1.38):
                continue
            if not .48 <= cv2.contourArea(contour) / (w*h) <= .91:
                continue
            # Remove the circle, and require agreement from two independent interior crops.
            readings = []
            yy, xx = np.ogrid[:h, :w]
            for radius in (.37, .40):
                crop = mask[y:y+h, x:x+w].copy()
                crop[((xx-(w-1)/2)/(w*radius))**2 + ((yy-(h-1)/2)/(h*radius))**2 > 1] = 0
                readings.append(read_number(crop))
            if any(reading is None for reading in readings) or readings[0][0] != readings[1][0]:
                continue
            point = readings[0][0]
            points.setdefault(point, []).append({
                'page': page_number, 'x': round((x+w/2)/image.shape[1], 6),
                'y': round((y+h/2)/image.shape[0], 6), 'w': round(w/image.shape[1], 6),
                'h': round(h/image.shape[0], 6), 'confidence': round(min(r[1] for r in readings), 4)
            })
    for locations in points.values():
        locations.sort(key=lambda p: (p['page'], p['y'], p['x']))
    return {'schemaVersion': 1, 'method': 'red-balloon-ocr', 'points': points}


@lru_cache(maxsize=1)
def cache_signature():
    model_root = Path(__file__).resolve().parent.parent / '.cloud-publish/inspection-ocr'
    digest = hashlib.sha256(Path(__file__).read_bytes())
    for name in ('recognizer.onnx', 'characters.txt'):
        digest.update((model_root / name).read_bytes())
    return digest.hexdigest()[:12]


def point_map(cache, page_names, output):
    # A code/model change invalidates only the coordinate cache, never the images.
    cached = cache / ('points-' + cache_signature() + '.json')
    if cached.exists():
        data = cached.read_bytes()
    else:
        data = json.dumps(locate_points([cache / name for name in page_names]),
                          separators=(',', ':'), sort_keys=True).encode('utf-8')
        temp = cached.with_suffix('.tmp')
        temp.write_bytes(data)
        temp.replace(cached)
    filename = f'points-{cache.name}-{hashlib.sha256(data).hexdigest()[:12]}.json'
    (output / filename).write_bytes(data)
    return filename
