// Camera: follows the figure at an angle from above, can rotate and zoom, flies up for the map.

import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';

const NEAR = 13, FAR = 92;

export class Camera {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this.gaze = new THREE.Vector3();
    this.az = 0; this.azTarget = 0;
    this.dist = 36; this.distTarget = 36;
    this.tilt = 0; this.tiltTarget = 0;
    this.map = 0; this.mapTarget = 0;
    this.mapCenter = new THREE.Vector3(-4, 0, -18);
    this.drag = null;
    this.moved = false;
    this.flight = null;
    this._bind();
  }

  // Frame of the map. Landscape: north at the top. Portrait: rotated by 90 degrees, west at the top,
  // so the long village lies along the long side of the screen.
  mapFrame() {
    const a = this.cam.aspect, t = 2 * Math.tan((this.cam.fov * Math.PI) / 360), b = this.mapBox;
    if (!b || a >= 1) return { center: this.mapCenter, dist: Math.max(330, b ? (b.x1 - b.x0) / (t * a) : 0), az: 0 };
    const width = b.z1 - b.z0, height = (b.x1 - b.x0) / Math.sin(1.2);
    const dist = Math.max(width / (t * a), height / t / 0.72);
    if (!this._kmH) this._kmH = new THREE.Vector3();
    // a little to the east so the village sits between header and legend
    return { center: this._kmH.set((b.x0 + b.x1) / 2 + dist * 0.02, 0, (b.z0 + b.z1) / 2), dist, az: Math.PI / 2 };
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (this.locked) { this.moved = false; return; }
      this.drag = { x: e.clientX, y: e.clientY, az: this.azTarget, n: this.tiltTarget, span: 0, id: e.pointerId, key: e.button };
      this.moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      const z = this.drag;
      if (!z || z.id !== e.pointerId || this.points?.size > 1) return;
      const dx = e.clientX - z.x, dy = e.clientY - z.y;
      z.span = Math.max(z.span, Math.hypot(dx, dy));
      if (z.span > 6) {
        this.moved = true;
        if (this.mapTarget < 0.5) {
          this.azTarget = z.az - dx * 0.006;
          this.tiltTarget = clamp(z.n + dy * 0.0035, -0.35, 0.45);
        }
      }
    });
    window.addEventListener('pointerup', (e) => { if (this.drag?.id === e.pointerId) setTimeout(() => (this.drag = null), 0); });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mapTarget > 0.5 || this.locked) return;
      this.distTarget = clamp(this.distTarget * Math.exp(e.deltaY * 0.0012), NEAR, FAR);
    }, { passive: false });
    // two fingers: zoom
    this.points = new Map();
    let start = null;
    d.addEventListener('pointerdown', (e) => {
      this.points.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.points.size === 2) { const [a, b] = [...this.points.values()]; start = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: this.distTarget }; }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.points.has(e.pointerId)) return;
      this.points.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.points.size === 2 && start && !this.locked) {
        const [a, b] = [...this.points.values()];
        const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.distTarget = clamp(start.dist * (start.d / Math.max(dd, 1)), NEAR, FAR);
        this.moved = true;
      }
    });
    const path = (e) => { this.points.delete(e.pointerId); if (this.points.size < 2) start = null; };
    window.addEventListener('pointerup', path);
    window.addEventListener('pointercancel', path);
  }

  rotate(r) { this.azTarget += r; }
  zoome(f) { this.distTarget = clamp(this.distTarget * f, NEAR, FAR); }
  setMap(on) { this.mapTarget = on ? 1 : 0; }
  get inMap() { return this.mapTarget > 0.5; }

  // camera move (intro): from one shot to the next
  move(from, duration) { this.flight = { from, t: 0, duration }; }

  // viewing direction on the ground (for controls relative to the camera)
  forward() { return new THREE.Vector3(-Math.sin(this.az), 0, -Math.cos(this.az)); }
  right() { return new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az)); }

  update(dt, figure) {
    const k = 1 - Math.exp(-dt * 6);
    this.target.lerp(new THREE.Vector3(figure.x, (figure.y || 0) + 1.1, figure.z), 1 - Math.exp(-dt * 5));
    this.az += (this.azTarget - this.az) * k;
    this.dist += (this.distTarget - this.dist) * k;
    this.tilt += (this.tiltTarget - this.tilt) * k;
    this.map += (this.mapTarget - this.map) * (1 - Math.exp(-dt * 2.6));
    const t = smooth(NEAR, FAR, this.dist);
    let el = lerp(0.6, 1.05, t) + this.tilt;
    el = clamp(el, 0.2, 1.3);
    let dist = this.dist, az = this.az;
    const target = this.target.clone();
    // map: high above the board, north at the top
    const km = smooth(0, 1, this.map);
    if (km > 0.001) {
      const R = this.mapFrame();
      target.lerp(R.center, km);
      dist = lerp(dist, R.dist, km * km * (3 - 2 * km));
      el = lerp(el, 1.2, km);
      const azK = R.az + Math.round((az - R.az) / (Math.PI * 2)) * Math.PI * 2;
      az = lerp(az, azK, km);
    }
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const e = smooth(0, 1, Math.min(1, f.t));
      target.lerp(f.from.target, 1 - e);
      dist = lerp(f.from.dist, dist, e);
      el = lerp(f.from.el, el, e);
      az = lerp(f.from.az, az, e);
      if (f.t >= 1) this.flight = null;
    }
    this.el = el;
    const pos = new THREE.Vector3(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
    this.cam.position.copy(pos);
    this.cam.lookAt(target);
    this.gaze.copy(target);
    this.curDist = dist;
  }
}
