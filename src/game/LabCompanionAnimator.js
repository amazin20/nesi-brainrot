import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const damp = (value, target, rate, dt) => target + (value - target) * Math.exp(-rate * dt);
const clipEnvelope = (clip) => clip ? Math.sin(Math.PI * clamp(clip.elapsed / clip.duration, 0, 1)) ** 2 : 0;
const timedWindow = (time, start, duration) => time > start && time < start + duration
  ? Math.sin((time - start) / duration * Math.PI) ** 2 : 0;

/**
 * Small, rigid animation on a dedicated Y-up visual child of the companion's
 * physics root. Authored descendants, geometry, materials and every scale stay
 * untouched. Translation is in the wrapper parent's local units; rotation is
 * an offset from the wrapper's authored quaternion. Physics remains the caller's
 * responsibility, including real jumps and collisions.
 *
 * update(): dt in seconds, speed/velocity.y in world units/s. carrying locks
 * visual support to the hands; angularVelocity suppresses procedural tilts
 * during real tumbling. Optional elapsed
 * synchronizes idle oscillations to the scene clock. curious/celebrating are
 * sustained cues; trigger('curious'|'celebrate'|'landing') plays a brief cue.
 */
export class LabCompanionAnimator {
  constructor({ visual } = {}) {
    if (!visual?.isObject3D) throw new TypeError('A companion visual child Object3D is required.');
    this.visual = visual;
    this.restPosition = visual.position.clone();
    this.restQuaternion = visual.quaternion.clone();
    this.offsetPosition = new THREE.Vector3();
    this.offsetRotation = new THREE.Euler();
    this.tempQuaternion = new THREE.Quaternion();
    this.reset();
  }

  reset() {
    this.elapsed = this.gait = 0;
    this.moveBlend = this.airBlend = this.curiousBlend = this.celebrateBlend = 0;
    this.airPitch = this.landing = this.landVelocity = 0;
    this.previousGrounded = true;
    this.previousCarrying = false;
    this.carryBlend = this.tumbleBlend = this.lastImpact = 0;
    this.lastVerticalSpeed = 0;
    this.curiousClip = this.celebrateClip = null;
    this.reactionClip = null;
    this.curiousDirection = 1;
    this.state = 'idle';
    this.offsetPosition.set(0, 0, 0);
    this.offsetRotation.set(0, 0, 0);
    this.visual.position.copy(this.restPosition);
    this.visual.quaternion.copy(this.restQuaternion);
  }

  trigger(kind = 'curious') {
    if (kind === 'landing') return this.triggerLanding();
    // Ignore repeated events while a cue is active, so a proximity check or
    // repeated input cannot restart the envelope and make the model snap.
    if (kind === 'curious') {
      if (!this.curiousClip) {
        if (this.curiousBlend < 0.02) this.curiousDirection *= -1;
        this.curiousClip = { elapsed: 0, duration: 1.65 };
      }
      return true;
    }
    if (kind === 'celebrate') {
      if (!this.celebrateClip) this.celebrateClip = { elapsed: 0, duration: 1.4 };
      return true;
    }
    if (['pickup', 'release', 'portal', 'startle', 'nod'].includes(kind)) {
      if (!this.reactionClip) this.reactionClip = { kind, elapsed: 0, duration: kind === 'portal' ? 1.1 : .85 };
      return true;
    }
    return false;
  }

  triggerLanding(impact = 4) {
    const strength = clamp(Math.abs(finite(impact, 4)), 0, 12);
    this.landVelocity = Math.min(this.landVelocity, -strength * 0.1);
    return true;
  }

  get diagnostics() {
    return {
      state: this.state,
      profile: 'responsive-companion-v2',
      rigidVisualOnly: true,
      sourceAttributesPreserved: true,
      elapsed: this.elapsed,
      moveBlend: this.moveBlend,
      airBlend: this.airBlend,
      curiousBlend: Math.max(this.curiousBlend, clipEnvelope(this.curiousClip)),
      celebrateBlend: Math.max(this.celebrateBlend, clipEnvelope(this.celebrateClip)),
      landing: this.landing,
      landingVelocity: this.landVelocity,
      carryBlend: this.carryBlend,
      tumbleBlend: this.tumbleBlend,
      reaction: this.reactionClip ? { ...this.reactionClip } : null,
      clips: {
        curious: this.curiousClip ? { ...this.curiousClip } : null,
        celebrate: this.celebrateClip ? { ...this.celebrateClip } : null,
      },
      offset: {
        position: { x: this.offsetPosition.x, y: this.offsetPosition.y, z: this.offsetPosition.z },
        rotation: { x: this.offsetRotation.x, y: this.offsetRotation.y, z: this.offsetRotation.z },
      },
    };
  }

  update({ dt = 1 / 60, elapsed, speed = 0, grounded = true, velocity, angularVelocity,
    carrying = false, impact = 0, curious = false, celebrating = false } = {}) {
    // All dynamics below have closed forms, including the gait's damped speed
    // integral. Long frames therefore settle safely without losing elapsed time.
    dt = clamp(finite(dt), 0, 60);
    speed = clamp(finite(speed), 0, 12);
    const vy = clamp(finite(velocity?.y), -30, 30);
    const angularSpeed = Math.hypot(finite(angularVelocity?.x), finite(angularVelocity?.y), finite(angularVelocity?.z));
    impact = clamp(finite(impact), 0, 16);
    this.elapsed = Number.isFinite(elapsed) ? elapsed : this.elapsed + dt;
    if (!carrying && grounded && !this.previousGrounded) this.triggerLanding(Math.abs(this.lastVerticalSpeed));
    else if (!carrying && grounded && impact > 1.6 && impact > this.lastImpact + .8) this.triggerLanding(impact * .55);
    if (carrying !== this.previousCarrying) this.trigger(carrying ? 'pickup' : 'release');
    this.previousGrounded = Boolean(grounded);
    this.previousCarrying = Boolean(carrying);
    this.lastImpact = impact;
    this.lastVerticalSpeed = vy;

    const moveTarget = clamp(speed / 4, 0, 1);
    const moveDecay = Math.exp(-7 * dt);
    const moveIntegral = moveTarget * dt + (this.moveBlend - moveTarget) * (1 - moveDecay) / 7;
    this.gait = (this.gait + 5.5 * dt + 7 * moveIntegral) % TAU;
    this.moveBlend = moveTarget + (this.moveBlend - moveTarget) * moveDecay;
    this.carryBlend = damp(this.carryBlend, carrying ? 1 : 0, 16, dt);
    this.tumbleBlend = damp(this.tumbleBlend, carrying ? 0 : clamp(angularSpeed / 3, 0, 1), 12, dt);
    this.airBlend = damp(this.airBlend, grounded || carrying ? 0 : 1, 10, dt);
    this.airPitch = damp(this.airPitch, clamp(vy * 0.012, -0.065, 0.065), 8, dt);
    this.curiousBlend = damp(this.curiousBlend, curious ? 1 : 0, 7, dt);
    this.celebrateBlend = damp(this.celebrateBlend, celebrating ? 1 : 0, 8, dt);

    for (const name of ['curiousClip', 'celebrateClip', 'reactionClip']) {
      const clip = this[name];
      if (!clip) continue;
      clip.elapsed += dt;
      if (clip.elapsed >= clip.duration) this[name] = null;
    }

    // Exact underdamped spring solution: x'' + 16 x' + 484 x = 0.
    // An impulse changes velocity only, preserving the visual's current position.
    const damping = 8, frequency = Math.sqrt(22 * 22 - damping * damping);
    const decay = Math.exp(-damping * dt), cosine = Math.cos(frequency * dt), sine = Math.sin(frequency * dt);
    const x = this.landing, v = this.landVelocity;
    this.landing = decay * (x * cosine + (v + damping * x) / frequency * sine);
    this.landVelocity = decay * (v * cosine - (damping * v + 22 * 22 * x) / frequency * sine);

    const t = this.elapsed;
    const curiousCue = Math.max(this.curiousBlend, clipEnvelope(this.curiousClip));
    const celebrateCue = Math.max(this.celebrateBlend, clipEnvelope(this.celebrateClip));
    const clipPhase = this.celebrateClip ? this.celebrateClip.elapsed / this.celebrateClip.duration * Math.PI * 6 : 0;
    const clipWeight = (1 - this.celebrateBlend) * clipEnvelope(this.celebrateClip);
    // Keep sustained and one-shot oscillators separate. A clip ending must not
    // switch the phase of an ongoing celebration and snap the wrapper.
    const happyWiggle = this.celebrateBlend * Math.sin(t * 9) + clipWeight * Math.sin(clipPhase);
    const groundedBlend = 1 - this.airBlend;
    const settled = 1 - this.tumbleBlend;
    const freeSupport = (1 - this.carryBlend) * settled;
    const step = this.moveBlend * groundedBlend * freeSupport;
    const breathing = 0.007 * Math.sin(t * 2.25);
    const happyHop = 0.06 * (this.celebrateBlend * Math.sin(t * 4.5) ** 2
      + clipWeight * Math.sin(clipPhase / 2) ** 2) * groundedBlend;
    // A quiet companion occasionally checks its surroundings and nods. These
    // smooth windows have zero velocity at their edges and are not random
    // frame-dependent events, so they remain identical at any render FPS.
    const quiet = (1 - this.moveBlend) * groundedBlend * settled;
    const idlePhase = ((t % 8.8) + 8.8) % 8.8;
    const autoLook = timedWindow(idlePhase, 4.4, 1.8) * quiet * (Math.floor(t / 8.8) % 2 ? -1 : 1);
    const autoNod = timedWindow(idlePhase, 6.5, 1.25) * quiet * Math.sin((idlePhase - 6.5) * TAU / 1.25);
    const curiousLook = curiousCue * this.curiousDirection + autoLook * .75;
    const reaction = clipEnvelope(this.reactionClip);
    const reactionPhase = this.reactionClip ? this.reactionClip.elapsed / this.reactionClip.duration * TAU : 0;
    const reactionNod = this.reactionClip?.kind === 'portal' ? -.07 * Math.sin(reactionPhase)
      : this.reactionClip?.kind === 'startle' ? -.07 : .075 * Math.sin(reactionPhase);
    // Carried bob/hops would visually leave the actual hand contacts. Carrying
    // uses only a tiny rigid look, while jump/drop/tumble come from physics.
    const supportMotion = freeSupport + .035 * this.carryBlend;
    const lookMotion = settled * (1 - .72 * this.carryBlend);
    this.offsetPosition.set(
      clamp((0.004 * Math.sin(t * 1.3) + 0.012 * curiousLook + 0.008 * step * Math.sin(this.gait)) * supportMotion, -0.025, 0.025),
      clamp((breathing + 0.014 * step * (1 - Math.cos(this.gait * 2)) + happyHop + this.landing) * supportMotion, -0.04, 0.10),
      clamp((0.006 * curiousCue - 0.007 * step) * supportMotion, -0.02, 0.02),
    );
    this.offsetRotation.set(
      clamp((0.013 * Math.sin(t * 2.25) - 0.04 * step - 0.055 * curiousCue + this.airPitch * this.airBlend
        - this.landing * 1.4 + .06 * autoNod + reaction * reactionNod) * lookMotion, -0.18, 0.18),
      clamp((0.018 * Math.sin(t * 0.8) + 0.145 * curiousLook + 0.032 * happyWiggle) * lookMotion, -0.20, 0.20),
      clamp((0.015 * Math.sin(t * 1.3) + 0.08 * curiousLook + 0.036 * step * Math.sin(this.gait) + 0.12 * happyWiggle
        + (this.reactionClip?.kind === 'portal' ? .08 * reaction * Math.sin(reactionPhase) : 0)) * lookMotion, -0.20, 0.20),
    );
    this.visual.position.copy(this.restPosition).add(this.offsetPosition);
    this.tempQuaternion.setFromEuler(this.offsetRotation);
    this.visual.quaternion.copy(this.restQuaternion).multiply(this.tempQuaternion);

    this.state = carrying ? 'held' : this.tumbleBlend > .5 ? 'tumble' : !grounded ? (vy > 0.15 ? 'jump' : 'fall')
      : Math.abs(this.landing) > 0.0004 || Math.abs(this.landVelocity) > 0.02 ? 'landing'
        : celebrateCue > 0.02 ? 'celebrate'
          : curiousCue > 0.02 ? 'curious'
            : this.moveBlend > 0.02 ? 'move' : 'idle';
  }
}
