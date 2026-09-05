"""Compare exported source/runtime meshes, without a browser or graphics driver.

python scripts/optimize-runtime-models-qa.py /tmp/nesi-model-qa /tmp/nesi-raster
Produces 2-view PNG comparisons and measurements in the selected scratch folder.
"""
import json
import math
import pathlib
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

root = pathlib.Path(sys.argv[1])
raster = sys.argv[2]
resolution = 600
results = []
for pair in json.loads((root / 'pairs.json').read_text()):
    variants = []
    for variant in pair['variants']:
        prefix = variant['prefix']
        matrix = np.array(variant['matrix']).reshape(4, 4).T
        p = np.fromfile(root / f'{prefix}-POSITION.bin', np.float32).reshape(-1, 3)
        normals = np.fromfile(root / f'{prefix}-NORMAL.bin', np.float32).reshape(-1, 3)
        uv = np.fromfile(root / f'{prefix}-TEXCOORD_0.bin', np.float32).reshape(-1, 2)
        indices = np.fromfile(root / f'{prefix}-indices.bin', np.uint32)
        p = p @ matrix[:3, :3].T + matrix[:3, 3]
        normals = normals @ np.linalg.inv(matrix[:3, :3])
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
        texture = np.array(Image.open(root / f'{prefix}-texture.webp').convert('RGBA'))
        variants.append((p, normals, uv, indices, texture))
    source_positions = variants[0][0]
    center = (source_positions.min(axis=0) + source_positions.max(axis=0)) / 2
    model_scale = (source_positions.max(axis=0) - source_positions.min(axis=0)).max()
    sheet = Image.new('RGB', (resolution * 2, (resolution + 35) * 2), '#e8edf0')
    draw = ImageDraw.Draw(sheet)
    measures = []
    # Front three-quarter and rear three-quarter; raised angle for broad floor devices.
    pitch = .7 if pair['id'] in (18, 21, 29) else .18
    start_yaw = -1.05 if pair['id'] == 2 else .5
    for view, yaw in enumerate([start_yaw, start_yaw + 2.7]):
        camera = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
        right = np.cross([0, 1, 0], camera); right /= np.linalg.norm(right)
        up = np.cross(camera, right)
        light = np.array([-.4, .8, .5]); light /= np.linalg.norm(light)
        images = []
        for number, (p, normals, uv, indices, texture) in enumerate(variants):
            local = (p - center) / model_scale
            vert = np.empty((len(p), 6), dtype=np.float32)
            vert[:, 0] = resolution * (.5 + local @ right * .83)
            vert[:, 1] = resolution * (.5 - local @ up * .83)
            vert[:, 2] = local @ camera
            vert[:, 3] = .58 + .42 * np.maximum(normals @ light, 0)
            vert[:, 4:] = uv
            binary = root / 'raster-input.bin'
            output = root / 'raster-output.rgba'
            with binary.open('wb') as f:
                f.write(struct.pack('<6I', resolution, resolution, len(p), len(indices), texture.shape[1], texture.shape[0]))
                f.write(vert.tobytes()); f.write(indices.tobytes()); f.write(texture.tobytes())
            subprocess.run([raster, str(binary), str(output)], check=True)
            pixels = np.fromfile(output, np.uint8).reshape(resolution, resolution, 4)
            images.append(pixels.copy())
            image = Image.fromarray(pixels, 'RGBA')
            sheet.paste(image, (number * resolution, view * (resolution + 35) + 35), image)
            label = ('Source' if number == 0 else 'Runtime') + f" / {pair['variants'][number]['triangles']:,} triangles"
            draw.text((number * resolution + 16, view * (resolution + 35) + 10), label, fill='#243342')
        source, runtime = images
        a, b = source[:, :, 3] > 0, runtime[:, :, 3] > 0
        intersection, union = a & b, a | b
        rgb_error = np.abs(source[:, :, :3].astype(float) - runtime[:, :, :3].astype(float))
        measures.append({'view': view, 'silhouetteIoU': float(intersection.sum() / max(1, union.sum())),
                         'meanRGBByteDeltaOnCommonSurface': float(rgb_error[intersection].mean()),
                         'sourceSilhouettePixels': int(a.sum()), 'runtimeSilhouettePixels': int(b.sum())})
    destination = root / f"comparison-{pair['id']:02d}.png"
    sheet.save(destination)
    record = {'id': pair['id'], 'name': pair['name'], 'views': measures, 'comparison': destination.name}
    results.append(record)
    print(json.dumps(record), flush=True)
(root / 'comparison-report.json').write_text(json.dumps({'method': 'CPU orthographic 600px base texture and vertex-normal shading; 2 views; no normal-map/PBR/animation/browser claim', 'models': results}, indent=2) + '\n')
