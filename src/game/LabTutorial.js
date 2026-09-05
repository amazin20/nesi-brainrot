/** Basic rules are free. Optional solution hints are a separate pause-menu feature. */
export class LabTutorial {
 constructor(game){this.game=game;this.seen=new Set();this.enabled=true;this.active=null;this.feedback=null;}
 explain(text){this.feedback={text,until:this.game.visualTime+4.5};}
 select(){
  const g=this.game,l=g.firstLevel,p=g.playerPosition,near=q=>q&&p.distanceTo(q)<4;
  if(this.feedback&&this.feedback.until>g.visualTime)return['feedback','·',this.feedback.text,false];
  if(g.levelIndex===0&&!this.seen.has('move'))return['move','WASD','Пройди несколько шагов. Мышь — камера. Esc — настройки.',p.distanceTo(new p.constructor(...l.spawn))>1.2];
  if(!this.seen.has('portal')&&!g.heldCube)return['portal','ЛКМ / ПКМ','Гладкая светлая плита с ободком принимает портал. Ребристый металл — нет. F — прицел.',g.portals.ready];
  if(near(g.cargo?.position)&&!this.seen.has('carry'))return['carry','E','Возьми друга после установки порталов. Ещё раз E — поставить.',!!g.heldCube];
  if(g.levelIndex===1&&!this.seen.has('momentum'))return['momentum','↓ →','Портал поворачивает скорость. Более высокое падение даёт более дальний полёт.',g.teleportCount>0];
  if(l?.lift&&near(l.lift.position)&&!this.seen.has('lift'))return['lift','↑','Встань на платформу и дождись остановки. Лифт поднимает и друга.',l.lift.y>1];
  if(l?.pads?.some(x=>near(x.position))&&!this.seen.has('weight'))return['weight','E','Нажимная плита реагирует на вес лежащего груза. Светлая середина принимает портал.',l.cargoOnAnyPad()];
  if(l?.nearbyInteraction?.())return['terminal','E','Повернуть выходную панель вместе с порталом.',false];
  return null;
 }
 update(){const l=this.enabled&&this.game.state==='playing'?this.select():null;if(l?.[3]){this.seen.add(l[0]);return this.update();}this.active=l;return l?{id:l[0],key:l[1],text:l[2]}:null;}
}
