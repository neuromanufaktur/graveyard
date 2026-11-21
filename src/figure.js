// Figures like painted scale-model figures: joints as groups (hip, legs, torso, arms, head),
// hair, clothes and one item per person. Look, names and roles come from the configuration.

import * as THREE from 'three';
import { Builder, MAT, T, box, cyl, sphere, torus, lightMaterial, merge, withFog } from './build.js';
import config from './config.js';
import { t } from './i18n.js';

const asFigure = (p) => ({ name: p.name, role: p.role, ...(p.accent ? { accent: p.accent } : {}), ...p.look });
const figures = (list) => Object.fromEntries(Object.entries(list).map(([id, p]) => [id, asFigure(p)]));

// Without a configured team there is one neutral figure to play
export const STANDARD_TEAM = {
  guest: { name: t('guest'), role: t('visiting'), skin: '#e6c3a5', hair: '#3a2c24', hairstyle: 'short', top: 'sweater', color: '#5b6577', trousers: '#2c3140', shoes: '#2a2522' },
};

export const TEAM = Object.keys(config.team).length ? figures(config.team) : STANDARD_TEAM;
export const AI_TEAM = figures(config.mourners.members);

export const ZOMBIE = { name: 'Zombie', skin: '#9fb59a', hair: '#3b3a2e', hairstyle: 'shaggy', top: 'torn', color: '#5d5a4c', trousers: '#3a3a34', shoes: '#2a2a26' };

let SKIN, HAIR;
function materials() {
  if (SKIN) return;
  // own materials instead of clone(): clone() resets the shader defines
  SKIN = withFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58 }), null, 'skin');
  HAIR = withFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.6 }), null, 'hair');
}

const capsuleCache = new Map();
function capsule(r, l, seg = 10) {
  const k = r + ',' + l;
  if (!capsuleCache.has(k)) capsuleCache.set(k, new THREE.CapsuleGeometry(r, l, 4, seg));
  return capsuleCache.get(k);
}
// chin area for stubble: only the lower front part of the head sphere
const chin = new THREE.SphereGeometry(0.158, 18, 6, Math.PI * 0.14, Math.PI * 0.72, 2.08, 0.95);
// shaved head: only a ring at the sides and back of the head
// full beard: lower front half. The top edge runs like a real beard line from the ears
// down at an angle to the corner of the mouth, so the cheeks stay free.
const fullBeard = (() => {
  const r = 0.162, t0 = 1.55, t1 = 3.05;
  const g = new THREE.SphereGeometry(r, 24, 10, Math.PI * 0.04, Math.PI * 0.92, t0, t1 - t0);
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const th = Math.acos(Math.max(-1, Math.min(1, v.y / r))), ph = Math.atan2(v.z, -v.x);
    const edge = 1.62 + 0.4 * Math.pow(Math.max(0, Math.sin(ph)), 3);
    const t = edge + ((th - t0) / (t1 - t0)) * (t1 - edge);
    v.set(-r * Math.cos(ph) * Math.sin(t), r * Math.cos(t), r * Math.sin(ph) * Math.sin(t));
    p.setXYZ(i, v.x, v.y, v.z);
    v.normalize(); n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
})();
const hemisphere = new Map();
function cap(r, phiStart, phiLen, thetaLen) {
  const k = [r, phiStart, phiLen, thetaLen].join(',');
  if (!hemisphere.has(k)) hemisphere.set(k, new THREE.SphereGeometry(r, 18, 12, phiStart, phiLen, 0, thetaLen));
  return hemisphere.get(k);
}

function hairstyle(B, f, hair) {
  const o = { material: HAIR };
  const R = 0.168;
  switch (f.hairstyle) {
    case 'short':
      B.add('matt', cap(R, 0, Math.PI * 2, 1.05), T(0, 0.012, -0.008), hair, o);
      B.add('matt', cap(R, Math.PI * 0.75, Math.PI * 1.5, 1.6), T(0, 0.0, -0.004), hair, o);
      break;
    case 'side':
      B.add('matt', cap(R + 0.004, 0, Math.PI * 2, 1.1), T(0, 0.016, -0.01), hair, o);
      B.add('matt', cap(R, Math.PI * 0.7, Math.PI * 1.6, 1.62), T(0, 0.0, -0.006), hair, o);
      B.add('matt', box(0.2, 0.06, 0.1, 0.03), T(0.03, 0.135, 0.1, 0.25, 0.35, -0.25), hair, o);
      break;
    case 'curls':
      B.add('matt', cap(R + 0.006, 0, Math.PI * 2, 1.2), T(0, 0.02, -0.01), hair, o);
      for (let i = 0; i < 22; i++) {
        const w = (i / 22) * Math.PI * 2, t = 0.25 + (i % 3) * 0.32;
        B.add('matt', sphere(0.05, 7, 5), T(Math.cos(w) * Math.sin(t) * 0.17, 0.03 + Math.cos(t) * 0.17, Math.sin(w) * Math.sin(t) * 0.17 - 0.01), hair, o);
      }
      B.add('matt', cap(R, Math.PI * 0.75, Math.PI * 1.5, 1.7), T(0, 0, -0.008), hair, o);
      break;
    case 'curlytop': {
      // short sides, dense curls on top, slightly into the forehead at the front
      B.add('matt', cap(R, Math.PI * 0.74, Math.PI * 1.52, 1.48), T(0, 0, -0.006), hair, o);
      B.add('matt', cap(R + 0.004, 0, Math.PI * 2, 0.95), T(0, 0.018, -0.006), hair, o);
      const N = 34, tmax = 1.02;
      for (let i = 0; i < N; i++) {
        const th = Math.acos(1 - (1 - Math.cos(tmax)) * (i + 0.5) / N), ph = i * 2.39996;
        const rr = 0.172 + ((i * 7) % 5) * 0.003, s = Math.sin(th);
        B.add('matt', sphere(0.046 + ((i * 3) % 4) * 0.003, 7, 5), T(Math.cos(ph) * s * rr, 0.026 + Math.cos(th) * rr, Math.sin(ph) * s * rr + 0.012), hair, o);
      }
      break;
    }
    case 'short': {
      // buzz cut, the hairline at forehead and temples slightly receded: skin shows through
      const c = merge(f.skin, hair, 0.55);
      B.add('matt', cap(R + 0.0015, Math.PI * 0.72, Math.PI * 1.56, 1.42), T(0, 0, -0.004), c, o);
      B.add('matt', cap(R + 0.0025, 0, Math.PI * 2, 0.86), T(0, 0.002, -0.016, -0.2, 0, 0), c, o);
      break;
    }
    case 'slicked':
      // fuller on top, combed back
      B.add('matt', cap(R, Math.PI * 0.74, Math.PI * 1.52, 1.5), T(0, 0, -0.006), hair, o);
      B.add('matt', cap(R + 0.006, 0, Math.PI * 2, 1.0), T(0, 0.02, -0.012, 0, 0, 0, 1.0, 1.12, 1.03), hair, o);
      B.add('matt', box(0.2, 0.06, 0.13, 0.03), T(0.018, 0.168, 0.055, -0.5, 0, -0.12), hair, o);
      break;
    case 'bun':
      B.add('matt', cap(R + 0.003, 0, Math.PI * 2, 1.15), T(0, 0.012, -0.008), hair, o);
      B.add('matt', cap(R, Math.PI * 0.72, Math.PI * 1.56, 1.75), T(0, 0, -0.006), hair, o);
      B.add('matt', sphere(0.085, 12, 9), T(0, 0.17, -0.1), hair, o);
      break;
    case 'long':
      B.add('matt', cap(R + 0.005, 0, Math.PI * 2, 1.2), T(0, 0.012, -0.01), hair, o);
      B.add('matt', cap(R + 0.004, Math.PI * 0.68, Math.PI * 1.64, 2.0), T(0, 0, -0.01), hair, o);
      B.add('matt', box(0.3, 0.42, 0.1, 0.05), T(0, -0.2, -0.1), hair, o);
      for (const s of [-1, 1]) B.add('matt', box(0.06, 0.34, 0.08, 0.03), T(s * 0.15, -0.14, 0.05), hair, o);
      break;
    case 'braid':
      B.add('matt', cap(R + 0.004, 0, Math.PI * 2, 1.2), T(0, 0.012, -0.008), hair, o);
      B.add('matt', cap(R, Math.PI * 0.72, Math.PI * 1.56, 1.8), T(0, 0, -0.006), hair, o);
      for (let i = 0; i < 5; i++) B.add('matt', sphere(0.05 - i * 0.004, 8, 6), T(0, -0.06 - i * 0.075, -0.17 - i * 0.012), hair, o);
      break;
    case 'longbob':
      B.add('matt', cap(R + 0.006, 0, Math.PI * 2, 1.25), T(0, 0.015, -0.01), hair, o);
      B.add('matt', cap(R + 0.012, Math.PI * 0.62, Math.PI * 1.76, 2.15), T(0, -0.005, -0.008), hair, o);
      B.add('matt', box(0.24, 0.05, 0.08, 0.025), T(0, 0.12, 0.12, 0, 0.5), hair, o);
      break;
    case 'shaggy':
      B.add('matt', cap(R, 0, Math.PI * 2, 1.15), T(0, 0.01, 0), hair, o);
      for (let i = 0; i < 14; i++) {
        const w = (i / 14) * Math.PI * 2;
        B.add('matt', sphere(0.035, 5, 4), T(Math.cos(w) * 0.13, 0.12 + (i % 2) * 0.03, Math.sin(w) * 0.13, 0, 0, 0, 1, 2.2, 1), hair, o);
      }
      break;
  }
}

function glasses(B) {
  for (const s of [-1, 1]) B.add('metal', torus(0.036, 0.0065, 6, 16), T(s * 0.058, 0.02, 0.15, 0, 0, 0), '#141418');
  B.add('metal', box(0.04, 0.008, 0.008), T(0, 0.024, 0.155), '#141418');
  for (const s of [-1, 1]) B.add('metal', box(0.008, 0.008, 0.13), T(s * 0.095, 0.024, 0.09), '#141418');
}

export function buildFigure(f, opt = {}) {
  materials();
  const root = new THREE.Group();
  const hip = new THREE.Group(); hip.position.y = 0.86;
  const torso = new THREE.Group(); torso.position.y = 0.86;
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(0.095, 0, 0); legR.position.set(-0.095, 0, 0);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(0.245, 0.56, 0); armR.position.set(-0.245, 0.56, 0);
  const head = new THREE.Group(); head.position.y = 0.8;
  root.add(hip, torso); hip.add(legL, legR); torso.add(armL, armR, head);
  const skin = { material: SKIN };
  const shirt = f.shirt || f.color;
  const sleeve = f.top === 'vest' ? shirt : f.color;
  const zombie = f.top === 'torn';

  // legs with shoes
  for (const [g, s] of [[legL, 1], [legR, -1]]) {
    const B = new Builder(3);
    B.add('fabric', capsule(0.074, 0.6), T(0, -0.37, 0), f.trousers);
    B.add('matt', box(0.125, 0.09, 0.26, 0.04), T(0, -0.815, 0.04), f.shoes);
    B.add('matt', box(0.13, 0.025, 0.27, 0.01), T(0, -0.85, 0.04), merge(f.shoes, '#000000', 0.45));
    if (zombie) B.add('fabric', box(0.16, 0.06, 0.16, 0.02), T(0, -0.6, 0, s * 0.3), merge(f.trousers, '#000', 0.2));
    B.done(g);
  }
  // pelvis
  { const B = new Builder(4); B.add('fabric', box(0.33, 0.17, 0.21, 0.07), T(0, 0.02, 0), f.trousers); B.done(hip); }

  // torso per outfit
  {
    const B = new Builder(5);
    const chest = f.top === 'vest' ? shirt : f.color;
    B.add('fabric', box(0.4, 0.54, 0.24, 0.09), T(0, 0.33, 0), chest);
    B.add('fabric', capsule(0.085, 0.3), T(0, 0.55, 0, 0, 0, Math.PI / 2), chest);
    B.add('matt', cyl(0.055, 0.06, 0.1, 10), T(0, 0.64, 0), f.skin, skin);
    if (f.top === 'hoodie') {
      B.add('fabric', sphere(0.15, 12, 8), T(0, 0.6, -0.1, 0, 0, 0, 1.1, 0.6, 0.8), merge(f.color, '#000', 0.08));
      B.add('fabric', box(0.26, 0.13, 0.03, 0.03), T(0, 0.14, 0.12), merge(f.color, '#000', 0.12));
      const cord = new THREE.Color(f.color).getHSL({}).l > 0.6 ? merge(f.color, '#000', 0.3) : '#f3ece0';
      for (const s of [-1, 1]) B.add('fabric', cyl(0.007, 0.007, 0.14, 4), T(s * 0.045, 0.47, 0.125), cord);
      B.add('fabric', box(0.41, 0.05, 0.25, 0.02), T(0, 0.07, 0), merge(f.color, '#000', 0.15));
    } else if (f.top === 'blazer') {
      B.add('fabric', box(0.1, 0.22, 0.02, 0.01), T(0, 0.49, 0.118), shirt);
      for (const s of [-1, 1]) B.add('fabric', box(0.07, 0.24, 0.02, 0.01), T(s * 0.07, 0.47, 0.124, 0, 0, s * 0.32), merge(f.color, '#000', 0.25));
      for (const y of [0.22, 0.32]) B.add('metal', sphere(0.012, 6, 4), T(0.02, y, 0.122), '#d9cfb8');
      B.add('fabric', box(0.42, 0.12, 0.25, 0.03), T(0, 0.04, 0), f.color);
      if (f.scarf) B.add('fabric', box(0.065, 0.03, 0.014, 0.006), T(0.105, 0.43, 0.124, 0, 0, 0.12), f.scarf);
      if (f.tie) {
        const stripes = merge(f.tie, '#000', 0.55);
        B.add('fabric', box(0.036, 0.03, 0.016, 0.006), T(0, 0.575, 0.127), f.tie);
        B.add('fabric', box(0.044, 0.21, 0.012, 0.008), T(0, 0.45, 0.128), f.tie);
        for (const y of [0.53, 0.47, 0.41]) B.add('fabric', box(0.046, 0.009, 0.004), T(0, y, 0.1345, 0, 0, 0.55), stripes);
      }
    } else if (f.top === 'jacket') {
      B.add('metal', box(0.012, 0.5, 0.01), T(0, 0.32, 0.122), '#c9c4b8');
      B.add('fabric', torus(0.08, 0.03, 6, 14), T(0, 0.62, 0, 0, Math.PI / 2), merge(f.color, '#000', 0.12));
      for (const s of [-1, 1]) B.add('fabric', box(0.1, 0.07, 0.02, 0.01), T(s * 0.1, 0.24, 0.12), merge(f.color, '#000', 0.2));
    } else if (f.top === 'sweater') {
      B.add('fabric', box(0.42, 0.06, 0.26, 0.03), T(0, 0.08, 0), merge(f.color, '#000', 0.12));
      B.add('fabric', torus(0.065, 0.02, 6, 14), T(0, 0.61, 0, 0, Math.PI / 2), merge(f.color, '#000', 0.12));
    } else if (f.top === 'vest') {
      B.add('fabric', box(0.42, 0.42, 0.255, 0.08), T(0, 0.28, 0), f.color);
      B.add('fabric', box(0.1, 0.16, 0.02, 0.01), T(0, 0.5, 0.122), shirt);
      for (const y of [0.18, 0.27, 0.36]) B.add('metal', sphere(0.012, 6, 4), T(0, y, 0.13), '#d9cfb8');
    } else if (f.top === 'coat') {
      B.add('fabric', cyl(0.22, 0.26, 0.5, 14), T(0, -0.2, 0), f.color);
      B.add('fabric', torus(0.085, 0.035, 6, 14), T(0, 0.6, 0.01, 0, Math.PI / 2), merge(f.color, '#000', 0.2));
      for (const y of [0.1, 0.24, 0.38]) B.add('metal', sphere(0.014, 6, 4), T(0.05, y, 0.122), '#c9b98a');
      B.add('fabric', box(0.44, 0.06, 0.27, 0.02), T(0, 0.12, 0), merge(f.color, '#000', 0.25));
    } else if (zombie) {
      for (let i = 0; i < 5; i++) B.add('fabric', box(0.07, 0.08, 0.02), T(-0.16 + i * 0.08, 0.05, 0.12, 0, 0, (i % 2 ? 1 : -1) * 0.5), f.color);
      B.add('fabric', box(0.12, 0.1, 0.02), T(0.08, 0.36, 0.122), merge(f.color, '#000', 0.35));
    }
    if (f.extra === 'laptop') B.add('metal', box(0.025, 0.23, 0.32, 0.01), T(0.27, 0.26, 0.02), '#a9adb4');
    if (f.extra === 'folder') B.add('fabric', box(0.03, 0.3, 0.24, 0.01), T(-0.27, 0.26, 0.04), '#6b4a2e');
    B.done(torso);
  }
  // arms
  for (const [g, s] of [[armL, 1], [armR, -1]]) {
    const B = new Builder(6);
    B.add('fabric', capsule(0.062, 0.4), T(0, -0.25, 0), sleeve);
    if (f.top === 'blazer' || f.top === 'coat') B.add('fabric', cyl(0.068, 0.068, 0.05, 10), T(0, -0.46, 0), merge(sleeve, '#000', 0.25));
    B.add('matt', sphere(0.062, 10, 8), T(0, -0.52, 0.01), f.skin, skin);
    const right = s < 0;
    if (right && f.extra === 'phone') B.add('metal', box(0.075, 0.14, 0.012, 0.006), T(0, -0.55, 0.06), '#1a1a1e');
    if (!right && f.extra === 'tablet') B.add('metal', box(0.2, 0.27, 0.012, 0.01), T(0.02, -0.5, 0.08, 0, -0.9), '#26262c');
    if (right && f.extra === 'letter') B.add('fabric', box(0.16, 0.11, 0.008, 0.002), T(0, -0.56, 0.07), '#f3ede2');
    if (right && f.extra === 'calculator') B.add('metal', box(0.09, 0.13, 0.02, 0.008), T(0, -0.55, 0.06), '#3a3f3a');
    if (right && f.extra === 'umbrella') {
      B.add('fabric', cyl(0.035, 0.012, 0.75, 8), T(0, -0.9, 0.05), '#14141a');
      B.add('metal', torus(0.04, 0.009, 5, 10, Math.PI), T(0, -0.54, 0.05, Math.PI / 2), '#2a2220');
    }
    B.done(g);
  }
  // head: face, hair, glasses, beard, headset
  {
    const B = new Builder(7);
    B.add('matt', sphere(0.155, 20, 14), T(0, 0, 0, 0, 0, 0, 0.95, 1.06, 1.0), f.skin, skin);
    for (const s of [-1, 1]) {
      B.add('matt', sphere(0.034, 8, 6), T(s * 0.148, -0.005, -0.005, 0, 0, 0, 0.6, 1, 1), f.skin, skin);
      B.add('matt', sphere(0.019, 8, 6), T(s * 0.055, 0.02, 0.138), zombie ? '#e8f0a0' : '#1b1512');
      B.add('matt', box(0.05, 0.012, 0.012), T(s * 0.056, 0.062, 0.138, 0, 0, s * -0.12), merge(f.hair, '#000', 0.2), { material: HAIR });
    }
    B.add('matt', sphere(0.024, 8, 6), T(0, -0.012, 0.152), merge(f.skin, '#a0522d', 0.12), skin);
    if (f.beard === 'full') B.add('matt', box(0.05, 0.012, 0.01, 0.004), T(0, -0.07, 0.158), merge(f.skin, '#7a2e22', 0.4), skin);
    else B.add('matt', box(0.05, 0.008, 0.01), T(0, -0.07, 0.142), merge(f.skin, '#5a2a1a', 0.45), skin);
    hairstyle(B, f, f.hair);
    if (f.glasses) glasses(B);
    if (f.beard === 'stubble') {
      B.add('matt', chin, T(0, 0, 0.002, 0, 0, 0, 0.97, 1.05, 1.0), merge(f.skin, f.hair, 0.24), skin);
      B.add('matt', box(0.066, 0.011, 0.01, 0.004), T(0, -0.047, 0.147), merge(f.skin, f.hair, 0.34), skin);
    }
    if (f.beard === 'full') {
      B.add('matt', fullBeard, T(0, -0.004, 0.004, 0, 0, 0, 0.98, 1.04, 1.08), f.hair, { material: HAIR });
      B.add('matt', sphere(0.07, 10, 8), T(0, -0.135, 0.085, 0, 0, 0, 1.25, 0.75, 0.95), f.hair, { material: HAIR });
      B.add('matt', box(0.095, 0.02, 0.028, 0.009), T(0, -0.046, 0.147), f.hair, { material: HAIR });
    }
    if (f.extra === 'headset') {
      B.add('metal', torus(0.172, 0.012, 6, 20, Math.PI), T(0, 0.0, 0, 0, 0, 0), '#202024');
      for (const s of [-1, 1]) B.add('metal', cyl(0.045, 0.045, 0.035, 12), T(s * 0.165, -0.01, 0, 0, 0, Math.PI / 2), '#202024');
      B.add('metal', cyl(0.006, 0.006, 0.13, 5), T(0.13, -0.075, 0.08, -0.9, 0, 1.25), '#202024');
      B.add('metal', sphere(0.014, 6, 5), T(0.08, -0.1, 0.14), '#202024');
    }
    B.done(head);
  }

  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  // lantern in the hand
  let lantern = null;
  if (opt.lantern) {
    const B = new Builder(9);
    B.add('metal', torus(0.035, 0.006, 5, 10, Math.PI), T(0, -0.53, 0.03, Math.PI / 2), '#1d1e22');
    B.add('metal', box(0.12, 0.02, 0.12), T(0, -0.6, 0.03), '#1d1e22');
    B.add('glass', box(0.1, 0.14, 0.1), T(0, -0.68, 0.03), '#ffffff', { material: lightMaterial('#ffbe73', 5), uv: 'own' });
    B.add('metal', box(0.12, 0.02, 0.12), T(0, -0.76, 0.03), '#1d1e22');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('metal', box(0.012, 0.15, 0.012), T(sx * 0.055, -0.68, 0.03 + sz * 0.055), '#1d1e22');
    lantern = new THREE.Group();
    B.done(lantern);
    armR.add(lantern);
  }
  // light of the mourners: small sphere above the shoulder
  let sphereLight = null;
  if (opt.accent) {
    sphereLight = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), lightMaterial(opt.accent, 4.5));
    sphereLight.position.set(0.42, 1.95, 0);
    root.add(sphereLight);
  }
  root.userData.fig = { hip, torso, legL, legR, armL, armR, head, lantern, sphereLight, phase: Math.random() * 6, bowing: 0, zombie };
  return root;
}

// movement: walking, standing, bowing, zombie shuffle
export function animate(root, dt, { pace = 0, bow = false, time = 0, wave = false }) {
  const f = root.userData.fig;
  const run = Math.min(1, pace / 4.2);
  f.phase += dt * (f.zombie ? 3.2 : 4.8 + pace * 1.25) * (pace > 0.05 ? 1 : 0);
  const p = f.phase;
  const amp = f.zombie ? 0.32 : 0.62 * run + (pace > 4.5 ? 0.15 : 0);
  const sw = Math.sin(p) * amp;
  f.legL.rotation.x = sw;
  f.legR.rotation.x = -sw;
  f.bowing += ((bow ? 1 : 0) - f.bowing) * (1 - Math.exp(-dt * 5));
  const breathe = Math.sin(time * 1.6 + f.phase) * 0.012;
  if (f.zombie) {
    f.armL.rotation.set(-1.35 + Math.sin(p * 0.5) * 0.08, 0, -0.08);
    f.armR.rotation.set(-1.25 + Math.cos(p * 0.5) * 0.08, 0, 0.08);
    f.torso.rotation.set(0.22, 0, Math.sin(p * 0.5) * 0.12);
    f.head.rotation.set(0.15, 0, 0.35 + Math.sin(time * 0.7) * 0.1);
    root.children[0].position.y = 0.86;
    f.torso.position.y = 0.86 - Math.abs(Math.sin(p)) * 0.03;
  } else {
    f.armL.rotation.x = -sw * 0.8 + (f.lantern ? 0 : 0);
    f.armR.rotation.x = f.lantern ? 0.12 + sw * 0.3 : sw * 0.8;
    f.armL.rotation.z = 0.06; f.armR.rotation.z = -0.06;
    if (wave) { f.armL.rotation.set(-2.6, 0, 0.3 + Math.sin(time * 9) * 0.35); }
    const bob = Math.abs(Math.sin(p)) * 0.035 * run;
    f.hip.position.y = 0.86 + bob;
    f.torso.position.y = 0.86 + bob;
    f.torso.rotation.set(f.bowing * 0.55 + run * 0.06, Math.sin(p) * 0.08 * run, 0);
    f.torso.scale.y = 1 + breathe * (1 - run);
    f.head.rotation.set(f.bowing * 0.35, Math.sin(time * 0.4 + f.phase) * 0.25 * (1 - run) * (1 - f.bowing), 0);
    if (f.bowing > 0.01) {
      f.armL.rotation.x = -0.25 * f.bowing; f.armR.rotation.x = f.lantern ? 0.1 : -0.25 * f.bowing;
      f.armL.rotation.z = 0.2 * f.bowing; f.armR.rotation.z = -0.2 * f.bowing;
    }
  }
  if (f.sphereLight) {
    f.sphereLight.position.y = 1.95 + Math.sin(time * 2 + f.phase) * 0.08;
    f.sphereLight.position.x = 0.42 + Math.cos(time * 1.3 + f.phase) * 0.06;
  }
}
