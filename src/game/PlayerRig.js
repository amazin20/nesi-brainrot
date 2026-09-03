import * as THREE from 'three';

export const PLAYER_RIG_SPEC = Object.freeze([
  { name: 'Root', parent: null, position: [0, 0, 0] },
  { name: 'Pelvis', parent: 'Root', position: [0, -0.01, -0.405] },
  { name: 'Spine', parent: 'Pelvis', position: [0, 0, -0.12] },
  { name: 'Chest', parent: 'Spine', position: [0, 0, -0.13] },
  { name: 'Neck', parent: 'Chest', position: [0, 0, -0.075] },
  { name: 'Head', parent: 'Neck', position: [0, 0, -0.095] },
  { name: 'EarL', parent: 'Head', position: [-0.095, -0.005, -0.035] },
  { name: 'EarR', parent: 'Head', position: [0.095, -0.005, -0.035] },
  { name: 'Cape', parent: 'Chest', position: [0, -0.175, 0.015] },
  { name: 'UpperArmL', parent: 'Chest', position: [-0.17, 0, 0.025] },
  { name: 'LowerArmL', parent: 'UpperArmL', position: [-0.052, 0, 0.13] },
  { name: 'HandL', parent: 'LowerArmL', position: [-0.016, 0.005, 0.125] },
  { name: 'UpperArmR', parent: 'Chest', position: [0.17, 0, 0.025] },
  { name: 'LowerArmR', parent: 'UpperArmR', position: [0.052, 0, 0.13] },
  { name: 'HandR', parent: 'LowerArmR', position: [0.016, 0.005, 0.125] },
  { name: 'UpperLegL', parent: 'Pelvis', position: [-0.09, 0, 0.035] },
  { name: 'LowerLegL', parent: 'UpperLegL', position: [-0.008, 0, 0.17] },
  { name: 'FootL', parent: 'LowerLegL', position: [0, 0.03, 0.14] },
  { name: 'UpperLegR', parent: 'Pelvis', position: [0.09, 0, 0.035] },
  { name: 'LowerLegR', parent: 'UpperLegR', position: [0.008, 0, 0.17] },
  { name: 'FootR', parent: 'LowerLegR', position: [0, 0.03, 0.14] },
]);

export const PLAYER_BONE_INDEX = Object.freeze(Object.fromEntries(
  PLAYER_RIG_SPEC.map((bone, index) => [bone.name, index]),
));

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const clearInfluences = (indices, weights) => {
  for (let slot = 0; slot < 4; slot += 1) {
    indices[slot] = 0;
    weights[slot] = 0;
  }
};

const setSingle = (indices, weights, bone) => {
  clearInfluences(indices, weights);
  indices[0] = bone;
  weights[0] = 1;
};

const setBlend = (indices, weights, first, second, secondWeight) => {
  const mix = clamp01(secondWeight);
  clearInfluences(indices, weights);
  indices[0] = first;
  indices[1] = second;
  weights[0] = 1 - mix;
  weights[1] = mix;
};

const torsoBoneAtHeight = (height) => {
  if (height < 0.5) return PLAYER_BONE_INDEX.Pelvis;
  if (height < 0.62) return PLAYER_BONE_INDEX.Spine;
  if (height < 0.72) return PLAYER_BONE_INDEX.Chest;
  if (height < 0.79) return PLAYER_BONE_INDEX.Neck;
  return PLAYER_BONE_INDEX.Head;
};

/** Map the source mesh (-Z is up) to normalized anatomical weights. */
export function resolvePlayerSkin(
  x,
  y,
  z,
  indices = new Uint16Array(4),
  weights = new Float32Array(4),
) {
  const height = -z;
  const side = x < 0 ? 'L' : 'R';
  const absX = Math.abs(x);

  if (height >= 0.84) {
    const earWeight = smoothstep(0.88, 1.015, height) * smoothstep(0.025, 0.095, absX);
    if (earWeight > 0.015) {
      setBlend(indices, weights, PLAYER_BONE_INDEX.Head, PLAYER_BONE_INDEX[`Ear${side}`], earWeight);
    } else setSingle(indices, weights, PLAYER_BONE_INDEX.Head);
    return { indices, weights };
  }

  if (height >= 0.705) {
    setBlend(
      indices,
      weights,
      PLAYER_BONE_INDEX.Neck,
      PLAYER_BONE_INDEX.Head,
      smoothstep(0.705, 0.82, height),
    );
    return { indices, weights };
  }

  const armThreshold = height > 0.59 ? 0.158 : height > 0.43 ? 0.132 : 0.155;
  if (height > 0.29 && height < 0.715 && absX > armThreshold) {
    const upper = PLAYER_BONE_INDEX[`UpperArm${side}`];
    const lower = PLAYER_BONE_INDEX[`LowerArm${side}`];
    const hand = PLAYER_BONE_INDEX[`Hand${side}`];
    if (height > 0.555) {
      // Blend the shoulder cap into the chest instead of cutting a rigid seam
      // at the arm threshold. Outer vertices still follow the arm fully.
      const shoulderWeight = smoothstep(armThreshold, armThreshold + 0.05, absX);
      setBlend(indices, weights, PLAYER_BONE_INDEX.Chest, upper, shoulderWeight);
    }
    else if (height > 0.435) setBlend(indices, weights, lower, upper, smoothstep(0.435, 0.555, height));
    else setBlend(indices, weights, hand, lower, smoothstep(0.315, 0.435, height));
    return { indices, weights };
  }

  if (y < -0.185 && height > 0.405 && height < 0.765 && absX < 0.235) {
    setBlend(
      indices,
      weights,
      torsoBoneAtHeight(height),
      PLAYER_BONE_INDEX.Cape,
      smoothstep(-0.185, -0.31, y) * 0.82,
    );
    return { indices, weights };
  }

  if (height < 0.43 && (absX > 0.032 || height < 0.27)) {
    const upper = PLAYER_BONE_INDEX[`UpperLeg${side}`];
    const lower = PLAYER_BONE_INDEX[`LowerLeg${side}`];
    const foot = PLAYER_BONE_INDEX[`Foot${side}`];
    if (height < 0.115) setSingle(indices, weights, foot);
    else if (height < 0.205) setBlend(indices, weights, foot, lower, smoothstep(0.115, 0.205, height));
    else if (height < 0.315) setBlend(indices, weights, lower, upper, smoothstep(0.255, 0.315, height));
    else setBlend(indices, weights, upper, PLAYER_BONE_INDEX.Pelvis, smoothstep(0.385, 0.44, height));
    return { indices, weights };
  }

  if (height < 0.48) setSingle(indices, weights, PLAYER_BONE_INDEX.Pelvis);
  else if (height < 0.6) {
    setBlend(indices, weights, PLAYER_BONE_INDEX.Pelvis, PLAYER_BONE_INDEX.Spine, smoothstep(0.48, 0.6, height));
  } else if (height < 0.705) {
    setBlend(indices, weights, PLAYER_BONE_INDEX.Spine, PLAYER_BONE_INDEX.Chest, smoothstep(0.6, 0.705, height));
  } else setSingle(indices, weights, PLAYER_BONE_INDEX.Chest);
  return { indices, weights };
}

function createVertexComponents(geometry, vertexCount) {
  const parents = new Uint32Array(vertexCount);
  const ranks = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) parents[vertex] = vertex;

  const find = (start) => {
    let root = start;
    while (parents[root] !== root) root = parents[root];
    let vertex = start;
    while (parents[vertex] !== vertex) {
      const next = parents[vertex];
      parents[vertex] = root;
      vertex = next;
    }
    return root;
  };
  const union = (a, b) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if (ranks[rootA] < ranks[rootB]) [rootA, rootB] = [rootB, rootA];
    parents[rootB] = rootA;
    if (ranks[rootA] === ranks[rootB]) ranks[rootA] += 1;
  };

  const sourceIndex = geometry.getIndex()?.array;
  if (sourceIndex) {
    for (let offset = 0; offset + 2 < sourceIndex.length; offset += 3) {
      union(sourceIndex[offset], sourceIndex[offset + 1]);
      union(sourceIndex[offset], sourceIndex[offset + 2]);
    }
  } else {
    for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3) {
      union(vertex, vertex + 1);
      union(vertex, vertex + 2);
    }
  }

  const componentIds = new Uint32Array(vertexCount);
  const rootToComponent = new Map();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const root = find(vertex);
    let component = rootToComponent.get(root);
    if (component === undefined) {
      component = rootToComponent.size;
      rootToComponent.set(root, component);
    }
    componentIds[vertex] = component;
  }
  return { componentIds, componentCount: rootToComponent.size };
}

const writeTopInfluences = (scores, indices, weights) => {
  const strongest = [];
  for (let bone = 0; bone < scores.length; bone += 1) {
    if (scores[bone] > 1e-8) strongest.push([bone, scores[bone]]);
  }
  strongest.sort((a, b) => b[1] - a[1]);
  clearInfluences(indices, weights);
  const selected = strongest.slice(0, 4);
  let total = selected.reduce((sum, entry) => sum + entry[1], 0);
  if (total <= 1e-8) {
    indices[0] = PLAYER_BONE_INDEX.Root;
    weights[0] = 1;
    return;
  }
  for (let slot = 0; slot < selected.length; slot += 1) {
    indices[slot] = selected[slot][0];
    weights[slot] = selected[slot][1] / total;
  }
};

/**
 * Add surface-coherent anatomical weights to a cloned geometry.
 *
 * The source contains 7705 disconnected surface islands. Pure per-vertex
 * weights can shear the many tiny textured details; collapsing every island to
 * one bone makes adjacent armour pieces separate. Small islands therefore share
 * one smooth multi-bone weight vector, while larger surfaces keep anatomical
 * per-vertex gradients across joints. The bind pose geometry and UVs are never
 * modified.
 */
export function buildSmoothSkinAttributes(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Player mesh has no position attribute.');
  const { componentIds, componentCount } = createVertexComponents(geometry, position.count);
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const componentScores = Array.from(
    { length: componentCount },
    () => new Float64Array(PLAYER_RIG_SPEC.length),
  );
  const componentCounts = new Uint32Array(componentCount);
  const componentMins = new Float32Array(componentCount * 3).fill(Infinity);
  const componentMaxs = new Float32Array(componentCount * 3).fill(-Infinity);
  const indices = new Uint16Array(4);
  const weights = new Float32Array(4);

  // First keep the continuous anatomical solution for all large body surfaces.
  // At the same time accumulate a stable shared solution for tiny visual parts.
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    resolvePlayerSkin(x, y, z, indices, weights);
    const offset = vertex * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      skinIndices[offset + slot] = indices[slot];
      skinWeights[offset + slot] = weights[slot];
      componentScores[componentIds[vertex]][indices[slot]] += weights[slot];
    }
    const component = componentIds[vertex];
    componentCounts[component] += 1;
    const componentOffset = component * 3;
    componentMins[componentOffset] = Math.min(componentMins[componentOffset], x);
    componentMins[componentOffset + 1] = Math.min(componentMins[componentOffset + 1], y);
    componentMins[componentOffset + 2] = Math.min(componentMins[componentOffset + 2], z);
    componentMaxs[componentOffset] = Math.max(componentMaxs[componentOffset], x);
    componentMaxs[componentOffset + 1] = Math.max(componentMaxs[componentOffset + 1], y);
    componentMaxs[componentOffset + 2] = Math.max(componentMaxs[componentOffset + 2], z);
  }

  const stableIndices = new Uint16Array(componentCount * 4);
  const stableWeights = new Float32Array(componentCount * 4);
  const coherent = new Uint8Array(componentCount);
  let stabilizedComponents = 0;
  let stabilizedVertices = 0;
  for (let component = 0; component < componentCount; component += 1) {
    const offset = component * 3;
    const maxExtent = Math.max(
      componentMaxs[offset] - componentMins[offset],
      componentMaxs[offset + 1] - componentMins[offset + 1],
      componentMaxs[offset + 2] - componentMins[offset + 2],
    );
    // Roughly a hand-sized patch or smaller in source space. Larger clothing and
    // body surfaces still need a gradient to bend naturally across a joint.
    if (componentCounts[component] > 256 || maxExtent > 0.055) continue;
    coherent[component] = 1;
    stabilizedComponents += 1;
    stabilizedVertices += componentCounts[component];
    writeTopInfluences(componentScores[component], indices, weights);
    const stableOffset = component * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      stableIndices[stableOffset + slot] = indices[slot];
      stableWeights[stableOffset + slot] = weights[slot];
    }
  }

  // Uniform multi-bone weights apply one coherent affine transform to every
  // vertex of a tiny island, preventing local UV crawling without snapping the
  // island to a single bone.
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const component = componentIds[vertex];
    if (!coherent[component]) continue;
    const offset = vertex * 4;
    const stableOffset = component * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      skinIndices[offset + slot] = stableIndices[stableOffset + slot];
      skinWeights[offset + slot] = stableWeights[stableOffset + slot];
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return { componentCount, stabilizedComponents, stabilizedVertices };
}

function copyMeshProperties(source, target) {
  target.name = source.name || 'PlayerSkinnedMesh';
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.matrix.copy(source.matrix);
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.visible = source.visible;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.renderOrder = source.renderOrder;
  target.layers.mask = source.layers.mask;
  target.userData = { ...source.userData, runtimeRigged: true };
  target.frustumCulled = false;
}

/** Convert the one-piece static GLB mesh into a real runtime SkinnedMesh. */
export function createPlayerRig(visual) {
  let sourceMesh = null;
  visual.traverse((child) => {
    if (!sourceMesh && child.isMesh && !child.isSkinnedMesh) sourceMesh = child;
  });
  if (!sourceMesh?.parent) throw new Error('Static player mesh was not found.');

  const geometry = sourceMesh.geometry.clone();
  const skinning = buildSmoothSkinAttributes(geometry);
  const skinnedMesh = new THREE.SkinnedMesh(geometry, sourceMesh.material);
  copyMeshProperties(sourceMesh, skinnedMesh);
  skinnedMesh.userData.skinProfile = 'surface-coherent-anatomical-v3';
  skinnedMesh.userData.skinning = skinning;
  const parent = sourceMesh.parent;
  const childIndex = parent.children.indexOf(sourceMesh);
  parent.remove(sourceMesh);
  parent.add(skinnedMesh);
  const appendedIndex = parent.children.indexOf(skinnedMesh);
  if (childIndex >= 0 && appendedIndex !== childIndex) {
    parent.children.splice(appendedIndex, 1);
    parent.children.splice(childIndex, 0, skinnedMesh);
  }

  const bones = {};
  for (const spec of PLAYER_RIG_SPEC) {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.fromArray(spec.position);
    bones[spec.name] = bone;
    if (spec.parent) bones[spec.parent].add(bone);
  }
  skinnedMesh.add(bones.Root);
  visual.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(PLAYER_RIG_SPEC.map(({ name }) => bones[name]));
  skinnedMesh.bind(skeleton);
  skinnedMesh.normalizeSkinWeights();
  skeleton.update();

  const rest = Object.fromEntries(PLAYER_RIG_SPEC.map(({ name }) => [name, {
    position: bones[name].position.clone(),
    quaternion: bones[name].quaternion.clone(),
  }]));
  return { mesh: skinnedMesh, skeleton, bones, rest };
}
