export class AudioController {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.enabled = false;
        return;
      }
      try {
        this.context = new AudioContextClass();
      } catch (error) {
        console.warn('Аудио отключено в этом браузере.', error);
        this.enabled = false;
        return;
      }
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  tone(frequency, duration = 0.1, type = 'sine', volume = 0.045, offset = 0) {
    if (!this.enabled || !this.context) return;
    const start = this.context.currentTime + offset;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  pickup() { this.tone(440, .09, 'triangle'); this.tone(660, .14, 'triangle', .04, .07); }
  checkpoint() { this.tone(520, .08, 'sine'); this.tone(780, .16, 'sine', .04, .08); }
  jump() { this.tone(190, .07, 'sine', .012); this.tone(285, .08, 'sine', .008, .035); }
  step(side, strength = .5) {
    this.tone(side === 'L' ? 92 : 104, .065, 'triangle', .009 + strength * .009);
    this.tone(580, .028, 'sine', .003 + strength * .003, .01);
  }
  land(strength = .5) { this.tone(76, .13, 'triangle', .012 + Math.min(1, strength) * .016); }
  hit() { this.tone(95, .12, 'sawtooth', .04); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .3, 'triangle', .04, i * .09)); }
}
