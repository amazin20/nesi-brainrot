import { Vec3 } from 'cannon-es';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const UP = new Vec3(0, 1, 0);

/** Local curiosity, not pathfinding. All recovery and walking use bounded
 * forces on the SAME rigid body. Airborne motion is always owned by physics. */
export class LabCompanionBehavior {
  constructor(physics) { this.physics = physics; this.reset(); }
  reset() {
    this.anchor = null; this.target = null; this.age = 0; this.restTime = 0;
    this.state = 'settling'; this.wasHeld = false; this.wasGrounded = false;
    this.visit = 0; this.recovery = 0; this.blockedTime = 0;
  }
  reanchor(position) {
    this.anchor = new Vec3(position.x, position.y, position.z);
    this.target = null; this.restTime = 0; this.blockedTime = 0;
  }
  update(dt, { held = false, onPad = false, canMove = () => true } = {}) {
    const body = this.physics.cargoBody;
    if (!body || !(dt > 0)) return;
    body.material.friction = 1;
    this.age += dt;
    if (held) { this.state = 'held'; this.wasHeld = true; this.wasGrounded = false; return; }
    const grounded = this.physics.grounded;
    if (this.wasHeld) { this.reanchor(body.position); this.wasHeld = false; this.wasGrounded = false; }
    if (!grounded) { this.state = 'airborne'; this.restTime = 0; this.wasGrounded = false; return; }
    if (!this.wasGrounded || !this.anchor) this.reanchor(body.position);
    this.wasGrounded = true;
    this.restTime += dt;
    const speed = body.velocity.length(), spin = body.angularVelocity.length();
    if (speed > 1.5 || spin > 5) { this.state = 'settling'; this.restTime = 0; return; }
    const up = body.quaternion.vmult(UP);
    const upright = clamp(up.dot(UP), -1, 1);
    // Let impacts tumble naturally, then brace and stand under motor torque.
    if (upright < .965 && this.restTime > .55) {
      this.state = 'getting_up'; this.recovery = Math.min(1, this.recovery + dt * 2.5);
      const axis = up.cross(UP);
      if (axis.lengthSquared() < 1e-8) axis.set(1, 0, 0);
      axis.normalize();
      const angle = Math.acos(upright), inertia = body.mass * this.physics.cargoSize ** 2 / 6;
      const gain = this.recovery * this.recovery * (3 - 2 * this.recovery);
      for (const k of ['x', 'z']) body.torque[k] += inertia * gain * (angle * axis[k] * 55 - body.angularVelocity[k] * 12);
      body.wakeUp(); return;
    }
    this.recovery = 0;
    if (upright < .965 || this.restTime < 1.6) { this.state = 'settling'; return; }
    // Weight switches are a deliberate command to stay. Cosmetic tail/head
    // motion can continue without invalidating a solved pressure circuit.
    if (onPad) { this.state = 'waiting_on_pad'; this.target = null; return; }
    if (!this.target) {
      if (this.restTime < 2.0 + (this.visit % 3) * .65) { this.state = 'looking'; return; }
      const angle = this.visit++ * 2.399963 + .4;
      const radius = .36 + (this.visit % 3) * .14;
      this.target = new Vec3(this.anchor.x + Math.cos(angle) * radius, body.position.y,
        this.anchor.z + Math.sin(angle) * radius);
    }
    const dx = this.target.x - body.position.x, dz = this.target.z - body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .085) { this.target = null; this.restTime = 0; this.state = 'looking'; return; }
    const nx = dx / distance, nz = dz / distance;
    if (!canMove(body.position, nx, nz)) {
      this.target = null; this.restTime = 0; this.state = 'looking'; return;
    }
    this.state = 'wandering';
    const pace = Math.min(.32, distance * .75);
    // Friction feed-forward allows a very slow walk without making the body
    // slippery during normal falls, pushes, carrying or landings.
    // During a step the foot lifts and transfers load. A box has four static
    // contacts, so retaining resting friction here pins even an active motor.
    // Restore the original high friction in every non-walking state above.
    body.material.friction = 0;
    const friction = 0;
    body.force.x += body.mass * clamp((nx * pace - body.velocity.x) * 30 + nx * friction, -18, 18);
    body.force.z += body.mass * clamp((nz * pace - body.velocity.z) * 30 + nz * friction, -18, 18);
    const facing = body.quaternion.vmult(new Vec3(-1, 0, 0));
    const turn = Math.atan2(facing.z * nx - facing.x * nz, facing.x * nx + facing.z * nz);
    const inertia = body.mass * this.physics.cargoSize ** 2 / 6;
    body.torque.y += inertia * clamp(turn * 9 - body.angularVelocity.y * 6, -9, 9);
    for (const k of ['x', 'z']) body.torque[k] -= inertia * body.angularVelocity[k] * 5;
    body.wakeUp();
    if (speed < .025) this.blockedTime += dt; else this.blockedTime = 0;
    if (this.blockedTime > .9) { this.target = null; this.restTime = 0; this.blockedTime = 0; }
  }
  get diagnostics() {
    return { state: this.state, anchor: this.anchor?.toArray() ?? null,
      target: this.target?.toArray() ?? null, recovery: this.recovery, wanderRadius: .8 };
  }
}
