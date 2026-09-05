/** Dispose generated level resources without disposing the shared GLB cache.
 * WebGL renderer, input, audio and loaded files are reused between levels. */
export function disposeLabLevel(game) {
  const sharedGeometry=new Set(),sharedMaterials=new Set();
  for(const source of game.assets.values()) source.traverse(node=>{
    if(node.geometry)sharedGeometry.add(node.geometry);
    for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat)sharedMaterials.add(mat);
  });
  for(const mat of Object.values(game.materials))sharedMaterials.add(mat);
  game.portalActors?.dispose();game.portals?.dispose();game.physics?.dispose();game.physics=null;game.portals=null;
  const geometries=new Set(),materials=new Set();
  for(const root of game.levelRoots??[]) {
    root.traverse(node=>{
      if(node.geometry&&!sharedGeometry.has(node.geometry))geometries.add(node.geometry);
      for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat&&!sharedMaterials.has(mat))materials.add(mat);
      if(node.isSkinnedMesh)node.skeleton?.dispose();
      if(node.isLight)node.dispose?.();
    });root.removeFromParent();
  }
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  for(const key of ['colliders','cameraBlockers','aimBlockers','portalPanels','floors','ramps','cubes','doors'])game[key]=[];
  game.sectorProps=[[],[],[]];game.portalCargoColliders.clear();game.levelRoots=[];game.exploration=null;
}
