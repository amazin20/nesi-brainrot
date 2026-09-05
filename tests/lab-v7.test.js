import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabGame } from '../src/game/LabGame.js';
import { createArchitecturalGate } from '../src/game/LabArchitecturalGate.js';
import { LabPerformance } from '../src/game/LabPerformance.js';
import { LabTutorial } from '../src/game/LabTutorial.js';
function architectural(kind='door') {
  const g=new LabGame({});g.scene=new THREE.Scene();g.materials={wall:new THREE.MeshBasicMaterial(),dark:new THREE.MeshBasicMaterial()};
  return {g,gate:createArchitecturalGate(g,{z:0,kind})};
}
test('v7: closed doorway and its wall have no uncovered construction joints',()=>{
  const {g,gate}=architectural();const ray=new THREE.Raycaster();g.scene.updateMatrixWorld(true);
  for(let x=-8.8;x<8.9;x+=.17)for(const y of [.06,1.2,2.4,3.62,3.8,5.8]) {
    ray.set(new THREE.Vector3(x,y,2),new THREE.Vector3(0,0,-1));
    assert.ok(ray.intersectObjects(g.scene.children,true).length,`uncovered wall at ${x},${y}`);
  }
  const frame=gate.mechanism.getFrameBoxes().map(b=>b.clone()),closed=gate.mechanism.getLeafBoxes();
  gate.mechanism.update(1);
  gate.mechanism.getFrameBoxes().forEach((b,i)=>assert.ok(b.equals(frame[i])));
  gate.mechanism.getLeafBoxes().forEach((b,i)=>{
    assert.ok(Math.abs(b.min.y-closed[i].min.y)<1e-9,'door slid upward instead of rotating');
    assert.ok(b.getCenter(new THREE.Vector3()).distanceTo(closed[i].getCenter(new THREE.Vector3()))>.8);
  });
});
test('v7: energy field is the same sized architectural aperture and clears collision when open',()=>{
  const {gate}=architectural('barrier');assert.equal(gate.mechanism.solid,true);assert.ok(gate.field.material.opacity>=.25);
  assert.equal(gate.opening.max.x-gate.opening.min.x,4.8);
  const before=gate.frame.map(m=>m.position.clone());gate.mechanism.update(1,3);
  assert.equal(gate.mechanism.solid,false);assert.equal(gate.field.visible,false);
  gate.frame.forEach((m,i)=>assert.ok(m.position.equals(before[i])));
});
test('v7: resizing moving collision proxies never replaces their geometry',()=>{
  const {g}=architectural();const collider=g.colliders[0],geometry=collider.mesh.geometry;
  for(let i=0;i<500;i++)g.syncCollision(collider,new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(1+i/500,3,1)),1/120);
  assert.equal(collider.mesh.geometry,geometry);
  assert.ok(new THREE.Box3().setFromObject(collider.mesh).max.distanceTo(collider.box.max)<1e-6);
});
test('v7: FPS uses unclamped rendered frame durations and reports a hitch',()=>{
  const fresh=new LabPerformance();fresh.sample(2,50000);assert.equal(fresh.stats.fps,0,'first partial frame must not be a misleading FPS reading');
  const p=new LabPerformance(100);for(let i=0;i<99;i++)p.sample(1000/60,1000+i*20,{calls:44,triangles:100000});
  let s=p.sample(1000/60,10000,{calls:44,triangles:100000});assert.ok(Math.abs(s.fps-60)<1e-7);
  s=p.sample(250,11000);assert.ok(s.fps<60);assert.equal(s.p99Ms,250);assert.equal(s.low1Fps,4);
  assert.equal(p.count,100);assert.equal(p.samples.length,100);
});
test('v7: tutorial requires the taught action and can be switched off',()=>{
  const game={levelIndex:0,state:'playing',visualTime:0,playerPosition:new THREE.Vector3(),firstLevel:{spawn:[0,0,0]},portals:{ready:false}};
  const t=new LabTutorial(game);assert.equal(t.update().id,'move');
  game.visualTime=100;assert.equal(t.update().id,'move','lesson skipped merely because time passed');
  game.playerPosition.z=2;assert.equal(t.update().id,'portal');assert.ok(t.seen.has('move'));
  t.enabled=false;assert.equal(t.update(),null);
});
