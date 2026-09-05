const KEY='nesi.preferences.v8';
export const DEFAULT_PREFERENCES=Object.freeze({quality:'balanced',volume:.65,muted:false,tutorial:true,completed:[],hints:{}});
export function sanitizePreferences(value={}) {
  const safe=value&&typeof value==='object'?value:{};
  return {quality:['low','balanced','high'].includes(safe.quality)?safe.quality:'balanced',
    volume:Number.isFinite(safe.volume)?Math.min(1,Math.max(0,safe.volume)):.65,
    muted:safe.muted===true,tutorial:safe.tutorial!==false,
    completed:Array.isArray(safe.completed)?[...new Set(safe.completed.filter(n=>Number.isInteger(n)&&n>=0&&n<100))]:[],
    hints:Object.fromEntries(Object.entries(safe.hints&&typeof safe.hints==='object'?safe.hints:{}).filter(([k,v])=>/^\d{1,2}$/.test(k)&&Number.isInteger(v)&&v>=0&&v<=3))};
}
export class LabPreferences {
  constructor(storage){this.storage=storage;try{this.value=sanitizePreferences(JSON.parse(storage?.getItem(KEY)||'{}'));}catch{this.value=sanitizePreferences();}}
  save(changes={}){this.value=sanitizePreferences({...this.value,...changes});try{this.storage?.setItem(KEY,JSON.stringify(this.value));}catch{/* Storage may be disabled; session settings still work. */}return this.value;}
  complete(index){this.save({completed:[...this.value.completed,index]});}
  unlockHint(index){this.save({hints:{...this.value.hints,[index]:Math.min(3,(this.value.hints[index]||0)+1)}});}
}
export const QUALITY_PRESETS=Object.freeze({low:{pixelRatio:1,portalResolution:640,shadowSize:512,shadows:false},
  balanced:{pixelRatio:1.35,portalResolution:896,shadowSize:1024,shadows:true},
  high:{pixelRatio:1.75,portalResolution:1280,shadowSize:2048,shadows:true}});
export function applyLabQuality(game,key,dpr=globalThis.devicePixelRatio||1){
  const profile=QUALITY_PRESETS[key]||QUALITY_PRESETS.balanced;game.quality={...profile};
  if(game.renderer){game.renderer.setPixelRatio(Math.min(dpr,profile.pixelRatio));game.renderer.setSize(innerWidth,innerHeight);game.renderer.shadowMap.enabled=profile.shadows;}
  if(game.keyLight){game.keyLight.castShadow=profile.shadows;game.keyLight.shadow.mapSize.set(profile.shadowSize,profile.shadowSize);
    game.keyLight.shadow.map?.dispose();game.keyLight.shadow.map=null;game.keyLight.shadow.needsUpdate=true;}
  if(game.portals)game.portals.maxResolution=profile.portalResolution;
  game.performanceMonitor?.reset();
}
