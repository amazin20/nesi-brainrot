import * as THREE from 'three';

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const JOINTS = [
  ['Body', [0, 0, -.35]], ['Head', [-.08, -.04, -.55]],
  ['Tail', [.23, -.09, -.30]], ['FinL', [-.06, -.15, -.42]], ['FinR', [-.06, .12, -.42]],
  ['FootL', [-.03, -.12, -.18]], ['FootR', [-.03, .12, -.18]],
];

/** Small anatomical motion on the uploaded shark. Spatially continuous weights
 * weld UV duplicates; the source file, topology, maps and bind pose stay intact. */
export class LabCompanionRig {
  constructor(visual) {
    let source;
    visual.traverse(o => { if (!source && o.isMesh) source = o; });
    if (!source || source.isSkinnedMesh) { this.mesh = null; return; }
    const geometry = source.geometry.clone(), p = geometry.attributes.position;
    const indices = new Uint16Array(p.count * 4), weights = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      const x = Math.round(p.getX(i) * 1e5) / 1e5, y = Math.round(p.getY(i) * 1e5) / 1e5;
      const h = -Math.round(p.getZ(i) * 1e5) / 1e5;
      const tail = smooth(.21, .43, x) * (1 - smooth(.59, .73, h));
      const head = smooth(.54, .68, h) * (1 - tail);
      const shoe = (1 - smooth(.16, .25, h)) * (1 - tail);
      const fin = smooth(.105, .20, Math.abs(y + .015)) * smooth(.22, .31, h)
        * (1 - smooth(.48, .59, h)) * (1 - smooth(.04, .23, x)) * (1 - head) * (1 - tail) * (1 - shoe);
      const parts = [[0, Math.max(0, 1 - tail - head - shoe - fin)], [1, head], [2, tail],
        [y < -.015 ? 3 : 4, fin], [y < -.015 ? 5 : 6, shoe]]
        .filter(([, w]) => w > 1e-7).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = parts.reduce((s, [, w]) => s + w, 0);
      parts.forEach(([bone, w], k) => { indices[i * 4 + k] = bone; weights[i * 4 + k] = w / sum; });
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, source.material);
    mesh.position.copy(source.position); mesh.quaternion.copy(source.quaternion); mesh.scale.copy(source.scale);
    mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow; mesh.frustumCulled = false;
    mesh.name = 'Companion articulated source';
    const parent = source.parent; parent.remove(source); parent.add(mesh);
    this.bones = {};
    for (const [name, point] of JOINTS) {
      const bone = new THREE.Bone(); bone.name = `Companion${name}`; bone.position.fromArray(point);
      this.bones[name] = bone;
      if (name === 'Body') mesh.add(bone);
      else { bone.position.sub(this.bones.Body.position); this.bones.Body.add(bone); }
    }
    visual.updateWorldMatrix(true, true);
    this.skeleton = new THREE.Skeleton(Object.values(this.bones)); mesh.bind(this.skeleton);
    this.mesh = mesh; this.phase = 0; this.walk = 0; this.alert = 0;
  }
  reset() {
    this.phase = this.walk = this.alert = this.flightBrace = 0;
    if (!this.mesh) return;
    Object.values(this.bones).forEach(b => b.quaternion.identity());
    this.mesh.updateWorldMatrix(true, true); this.skeleton.update();
  }
  update({ dt = 0, elapsed = 0, speed = 0, grounded = true, carrying = false, recovering = false, tumbling = false }) {
    if (!this.mesh) return;
    const walk = grounded && !carrying && !tumbling ? THREE.MathUtils.clamp(speed / .32, 0, 1) : 0;
    this.walk = THREE.MathUtils.damp(this.walk, walk, 8, dt);
    this.alert = THREE.MathUtils.damp(this.alert, tumbling ? 0 : carrying ? .5 : 1, 7, dt);
    this.phase += dt * (3 + Math.min(speed, .6) * 28);
    const wave = Math.sin(this.phase), t = elapsed;
    // Carried high-speed flight: small fin/foot bracing, without moving the grip or body.
    this.flightBrace=THREE.MathUtils.damp(this.flightBrace||0,carrying&&!grounded?THREE.MathUtils.clamp((speed-5)/9,0,1):0,9,dt);
    this.bones.Tail.rotation.z = (Math.sin(t * 3.1) * .07 + wave * .055 * this.walk) * this.alert;
    this.bones.Head.rotation.x = Math.sin(t * 1.2) * .022 * this.alert;
    this.bones.Head.rotation.y = Math.sin(t * 2.1) * .017 * this.alert;
    this.bones.Tail.rotation.z+=Math.sin(t*4.2)*.025*this.flightBrace;
    for (const [side, sign] of [['L', -1], ['R', 1]]) {
      this.bones[`Fin${side}`].rotation.x = sign * (Math.sin(t * 2.7) * .04 + wave * .07 * this.walk) * this.alert + sign*.14*this.flightBrace;
      this.bones[`Foot${side}`].rotation.y = sign * wave * .12 * this.walk + (recovering ? sign * Math.sin(t * 8) * .055 : 0)+sign*.045*this.flightBrace;
    }
    this.mesh.updateWorldMatrix(true, true); this.skeleton.update();
  }
}
