import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.PI);
export const PORTAL_HALF_WIDTH = 1.18;
export const PORTAL_HALF_HEIGHT = 1.58;
const PORTAL_CLIP_OFFSET = 0.025;
const PORTAL_OUTER_SCALE = 1.10;

function boxCorners(box) {
  const result = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    result.push(new THREE.Vector3(x, y, z));
  }
  return result;
}

function boxInPortalFrame(frame, box) {
  const inverse = frame.quaternion.clone().invert();
  return new THREE.Box3().setFromPoints(boxCorners(box).map(point => point.sub(frame.position).applyQuaternion(inverse)));
}

/** Does a world-space box occupy the aperture within a signed depth interval?
 * Used both for placement clearance and for identifying a backing wall. */
export function portalIntersectsBox(frame, box, minDepth = -0.7, maxDepth = 0.08, padding = 0) {
  if (!box || box.isEmpty()) return false;
  // Reject on the box's own axes before expanding it into portal space. A long
  // room wall becomes an enormous local AABB under a diagonal floor portal and
  // used to block an opening several metres away. The ellipse's support on an
  // axis is exact; adding the depth interval gives its full clearance prism.
  const portalX = new THREE.Vector3(1, 0, 0).applyQuaternion(frame.quaternion);
  const portalY = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
  const middleDepth = (minDepth + maxDepth) / 2;
  const halfDepth = Math.abs(maxDepth - minDepth) / 2;
  for (const axis of ['x', 'y', 'z']) {
    const center = frame.position[axis] + frame.normal[axis] * middleDepth;
    const extent = Math.hypot((frame.width + padding) * portalX[axis], (frame.height + padding) * portalY[axis])
      + Math.abs(frame.normal[axis]) * halfDepth;
    if (center + extent < box.min[axis] || center - extent > box.max[axis]) return false;
  }
  const local = boxInPortalFrame(frame, box);
  if (local.max.z < minDepth || local.min.z > maxDepth) return false;
  const x = THREE.MathUtils.clamp(0, local.min.x, local.max.x);
  const y = THREE.MathUtils.clamp(0, local.min.y, local.max.y);
  return (x / (frame.width + padding)) ** 2 + (y / (frame.height + padding)) ** 2 <= 1;
}

/** Identifies the thin panel and wall directly behind it. A floor crossing the
 * aperture's lower edge or a freestanding obstacle must stay collidable. */
export function portalBacksCollider(frame, box, maxDepth = .7) {
  if (!box || box.isEmpty()) return false;
  const local = boxInPortalFrame(frame, box);
  return local.max.z <= .08 && local.max.z >= -maxDepth && local.min.z < .08
    && portalIntersectsBox(frame, box, -maxDepth, .08);
}

/** True only when coplanar portal rims overlap. Separating-axis tests also
 * support differently oriented floor/ceiling panels without a centre-ID rule. */
export function portalFramesOverlap(a, b, gap = 0.06) {
  if (!a || !b || Math.abs(a.normal.dot(b.normal)) < 0.995) return false;
  if (Math.abs(b.position.clone().sub(a.position).dot(a.normal)) > 0.12) return false;
  const inverse = a.quaternion.clone().invert();
  const outlines = [a, b].map(frame => Array.from({ length: 64 }, (_, i) => {
    const angle = i * Math.PI / 32;
    return new THREE.Vector3(Math.cos(angle) * (frame.width * PORTAL_OUTER_SCALE + gap / 2),
      Math.sin(angle) * (frame.height * PORTAL_OUTER_SCALE + gap / 2), 0)
      .applyQuaternion(frame.quaternion).add(frame.position).sub(a.position).applyQuaternion(inverse);
  }));
  for (const outline of outlines) for (let i = 0; i < outline.length; i++) {
    const edge = outline[(i + 1) % outline.length].clone().sub(outline[i]);
    const axis = new THREE.Vector2(-edge.y, edge.x).normalize();
    const ranges = outlines.map(points => {
      const projected = points.map(point => point.x * axis.x + point.y * axis.y);
      return [Math.min(...projected), Math.max(...projected)];
    });
    if (ranges[0][1] <= ranges[1][0] || ranges[1][1] <= ranges[0][0]) return false;
  }
  return true;
}

/** Planar surface metadata: world `center`, world `normal`, optional world
 * `portalUp`, and optional `portalBounds: { halfWidth, halfHeight }`. Without
 * explicit bounds the mesh's transformed geometry supplies them. */
export function resolvePortalPlacement(panel, hitPoint, { otherPortal = null, blockers = [], margin = 0.02, clampToFit = true, preferredUp } = {}) {
  const metadata = panel?.userData;
  if (!metadata?.portalable || metadata.portalForbidden) return { ok: false, reason: 'forbidden' };
  const movingFrame = typeof metadata.portalFrame === 'function' ? metadata.portalFrame() : null;
  const data = movingFrame ? { ...metadata, center: movingFrame.center, normal: movingFrame.normal,
    portalUp: movingFrame.up, portalBounds: { halfWidth: movingFrame.halfWidth, halfHeight: movingFrame.halfHeight } } : metadata;
  if (!data.normal || !data.center) return { ok: false, reason: 'surface' };
  // Surface bounds stay in the authored panel frame. Rotating a floor portal
  // must not rotate the rectangular panel's bounds along with the aperture.
  const surfaceFrame = makePortalFrame(data.center, data.normal, data.portalUp);
  const frame = makePortalFrame(data.center, data.normal, preferredUp || data.portalUp);
  let bounds;
  if (data.portalBounds) {
    const { halfWidth, halfHeight } = data.portalBounds;
    if (!(halfWidth > 0 && halfHeight > 0)) return { ok: false, reason: 'surface' };
    bounds = { minX: -halfWidth, maxX: halfWidth, minY: -halfHeight, maxY: halfHeight };
  } else {
    panel.updateWorldMatrix(true, false);
    panel.geometry?.computeBoundingBox();
    if (!panel.geometry?.boundingBox) return { ok: false, reason: 'surface' };
    const inverse = surfaceFrame.quaternion.clone().invert();
    const points = boxCorners(panel.geometry.boundingBox).map(point => point.applyMatrix4(panel.matrixWorld).sub(surfaceFrame.position).applyQuaternion(inverse));
    const box = new THREE.Box3().setFromPoints(points);
    bounds = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y };
  }
  const relative = surfaceFrame.quaternion.clone().invert().multiply(frame.quaternion);
  const apertureX = new THREE.Vector3(1, 0, 0).applyQuaternion(relative);
  const apertureY = new THREE.Vector3(0, 1, 0).applyQuaternion(relative);
  // Exact support of an ellipse on each boundary normal, including diagonal
  // floor placements. Bounding the rotated rectangle needlessly rejects fits.
  const halfWidth = Math.hypot(frame.width * apertureX.x, frame.height * apertureY.x) * PORTAL_OUTER_SCALE + margin;
  const halfHeight = Math.hypot(frame.width * apertureX.y, frame.height * apertureY.y) * PORTAL_OUTER_SCALE + margin;
  const minX = bounds.minX + halfWidth; const maxX = bounds.maxX - halfWidth;
  const minY = bounds.minY + halfHeight; const maxY = bounds.maxY - halfHeight;
  if (minX > maxX + 1e-8 || minY > maxY + 1e-8) return { ok: false, reason: 'too-small' };
  const local = (hitPoint || data.center).clone().sub(surfaceFrame.position).applyQuaternion(surfaceFrame.quaternion.clone().invert());
  if (!local.toArray().every(Number.isFinite)) return { ok: false, reason: 'surface' };
  // Only hits on this panel can be adjusted. Never jump to a remote panel or
  // replace the hit point with a fixed marker in the centre of the room.
  if (local.x < bounds.minX - .02 || local.x > bounds.maxX + .02 || local.y < bounds.minY - .02 || local.y > bounds.maxY + .02 || Math.abs(local.z) > .2) {
    return { ok: false, reason: 'outside' };
  }
  const x = THREE.MathUtils.clamp(local.x, minX, maxX); const y = THREE.MathUtils.clamp(local.y, minY, maxY);
  const adjusted = Math.abs(x - local.x) > 1e-7 || Math.abs(y - local.y) > 1e-7;
  if (!clampToFit && adjusted) return { ok: false, reason: 'edge' };
  frame.position.add(new THREE.Vector3(x, y, 0).applyQuaternion(surfaceFrame.quaternion));
  frame.surfaceId = panel.uuid;
  if (portalFramesOverlap(frame, otherPortal)) return { ok: false, reason: 'overlap' };
  for (const blocker of blockers) {
    const mesh = blocker.mesh || blocker;
    if (mesh === panel || (metadata.portalHostCollider && metadata.portalHostCollider === mesh.uuid) || blocker.enabled === false || mesh.userData?.portalClearance === false) continue;
    const box = blocker.box || new THREE.Box3().setFromObject(mesh);
    // Supporting walls are behind the plane. The first 8 cm are a skin allowance;
    // a pillar or closed door in front still prevents an unusable opening.
    if (portalIntersectsBox(frame, box, .08, .85)) return { ok: false, reason: 'obstructed' };
  }
  return { ok: true, frame, position: frame.position, normal: frame.normal, adjusted, bounds,
    anchor: movingFrame?.anchor || panel };
}

/** The normal always points out of the supporting wall and into the room. */
export function makePortalFrame(position, normal, preferredUp = WORLD_UP) {
  const z = normal.clone();
  if (z.lengthSq() < 1e-10) throw new Error('A portal needs a nonzero surface normal');
  z.normalize();
  const requestedUp = (preferredUp || WORLD_UP).clone().normalize();
  const fallbackUp = Math.abs(z.dot(WORLD_UP)) > 0.99 ? new THREE.Vector3(0, 0, 1) : WORLD_UP;
  const up = requestedUp.lengthSq() < .5 || Math.abs(z.dot(requestedUp)) > 0.99 ? fallbackUp : requestedUp;
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

/** A rigid transform shared by actors, cargo and every state in the camera rig. */
export function portalTransformMatrix(entry, exit, target = new THREE.Matrix4()) {
  const rotation = portalRotation(entry, exit);
  const translation = exit.position.clone().sub(entry.position.clone().applyQuaternion(rotation));
  return target.compose(translation, rotation, new THREE.Vector3(1, 1, 1));
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
export function portalCrossing(entry, exit, position, previousPosition, velocity, radius = 0.45,
  { exitClearance = radius + .025, previousEntry = entry } = {}) {
  // The actor and its support both move during a physics step. Testing the old
  // actor against today's plane misses a releasing pressure pad that rises past
  // the old actor centre before gravity advances the body.
  const previousDistance = previousPosition.clone().sub(previousEntry.position).dot(previousEntry.normal);
  const currentDistance = position.clone().sub(entry.position).dot(entry.normal);
  if (previousDistance <= 0 || currentDistance > 0) return null;
  let crossingFraction = previousDistance / (previousDistance - currentDistance);
  const crossingFrame = { position: new THREE.Vector3(), normal: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(), width: entry.width, height: entry.height };
  const interpolateFrame = fraction => {
    crossingFrame.position.copy(previousEntry.position).lerp(entry.position, fraction);
    crossingFrame.quaternion.copy(previousEntry.quaternion).slerp(entry.quaternion, fraction);
    crossingFrame.normal.set(0, 0, 1).applyQuaternion(crossingFrame.quaternion);
    return crossingFrame;
  };
  // Translation has a linear signed-distance sweep; a rotating panel does not.
  // Solve against the interpolated orientation without widening the aperture or
  // accepting an actor that was already behind the plane last physics step.
  if (Math.abs(previousEntry.quaternion.dot(entry.quaternion)) < 1 - 1e-12) {
    let before = 0, after = 1;
    const samplePoint = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const middle = (before + after) / 2;
      interpolateFrame(middle);
      const distance = samplePoint.copy(previousPosition).lerp(position, middle)
        .sub(crossingFrame.position).dot(crossingFrame.normal);
      if (distance > 0) before = middle;
      else after = middle;
    }
    crossingFraction = (before + after) / 2;
  }
  const crossingPoint = previousPosition.clone().lerp(position, crossingFraction);
  if (!pointInsidePortal(interpolateFrame(crossingFraction), crossingPoint, radius)) return null;
  const result = transformPortalPoint(position, entry, exit);
  const unadjustedPosition = result.clone();
  const exitDistance = result.clone().sub(exit.position).dot(exit.normal);
  const exitOffset = exit.normal.clone().multiplyScalar(Math.max(0, exitClearance - exitDistance));
  result.add(exitOffset);
  return {
    position: result,
    unadjustedPosition, exitOffset, crossingPoint, crossingFraction,
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
    exit.position.clone().addScaledVector(exit.normal, PORTAL_CLIP_OFFSET),
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
  if (Math.abs(denominator) < 1e-6) return false;
  clip.multiplyScalar(2 / denominator);
  projection[2] = clip.x;
  projection[6] = clip.y;
  projection[10] = clip.z + 1;
  projection[14] = clip.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}

/** Full viewport resolution keeps a small portal as sharp as the surrounding
 * image; a scissor rectangle, rather than downsampling it, bounds fill cost. */
export function portalTargetSize(width, height, maxResolution = 1280) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, Math.max(128, maxResolution) / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Conservative screen-space bounds, including portals intersecting the eye's
 * near plane. A bounding rectangle encloses the entire elliptical aperture. */
export function portalViewportRect(frame, camera, width, height) {
  camera.updateMatrixWorld(true);
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  if (eye.sub(frame.position).dot(frame.normal) <= 0.002) return null;
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
  if (!frustum.intersectsSphere(new THREE.Sphere(frame.position, Math.hypot(frame.width, frame.height) * 1.14))) return null;
  let minX = 1; let minY = 1; let maxX = -1; let maxY = -1;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      const point = new THREE.Vector3(x * frame.width * 1.14, y * frame.height * 1.14, 0)
        .applyQuaternion(frame.quaternion).add(frame.position);
      const clip = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(viewProjection);
      if (clip.w <= 0.0001) return { x: 0, y: 0, width, height };
      minX = Math.min(minX, clip.x / clip.w); maxX = Math.max(maxX, clip.x / clip.w);
      minY = Math.min(minY, clip.y / clip.w); maxY = Math.max(maxY, clip.y / clip.w);
    }
  }
  const x = Math.max(0, Math.floor((minX * 0.5 + 0.5) * width) - 3);
  const y = Math.max(0, Math.floor((minY * 0.5 + 0.5) * height) - 3);
  const right = Math.min(width, Math.ceil((maxX * 0.5 + 0.5) * width) + 3);
  const top = Math.min(height, Math.ceil((maxY * 0.5 + 0.5) * height) + 3);
  return right > x && top > y ? { x, y, width: right - x, height: top - y } : null;
}

function targetOptions(renderer, sampleCount) {
  const hdr = !!(renderer?.extensions?.has('EXT_color_buffer_float') || renderer?.extensions?.has('EXT_color_buffer_half_float'));
  let samples = Math.min(sampleCount, renderer?.capabilities?.maxSamples || 0);
  const gl = renderer?.getContext?.();
  if (samples && gl?.getInternalformatParameter) {
    // Float attachments do not necessarily support the context's MAX_SAMPLES.
    const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, hdr ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES);
    samples = Math.max(0, ...Array.from(supported || []).filter((value) => value <= samples));
  }
  return {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
  };
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
        float edge = smoothstep(0.92, 1.0, radial);
        vec3 dormant = tint * (0.10 + 0.05 * radial) + vec3(0.012, 0.018, 0.028);
        vec3 destination = texture2D(view, clamp(screenUv, vec2(0.001), vec2(0.999))).rgb;
        vec3 result = mix(dormant, destination, linked);
        result += tint * edge * 0.12;
        gl_FragColor = vec4(result, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    // Render targets contain linear HDR. Three applies this material's tone
    // mapping only for the final canvas, including when a nested portal is used.
    toneMapped: true,
    side: THREE.FrontSide,
  });
}

/** Live windows at the game render cadence. At most two primary views and one
 * nested view per primary; no target is ever sampled while it is being written. */
export class LabPortals {
  constructor({ scene, renderer, camera, maxResolution = 1280, recursion = true, samples = 4 }) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.portals = [null, null];
    this.physicsFrames = null;
    this.committedPhysicsFrames = null;
    this.maxResolution = maxResolution;
    this.recursion = recursion;
    const options = targetOptions(renderer, samples);
    this.targets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, options));
    this.bounceTarget = new THREE.WebGLRenderTarget(1, 1, { ...options, samples: 0 });
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.nestedCamera = new THREE.PerspectiveCamera();
    this._rendering = false;
    this.diagnostics = { cadence: 'every-render-frame', passes: 0, visible: 0, nested: 0, width: 1, height: 1, samples: options.samples, hdr: options.type === THREE.HalfFloatType };
  }

  get ready() { return this.portals.every(Boolean); }

  _physicsSnapshot(frame) {
    return frame ? { frame, pose: {
      position: frame.position.clone(), normal: frame.normal.clone(), quaternion: frame.quaternion.clone(),
      width: frame.width, height: frame.height,
    } } : null;
  }

  /** Once per fixed physics step, BEFORE moving mechanisms. Rendering and
   * multiple actor queries may sync world transforms but never change these
   * snapshots; player and cargo must sweep over the same time interval. The
   * last committed physics pose takes precedence over an interpolated render
   * anchor. For newly placed portals restore mechanism poses to physics time
   * before this call, since they do not have a previous committed frame yet. */
  beginPhysicsStep() {
    this.syncMovingSurfaces();
    this.physicsFrames = this.portals.map((frame, index) => {
      const committed = this.committedPhysicsFrames?.[index];
      return committed?.frame === frame ? committed : this._physicsSnapshot(frame);
    });
  }

  /** Commit after mechanisms and every actor finish their fixed step, before
   * interpolation changes animated model transforms for rendering. */
  endPhysicsStep() {
    this.syncMovingSurfaces();
    this.committedPhysicsFrames = this.portals.map(frame => this._physicsSnapshot(frame));
  }

  placeOnPanel(index, panel, hitPoint, options = {}) {
    if (index !== 0 && index !== 1) throw new Error('Portal index must be 0 or 1');
    this.syncMovingSurfaces();
    const placement = resolvePortalPlacement(panel, hitPoint, { ...options, otherPortal: this.portals[1 - index] });
    if (!placement.ok) return placement;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(placement.frame.quaternion);
    const frame = this.place(index, placement.position, placement.normal, up);
    frame.surfaceId = panel.uuid;
    this.attachToSurface(index, placement.anchor);
    return { ...placement, frame };
  }

  /** Attach in object space, so a pressing pad or rotating panel carries its
   * aperture with the same transform as the real model and collision surface. */
  attachToSurface(index, surface) {
    const frame = this.portals[index];
    if (!frame || !surface?.isObject3D) return false;
    surface.updateWorldMatrix(true, false);
    const inverse = surface.matrixWorld.clone().invert();
    frame.anchor = {
      object: surface,
      position: frame.position.clone().applyMatrix4(inverse),
      normal: frame.normal.clone().transformDirection(inverse),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion).transformDirection(inverse),
    };
    return true;
  }

  syncMovingSurfaces() {
    for (const frame of this.portals) {
      if (!frame?.anchor) continue;
      const anchor = frame.anchor;
      anchor.object.updateWorldMatrix(true, false);
      const matrix = anchor.object.matrixWorld;
      const updated = makePortalFrame(anchor.position.clone().applyMatrix4(matrix),
        anchor.normal.clone().transformDirection(matrix), anchor.up.clone().transformDirection(matrix));
      frame.position.copy(updated.position); frame.normal.copy(updated.normal); frame.quaternion.copy(updated.quaternion);
      frame.group.position.copy(frame.position).addScaledVector(frame.normal, .036);
      frame.group.quaternion.copy(frame.quaternion);
      frame.group.updateMatrixWorld(true);
    }
  }

  place(index, position, normal, preferredUp) {
    if (index !== 0 && index !== 1) throw new Error('Portal index must be 0 or 1');
    const frame = makePortalFrame(position, normal, preferredUp);
    this._remove(index);
    const color = index === 0 ? 0x38bcff : 0xffb74b;
    const group = new THREE.Group();
    group.name = index === 0 ? 'Lab aperture A' : 'Lab aperture B';
    group.position.copy(frame.position).addScaledVector(frame.normal, 0.036);
    group.quaternion.copy(frame.quaternion);
    const material = portalSurface(color, this.targets[index].texture);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 128), material);
    surface.scale.set(frame.width, frame.height, 1);
    surface.renderOrder = 2;
    group.add(surface);
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.002, 1.043, 128), new THREE.MeshBasicMaterial({ color }));
    rim.scale.set(frame.width, frame.height, 1);
    rim.position.z = 0.008;
    group.add(rim);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.04, 1.10, 128), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(frame.width, frame.height, 1);
    halo.position.z = 0.003;
    group.add(halo);
    this.scene.add(group);
    Object.assign(frame, { group, surface, rim, halo });
    this.portals[index] = frame;
    if (this.physicsFrames) this.physicsFrames[index] = this._physicsSnapshot(frame);
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
    if (this.physicsFrames) this.physicsFrames[index] = null;
    if (this.committedPhysicsFrames) this.committedPhysicsFrames[index] = null;
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

  tryTeleport(position, previousPosition, velocity, radius = 0.45, options = {}) {
    if (!this.ready) return null;
    this.syncMovingSurfaces();
    for (let entryIndex = 0; entryIndex < 2; entryIndex++) {
      const entry = this.portals[entryIndex];
      const previous = this.physicsFrames?.[entryIndex];
      const previousEntry = previous?.frame === entry ? previous.pose : entry;
      const result = portalCrossing(entry, this.portals[1 - entryIndex], position, previousPosition, velocity, radius,
        { previousEntry, ...options });
      if (result) return { ...result, entryIndex, exitIndex: 1 - entryIndex };
    }
    return null;
  }

  update(time = 0) {
    this.syncMovingSurfaces();
    this.portals.forEach((frame) => {
      if (!frame) return;
      frame.surface.material.uniforms.time.value = time;
      frame.surface.material.uniforms.linked.value = this.ready ? 1 : 0;
    });
  }

  _prepareCamera(source, entry, exit, target) {
    source.updateMatrixWorld(true);
    const eye = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    const rotation = source.getWorldQuaternion(new THREE.Quaternion());
    target.copy(source, false);
    target.position.copy(transformPortalPoint(eye, entry, exit));
    target.quaternion.copy(portalRotation(entry, exit)).multiply(rotation);
    target.scale.set(1, 1, 1);
    target.updateMatrixWorld(true);
    // A nested camera needs a fresh projection, not the preceding exit plane.
    // The main eye may itself still use an exit plane after its player crosses.
    // A fresh optical projection avoids composing two unrelated clip planes.
    target.updateProjectionMatrix();
    applyPortalObliqueClipping(target, exit);
    return target;
  }

  _draw(target, camera, rect) {
    const renderer = this.renderer;
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, target.width, target.height);
    renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(this.scene, camera);
    this.diagnostics.passes++;
  }

  render(time = 0) {
    this.update(time);
    this.diagnostics.passes = 0; this.diagnostics.visible = 0; this.diagnostics.nested = 0;
    if (!this.ready || !this.renderer || !this.camera || this._rendering) return;
    const renderer = this.renderer;
    const targetBefore = renderer.getRenderTarget();
    const faceBefore = renderer.getActiveCubeFace?.() || 0;
    const mipBefore = renderer.getActiveMipmapLevel?.() || 0;
    const viewportBefore = renderer.getViewport(new THREE.Vector4());
    const scissorBefore = renderer.getScissor(new THREE.Vector4());
    const scissorTestBefore = renderer.getScissorTest();
    const xrBefore = renderer.xr.enabled;
    const shadowBefore = renderer.shadowMap.autoUpdate;
    const visibleBefore = this.portals.map((frame) => frame.group.visible);
    const surfacesBefore = this.portals.map((frame) => ({
      visible: frame.surface.visible,
      texture: frame.surface.material.uniforms.view.value,
      linked: frame.surface.material.uniforms.linked.value,
    }));
    this.camera.updateMatrixWorld(true);
    const buffer = renderer.getDrawingBufferSize?.(new THREE.Vector2()) || new THREE.Vector2(viewportBefore.z, viewportBefore.w);
    const size = portalTargetSize(buffer.x, buffer.y, this.maxResolution);
    Object.assign(this.diagnostics, size);
    for (const target of [...this.targets, this.bounceTarget]) {
      if (target.width !== size.width || target.height !== size.height) target.setSize(size.width, size.height);
    }
    const visible = this.portals.map((frame, index) => visibleBefore[index]
      ? portalViewportRect(frame, this.camera, size.width, size.height) : null);
    this.diagnostics.visible = visible.filter(Boolean).length;
    if (!this.diagnostics.visible) return;
    this._rendering = true;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      for (let index = 0; index < 2; index++) {
        if (!visible[index]) continue;
        const entry = this.portals[index];
        const exit = this.portals[1 - index];
        const virtual = this._prepareCamera(this.camera, entry, exit, this.virtualCamera);
        this.portals.forEach((frame) => { frame.group.visible = false; });
        // The exit is back-facing from the virtual eye. Only the other aperture
        // can be seen again, so one additional texture suffices for recursion.
        const nestedRect = this.recursion && visibleBefore[index]
          ? portalViewportRect(entry, virtual, size.width, size.height) : null;
        if (nestedRect) {
          const nested = this._prepareCamera(virtual, entry, exit, this.nestedCamera);
          this._draw(this.bounceTarget, nested, nestedRect);
          entry.group.visible = true;
          entry.surface.visible = true;
          entry.surface.material.uniforms.view.value = this.bounceTarget.texture;
          entry.surface.material.uniforms.linked.value = 1;
          this.diagnostics.nested++;
        }
        this._draw(this.targets[index], virtual, visible[index]);
        // The next primary view must start with its own texture bindings.
        entry.surface.material.uniforms.view.value = surfacesBefore[index].texture;
      }
    } finally {
      this.portals.forEach((frame, index) => {
        frame.group.visible = visibleBefore[index];
        frame.surface.visible = surfacesBefore[index].visible;
        frame.surface.material.uniforms.view.value = surfacesBefore[index].texture;
        frame.surface.material.uniforms.linked.value = surfacesBefore[index].linked;
      });
      renderer.setRenderTarget(targetBefore, faceBefore, mipBefore);
      renderer.setViewport(viewportBefore);
      renderer.setScissor(scissorBefore);
      renderer.setScissorTest(scissorTestBefore);
      renderer.xr.enabled = xrBefore;
      renderer.shadowMap.autoUpdate = shadowBefore;
      this._rendering = false;
    }
  }

  dispose() { this.clear(); this.targets.forEach((target) => target.dispose()); this.bounceTarget.dispose(); }
}

export default LabPortals;
