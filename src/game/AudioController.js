/** Original synthesized lab sounds. No samples from Portal or other games. */
export class AudioController {
  constructor() { this.context=null;this.enabled=true;this.volume=.55;this.pauses=new Set();this.motors=new Map();this.emitted=0; }
  unlock() {
    if(!this.context) {
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Context)return;
      try {this.context=new Context();this.master=this.context.createGain();this.master.connect(this.context.destination);}
      catch {return;}
    }
    this.applyVolume();if(!this.pauses.size)this.context.resume()?.catch?.(()=>{});
  }
  setVolume(value) { this.volume=Math.max(0,Math.min(1,Number(value)||0));this.applyVolume(); }
  setMuted(value) { this.enabled=!value;this.applyVolume(); }
  pause(reason,value=true) { value?this.pauses.add(reason):this.pauses.delete(reason);this.applyVolume(); }
  applyVolume() { if(this.master)this.master.gain.setTargetAtTime(this.enabled&&!this.pauses.size?this.volume:0,this.context.currentTime,.025); }
  tone(frequency,duration=.1,type='sine',volume=.035,offset=0,endFrequency=frequency) {
    if(!this.context||!this.enabled||this.pauses.size||this.volume===0)return;
    const t=this.context.currentTime+offset,o=this.context.createOscillator(),gain=this.context.createGain();
    o.type=type;o.frequency.setValueAtTime(frequency,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),t+duration);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(gain).connect(this.master);
    o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();gain.disconnect();};this.emitted++;
  }
  noise(duration=.09,volume=.025,frequency=800) {
    if(!this.context||!this.enabled||this.pauses.size||!this.volume)return;
    const c=this.context,n=Math.ceil(c.sampleRate*duration),buf=c.createBuffer(1,n,c.sampleRate),a=buf.getChannelData(0);
    for(let i=0;i<n;i++)a[i]=(Math.random()*2-1)*(1-i/n)**2;
    const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
    source.buffer=buf;filter.type='lowpass';filter.frequency.value=frequency;gain.gain.value=volume;
    source.connect(filter).connect(gain).connect(this.master);source.start();source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};this.emitted++;
  }
  pickup(){this.tone(240,.18,'sine',.035,0,440);this.noise(.08,.015,1600);}
  checkpoint(){this.switch(true);}
  jump(){this.tone(140,.10,'sine',.018,0,220);this.noise(.06,.02,850);}
  step(side,strength=.5){this.tone(side==='L'?87:97,.07,'triangle',.01+strength*.008,0,60);this.noise(.055,.012+strength*.014,620);}
  land(strength=.5){this.tone(105,.18,'sine',.025+Math.min(strength/9,1)*.03,0,45);this.noise(.16,.03,750);}
  hit(){this.tone(115,.13,'triangle',.03,0,65);this.noise(.08,.04,1700);}
  portal(index){this.tone(index?370:540,.28,'sine',.032,0,index?190:850);this.noise(.20,.024,2600);}
  transport(){this.tone(95,.36,'sine',.04,0,620);this.tone(650,.32,'sine',.013,.03,130);this.noise(.22,.022,1800);}
  switch(on){this.tone(on?320:400,.13,'triangle',.024,0,on?560:220);this.noise(.05,.02,1700);}
  motor(id,strength=0){
    if(!this.context)return;
    let m=this.motors.get(id);
    if(!m&&strength>.03){const o=this.context.createOscillator(),g=this.context.createGain();o.type='sine';g.gain.value=0;o.connect(g).connect(this.master);o.start();m={o,g};this.motors.set(id,m);}
    if(m){m.o.frequency.setTargetAtTime((id==='bridge'?61:83)+Math.min(strength,1)*34,this.context.currentTime,.10);m.g.gain.setTargetAtTime(Math.min(Math.max(strength,0),1)*.018,this.context.currentTime,.10);}
  }
  win(){[392,523,659,784].forEach((f,i)=>this.tone(f,.33,'sine',.035,i*.10));}
  dispose(){for(const {o,g}of this.motors.values()){o.stop();o.disconnect();g.disconnect();}this.motors.clear();this.context?.close();}
}
