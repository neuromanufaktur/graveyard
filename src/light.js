// Light: moon with shadows that follow the view, sky light, and a small pool of point lights
// for moving sources (the figure's lantern, lights of the mourners, zombies, flickering candles nearby).

import * as THREE from 'three';
import { MOON_DIRECTION } from './sky.js';

export class Light {
  constructor(scene) {
    this.moon = new THREE.DirectionalLight('#a9bcff', 2.3);
    this.moon.castShadow = true;
    const s = this.moon.shadow;
    s.mapSize.set(4096, 4096);
    s.bias = -0.00035;
    s.normalBias = 0.035;
    s.radius = 2.2;
    s.camera.near = 1;
    s.camera.far = 420;
    this.half = 46;
    this.setArea(46);
    scene.add(this.moon, this.moon.target);
    this.sky = new THREE.HemisphereLight('#4a5f96', '#1b2420', 1.05);
    scene.add(this.sky);
    // cool back light from the other side so facades stay readable in the moon shadow
    this.fill = new THREE.DirectionalLight('#7088c8', 0.75);
    this.fill.position.set(0.55, 0.5, 0.7).multiplyScalar(100);
    scene.add(this.fill);
    // point lights
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const p = new THREE.PointLight('#ffb35c', 0, 9, 2);
      p.castShadow = false;
      scene.add(p);
      this.pool.push(p);
    }
    this.lantern = new THREE.PointLight('#ffb766', 0, 11, 2);
    this.lantern.castShadow = true;
    this.lantern.shadow.mapSize.set(512, 512);
    this.lantern.shadow.camera.near = 0.15;
    this.lantern.shadow.camera.far = 11;
    this.lantern.shadow.bias = -0.002;
    this.lantern.shadow.radius = 3;
    scene.add(this.lantern);
    this.sources = [];
  }

  setArea(half) {
    const c = this.moon.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.updateProjectionMatrix();
    this.half = half;
  }

  // the shadow camera follows the view point, snapped to texels so nothing flickers
  follow(target, before, half) {
    if (Math.abs(half - this.half) > 0.5) this.setArea(half);
    const texel = (this.half * 2) / this.moon.shadow.mapSize.x;
    const center = new THREE.Vector3(target.x + before.x, 0, target.z + before.z);
    // snap to light space
    const right = new THREE.Vector3().crossVectors(MOON_DIRECTION, new THREE.Vector3(0, 1, 0)).normalize();
    const top = new THREE.Vector3().crossVectors(right, MOON_DIRECTION).normalize();
    const u = Math.round(center.dot(right) / texel) * texel;
    const v = Math.round(center.dot(top) / texel) * texel;
    const w = center.dot(MOON_DIRECTION);
    center.copy(right).multiplyScalar(u).addScaledVector(top, v).addScaledVector(MOON_DIRECTION, w);
    this.moon.target.position.copy(center);
    this.moon.position.copy(center).addScaledVector(MOON_DIRECTION, 200);
    this.moon.target.updateMatrixWorld();
  }

  // sources: { x, y, z, color, strength, range, flicker }
  distribute(sources, near, time) {
    const sorted = sources
      .filter((q) => q.strength > 0)
      .map((q) => ({ q, d: (q.x - near.x) ** 2 + (q.z - near.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i], e = sorted[i];
      if (!e || e.d > 50 * 50) { p.intensity = 0; continue; }
      const q = e.q;
      p.position.set(q.x, q.y, q.z);
      p.color.set(q.color);
      p.distance = q.range;
      const fl = q.flicker ? 0.86 + 0.14 * Math.sin(time * 13 + i * 7) * Math.sin(time * 7.3 + i) : 1;
      const rim = 1 - Math.min(1, Math.max(0, (Math.sqrt(e.d) - 38) / 12));
      p.intensity = q.strength * fl * rim;
    }
  }
}
