/** Context lessons finish on successful actions, not on a timer. No wall labels,
 * no modal stops, no text over the player. Knowledge lasts for this session only. */
export class LabTutorial {
  constructor(game) { this.game = game; this.seen = new Set(); this.enabled = true; this.active = null; this.startedAt = 0; this.feedback = null; }
  explain(text) { this.feedback = { text, until: this.game.visualTime + 3.5 }; }
  select() {
    const g = this.game, level = g.firstLevel, p = g.playerPosition;
    const near = point => point && p.distanceTo(point) < 4.5;
    if (this.feedback && this.feedback.until > g.visualTime) return ['feedback', '·', this.feedback.text, false];
    if (g.levelIndex === 0 && !this.seen.has('move')) return ['move', 'W A S D', 'Пройди несколько шагов. Мышь поворачивает камеру.', p.distanceTo(new g.playerPosition.constructor(...level.spawn)) > 1.2];
    if (near(g.cargo?.position) && !this.seen.has('carry')) return ['carry', 'E', 'Возьми друга. Нажми ещё раз, чтобы аккуратно поставить.', !!g.heldCube];
    if (!this.seen.has('portal') && !g.heldCube) return ['portal', 'ЛКМ · ПКМ', 'Создай два прохода на белых поверхностях. F — точнее прицелиться.', g.portals.ready];
    const pad = level?.pads?.find(item => near(item.position));
    if (pad && !this.seen.has('weight')) return ['weight', 'E', 'Сначала открой портал в плите, затем поставь на неё друга. Вес включает механизм.', level.cargoOnAnyPad()];
    if (level?.receiverPanel && near(level.receiverPanel.control.position) && !this.seen.has('panel'))
      return ['panel', 'E', 'Терминал поворачивает белую панель. Через неё можно вернуть друга.', level.receiverPanel.deployed];
    if (level?.lift && near(level.lift.position ?? level.lift.group.position) && !this.seen.has('lift'))
      return ['lift', '↑', 'Встаньте на подъёмник вдвоём. Он сам вернёт вас наверх.', (level.lift.y - level.lift.minY) > .3];
    const action = level?.nearbyInteraction?.();
    if (action && !this.seen.has('terminal')) return ['terminal', 'E', 'Нажми рядом с терминалом, чтобы включить механизм.', level?.terminalActivated === true];
    return null;
  }
  update() {
    const lesson = this.enabled && this.game.state === 'playing' ? this.select() : null;
    if (lesson?.[3]) { this.seen.add(lesson[0]); this.active = null; return this.update(); }
    this.active = lesson;
    return lesson ? { id: lesson[0], key: lesson[1], text: lesson[2] } : null;
  }
}
