/** Free controls/concept introductions. These never conceal rules behind ads.
 * Optional paid-by-ad hints in the menu explain solutions separately. */
export class LabTutorial {
  constructor(game){this.game=game;this.seen=new Set();this.enabled=true;this.active=null;this.feedback=null;}
  explain(text){this.feedback={text,until:this.game.visualTime+3.5};}
  select(){
    const g=this.game,l=g.firstLevel,p=g.playerPosition;if(!l)return null;const mobile=globalThis.matchMedia?.('(pointer:coarse)')?.matches===true;
    if(this.feedback&&this.feedback.until>g.visualTime)return ['feedback','·',this.feedback.text,false];
    const near=point=>point&&p.distanceTo(point)<4.5;
    if(g.levelIndex===0&&!this.seen.has('move'))return ['move',mobile?'◉':'W A S D','Пройди несколько шагов. Поверни камеру мышью или движением пальца.',p.distanceTo(new p.constructor(...l.spawn))>1.2];
    if(!this.seen.has('portal')&&!g.heldCube)return ['portal',mobile?'① · ②':'ЛКМ · ПКМ','Светлые плиты принимают порталы, тёмные — нет. Создай пару. F — прицел.',g.portals.ready];
    if(g.levelIndex===0&&!this.seen.has('cross'))return ['cross','↔','Вход и выход связаны. Пройди в ближайший портал.',g.teleportCount>0];
    if(g.levelIndex>0&&near(g.cargo?.position)&&!this.seen.has('carry'))return ['carry','E','Возьми друга. Ещё раз E — поставить. С другом на руках стрелять нельзя.',!!g.heldCube];
    const pad=l.pads?.find(pad=>near(pad.position));
    if(pad&&!this.seen.has('weight'))return ['weight','↓','Вес свободного предмета нажимает платформу. Светлый центр пригоден для портала.',l.cargoOnAnyPad()];
    if(g.levelIndex===2&&!this.seen.has('momentum'))return ['momentum','↘','Высота даёт скорость падения. Портал сохраняет скорость и меняет её направление.',g.teleportCount>0];
    const action=l.nearbyInteraction?.();
    if(action&&!this.seen.has(action.kind))return [action.kind,'E',action.kind==='lift'?'Терминал меняет высоту подъёмника. Его портал движется вместе с панелью.':'Терминал меняет наклон панели. Направление вылета изменится вместе с порталом.',action.kind==='lift'?l.lift?.target>0:l.receiverPanel?.target>0];
    return null;
  }
  update(){let lesson=this.enabled&&this.game.state==='playing'&&!this.game.externalBlocked?this.select():null;
    for(let n=0;lesson?.[3]&&n<8;n++){this.seen.add(lesson[0]);lesson=this.select();}
    this.active=lesson;return lesson?{id:lesson[0],key:lesson[1],text:lesson[2]}:null;
  }
}
