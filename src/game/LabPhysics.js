import { Body, Box, Material, Quaternion, SAPBroadphase, Sphere, Vec3, World } from 'cannon-es';

const SOLID = 1, CARGO = 2, PLAYER = 4;
const EPSILON = 1e-10;

function vector(value, fallback = new Vec3()) {
  if (!value) return fallback.clone();
  const result = Array.isArray(value) ? new Vec3(...value) : new Vec3(value.x, value.y, value.z);
  if (![result.x, result.y, result.z].every(Number.isFinite)) throw new TypeError('A finite position or velocity is required');
  return result;
}

function rotation(value) {
  const result = value ? new Quaternion(value.x ?? value[0], value.y ?? value[1], value.z ?? value[2], value.w ?? value[3]) : new Quaternion();
  if (![result.x, result.y, result.z, result.w].every(Number.isFinite)) throw new TypeError('A finite quaternion is required');
  result.normalize();
  return result;
}

function dimensions(bounds) {
  const min = vector(bounds.min), max = vector(bounds.max);
  const half = max.vsub(min).scale(.5);
  if (Math.min(half.x, half.y, half.z) <= 0) throw new RangeError('Static boxes must have a positive volume');
  return { half, center: max.vadd(min).scale(.5) };
}

function limit(value, maximum) {
  const length = value.length();
  if (length > maximum) value.scale(maximum / length, value);
  return value;
}

/**
 * One persistent rigid cargo body, independent of the current chamber and portal
 * renderer. Rendering samples a 120 Hz simulation; no asset vertices are changed.
 * All positions are world-space centres, except setPlayerProxy's foot position.
 */
export class LabPhysics {
  constructor({ fixedStep = 1 / 120, maxFrame = .1, gravity = -19.5 } = {}) {
    if (!(fixedStep > 0 && fixedStep <= 1 / 60)) throw new RangeError('Use a physics step of 1/60 second or shorter');
    this.fixedStep = fixedStep;
    this.maxFrame = Math.max(fixedStep, maxFrame);
    this.accumulator = 0;
    this.world = new World({ gravity: new Vec3(0, gravity, 0), allowSleep: true });
    this.world.broadphase = new SAPBroadphase(this.world);
    this.world.solver.iterations = 18;
    this.world.solver.tolerance = 1e-8;
    Object.assign(this.world.defaultContactMaterial, {
      friction: .64, restitution: .08,
      contactEquationStiffness: 1e8, contactEquationRelaxation: 4,
      frictionEquationStiffness: 1e8, frictionEquationRelaxation: 4,
    });
    this.cargoMaterial = new Material({ friction: 1, restitution: 1 });
    this.solids = new Map();
    this.cargoBody = null;
    this.playerProxy = null;
    this.carryTarget = null;
    this.releasePlayerGrace = false;
    this.grounded = false;
    this.impact = 0;
    this.steps = 0;
    this._force = new Vec3();
    this._error = new Vec3();
    this._angularError = new Quaternion();
    this._inverseRotation = new Quaternion();
  }

  addStaticBox(id, bounds, { friction = .64, restitution = .08, kinematic = false, enabled = true } = {}) {
    if (this.solids.has(id)) throw new Error(`Collider already exists: ${id}`);
    const { half, center } = dimensions(bounds);
    const body = new Body({
      mass: 0, type: kinematic ? Body.KINEMATIC : Body.STATIC, allowSleep: false,
      position: center, shape: new Box(half),
      material: new Material({ friction, restitution }),
      collisionFilterGroup: SOLID, collisionFilterMask: enabled ? CARGO : 0,
    });
    body.labId = id;
    this.solids.set(id, { body, half, target: center.clone(), remaining: 0 });
    this.world.addBody(body);
    return body;
  }

  /** Moving platforms are advanced along their actual path during substeps. */
  updateStaticBox(id, bounds, dt = 0, enabled = true) {
    const item = this.solids.get(id);
    if (!item) throw new Error(`Unknown collider: ${id}`);
    const { half, center } = dimensions(bounds), { body } = item;
    const nextMask = enabled ? CARGO : 0;
    if (body.collisionFilterMask !== nextMask) this.cargoBody?.wakeUp();
    body.collisionFilterMask = nextMask;
    if (half.distanceSquared(item.half) > EPSILON) {
      body.removeShape(body.shapes[0]);
      body.addShape(new Box(half));
      item.half.copy(half);
    }
    item.target.copy(center);
    if (body.type === Body.KINEMATIC && dt > 0) { item.remaining = dt; body.wakeUp(); }
    else {
      body.position.copy(center); body.previousPosition.copy(center); body.interpolatedPosition.copy(center);
      body.velocity.setZero(); item.remaining = 0;
      body.aabbNeedsUpdate = true;
    }
    this.world.broadphase.dirty = true;
    return body;
  }

  setStaticEnabled(id, enabled) {
    const item = this.solids.get(id);
    if (!item) return false;
    item.body.collisionFilterMask = enabled ? CARGO : 0;
    this.world.broadphase.dirty = true;
    this.cargoBody?.wakeUp();
    return true;
  }

  removeStaticBox(id) {
    const item = this.solids.get(id);
    if (!item) return false;
    this.world.removeBody(item.body); this.solids.delete(id);
    this.cargoBody?.wakeUp();
    return true;
  }

  createCargo({ position = [0, .41, 0], size = .78, mass = 3.2, quaternion, velocity, angularVelocity } = {}) {
    if (this.cargoBody) throw new Error('Cargo already exists; keep the same body across chambers');
    if (!(size > 0 && mass > 0)) throw new RangeError('Cargo needs positive size and mass');
    this.cargoSize = size;
    // This bound keeps travel per substep below one quarter of the collider size,
    // including during falls, so ordinary thin walls cannot be skipped in one step.
    this.maxLinearSpeed = Math.min(22, size / (4 * this.fixedStep));
    const body = new Body({
      mass, position: vector(position), quaternion: rotation(quaternion),
      velocity: vector(velocity), angularVelocity: vector(angularVelocity),
      shape: new Box(new Vec3(size / 2, size / 2, size / 2)), material: this.cargoMaterial,
      linearDamping: .035, angularDamping: .16,
      allowSleep: true, sleepSpeedLimit: .11, sleepTimeLimit: .7,
      collisionFilterGroup: CARGO, collisionFilterMask: SOLID | PLAYER,
    });
    body.previousPosition.copy(body.position); body.previousQuaternion.copy(body.quaternion);
    body.addEventListener('collide', event => {
      this.impact = Math.max(this.impact, Math.min(16, Math.abs(event.contact.getImpactVelocityAlongNormal())));
    });
    this.cargoBody = body;
    this.world.addBody(body);
    return body;
  }

  /** Explicit restart only. Neither room progression nor a fall calls this. */
  resetCargo({ position, quaternion, velocity, angularVelocity } = {}) {
    const body = this.cargoBody;
    if (!body) return null;
    this.release();
    if (position) body.position.copy(vector(position));
    body.quaternion.copy(rotation(quaternion)); body.velocity.copy(vector(velocity));
    body.angularVelocity.copy(vector(angularVelocity)); body.force.setZero(); body.torque.setZero();
    body.previousPosition.copy(body.position); body.previousQuaternion.copy(body.quaternion);
    body.interpolatedPosition.copy(body.position); body.interpolatedQuaternion.copy(body.quaternion);
    body.aabbNeedsUpdate = true; body.wakeUp();
    this.releasePlayerGrace = false; body.collisionFilterMask = SOLID | PLAYER;
    this.accumulator = 0; this.impact = 0; this.grounded = false;
    return body;
  }

  setCarryTarget(position, { velocity, quaternion } = {}) {
    if (!this.cargoBody) return false;
    if (!position) { this.release(); return false; }
    this.carryTarget = { position: vector(position), velocity: vector(velocity), quaternion: rotation(quaternion) };
    this.releasePlayerGrace = false;
    this.cargoBody.collisionFilterMask = SOLID;
    this.cargoBody.allowSleep = false; this.cargoBody.wakeUp();
    return true;
  }

  /** Release preserves the acquired linear/angular momentum and exact pose. */
  release({ velocity } = {}) {
    const body = this.cargoBody;
    if (!body) return false;
    this.carryTarget = null;
    // A wall can compress the hand target into the player's rounded proxy.
    // Restore player contacts only after natural separation, avoiding a solver
    // impulse or a friction wedge that would leave the released object hanging.
    this.releasePlayerGrace = this._overlapsPlayer();
    body.collisionFilterMask = this.releasePlayerGrace ? SOLID : SOLID | PLAYER;
    body.allowSleep = true;
    // Optional hand velocity may add a small inherited impulse; it never erases
    // falling or tumbling motion and is bounded to prevent a release explosion.
    if (velocity) {
      const inherited = vector(velocity).vsub(body.velocity);
      limit(inherited, 1.5).scale(.25, inherited);
      body.velocity.vadd(inherited, body.velocity);
    }
    body.wakeUp();
    return true;
  }

  /** Kinematic rounded proxy lets a walking player push the unheld cargo. */
  setPlayerProxy({ position, radius = .43, height = 2.4, enabled = true }, dt = this.fixedStep) {
    const center = vector(position); center.y += height / 2;
    if (!this.playerProxy) {
      const body = new Body({
        type: Body.KINEMATIC, mass: 0, position: center, allowSleep: false,
        material: new Material({ friction: .08, restitution: 0 }),
        collisionFilterGroup: PLAYER, collisionFilterMask: CARGO,
      });
      const half = Math.max(0, height / 2 - radius);
      for (const y of [-half, 0, half]) body.addShape(new Sphere(radius), new Vec3(0, y, 0));
      this.playerProxy = { body, target: center.clone(), remaining: 0 };
      this.world.addBody(body);
    }
    const proxy = this.playerProxy;
    proxy.body.collisionFilterMask = enabled ? CARGO : 0;
    proxy.target.copy(center);
    // Only the player proxy may be repositioned on a player portal crossing.
    // The cargo is never moved with it or swept through all intermediate rooms.
    if (dt <= 0 || center.distanceSquared(proxy.body.position) > 9) {
      proxy.body.position.copy(center); proxy.body.previousPosition.copy(center);
      proxy.body.velocity.setZero(); proxy.remaining = 0;
      proxy.body.aabbNeedsUpdate = true;
    } else proxy.remaining = dt;
    return proxy.body;
  }

  _advanceKinematic(item, dt) {
    if (item.body.type !== Body.KINEMATIC) return;
    if (item.remaining > EPSILON) {
      item.target.vsub(item.body.position, item.body.velocity);
      item.body.velocity.scale(1 / Math.max(dt, item.remaining), item.body.velocity);
      item.remaining = Math.max(0, item.remaining - dt);
    } else item.body.velocity.setZero();
  }

  _overlapsPlayer() {
    const body = this.cargoBody, proxy = this.playerProxy?.body;
    if (!body || !proxy) return false;
    const half = this.cargoSize / 2, worldPoint = new Vec3(), localPoint = new Vec3();
    for (let i = 0; i < proxy.shapes.length; i++) {
      proxy.position.vadd(proxy.shapeOffsets[i], worldPoint);
      body.pointToLocalFrame(worldPoint, localPoint);
      const dx = localPoint.x - Math.max(-half, Math.min(half, localPoint.x));
      const dy = localPoint.y - Math.max(-half, Math.min(half, localPoint.y));
      const dz = localPoint.z - Math.max(-half, Math.min(half, localPoint.z));
      const radius = proxy.shapes[i].radius + .015;
      if (dx * dx + dy * dy + dz * dz < radius * radius) return true;
    }
    return false;
  }

  _carryForces() {
    const body = this.cargoBody, target = this.carryTarget;
    if (!body || !target) return;
    target.position.vsub(body.position, this._error);
    target.velocity.vsub(body.velocity, this._force);
    this._force.scale(18.5, this._force);
    this._force.addScaledVector(90, this._error, this._force);
    this._force.vsub(this.world.gravity, this._force);
    limit(this._force, 90).scale(body.mass, this._force);
    body.applyForce(this._force);

    body.quaternion.conjugate(this._inverseRotation);
    target.quaternion.mult(this._inverseRotation, this._angularError);
    const sign = this._angularError.w < 0 ? -1 : 1;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this._angularError.w)));
    const sine = Math.sqrt(Math.max(0, 1 - this._angularError.w * this._angularError.w));
    const factor = sine > 1e-5 ? sign * angle / sine : 2 * sign;
    const inertia = body.mass * this.cargoSize * this.cargoSize / 6;
    body.torque.x += inertia * (36 * this._angularError.x * factor - 11 * body.angularVelocity.x);
    body.torque.y += inertia * (36 * this._angularError.y * factor - 11 * body.angularVelocity.y);
    body.torque.z += inertia * (36 * this._angularError.z * factor - 11 * body.angularVelocity.z);
    limit(body.torque, body.mass * 8);
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Physics dt must be finite and nonnegative');
    this.accumulator += Math.min(this.maxFrame, dt);
    while (this.accumulator + EPSILON >= this.fixedStep) {
      for (const item of this.solids.values()) this._advanceKinematic(item, this.fixedStep);
      if (this.playerProxy) this._advanceKinematic(this.playerProxy, this.fixedStep);
      if (this.releasePlayerGrace && !this._overlapsPlayer()) {
        this.releasePlayerGrace = false;
        this.cargoBody.collisionFilterMask = SOLID | PLAYER;
        this.cargoBody.wakeUp();
      }
      this._carryForces();
      if (this.cargoBody) {
        limit(this.cargoBody.velocity, this.maxLinearSpeed);
        limit(this.cargoBody.angularVelocity, 18);
      }
      this.world.step(this.fixedStep);
      const supported = this.world.contacts.some(contact =>
        (contact.bi === this.cargoBody && contact.ni.y < -.45) ||
        (contact.bj === this.cargoBody && contact.ni.y > .45));
      // Sleeping bodies leave the narrowphase; retain their last support state.
      this.grounded = supported || (this.cargoBody?.sleepState === Body.SLEEPING && this.grounded);
      if (this.cargoBody) {
        limit(this.cargoBody.velocity, this.maxLinearSpeed);
        limit(this.cargoBody.angularVelocity, 18);
      }
      this.impact *= Math.exp(-9 * this.fixedStep);
      this.accumulator = Math.max(0, this.accumulator - this.fixedStep);
      this.steps++;
    }
    return this.accumulator / this.fixedStep;
  }

  /** alpha omitted: interpolate at the actual render-frame remainder. alpha=1: simulation state. */
  sample(alpha = this.accumulator / this.fixedStep) {
    const body = this.cargoBody;
    if (!body) return null;
    const blend = Math.min(1, Math.max(0, alpha));
    const position = new Vec3(), quaternion = new Quaternion();
    body.previousPosition.lerp(body.position, blend, position);
    body.previousQuaternion.slerp(body.quaternion, blend, quaternion);
    return {
      position, quaternion, velocity: body.velocity.clone(), angularVelocity: body.angularVelocity.clone(),
      sleeping: body.sleepState === Body.SLEEPING, carrying: Boolean(this.carryTarget),
      grounded: this.grounded, impact: this.impact, alpha: blend,
    };
  }

  get diagnostics() {
    const state = this.sample(1);
    return {
      solver: 'cannon-es', fixedHz: 1 / this.fixedStep, steps: this.steps,
      cargoCount: this.cargoBody ? 1 : 0, cargoSize: this.cargoSize ?? null,
      staticColliders: this.solids.size, carrying: Boolean(this.carryTarget),
      grounded: this.grounded, sleeping: state?.sleeping ?? false,
      releasePlayerGrace: this.releasePlayerGrace,
      speed: state?.velocity.length() ?? 0, angularSpeed: state?.angularVelocity.length() ?? 0,
      position: state?.position.toArray() ?? null, automaticTeleports: 0,
    };
  }

  dispose() {
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
    this.solids.clear(); this.cargoBody = null; this.playerProxy = null; this.carryTarget = null;
  }
}
