import * as THREE from 'three';

export class InputController {
  constructor({ joystick, joystickKnob, jumpButton }) {
    this.keys = new Set();
    this.mobileMove = new THREE.Vector2();
    this.jumpQueued = false;
    this.restartQueued = false;
    this.pauseQueued = false;
    this.joystick = joystick;
    this.joystickKnob = joystickKnob;
    this.jumpButton = jumpButton;
    this.joystickPointer = null;

    this.onKeyDown = (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
      if (event.code === 'KeyR' && !event.repeat) this.restartQueued = true;
      if (event.code === 'Escape' && !event.repeat) this.pauseQueued = true;
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);

    this.setupTouch();
  }

  setupTouch() {
    const updateStick = (event) => {
      const rect = this.joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const max = rect.width * 0.31;
      let dx = event.clientX - centerX;
      let dy = event.clientY - centerY;
      const length = Math.hypot(dx, dy) || 1;
      if (length > max) { dx = dx / length * max; dy = dy / length * max; }
      this.mobileMove.set(dx / max, dy / max);
      this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const endStick = (event) => {
      if (this.joystickPointer !== event.pointerId) return;
      this.joystickPointer = null;
      this.mobileMove.set(0, 0);
      this.joystickKnob.style.transform = 'translate(0, 0)';
      this.joystick.releasePointerCapture?.(event.pointerId);
    };
    this.joystick.addEventListener('pointerdown', (event) => {
      this.joystickPointer = event.pointerId;
      this.joystick.setPointerCapture?.(event.pointerId);
      updateStick(event);
    });
    this.joystick.addEventListener('pointermove', (event) => {
      if (this.joystickPointer === event.pointerId) updateStick(event);
    });
    this.joystick.addEventListener('pointerup', endStick);
    this.joystick.addEventListener('pointercancel', endStick);
    this.jumpButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.jumpQueued = true;
    });
  }

  getMove() {
    const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.mobileMove.x;
    const z = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
      - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) + this.mobileMove.y;
    const move = new THREE.Vector2(x, z);
    if (move.lengthSq() > 1) move.normalize();
    return move;
  }

  consumeJump() { const queued = this.jumpQueued; this.jumpQueued = false; return queued; }
  consumeRestart() { const queued = this.restartQueued; this.restartQueued = false; return queued; }
  consumePause() { const queued = this.pauseQueued; this.pauseQueued = false; return queued; }
}
