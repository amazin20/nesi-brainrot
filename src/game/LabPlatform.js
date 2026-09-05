/** Yandex Games integration, verified against official SDK documentation.
 * Outside the Yandex build we never simulate an advert or claim ad revenue. */
export async function loadYandexSDK({document:doc=globalThis.document,scope=globalThis,timeout=10000}={}){
  if(!scope.YaGames)await new Promise((resolve,reject)=>{
    const script=doc.createElement('script');script.src='/sdk.js';script.async=true;
    const timer=setTimeout(()=>reject(new Error('SDK loading timeout')),timeout);
    script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);reject(new Error('Yandex SDK unavailable'));};doc.head.append(script);
  });
  if(!scope.YaGames?.init)throw new Error('Yandex SDK missing');
  let timer;
  try{return await Promise.race([scope.YaGames.init(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SDK init timeout')),timeout);})]);}
  finally{clearTimeout(timer);}
}
export class LabPlatform {
  constructor({sdk=null,demo=true,hold=()=>{},now=()=>Date.now(),timeout=15000}={}){
    this.sdk=sdk;this.demo=demo;this.hold=hold;this.now=now;this.timeout=timeout;this.busy=false;this.playing=false;this.adLocks=new Set();this.requestSerial=0;
    this.lastAdAt=now();this.lastRestartAttempt=now();this.readySent=false;
    this.onPause=()=>this.hold('sdk',true);this.onResume=()=>this.hold('sdk',false);
    sdk?.on?.('game_api_pause',this.onPause);sdk?.on?.('game_api_resume',this.onResume);
  }
  ready(){if(this.readySent)return;this.readySent=true;try{this.sdk?.features?.LoadingAPI?.ready();}catch{/* SDK failure must not hide a playable scene. */}}
  gameplay(active){if(this.playing===active)return;this.playing=active;try{const api=this.sdk?.features?.GameplayAPI;active?api?.start():api?.stop();}catch{}}
  async interstitial(reason){
    if(!['next','restart'].includes(reason))return {shown:false,reason:'invalid-transition'};
    if(this.demo||!this.sdk?.adv?.showFullscreenAdv)return {shown:false,reason:this.demo?'demo':'unavailable'};
    if(reason==='restart'){
      if(this.now()-Math.max(this.lastAdAt,this.lastRestartAttempt)<300000)return {shown:false,reason:'cooldown'};
      this.lastRestartAttempt=this.now();
    }
    return this.request(false);
  }
  async hint(reward){
    if(this.busy||this.adLocks.size)return {rewarded:false,reason:'busy'};
    if(this.demo){reward();return {rewarded:true,reason:'free-demo'};}
    if(!this.sdk?.adv?.showRewardedVideo)return {rewarded:false,reason:'unavailable'};
    return this.request(true,reward);
  }
  request(rewarded,onReward=()=>{}){
    if(this.busy||this.adLocks.size)return Promise.resolve({rewarded:false,shown:false,reason:'busy'});
    const requestId=++this.requestSerial;
    const lock=active=>{active?this.adLocks.add(requestId):this.adLocks.delete(requestId);this.hold('ad',this.adLocks.size>0);};
    this.busy=true;lock(true);this.gameplay(false);
    return new Promise(resolve=>{
      let settled=false,opened=false,earned=false;
      const finish=(reason,shown=opened)=>{
        if(settled)return;settled=true;clearTimeout(timer);this.busy=false;lock(false);
        if(shown)this.lastAdAt=this.now();resolve({shown,rewarded:earned,reason});
      };
      // Never run this watchdog after onOpen: it must not resume under a real ad.
      const timer=setTimeout(()=>finish('timeout',false),this.timeout);
      const callbacks={
        onOpen:()=>{opened=true;clearTimeout(timer);lock(true);},
        onRewarded:()=>{if(!settled&&!earned){earned=true;onReward();}},
        onClose:wasShown=>{if(settled){lock(false);return;}finish('closed',rewarded?opened:!!wasShown);},
        onError:()=>{if(settled){lock(false);return;}finish('error',opened);},
      };
      try{const result=rewarded?this.sdk.adv.showRewardedVideo({callbacks}):this.sdk.adv.showFullscreenAdv({callbacks});
        result?.catch?.(()=>finish('error',opened));}catch{finish('error',false);}
    });
  }
  dispose(){this.sdk?.off?.('game_api_pause',this.onPause);this.sdk?.off?.('game_api_resume',this.onResume);this.gameplay(false);}
}
