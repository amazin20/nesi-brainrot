import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.PI);
export const PORTAL_HALF_WIDTH = 1.18;
export const PORTAL_HALF_HEIGHT = 1.58;

/** The normal always points out of the supporting wall and into the room. */
export function makePortalFrame(position, normal) {
  const z = normal.clone();
  if (z.lengthSq() < 1e-10) throw new Error('A portal needs a nonzero surface normal');
  z.normalize();
  const up = Math.abs(z.dot(WORLD_UP)) > 0.99 ? new THREE.Vector3(0, 0, 1) : WORLD_UP;
  const x = up.clone().cross(z).normalize();
  const y = z.clone().cross(x).normalize();
  return {
    position: position.clone(), normal: z,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)),
    width: PORTAL_HALF_WIDTH, height: PORTAL_HALF_HEIGHT,
  };
}

export function portalRotation(entry, exit, target = new THREE.Quaternion()) {
  return target.copy(exit.quaternion).multiply(HALF_TURN).multiply(entry.quaternion.clone().invert()).normalize();
}

export function transformPortalPoint(point, entry, exit, target = new THREE.Vector3()) {
  return target.copy(point).sub(entry.position).applyQuaternion(portalRotation(entry, exit)).add(exit.position);
}

export function transformPortalDirection(direction, entry, exit, target = new THREE.Vector3()) {
  return target.copy(direction).applyQuaternion(portalRotation(entry, exit));
}

/** Conservative aperture erosion by capsule radius; caller checks wall depth. */
export function pointInsidePortal(frame, point, radius = 0) {
  const local = point.clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
  const width = frame.width - radius;
  const height = frame.height - radius;
  return width > 0 && height > 0 && (local.x / width) ** 2 + (local.y / height) ** 2 <= 1;
}

/** Swept front-to-back crossing, independent of camera and frame-rate. */
export function portalCrossing(entry, exit, position, previousPosition, velocity, radius = 0.45) {
  const previousDistance = previousPosition.clone().sub(entry.position).dot(entry.normal);
  const currentDistance = position.clone().sub(entry.position).dot(entry.normal);
  if (previousDistance <= 0 || currentDistance > 0) return null;
  const crossingPoint = previousPosition.clone().lerp(position, previousDistance / (previousDistance - currentDistance));
  if (!pointInsidePortal(entry, crossingPoint, radius)) return null;
  const result = transformPortalPoint(position, entry, exit);
  const exitDistance = result.clone().sub(exit.position).dot(exit.normal);
  result.addScaledVector(exit.normal, Math.max(0, radius + 0.10 - exitDistance));
  return {
    position: result,
    velocity: transformPortalDirection(velocity, entry, exit),
    rotation: portalRotation(entry, exit),
  };
}

// Replace the near plane with the destination portal plane. This clips its
// supporting wall even though the virtual eye is physically behind that wall.
export function applyPortalObliqueClipping(camera, exit) {
  camera.updateMatrixWorld(true);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    exit.normal,
    exit.position.clone().addScaledVector(exit.normal, 0.025),
  ).applyMatrix4(camera.matrixWorldInverse);
  const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const projection = camera.projectionMatrix.elements;
  const q = new THREE.Vector4(
    (Math.sign(clip.x) + projection[8]) / projection[0],
    (Math.sign(clip.y) + projection[9]) / projection[5],
    -1,
    (1 + projection[10]) / projection[14],
  );
  const denominator = clip.dot(q);
  if (Math.abs(denominator) < 1e-6) return;
  clip.multiplyScalar(2 / denominator);
  projection[2] = clip.x;
  projection[6] = clip.y;
  projection[10] = clip.z + 1;
  projection[14] = clip.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function portalSurface(color, texture) {
  return new THREE.ShaderMaterial({
    uniforms: { view: { value: texture }, tint: { value: new THREE.Color(color) }, linked: { value: 0 }, time: { value: 0 } },
    vertexShader: `
      varying vec2 apertureUv;
      varying vec4 screenPosition;
      void main() {
        apertureUv = uv;
        screenPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = screenPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D view;
      uniform vec3 tint;
      uniform float linked;
      uniform float time;
      varying vec2 apertureUv;
      varying vec4 screenPosition;
      void main() {
        vec2 screenUv = screenPosition.xy / screenPosition.w * 0.5 + 0.5;
        float radial = length((apertureUv - 0.5) * 2.0);
        float wave = 0.035 * sin(radial * 34.0 - time * 3.0);
        vec3 dormant = tint * (0.15 + wave) + vec3(0.012, 0.018, 0.028);
        vec3 destination = texture2D(view, clamp(screenUv, vec2(0.001), vec2(0.999))).rgb;
        vec3 result = mix(dormant, destination, linked);
        result += tint * pow(clamp(radial, 0.0, 1.0), 18.0) * 0.24;
        gl_FragColor = vec4(result, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false,
    side: THREE.FrontSide,
  });
}

/** Two reusable lab apertures. Rendering is bounded to two nonrecursive views. */
export class LabPortals {
  constructor({ scene, renderer, camera }) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.portals = [null, null];
    this.targets = [0, 1].map(() => new THREE.WebGLRenderTarget(384, 216, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
    }));
    this.virtualCamera = new THREE.PerspectiveCamera();
    this._rendering = false;
    this._lastRenderTime = -Infinity;
    this.renderInterval = 1 / 30;
  }

  get ready() { return this.portals.every(Boolean); }

  place(index, position, normal) {
    if (index !== 0 && index !== 1) throw new Error('Portal index must be 0 or 1');
    this._remove(index);
    const frame = makePortalFrame(position, normal);
    const color = index === 0 ? 0x38bcff : 0xffb74b;
    const group = new THREE.Group();
    group.name = index === 0 ? 'Lab aperture A' : 'Lab aperture B';
    group.position.copy(frame.position).addScaledVector(frame.normal, 0.036);
    group.quaternion.copy(frame.quaternion);
    const material = portalSurface(color, this.targets[index].texture);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 64), material);
    surface.scale.set(frame.width, frame.height, 1);
    surface.renderOrder = 2;
    group.add(surface);
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.015, 1.067, 64), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    rim.scale.set(frame.width, frame.height, 1);
    rim.position.z = 0.008;
    group.add(rim);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.065, 1.13, 64), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    halo.scale.set(frame.width, frame.height, 1);
    halo.position.z = 0.003;
    group.add(halo);
    this.scene.add(group);
    Object.assign(frame, { group, surface, rim, halo });
    this.portals[index] = frame;
    this._lastRenderTime = -Infinity;
    return frame;
  }

  _remove(index) {
    const frame = this.portals[index];
    if (!frame) return;
    frame.group.removeFromParent();
    frame.group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    this.portals[index] = null;
  }

  clear() { this._remove(0); this._remove(1); }

  isInsideAperture(index, position, radius = 0.45) {
    return !!this.portals[index] && pointInsidePortal(this.portals[index], position, radius);
  }

  transformPoint(point, entryIndex, target = new THREE.Vector3()) {
    return this.ready ? transformPortalPoint(point, this.portals[entryIndex], this.portals[1 - entryIndex], target) : target.copy(point);
  }

  transformDirection(direction, entryIndex, target = new THREE.Vector3()) {
    return this.ready ? transformPortalDirection(direction, this.portals[entryIndex], this.portals[1 - entryIndex], target) : target.copy(direction);
  }

  tryTeleport(position, previousPosition, velocity, radius = 0.45) {
    if (!this.ready) return null;
    for (let entryIndex = 0; entryIndex < 2; entryIndex++) {
      const result = portalCrossing(this.portals[entryIndex], this.portals[1 - entryIndex], position, previousPosition, velocity, radius);
      if (result) return { ...result, entryIndex, exitIndex: 1 - entryIndex };
    }
    return null;
  }

  update(time = 0) {
    this.portals.forEach((frame, index) => {
      if (!frame) return;
      frame.surface.material.uniforms.time.value = time;
      frame.surface.material.uniforms.linked.value = this.ready ? 1 : 0;
      frame.halo.material.opacity = 0.14 + 0.06 * Math.sin(time * 2.8 + index);
    });
  }

  render(time = 0) {
    this.update(time);
    if (!this.ready || !this.renderer || !this.camera || this._rendering) return;
    if (time - this._lastRenderTime < this.renderInterval && time >= this._lastRenderTime) return;
    this._lastRenderTime = time;
    const renderer = this.renderer;
    const targetBefore = renderer.getRenderTarget();
    const viewportBefore = renderer.getViewport(new THREE.Vector4());
    const scissorBefore = renderer.getScissor(new THREE.Vector4());
    const scissorTestBefore = renderer.getScissorTest();
    const xrBefore = renderer.xr.enabled;
    const shadowBefore = renderer.shadowMap.autoUpdate;
    const visibleBefore = this.portals.map((frame) => frame.group.visible);
    this.camera.updateMatrixWorld(true);
    const eye = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const eyeRotation = new THREE.Quaternion().setFromRotationMatrix(this.camera.matrixWorld);
    this._rendering = true;
    this.portals.forEach((frame) => { frame.group.visible = false; });
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setScissorTest(false);
      for (let index = 0; index < 2; index++) {
        const entry = this.portals[index];
        const exit = this.portals[1 - index];
        if (eye.clone().sub(entry.position).dot(entry.normal) <= 0.02) continue;
        const virtual = this.virtualCamera;
        virtual.copy(this.camera, false);
        virtual.position.copy(transformPortalPoint(eye, entry, exit));
        virtual.quaternion.copy(portalRotation(entry, exit)).multiply(eyeRotation);
        virtual.scale.set(1, 1, 1);
        virtual.updateMatrixWorld(true);
        virtual.projectionMatrix.copy(this.camera.projectionMatrix);
        applyPortalObliqueClipping(virtual, exit);
        const aspect = this.camera.aspect || 16 / 9;
        const width = aspect >= 1 ? 384 : Math.max(128, Math.round(384 * aspect));
        const height = aspect >= 1 ? Math.max(128, Math.round(384 / aspect)) : 384;
        const target = this.targets[index];
        if (target.width !== width || target.height !== height) target.setSize(width, height);
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, width, height);
        renderer.clear();
        renderer.render(this.scene, virtual);
      }
    } finally {
      this.portals.forEach((frame, index) => { frame.group.visible = visibleBefore[index]; });
      renderer.setRenderTarget(targetBefore);
      renderer.setViewport(viewportBefore);
      renderer.setScissor(scissorBefore);
      renderer.setScissorTest(scissorTestBefore);
      renderer.xr.enabled = xrBefore;
      renderer.shadowMap.autoUpdate = shadowBefore;
      this._rendering = false;
    }
  }

  dispose() { this.clear(); this.targets.forEach((target) => target.dispose()); }
}

export default LabPortals;
