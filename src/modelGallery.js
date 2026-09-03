import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const models = [
  ['model-01-player.glb', '01 — Player'],
  ['model-02-cargo.glb', '02 — Cargo / Brainrot'],
  ['model-03-swing-hammer.glb', '03 — Swing Hammer'],
  ['model-04-bounce-block.glb', '04 — Bounce Block'],
  ['model-05-checkpoint.glb', '05 — Checkpoint'],
  ['model-06-finish-flag.glb', '06 — Finish Flag'],
  ['model-07-spin-hammer.glb', '07 — Spin Hammer'],
  ['model-08-roller.glb', '08 — Roller'],
  ['model-09-hurdles.glb', '09 — Hurdles'],
  ['model-10-platform.glb', '10 — Platform'],
];

const gallery = document.querySelector('#gallery');
const status = document.querySelector('#status');
const base = import.meta.env.BASE_URL;

const draco = new DRACOLoader();
draco.setDecoderPath(`${base}draco/`);
draco.setDecoderConfig({ type: 'wasm' });
draco.preload();
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

function loadModel(file) {
  return new Promise((resolve, reject) => loader.load(`${base}models/${file}`, resolve, undefined, reject));
}

function fitObject(object, targetSize = 4.5) {
  let box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const scale = largest > 0.0001 ? targetSize / largest : 1;
  object.scale.setScalar(scale);
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  return new THREE.Box3().setFromObject(object);
}

async function renderCard(file, label) {
  const card = document.createElement('section');
  card.className = 'card';
  const title = document.createElement('h2');
  title.textContent = `${label} — ${file}`;
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  card.append(title, viewport);
  gallery.appendChild(card);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101a33);

  const camera = new THREE.PerspectiveCamera(38, 1.2, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(1);
  renderer.setSize(720, 610, false);
  viewport.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x25334d, 2.7));
  const key = new THREE.DirectionalLight(0xfff0d8, 4.5);
  key.position.set(-5, 8, 7);
  scene.add(key);
  const rim = new THREE.PointLight(0x55cfff, 25, 30, 2);
  rim.position.set(5, 5, -5);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 64),
    new THREE.MeshStandardMaterial({ color: 0x172643, roughness: 0.9, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const gltf = await loadModel(file);
  const object = gltf.scene;
  object.rotation.y = -0.52;
  const box = fitObject(object, 4.5);
  scene.add(object);

  const size = box.getSize(new THREE.Vector3());
  const centerY = Math.max(1.2, size.y * 0.48);
  camera.position.set(6.6, Math.max(3.4, size.y * 0.68), 8.4);
  camera.lookAt(0, centerY, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  card.dataset.ready = 'true';
}

try {
  for (const [file, label] of models) {
    await renderCard(file, label);
    status.textContent = `Загружено ${document.querySelectorAll('.card[data-ready="true"]').length} / ${models.length}`;
  }
  status.textContent = 'Все 10 моделей загружены';
  document.documentElement.dataset.galleryReady = 'true';
} catch (error) {
  console.error(error);
  status.textContent = `Ошибка: ${error?.message ?? error}`;
  document.documentElement.dataset.galleryReady = 'error';
}
