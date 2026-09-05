// SDK integration is opt-in at build time. GitHub preview never simulates ads.
export class LabPlatform {
  constructor({sdk=null,preview=false,now=()=>Date.now(),pause=()=>{},resume=()=>{},storage=null}={}) {
    this.sdk=sdk;this.preview=preview;this.now=now;this.pause=pause;this.resume=resume;this.storage=storage;
    this.busy=false;this.started=now();this.lastInterstitial=-Infinity;this.lastAny=-Infinity;this.lastAttempt=-Infinity;this.hints={};
    try{this.hints=JSON.parse(storage?.getItem('nesi-v8-hints')||'{}');if(!this.hints||typeof this.hints!=='object')this.hints={};}catch{}
  }
  async init() {
    if(this.preview||this.sdk)return;
    try {
      if(!globalThis.YaGames)await new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src='/sdk.js';s.onload=resolve;s.onerror=reject;document.head.append(s);
        setTimeout(()=>reject(new Error('SDK loading timeout')),10000);
      });
      this.sdk=await globalThis.YaGames.init();
    }catch{this.sdk=null;}
  }
  ready(){this.sdk?.features?.LoadingAPI?.ready?.();}
  gameplay(active){const api=this.sdk?.features?.GameplayAPI;active?api?.start?.():api?.stop?.();}
  unlocked(id){return Math.min(3,Math.max(0,Number(this.hints[id])||0));}
  grant(id){this.hints[id]=Math.min(3,this.unlocked(id)+1);try{this.storage?.setItem('nesi-v8-hints',JSON.stringify(this.hints));}catch{}}
  async hint(id){
    if(this.busy)return {reason:'busy',rewarded:false};
    if(this.unlocked(id)>=3)return {rewarded:true,existing:true};
    if(this.preview){this.grant(id);return{rewarded:true,preview:true};}
    if(!this.sdk?.adv?.showRewardedVideo)return {rewarded:false,reason:'unavailable'};
    return this.ad('rewarded',id);
  }
  async interstitial(reason){
    const t=this.now();
    // Own comfort policy, NOT a claimed Yandex frequency rule. Requests are
    // made only at explicit level transitions/restarts, never from a timer.
    const cooldown=reason==='restart'?300000:120000;
    if(this.busy||this.preview||!this.sdk?.adv?.showFullscreenAdv||t-this.started<120000||t-this.lastInterstitial<cooldown||t-this.lastAny<90000||t-this.lastAttempt<30000)return{shown:false};
    this.lastAttempt=t;return this.ad('interstitial');
  }
  ad(kind,id){
    this.busy=true;this.pause();this.gameplay(false);
    return new Promise(resolve=>{
      let done=false,opened=false,rewarded=false;
      const complete=(shown=false,reason=null)=>{if(done)return;done=true;clearTimeout(timer);if(shown||opened||rewarded){this.lastAny=this.now();if(kind==='interstitial')this.lastInterstitial=this.now();}this.busy=false;this.resume();resolve({shown:!!shown,rewarded,reason});};
      // Only a request which never opened may time out. Never resume a game
      // underneath an actually opened advertisement.
      const timer=setTimeout(()=>{if(!opened)complete(false,'unavailable');},15000);
      const callbacks={onOpen:()=>{if(!done)opened=true;},onRewarded:()=>{if(done||rewarded||kind!=='rewarded')return;rewarded=true;this.grant(id);},onClose:shown=>complete(shown),onError:()=>complete(false,'unavailable')};
      try{if(kind==='rewarded')this.sdk.adv.showRewardedVideo({callbacks});else this.sdk.adv.showFullscreenAdv({callbacks});}catch{complete(false,'unavailable');}
    });
  }
}
