/** Original procedural sound design. No Portal/Valve samples or recordings.
 * One shared noise buffer, bounded voices, quiet room tone and a lift motor. */
export class AudioController {
  constructor(){this.context=null;this.enabled=true;this.volume=.65;this.muted=false;this.blocks=new Set(['menu']);this.voices=0;this.motorOn=false;}
  unlock(){
    if(!this.context){
      const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AC)return;
      try{
        const c=this.context=new AC();this.master=c.createGain();this.master.gain.value=0;this.master.connect(c.destination);
        this.fx=c.createGain();this.fx.gain.value=.8;this.fx.connect(this.master);
        this.room=c.createGain();this.room.gain.value=.014;this.room.connect(this.master);
        this.motorGain=c.createGain();this.motorGain.gain.value=0;this.motorGain.connect(this.master);
        this.loops=[];
        for(const [f,output] of [[59,this.room],[89.3,this.room],[112,this.motorGain]]){
          const o=c.createOscillator();o.type='sine';o.frequency.value=f;o.connect(output);o.start();this.loops.push(o);
        }
        const length=c.sampleRate;this.noise=c.createBuffer(1,length,c.sampleRate);const data=this.noise.getChannelData(0);
        let seed=71473;for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=((seed/4294967296)*2-1)*.5;}
      }catch(error){this.enabled=false;console.warn('WebAudio unavailable',error);return;}
    }
    this.sync();
  }
  configure({volume=this.volume,muted=this.muted}={}){this.volume=Math.min(1,Math.max(0,Number.isFinite(volume)?volume:.65));this.muted=!!muted;this.sync();}
  block(reason,value){value?this.blocks.add(reason):this.blocks.delete(reason);this.sync();}
  sync(){
    const c=this.context;if(!c)return;
    const active=this.enabled&&!this.muted&&!this.blocks.size&&this.volume>0;
    this.master.gain.cancelScheduledValues(c.currentTime);this.master.gain.setValueAtTime(active?this.volume:0,c.currentTime);
    if(active&&c.state==='suspended')c.resume().catch(()=>{});
    else if(!active&&c.state==='running')c.suspend().catch(()=>{});
  }
  get audible(){return this.enabled&&this.context?.state==='running'&&!this.muted&&!this.blocks.size&&this.volume>0;}
  tone(frequency,duration=.1,type='sine',volume=.045,offset=0,endFrequency=frequency){
    if(!this.audible||this.voices>=24)return;
    const c=this.context,t=c.currentTime+offset,o=c.createOscillator(),g=c.createGain();this.voices++;
    o.type=type;o.frequency.setValueAtTime(Math.max(20,frequency),t);o.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.007);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g).connect(this.fx);o.onended=()=>{o.disconnect();g.disconnect();this.voices--;};o.start(t);o.stop(t+duration+.01);
  }
  hush(duration=.15,volume=.025,cutoff=800){
    if(!this.audible||this.voices>=24)return;
    const c=this.context,t=c.currentTime,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();this.voices++;
    s.buffer=this.noise;f.type='lowpass';f.frequency.setValueAtTime(cutoff,t);f.frequency.exponentialRampToValueAtTime(160,t+duration);
    g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    s.connect(f).connect(g).connect(this.fx);s.onended=()=>{s.disconnect();f.disconnect();g.disconnect();this.voices--;};s.start(t);s.stop(t+duration);
  }
  portal(index=0){this.hush(.21,.026,2400);this.tone(index?420:590,.24,'sine',.035,0,index?680:910);this.tone(index?841:1181,.30,'sine',.007,.03,520);}
  travel(){this.hush(.38,.045,1900);this.tone(130,.34,'sine',.045,0,420);this.tone(310,.28,'sine',.016,.07,170);}
  pickup(){this.tone(370,.12,'triangle',.018,0,470);this.tone(630,.16,'sine',.018,.07);}
  checkpoint(){this.mechanism('switch');}
  mechanism(kind){this.hush(.12,.023,kind==='switch'?1200:600);this.tone(kind==='close'?150:220,.23,'triangle',.017,0,kind==='close'?95:350);}
  motor(on){if(this.motorOn===on)return;this.motorOn=on;if(!this.context)return;this.motorGain.gain.setTargetAtTime(on ? .015 : 0,this.context.currentTime,.08);}
  jump(){this.tone(155,.13,'sine',.014,0,285);}
  step(side,strength=.5){this.hush(.055,.018+Math.min(1,strength)*.018,680);this.tone(side==='L'?83:93,.075,'triangle',.009+Math.min(1,strength)*.007);this.tone(480,.026,'sine',.003,.021);}
  land(strength=1){this.hush(.16,.025+Math.min(1,strength/12)*.035,400);this.tone(67,.19,'triangle',.018);}
  hit(){this.hush(.12,.04,750);this.tone(91,.12,'triangle',.023);}
  win(){[392,494,587,784].forEach((f,i)=>this.tone(f,.36,'sine',.032,i*.11));}
  dispose(){this.loops?.forEach(o=>{o.stop();o.disconnect();});this.context?.close().catch(()=>{});this.context=null;}
}
