import fs from 'node:fs';import assert from 'node:assert/strict';import {CAMPAIGN_ASSET_IDS} from '../src/game/labAssets.js';
const root=process.argv[2]||'dist',manifest=JSON.parse(fs.readFileSync(root+'/models/runtime/manifest.json'));
assert.deepEqual(manifest.models.map(m=>m.id).sort((a,b)=>a-b),[...CAMPAIGN_ASSET_IDS]);
for(const m of manifest.models)assert.ok(fs.statSync(root+'/models/runtime/'+m.filename).size>1000);
assert.ok(!fs.existsSync(root+'/models/model-01-player.glb'));assert.ok(!fs.existsSync(root+'/model-screens'));assert.ok(!fs.existsSync(root+'/concepts'));
assert.ok(manifest.totalBytes<4000000);assert.ok(fs.readFileSync(root+'/index.html','utf8').includes('settings-level-select'));
console.log('V8 package verified: 9 purposeful runtime assets, no source/reference files.');
