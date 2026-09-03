import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { PlayerAnimator } from '../src/game/FullBodyPlayerAnimator.js';

const require = createRequire(import.meta.url);
const project = path.resolve(import.meta.dirname, '..');
const inputPath = path.join(project, 'public/models/model-01-player.glb');
const decoderPath = path.join(project, 'public/draco/draco_decoder.js');
const outputPath = path.resolve(process.argv[2] ?? '/workspace/scratch/player-animation-rig-v2.mp4');
const posterPath = outputPath.replace(/\.mp4$/iu, '.jpg');
const width = 640;
const height = 360;
const fps = 15;
const duration = 12;
const maximumTriangles = 52000;

function parseGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/u, ''));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  return { json, binary: buffer.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength) };
}

async function loadDraco() {
  const decoderDirectory = path.dirname(decoderPath);
  const context = {
    console, require, module: { exports: {} }, exports: {},
    __filename: decoderPath, __dirname: decoderDirectory,
    process, Buffer, URL, WebAssembly, TextDecoder,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(decoderPath, 'utf8'), context, { filename: decoderPath });
  return context.module.exports({ locateFile: (name) => path.join(decoderDirectory, name) });
}

function readAttribute(draco, decoder, mesh, id) {
  const attribute = decoder.GetAttributeByUniqueId(mesh, id);
  const source = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, source);
  const result = new Float32Array(source.size());
  for (let index = 0; index < result.length; index += 1) result[index] = source.GetValue(index);
  draco.destroy(source);
  return result;
}

function extractTexture(glb) {
  const textureIndex = glb.json.materials[0].pbrMetallicRoughness.baseColorTexture.index;
  const textureInfo = glb.json.textures[textureIndex];
  const imageIndex = textureInfo.extensions?.EXT_texture_webp?.source ?? textureInfo.source;
  const image = glb.json.images[imageIndex];
  const view = glb.json.bufferViews[image.bufferView];
  const temporaryPath = `${outputPath}.basecolor.webp`;
  fs.writeFileSync(
    temporaryPath,
    glb.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
  );
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', temporaryPath,
  ], { encoding: 'utf8' });
  const dimensions = JSON.parse(probe.stdout).streams[0];
  const decode = spawnSync('ffmpeg', [
    '-v', 'error', '-i', temporaryPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { maxBuffer: 128 * 1024 * 1024 });
  fs.rmSync(temporaryPath, { force: true });
  if (decode.status !== 0) throw new Error(decode.stderr.toString());
  return { pixels: decode.stdout, width: dimensions.width, height: dimensions.height };
}

function sampleTexture(texture, u, v) {
  const wrappedU = u - Math.floor(u);
  const wrappedV = v - Math.floor(v);
  const x = Math.min(texture.width - 1, Math.floor(wrappedU * texture.width));
  const y = Math.min(texture.height - 1, Math.floor((1 - wrappedV) * texture.height));
  const offset = (y * texture.width + x) * 3;
  return [texture.pixels[offset], texture.pixels[offset + 1], texture.pixels[offset + 2]];
}

function directionBin(value) {
  return value < -0.36 ? 0 : value > 0.36 ? 2 : 1;
}

function reduceForReview(positions, normals, uvs, sourceTriangles, texture, bounds) {
  const resolution = 42;
  const range = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  const cellSize = range / resolution;
  const clusters = new Map();
  const remap = new Uint32Array(positions.length / 3);
  const positionSums = [];
  const colorSums = [];
  const counts = [];

  for (let vertex = 0; vertex < remap.length; vertex += 1) {
    const p = vertex * 3;
    const ix = Math.min(127, Math.max(0, Math.floor((positions[p] - bounds.min[0]) / cellSize)));
    const iy = Math.min(127, Math.max(0, Math.floor((positions[p + 1] - bounds.min[1]) / cellSize)));
    const iz = Math.min(127, Math.max(0, Math.floor((positions[p + 2] - bounds.min[2]) / cellSize)));
    const normalClass = directionBin(normals[p])
      + directionBin(normals[p + 1]) * 3
      + directionBin(normals[p + 2]) * 9;
    const key = (((ix * 128 + iy) * 128 + iz) * 27) + normalClass;
    let cluster = clusters.get(key);
    if (cluster === undefined) {
      cluster = clusters.size;
      clusters.set(key, cluster);
      positionSums.push(0, 0, 0);
      colorSums.push(0, 0, 0);
      counts.push(0);
    }
    remap[vertex] = cluster;
    positionSums[cluster * 3] += positions[p];
    positionSums[cluster * 3 + 1] += positions[p + 1];
    positionSums[cluster * 3 + 2] += positions[p + 2];
    const uv = vertex * 2;
    const color = sampleTexture(texture, uvs[uv], uvs[uv + 1]);
    colorSums[cluster * 3] += color[0];
    colorSums[cluster * 3 + 1] += color[1];
    colorSums[cluster * 3 + 2] += color[2];
    counts[cluster] += 1;
  }

  const reducedPositions = new Float32Array(clusters.size * 3);
  const reducedColors = new Uint8Array(clusters.size * 3);
  for (let cluster = 0; cluster < clusters.size; cluster += 1) {
    const inverse = 1 / counts[cluster];
    for (let axis = 0; axis < 3; axis += 1) {
      reducedPositions[cluster * 3 + axis] = positionSums[cluster * 3 + axis] * inverse;
      reducedColors[cluster * 3 + axis] = Math.round(colorSums[cluster * 3 + axis] * inverse);
    }
  }

  const triangles = [];
  const unique = new Set();
  for (let offset = 0; offset < sourceTriangles.length; offset += 3) {
    const a = remap[sourceTriangles[offset]];
    const b = remap[sourceTriangles[offset + 1]];
    const c = remap[sourceTriangles[offset + 2]];
    if (a === b || b === c || c === a) continue;
    const low = Math.min(a, b, c);
    const high = Math.max(a, b, c);
    const middle = a + b + c - low - high;
    const key = (BigInt(low) << 42n) | (BigInt(middle) << 21n) | BigInt(high);
    if (unique.has(key)) continue;
    unique.add(key);
    triangles.push(a, b, c);
  }

  if (triangles.length / 3 <= maximumTriangles) {
    return { positions: reducedPositions, colors: reducedColors, triangles: new Uint32Array(triangles) };
  }
  const capped = new Uint32Array(maximumTriangles * 3);
  const stride = triangles.length / 3 / maximumTriangles;
  for (let triangle = 0; triangle < maximumTriangles; triangle += 1) {
    const source = Math.floor(triangle * stride) * 3;
    capped[triangle * 3] = triangles[source];
    capped[triangle * 3 + 1] = triangles[source + 1];
    capped[triangle * 3 + 2] = triangles[source + 2];
  }
  return { positions: reducedPositions, colors: reducedColors, triangles: capped };
}

function makeBackground() {
  const frame = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const glow = Math.max(0, 1 - Math.abs(t - 0.72) * 3.8);
    for (let x = 0; x < width; x += 1) {
      const vignette = 1 - Math.max(0, Math.abs(x / width - 0.5) - 0.3) * 0.65;
      const offset = (y * width + x) * 3;
      frame[offset] = (7 + t * 18 + glow * 8) * vignette;
      frame[offset + 1] = (14 + t * 12 + glow * 13) * vignette;
      frame[offset + 2] = (37 + t * 28 + glow * 28) * vignette;
    }
  }
  return frame;
}

function blendPixel(frame, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 3;
  for (let axis = 0; axis < 3; axis += 1) frame[offset + axis] = frame[offset + axis] * (1 - alpha) + color[axis] * alpha;
}

function drawGround(frame) {
  const centerX = width * 0.5;
  const baseline = height - 31;
  for (let ring = 0; ring < 4; ring += 1) {
    const radiusX = 55 + ring * 25;
    const radiusY = 5 + ring * 3;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.018) {
      blendPixel(frame, Math.round(centerX + Math.cos(angle) * radiusX), Math.round(baseline + Math.sin(angle) * radiusY), [44, 179, 222], 0.28);
    }
  }
}

const glb = parseGlb(fs.readFileSync(inputPath));
const draco = await loadDraco();
const primitive = glb.json.meshes[0].primitives[0];
const extension = primitive.extensions.KHR_draco_mesh_compression;
const compressedView = glb.json.bufferViews[extension.bufferView];
const compressed = glb.binary.subarray(
  compressedView.byteOffset ?? 0,
  (compressedView.byteOffset ?? 0) + compressedView.byteLength,
);
const decoderBuffer = new draco.DecoderBuffer();
decoderBuffer.Init(new Int8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength), compressed.byteLength);
const decoder = new draco.Decoder();
const mesh = new draco.Mesh();
const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
if (!status.ok()) throw new Error(status.error_msg());
const positions = readAttribute(draco, decoder, mesh, extension.attributes.POSITION);
const normals = readAttribute(draco, decoder, mesh, extension.attributes.NORMAL);
const uvs = readAttribute(draco, decoder, mesh, extension.attributes.TEXCOORD_0);
const sourceTriangles = new Uint32Array(mesh.num_faces() * 3);
const face = new draco.DracoInt32Array();
for (let triangle = 0; triangle < mesh.num_faces(); triangle += 1) {
  decoder.GetFaceFromMesh(mesh, triangle, face);
  sourceTriangles[triangle * 3] = face.GetValue(0);
  sourceTriangles[triangle * 3 + 1] = face.GetValue(1);
  sourceTriangles[triangle * 3 + 2] = face.GetValue(2);
}
draco.destroy(face);
draco.destroy(mesh);
draco.destroy(decoder);
draco.destroy(decoderBuffer);
const texture = extractTexture(glb);
const bounds = glb.json.accessors[primitive.attributes.POSITION];
const reduced = reduceForReview(positions, normals, uvs, sourceTriangles, texture, bounds);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(reduced.positions, 3));
geometry.setIndex(new THREE.BufferAttribute(reduced.triangles, 1));
const sourceMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
sourceMesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const modelSpace = new THREE.Group();
modelSpace.add(sourceMesh);
const visual = new THREE.Group();
visual.add(modelSpace);
const root = new THREE.Group();
root.add(visual);
const carrier = new THREE.Group();
const world = new THREE.Group();
world.add(root, carrier);
const modelScale = 2.45 / (bounds.max[2] - bounds.min[2]);
modelSpace.scale.setScalar(modelScale);
modelSpace.position.set(
  -((bounds.min[0] + bounds.max[0]) * 0.5) * modelScale,
  bounds.max[2] * modelScale,
  -((bounds.min[1] + bounds.max[1]) * 0.5) * modelScale,
);
const animator = new PlayerAnimator({ visual, carrier });
world.updateMatrixWorld(true);
animator.snapCarrierToBody();
const skinnedMesh = animator.rig.mesh;
const vertexCount = reduced.positions.length / 3;
const worldPositions = new Float32Array(vertexCount * 3);
const screen = new Float32Array(vertexCount * 3);
const temporary = new THREE.Vector3();
const velocity = new THREE.Vector3();
const background = makeBackground();
let actualSpeed = 0;
let wasGrounded = true;

function motionAt(time) {
  let desiredSpeed = 0;
  let grounded = true;
  let verticalVelocity = 0;
  let hasCargo = false;
  let turnRate = 0;
  if (time >= 1.4 && time < 4.2) desiredSpeed = 3.4;
  else if (time >= 4.2 && time < 7.1) {
    desiredSpeed = 8.1;
    turnRate = time > 5.35 && time < 6.2 ? 0.58 : 0;
  } else if (time >= 7.9 && time < 9.55) {
    grounded = false;
    verticalVelocity = time < 8.55 ? 7.8 - (time - 7.9) * 8.5 : -1.2 - (time - 8.55) * 7.2;
  } else if (time >= 10.2) {
    hasCargo = true;
    desiredSpeed = time >= 10.75 ? 2.8 : 0;
  }
  return { desiredSpeed, grounded, verticalVelocity, hasCargo, turnRate };
}

function rasterTriangle(frame, depth, a, b, c) {
  const ia = a * 3;
  const ib = b * 3;
  const ic = c * 3;
  const ax = screen[ia]; const ay = screen[ia + 1];
  const bx = screen[ib]; const by = screen[ib + 1];
  const cx = screen[ic]; const cy = screen[ic + 1];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 0.12) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;
  const inverseArea = 1 / area;
  const positive = area > 0;
  const abx = worldPositions[ib] - worldPositions[ia];
  const aby = worldPositions[ib + 1] - worldPositions[ia + 1];
  const abz = worldPositions[ib + 2] - worldPositions[ia + 2];
  const acx = worldPositions[ic] - worldPositions[ia];
  const acy = worldPositions[ic + 1] - worldPositions[ia + 1];
  const acz = worldPositions[ic + 2] - worldPositions[ia + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const inverseNormal = 1 / Math.max(1e-8, Math.hypot(nx, ny, nz));
  const shade = 0.58 + Math.max(0, (nx * -0.32 + ny * 0.82 + nz * 0.47) * inverseNormal) * 0.48;
  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const edgeA = (bx - px) * (cy - py) - (by - py) * (cx - px);
      const edgeB = (cx - px) * (ay - py) - (cy - py) * (ax - px);
      const edgeC = (ax - px) * (by - py) - (ay - py) * (bx - px);
      if (positive ? edgeA < 0 || edgeB < 0 || edgeC < 0 : edgeA > 0 || edgeB > 0 || edgeC > 0) continue;
      const wa = edgeA * inverseArea;
      const wb = edgeB * inverseArea;
      const wc = edgeC * inverseArea;
      const z = screen[ia + 2] * wa + screen[ib + 2] * wb + screen[ic + 2] * wc;
      const pixel = y * width + x;
      if (z <= depth[pixel]) continue;
      depth[pixel] = z;
      const output = pixel * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const color = reduced.colors[ia + axis] * wa + reduced.colors[ib + axis] * wb + reduced.colors[ic + axis] * wc;
        frame[output + axis] = Math.min(255, color * shade + (axis === 2 ? 15 : 7));
      }
    }
  }
}

function renderFrame(yaw) {
  const frame = Buffer.from(background);
  drawGround(frame);
  const depth = new Float32Array(width * height);
  depth.fill(-Infinity);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const scale = 112;
  const centerX = width * 0.5;
  const baseline = height - 31;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    skinnedMesh.getVertexPosition(vertex, temporary);
    temporary.applyMatrix4(skinnedMesh.matrixWorld);
    const offset = vertex * 3;
    worldPositions[offset] = temporary.x;
    worldPositions[offset + 1] = temporary.y;
    worldPositions[offset + 2] = temporary.z;
    screen[offset] = centerX + (cosYaw * temporary.x - sinYaw * temporary.z) * scale;
    screen[offset + 1] = baseline - temporary.y * scale;
    screen[offset + 2] = sinYaw * temporary.x + cosYaw * temporary.z;
  }
  for (let offset = 0; offset < reduced.triangles.length; offset += 3) {
    rasterTriangle(frame, depth, reduced.triangles[offset], reduced.triangles[offset + 1], reduced.triangles[offset + 2]);
  }
  return frame;
}

const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const filters = [
  `drawtext=fontfile=${font}:text='PLAYER RIG V2 - SMOOTH WEIGHTS':fontcolor=white:fontsize=20:x=18:y=16:box=1:boxcolor=0x07112699:boxborderw=8`,
  `drawtext=fontfile=${font}:text='IDLE':fontcolor=0x6ff7ff:fontsize=23:x=18:y=57:enable='between(t,0,1.4)'`,
  `drawtext=fontfile=${font}:text='WALK':fontcolor=0xa8ff67:fontsize=23:x=18:y=57:enable='between(t,1.4,4.2)'`,
  `drawtext=fontfile=${font}:text='RUN + TURN':fontcolor=0xffcf68:fontsize=23:x=18:y=57:enable='between(t,4.2,7.1)'`,
  `drawtext=fontfile=${font}:text='STOP':fontcolor=0xff75cf:fontsize=23:x=18:y=57:enable='between(t,7.1,7.9)'`,
  `drawtext=fontfile=${font}:text='JUMP + LANDING':fontcolor=0x6ff7ff:fontsize=23:x=18:y=57:enable='between(t,7.9,10.2)'`,
  `drawtext=fontfile=${font}:text='CARRY':fontcolor=0xa8ff67:fontsize=23:x=18:y=57:enable='between(t,10.2,12)'`,
  `drawtext=fontfile=${font}:text='bind pose preserves original positions - source GLB unchanged':fontcolor=0xc7d6ff:fontsize=13:x=(w-text_w)/2:y=h-21:box=1:boxcolor=0x071126aa:boxborderw=5`,
].join(',');
const errors = [];
const encoder = spawn('ffmpeg', [
  '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', `${fps}`, '-i', 'pipe:0',
  '-vf', filters, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
]);
encoder.stderr.on('data', (chunk) => errors.push(chunk));

for (let frameIndex = 0; frameIndex < duration * fps; frameIndex += 1) {
  const time = frameIndex / fps;
  const motion = motionAt(time);
  actualSpeed = THREE.MathUtils.damp(actualSpeed, motion.desiredSpeed, motion.desiredSpeed > actualSpeed ? 9.5 : 6.5, 1 / fps);
  if (!wasGrounded && motion.grounded) animator.triggerLanding(8.4);
  wasGrounded = motion.grounded;
  velocity.set(0, 0, actualSpeed);
  world.updateMatrixWorld(true);
  animator.update(1 / fps, time, {
    planarSpeed: actualSpeed,
    planarVelocity: velocity,
    desiredSpeed: motion.desiredSpeed,
    maxSpeed: 8.7,
    grounded: motion.grounded,
    verticalVelocity: motion.verticalVelocity,
    hasCargo: motion.hasCargo,
    turnRate: motion.turnRate,
  });
  world.updateMatrixWorld(true);
  const yaw = -0.58 + Math.sin(time * 0.42) * 0.08;
  if (!encoder.stdin.write(renderFrame(yaw))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end();
const [exitCode] = await once(encoder, 'close');
if (exitCode !== 0) throw new Error(Buffer.concat(errors).toString());
const poster = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', '4.9', '-i', outputPath, '-frames:v', '1', posterPath]);
if (poster.status !== 0) throw new Error(poster.stderr.toString());
console.log(JSON.stringify({
  sourceVertices: positions.length / 3,
  reviewVertices: vertexCount,
  reviewTriangles: reduced.triangles.length / 3,
  outputPath,
  posterPath,
  duration,
  fps,
}));
