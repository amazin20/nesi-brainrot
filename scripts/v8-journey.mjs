import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHeadlessGame} from './lab-headless.mjs';
import {runPhysicsJourney} from '../src/game/LabJourneyV8.js';
const reports=[];
const chosen=process.argv[2]===undefined?[0,1,2,3,4]:[Number(process.argv[2])];
for(const i of chosen){const g=await createHeadlessGame(i);g.callbacks.onToast=console.log;try{reports.push(runPhysicsJourney(g));console.log('PASS level',i+1);}finally{g.physics.dispose();g.portals.dispose();}}
fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/v8-journey.json',JSON.stringify({pass:true,reports},null,2));
