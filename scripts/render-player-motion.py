"""Rasterize production mesh poses exported by render-player-motion.mjs.

python3 scripts/render-player-motion.py /tmp/nesi-player-motion /tmp/nesi-raster
The raster executable is compiled from optimize-runtime-models-raster.cpp.
Outputs are reference captures, never described as actual browser rendering.
"""
import json
import math
import pathlib
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

source = pathlib.Path(sys.argv[1])
raster = sys.argv[2]
destination = pathlib.Path(__file__).resolve().parents[1] / 'qa'
destination.mkdir(exist_ok=True)
manifest = json.loads((source / 'frames.json').read_text())
width, height = 300, 360
textures = {key: np.asarray(Image.open(source / f'{key}.webp').convert('RGBA').resize((512, 512))) for key in ['player', 'gun']}
atlas = np.concatenate(list(textures.values()), axis=1)
attributes = {}
for number, key in enumerate(textures):
    uv = np.fromfile(source / f'{key}-uv.bin', np.float32).reshape(-1, 2)
    uv[:, 0] = (uv[:, 0] * 511 + number * 512) / 1023
    attributes[key] = (uv, np.fromfile(source / f'{key}-indices.bin', np.uint32))

def render(frame, yaw=.68, world_arc=False):
    pitch = .10
    camera = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
    right = np.cross([0, 1, 0], camera); right /= np.linalg.norm(right)
    up = np.cross(camera, right)
    light = np.array([-.4, .8, .5]); light /= np.linalg.norm(light)
    vertices, faces, offset = [], [], 0
    for mesh in frame['meshes']:
        p = np.fromfile(source / f"{mesh['prefix']}-position.bin", np.float32).reshape(-1, 3)
        n = np.fromfile(source / f"{mesh['prefix']}-normal.bin", np.float32).reshape(-1, 3)
        local = p - [0, 2.05 if world_arc else 1.20, 0]
        if world_arc:
            local[:, 1] += frame['y']
        scale = 76 if world_arc else 125
        vert = np.empty((len(p), 6), dtype=np.float32)
        vert[:, 0] = width * .5 + local @ right * scale
        vert[:, 1] = height * .52 - local @ up * scale
        vert[:, 2] = local @ camera
        vert[:, 3] = .65 + .35 * np.maximum(n @ light, 0)
        uv, indices = attributes[mesh['key']]
        vert[:, 4:] = uv
        vertices.append(vert); faces.append(indices + offset); offset += len(p)
    vertices, faces = np.concatenate(vertices), np.concatenate(faces)
    binary, output = source / 'raster-input.bin', source / 'raster-output.rgba'
    with binary.open('wb') as f:
        f.write(struct.pack('<6I', width, height, len(vertices), len(faces), atlas.shape[1], atlas.shape[0]))
        f.write(vertices.tobytes()); f.write(faces.tobytes()); f.write(atlas.tobytes())
    subprocess.run([raster, str(binary), str(output)], check=True)
    pixels = Image.fromarray(np.fromfile(output, np.uint8).reshape(height, width, 4), 'RGBA')
    image = Image.new('RGB', (width, height), '#e9eef2')
    draw = ImageDraw.Draw(image)
    draw.line([(12, 340), (width-12, 340)], fill='#c6d2da', width=1)
    image.paste(pixels, (0, 0), pixels)
    draw.text((12, 9), f"{frame['name']}   {frame['time']:.2f}s", fill='#253c4e')
    if frame['name'] == 'jump': draw.text((12, 26), frame['phase'] + f" / y={frame['y']:.2f}m", fill='#405b6b')
    return image

names = ['idle', 'walk', 'run', 'jump', 'carry']
sheet = Image.new('RGB', (6*width, 5*(height+28)+52), '#ffffff')
draw = ImageDraw.Draw(sheet)
draw.text((16, 12), 'NESI v6 | Actual runtime mesh + production animation | CPU reference capture, not browser/PBR', fill='#213947')
draw.text((16, 29), 'Frames follow the player root. Jump height is written in metres. Carry checks the wrist pose; companion is omitted.', fill='#516470')
stats = {}
reference = np.fromfile(source / 'idle-000-player-position.bin', np.float32).reshape(-1, 3)
boot_masks = {'left': (reference[:, 1] < .30) & (reference[:, 0] < 0),
              'right': (reference[:, 1] < .30) & (reference[:, 0] > 0)}
for row, name in enumerate(names):
    frames = [frame for frame in manifest['frames'] if frame['name'] == name]
    select = np.linspace(0, len(frames)-1, 6).astype(int)
    for column, index in enumerate(select):
        sheet.paste(render(frames[index]), (column*width, 52+row*(height+28)))
    label = f"{name.upper()} | {frames[-1]['cadence']:.2f} cycles/s" if name != 'jump' else 'JUMP | takeoff - tuck - descent - landing'
    draw.text((16, 52+row*(height+28)+height+7), label, fill='#253c4e')
    if name in ('run', 'walk', 'jump'):
        sequence = [render(frame) for frame in frames]
        sequence[0].save(destination / f'player-motion-v6-{name}.webp', save_all=True, append_images=sequence[1:], duration=33 if name == 'jump' else 50, loop=0, quality=82, method=4)
        if name == 'jump':
            sequence = [render(frame, world_arc=True) for frame in frames]
            sequence[0].save(destination / 'player-motion-v6-jump-arc.webp', save_all=True, append_images=sequence[1:], duration=33, loop=0, quality=82, method=4)
    stats[name] = {'cadenceHz': frames[-1]['cadence'], 'frames': len(frames), 'phases': sorted(set(f['phase'] for f in frames))}
    stats[name]['bootMeshMeasurements'] = {}
    for side, mask in boot_masks.items():
        points = np.array([np.fromfile(source / f"{frame['meshes'][0]['prefix']}-position.bin", np.float32).reshape(-1, 3)[mask].mean(0) for frame in frames])
        stats[name]['bootMeshMeasurements'][side] = {
            'rootRelativeCenterRangeMetres': np.ptp(points, axis=0).round(6).tolist(),
            'maximumCenterDisplacementMetres': float(np.linalg.norm(np.diff(points, axis=0), axis=1).max()),
            'sampleIntervalSeconds': frames[1]['time'] - frames[0]['time'],
        }
    print(f'Rendered {name}', flush=True)
sheet.save(destination / 'player-motion-v6-contact-sheet.jpg', quality=92)
# A side view exposes knee direction and boot contact that a front view hides.
side = Image.new('RGB', (6*width, 2*(height+28)+32), '#ffffff')
for row, name in enumerate(['run', 'jump']):
    frames = [frame for frame in manifest['frames'] if frame['name'] == name]
    for column, index in enumerate(np.linspace(0, len(frames)-1, 6).astype(int)):
        side.paste(render(frames[index], math.pi/2), (column*width, 32+row*(height+28)))
ImageDraw.Draw(side).text((16, 10), 'Side reference | actual deformed mesh | run / jump', fill='#253c4e')
side.save(destination / 'player-motion-v6-side.jpg', quality=92)
(destination / 'player-motion-v6-report.json').write_text(json.dumps({'method': manifest['method'], 'states': stats}, indent=2)+'\n')
print(destination / 'player-motion-v6-contact-sheet.jpg')
