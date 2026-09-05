/** Bounded real-frame statistics. Simulation dt is deliberately NOT used as FPS. */
export class LabPerformance {
  constructor(capacity = 180) {
    this.samples = new Float64Array(capacity); this.reset();
  }
  reset() { this.elapsed = this.count = this.cursor = this.lastPublish = 0; this.stats = { fps: 0, frameMs: 0, p99Ms: 0, low1Fps: 0, calls: 0, triangles: 0 }; }
  sample(milliseconds, now, renderInfo) {
    if (!(milliseconds > 0) || !Number.isFinite(milliseconds)) return this.stats;
    this.samples[this.cursor++ % this.samples.length] = milliseconds;
    this.count = Math.min(this.samples.length, this.count + 1);
    this.elapsed += milliseconds;
    if (this.count < 4 || this.elapsed < 500 || now - this.lastPublish < 500) return this.stats;
    this.lastPublish = now;
    const values = Array.from(this.samples.subarray(0, this.count)).sort((a,b) => a-b);
    const mean = values.reduce((sum,x) => sum+x, 0) / values.length;
    const tail = values.slice(Math.floor(values.length * .99));
    const p99 = values[Math.min(values.length-1, Math.floor(values.length * .99))];
    this.stats = { fps: 1000 / mean, frameMs: mean, p99Ms: p99,
      low1Fps: 1000 / (tail.reduce((sum,x) => sum+x,0) / tail.length),
      calls: renderInfo?.calls ?? 0, triangles: renderInfo?.triangles ?? 0 };
    return this.stats;
  }
}
