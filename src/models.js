// Smaller models: graves, graveyard wall and gate, lanterns, benches, fountain, pond, archway,
// monuments, client signs, hospice beds, signposts, offerings and the model board itself.

import * as THREE from 'three';
import { Builder, MAT, T, box, cyl, sphere, cone, torus, form, lightMaterial, withFog, color, merge } from './build.js';
import { rng, hash, formatDate, stoneColor } from './util.js';
import { textTexture } from './textures.js';
import config from './config.js';
import { t } from './i18n.js';

const _c = new THREE.Color();
const MOSS = new THREE.Color('#4c5a36');
const IRON = '#1d1e22';

function mm(F, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return F.clone().multiply(T(x, y, z, ry, rx, rz, sx, sy, sz));
}

// moss at the bottom of the stone, the older the more
function moss(base, old, seed = 1) {
  const b = new THREE.Color(base);
  return (x, y, z) => {
    const n = Math.sin(x * 9.1 + seed) * Math.sin(z * 7.3 + y * 5.1 + seed * 2.1) * 0.5 + 0.5;
    const t = Math.max(0, Math.min(1, (0.55 - y) / 0.55)) * old * (0.55 + n * 0.6);
    return _c.copy(b).lerp(MOSS, Math.min(0.85, t)).clone();
  };
}

// stacked builds: one build per tile so camera and shadows only draw what is near
export class Stack {
  constructor(size = 48) { this.g = size; this.builders = new Map(); }
  build(x, z) {
    const k = Math.floor(x / this.g) + ',' + Math.floor(z / this.g);
    if (!this.builders.has(k)) this.builders.set(k, new Builder(hash(k)));
    return this.builders.get(k);
  }
  done(target) {
    for (const b of this.builders.values()) target.add(b.done());
    this.builders.clear();
  }
}

function light(list, x, y, z, colorHex, strength, range, kind, ground, groundStrength) {
  list.push({ x, y, z, color: colorHex, strength, range, kind, ground, groundStrength, flicker: kind === 'candle' || kind === 'lantern' });
}

// ---------- inscriptions ----------

function matchingScript(ctx, text, font, size, max, min = 18) {
  let g = size;
  ctx.font = font.replace('{g}', g);
  while (ctx.measureText(text).width > max && g > min) { g -= 2; ctx.font = font.replace('{g}', g); }
  return g;
}

function partsName(name) {
  const t = name.split(/(?<=[-.])/);
  if (t.length < 2) return [name];
  let best = [name], bestD = Infinity;
  for (let i = 1; i < t.length; i++) {
    const a = t.slice(0, i).join(''), b = t.slice(i).join('');
    const d = Math.abs(a.length - b.length);
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
}

export function inscriptionTexture(rows, style) {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const gold = style === 'gold';
  const colorT = gold ? '#c9a24f' : style === 'bright' ? '#e8e2d6' : 'rgba(28,28,32,0.86)';
  const edge = gold ? 'rgba(90,60,10,0.7)' : style === 'bright' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.32)';
  let y = rows.top ?? 120;
  const draw = (text, font, g, dy, colorZ = colorT) => {
    ctx.font = font.replace('{g}', g);
    ctx.fillStyle = edge; ctx.fillText(text, W / 2, y + 2.5);
    ctx.fillStyle = colorZ; ctx.fillText(text, W / 2, y);
    y += dy;
  };
  if (rows.cross) {
    ctx.fillStyle = colorT;
    ctx.fillRect(W / 2 - 4, y - 74, 8, 56);
    ctx.fillRect(W / 2 - 20, y - 60, 40, 8);
    y += 10;
  }
  const names = rows.names.length > 1 ? rows.names : partsName(rows.names[0]).length > 1 && rows.names[0].length > 15 ? partsName(rows.names[0]) : rows.names;
  const serif = 'italic 400 {g}px "Instrument Serif", Georgia, serif';
  const g = Math.min(...names.map((n) => matchingScript(ctx, n, serif, names.length > 1 ? 82 : 96, W - 70)));
  for (const n of names) draw(n, serif, g, g * 0.92);
  y += 8;
  ctx.fillStyle = colorT;
  ctx.fillRect(W / 2 - 46, y - 18, 92, 3);
  y += 34;
  for (const z of rows.data) draw(z, '500 {g}px "Geist Mono", ui-monospace, monospace', 34, 46);
  if (rows.extra) { y += 6; draw(rows.extra, 'italic 400 {g}px "Instrument Serif", serif', 38, 40); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function scriptMaterial(tex, gold) {
  return withFog(new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: gold ? 0.32 : 0.8, metalness: gold ? 0.85 : 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 1.3,
  }), null, gold ? 'scriptGold' : 'script');
}

// ---------- graves ----------

function stoneForm(kind, w, h) {
  const s = new THREE.Shape();
  if (kind === 'marble') {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - 0.3);
    s.quadraticCurveTo(w / 2 - 0.01, h - 0.17, w / 2 - 0.13, h - 0.19);
    s.quadraticCurveTo(0.14, h - 0.03, 0, h);
    s.quadraticCurveTo(-0.14, h - 0.03, -w / 2 + 0.13, h - 0.19);
    s.quadraticCurveTo(-w / 2 + 0.01, h - 0.17, -w / 2, h - 0.3);
    s.lineTo(-w / 2, 0);
  } else if (kind === 'family') {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - 0.12); s.lineTo(w / 2 - 0.12, h);
    s.lineTo(-w / 2 + 0.12, h); s.lineTo(-w / 2, h - 0.12); s.lineTo(-w / 2, 0);
  } else {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - 0.2);
    s.quadraticCurveTo(w / 2, h, 0, h); s.quadraticCurveTo(-w / 2, h, -w / 2, h - 0.2); s.lineTo(-w / 2, 0);
  }
  return s;
}

function lifeRows(r) {
  const from = r.first_commit || r.created_at, to = r.last_push;
  return ['* ' + formatDate(from, true), '† ' + formatDate(to, true)];
}

export function buildGrave(o) {
  const r = o.repo, p = o.partner;
  const rnd = rng(o.seed);
  const B = new Builder(o.seed);
  const g = new THREE.Group();
  const lights = [];
  const old = Math.min(1, o.daysDead / 320);
  const fresh = o.daysDead < 70;
  const wide = !!p;
  const iw = wide ? 1.22 : 0.74, id = 1.32;
  const tilt = (rnd() - 0.5) * 0.06 + (rnd() < 0.5 ? -1 : 1) * old * 0.07;
  const offset = (rnd() - 0.5) * 0.08;
  const kind = wide ? 'family' : o.tier;

  // border
  const simple = kind === 'marble' ? '#d9d4ca' : merge('#8f8b83', '#6f6c64', old * 0.6);
  const em = kind === 'marble' ? 'marble' : 'stone';
  B.add(em, box(iw * 2 + 0.24, 0.14, 0.12, 0.02), T(0, 0.07, id + 0.06), moss(simple, old * 0.7, o.seed));
  B.add(em, box(iw * 2 + 0.24, 0.14, 0.12, 0.02), T(0, 0.07, -id - 0.06), moss(simple, old * 0.7, o.seed + 1));
  for (const s of [-1, 1]) B.add(em, box(0.12, 0.14, id * 2, 0.02), T(s * (iw + 0.06), 0.07, 0), moss(simple, old * 0.7, o.seed + 2));

  // inside: soil, ivy or light gravel
  if (kind === 'marble') {
    B.add('earth', box(iw * 2, 0.08, id * 2), T(0, 0.04, 0), '#bdb6aa', { tile: 0.5 });
    B.add('marble', box(iw * 2 - 0.1, 0.07, id * 1.05, 0.02), T(0, 0.115, -id * 0.42), '#ece8e1');
  } else {
    B.add('earth', box(iw * 2, 0.2, id * 2, 0.07), T(0, 0.06, 0), merge('#3d3029', '#33302a', old), { tile: 0.8 });
    const ivy = kind === 'stone' || kind === 'family' || (!fresh && rnd() < 0.6);
    if (ivy) {
      const n = Math.round((wide ? 34 : 22) * (0.6 + old * 0.6));
      for (let i = 0; i < n; i++) {
        const x = (rnd() - 0.5) * iw * 1.9, z = (rnd() - 0.5) * id * 1.9;
        const rr = 0.09 + rnd() * 0.12;
        B.add('leaf', sphere(rr, 8, 6), T(x, 0.15 + rr * 0.25, z, rnd() * 6, 0, 0, 1, 0.55, 1), merge('#27412a', '#3c5a33', rnd()));
      }
    }
    // flowers on well-kept graves
    if (!old || rnd() > old) {
      const tones = ['#c8433a', '#e9e3d6', '#d9718c', '#e8b54a', '#8b5fb8'];
      const sound = tones[Math.floor(rnd() * tones.length)];
      for (let k = 0; k < 2; k++) {
        const bx = (k ? 1 : -1) * iw * 0.45, bz = id * 0.45 + (rnd() - 0.5) * 0.3;
        for (let i = 0; i < 7; i++) B.add('leaf', sphere(0.045, 7, 5), T(bx + (rnd() - 0.5) * 0.2, 0.24 + rnd() * 0.06, bz + (rnd() - 0.5) * 0.2), i % 3 ? sound : '#3c6a3a');
      }
    }
  }

  // headstone
  const F = T(offset, 0, -id + 0.16, 0, -tilt * 0.5, tilt);
  let script = null;
  if (kind === 'cross') {
    const wood = merge('#5a4030', '#3c3530', old);
    B.add('wood', box(0.09, 1.2, 0.07, 0.01), mm(F, 0, 0.6, 0), wood, { tile: 0.4 });
    B.add('wood', box(0.62, 0.09, 0.07, 0.01), mm(F, 0, 0.86, 0), wood, { tile: 0.4 });
    for (const s of [-1, 1]) B.add('wood', box(0.15, 0.025, 0.12), mm(F, s * 0.05, 1.24, 0, 0, 0, s * -0.6), merge(wood, '#000', 0.2), { tile: 0.4 });
    B.add('brass', box(0.28, 0.13, 0.012, 0.004), mm(F, 0, 0.86, 0.04), '#b89a5a');
    script = { w: 0.27, h: 0.27, y: 0.86 - 0.005, z: 0.047, style: 'dark', small: true };
  } else {
    const mass = { stone: [0.64, 0.94, 0.15], marble: [0.72, 1.14, 0.16], family: [1.32, 0.9, 0.17] }[kind];
    const [w, h, d] = mass;
    const plinth = kind === 'marble' ? '#dcd7cf' : merge('#77736c', '#5f5d58', old);
    B.add(kind === 'marble' ? 'marble' : 'stone', box(w + 0.14, 0.14, d + 0.14, 0.02), mm(F, 0, 0.12, 0), moss(plinth, old, o.seed + 4));
    const sf = kind === 'marble' ? '#f1eee8' : merge(stoneColor(r.language), '#5e5c58', old * 0.35);
    B.add(kind === 'marble' ? 'marble' : 'granite', form(stoneForm(kind, w, h), d, 0.018, 'stone:' + kind), mm(F, 0, 0.19, 0), kind === 'marble' ? sf : moss(sf, old, o.seed + 5));
    script = { w: w * 0.86, h: w * 0.86, y: 0.19 + (kind === 'family' ? h * 0.5 : h * 0.47), z: d / 2 + 0.004, style: kind === 'marble' ? 'gold' : 'dark' };
    if (kind === 'marble') {
      // vase with flowers and a cross in the gable
      B.add('marble', cyl(0.07, 0.05, 0.22, 12), mm(F, w / 2 + 0.2, 0.19 + 0.11, 0.05), '#ece8e1');
      for (let i = 0; i < 6; i++) B.add('leaf', sphere(0.05, 7, 5), mm(F, w / 2 + 0.2 + (rnd() - 0.5) * 0.12, 0.36 + rnd() * 0.1, 0.05 + (rnd() - 0.5) * 0.1), i % 2 ? '#e9e3d6' : '#c8433a');
    }
  }

  // grave light: the recently deceased have it on, older ones sometimes
  const burns = fresh || rnd() < 0.35 * (1 - old);
  if (burns || rnd() < 0.5) {
    const lx = (rnd() < 0.5 ? -1 : 1) * (wide ? 0.85 : 0.42), lz = -id + 0.5;
    B.add('glass', cyl(0.055, 0.05, 0.14, 12), T(lx, 0.17 + 0.07, lz), burns ? '#ffffff' : '#552222', { material: burns ? lightMaterial('#ff4a2e', 1.8) : MAT.glass, uv: 'own' });
    B.add('brass', cyl(0.058, 0.058, 0.035, 12), T(lx, 0.17 + 0.155, lz), '#a98a4a');
    if (burns) light(lights, o.x + lx, 0.35, o.z + lz, '#ff7a45', 0.9, 3.2, 'candle', 1.1, 0.22);
  }
  // wreath with a ribbon on fresh graves
  if (o.daysDead < 40) {
    B.add('leaf', torus(0.3, 0.07, 6, 18), T(0, 0.24, 0.2, 0, Math.PI / 2), '#2f4d2c');
    for (let i = 0; i < 8; i++) { const w = (i / 8) * Math.PI * 2; B.add('leaf', sphere(0.045, 6, 5), T(Math.cos(w) * 0.3, 0.29, 0.2 + Math.sin(w) * 0.3), i % 2 ? '#e8e2d6' : '#b8323a'); }
    B.add('fabric', box(0.1, 0.01, 0.42), T(0.08, 0.26, 0.45, 0.3), '#e6dccb');
  }

  B.done(g);
  if (script) {
    const names = p ? [r.name, p.name] : [r.name];
    const data = p ? [`${formatDate(r.first_commit || r.created_at, true).slice(-4)} bis ${formatDate(r.last_push, true).slice(-4)}`] : lifeRows(r);
    const tex = inscriptionTexture({ names, data, cross: !script.small && kind !== 'family', top: script.small ? 210 : kind === 'family' ? 150 : 170 }, script.style);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(script.w, script.h), scriptMaterial(tex, script.style === 'gold'));
    m.applyMatrix4(mm(F, 0, script.y, script.z));
    if (kind === 'family') m.scale.set(1, 0.62, 1);
    g.add(m);
  }
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot || 0;
  return { group: g, lights };
}

// ---------- wall and gate ----------

export function buildWalls(L, stack) {
  const F = L.graveyard;
  for (const m of L.walls) {
    const [ax, az] = m.a, [bx, bz] = m.b;
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bx - ax, bz - az);
    const front = Math.abs(az - F.z1) < 0.01 && Math.abs(bz - F.z1) < 0.01;
    const h = front ? 0.75 : 1.45;
    const n = Math.max(1, Math.round(len / 6.5));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const sl = len / n;
      const B = stack.build(mx, mz);
      const M = T(mx, 0, mz, rot);
      B.add('stone', box(0.5, h, sl, 0.03), mm(M, 0, h / 2, 0), moss('#9b968c', 0.8, k));
      B.add('stone', box(0.66, 0.1, sl + 0.02, 0.02), mm(M, 0, h + 0.05, 0), '#77736b');
      if (front) {
        // iron railings on the low front wall
        for (let s = -sl / 2 + 0.14; s < sl / 2 - 0.05; s += 0.16) {
          B.add('metal', box(0.025, 1.0, 0.025), mm(M, 0, h + 0.1 + 0.5, s), IRON);
          B.add('metal', cone(0.03, 0.09, 4), mm(M, 0, h + 0.1 + 1.04, s), IRON);
        }
        for (const y of [h + 0.24, h + 0.92]) B.add('metal', box(0.03, 0.035, sl), mm(M, 0, y, 0), IRON);
      }
    }
    // pillars at the segment borders
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      if (Math.abs(x) < L.graveyard.gateWidth / 2 + 0.5 && Math.abs(z - F.z1) < 0.5) continue;
      const B = stack.build(x, z);
      const ph = front ? 1.95 : 1.75;
      B.add('stone', box(0.72, ph, 0.72, 0.03), T(x, ph / 2, z, rot), moss('#a29d93', 0.8, k + 7));
      B.add('stone', box(0.86, 0.12, 0.86, 0.03), T(x, ph + 0.06, z, rot), '#77736b');
      B.add('stone', cone(0.46, 0.22, 4), T(x, ph + 0.23, z, rot + Math.PI / 4), '#77736b');
    }
  }
}

export function buildGate(L) {
  const B = new Builder(5);
  const g = new THREE.Group();
  const lights = [];
  const hb = L.graveyard.gateWidth / 2;
  for (const s of [-1, 1]) {
    const x = s * (hb + 0.45);
    B.add('stone', box(0.9, 0.3, 0.9, 0.03), T(x, 0.15, 0), '#8c877e');
    B.add('stone', box(0.8, 2.75, 0.8, 0.03), T(x, 1.55, 0), moss('#a6a196', 0.6, s + 3));
    B.add('stone', box(0.98, 0.16, 0.98, 0.03), T(x, 2.98, 0), '#7f7a72');
    B.add('stone', sphere(0.3, 16, 12), T(x, 3.36, 0), '#a6a196');
    // gate wings: open, swung inwards
    const fl = T(s * hb, 0, 0, s * -1.25);
    const w = hb - 0.04;
    for (let i = 0; i <= 12; i++) {
      const lx = -s * (0.06 + (i / 12) * (w - 0.12));
      const top = 1.9 + Math.sin((i / 12) * Math.PI) * 0.22 * (s > 0 ? 1 : 1);
      B.add('metal', box(0.024, top - 0.1, 0.024), mm(fl, lx, 0.08 + (top - 0.1) / 2, 0), IRON);
      B.add('metal', cone(0.03, 0.1, 4), mm(fl, lx, top + 0.02, 0), IRON);
    }
    for (const y of [0.2, 1.05, 1.75]) B.add('metal', box(w, 0.04, 0.035), mm(fl, -s * w / 2, y, 0), IRON);
    B.add('metal', torus(0.22, 0.016, 6, 20), mm(fl, -s * w / 2, 1.4, 0), IRON);
  }
  // arch with a banner
  B.add('metal', torus(hb + 0.45, 0.04, 6, 32, Math.PI), T(0, 3.05, 0), IRON);
  B.add('metal', torus(hb + 0.2, 0.03, 6, 32, Math.PI), T(0, 3.05, 0), IRON);
  for (let i = 1; i < 12; i++) {
    const w = (i / 12) * Math.PI;
    B.add('metal', box(0.02, 0.26, 0.02), T(Math.cos(w) * (hb + 0.33), 3.05 + Math.sin(w) * (hb + 0.33), 0, 0, 0, w - Math.PI / 2), IRON);
  }
  B.add('metal', box(hb * 2 + 0.6, 0.05, 0.05), T(0, 3.05, 0), IRON);
  B.done(g);
  const tex = textTexture({ width: 1024, height: 128, background: null, color: '#16171b', light: 'rgba(160,170,200,0.35)', rows: [{ text: t('signs.rip'), font: '600 72px Geist, sans-serif', y: 68, gap: '18px', max: 1000 }] });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(hb * 2 + 0.2, 0.32), withFog(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide, alphaTest: 0.3 }), null, 'gateSign'));
  sign.position.set(0, 3.32, 0.02);
  g.add(sign);
  // lanterns on the pillars
  for (const s of [-1, 1]) {
    const x = s * (hb + 0.45);
    const L2 = new Builder(7);
    L2.add('metal', box(0.05, 0.05, 0.3), T(x, 2.45, 0.55), IRON);
    L2.add('glass', box(0.18, 0.26, 0.18), T(x, 2.3, 0.72), '#ffffff', { material: lightMaterial('#ffc27a', 3.2), uv: 'own' });
    L2.add('metal', cone(0.16, 0.12, 4), T(x, 2.5, 0.72, Math.PI / 4), IRON);
    L2.done(g);
    light(lights, L.gate.x + x, 2.3, L.gate.z + 0.8, '#ffc27a', 4.5, 9, 'lantern', 4.5, 0.9);
  }
  g.position.set(L.gate.x, 0, L.gate.z);
  return { group: g, lights };
}

// ---------- lanterns and benches ----------

export function buildLanterns(L, stack) {
  const lights = [];
  const glass = lightMaterial('#ffc58a', 3.4);
  for (const l of L.lanterns) {
    const B = stack.build(l.x, l.z);
    if (l.small) {
      B.add('metal', cyl(0.07, 0.09, 0.9, 8), T(l.x, 0.45, l.z), IRON);
      B.add('glass', cyl(0.1, 0.1, 0.22, 8), T(l.x, 1.0, l.z), '#ffffff', { material: glass, uv: 'own' });
      B.add('metal', cone(0.15, 0.14, 8), T(l.x, 1.18, l.z), IRON);
      for (let k = 0; k < 4; k++) B.add('metal', box(0.015, 0.22, 0.015), T(l.x + Math.cos(k * 1.57) * 0.1, 1.0, l.z + Math.sin(k * 1.57) * 0.1), IRON);
      light(lights, l.x, 1.0, l.z, '#ffc58a', 2.2, 6, 'lantern', 3.2, 0.7);
      continue;
    }
    const rot = hash(l.x.toFixed(1) + l.z.toFixed(1)) % 7;
    B.add('metal', cyl(0.2, 0.24, 0.42, 8), T(l.x, 0.21, l.z, rot), IRON);
    B.add('metal', cyl(0.15, 0.2, 0.12, 8), T(l.x, 0.48, l.z, rot), IRON);
    B.add('metal', cyl(0.045, 0.07, 2.7, 10), T(l.x, 1.85, l.z), IRON);
    for (const y of [0.9, 2.9]) B.add('metal', cyl(0.085, 0.085, 0.06, 10), T(l.x, y, l.z), IRON);
    B.add('metal', cyl(0.12, 0.05, 0.16, 8), T(l.x, 3.24, l.z), IRON);
    // lantern head: four panes, roof with a point
    B.add('glass', cyl(0.2, 0.15, 0.5, 4), T(l.x, 3.58, l.z, Math.PI / 4), '#ffffff', { material: glass, uv: 'own' });
    for (let k = 0; k < 4; k++) {
      const w = k * Math.PI / 2;
      B.add('metal', box(0.025, 0.52, 0.025), T(l.x + Math.cos(w) * 0.165, 3.58, l.z + Math.sin(w) * 0.165, 0, 0, 0), IRON);
    }
    B.add('metal', cyl(0.24, 0.24, 0.04, 4), T(l.x, 3.85, l.z, Math.PI / 4), IRON);
    B.add('metal', cone(0.26, 0.26, 4), T(l.x, 4.0, l.z, Math.PI / 4), IRON);
    B.add('metal', sphere(0.04, 8, 6), T(l.x, 4.16, l.z), IRON);
    light(lights, l.x, 3.55, l.z, '#ffc58a', 9, 15, 'lantern', 6.5, 1.0);
  }
  return lights;
}

export function buildBenches(L, stack) {
  for (const b of L.benches) {
    const B = stack.build(b.x, b.z);
    const M = T(b.x, 0, b.z, b.rot);
    const wood = '#6e5038';
    for (const s of [-1, 1]) {
      B.add('metal', box(0.06, 0.45, 0.06), mm(M, s * 0.82, 0.225, 0.2), IRON);
      B.add('metal', box(0.06, 0.88, 0.06), mm(M, s * 0.82, 0.44, -0.2, 0, -0.12), IRON);
      B.add('metal', box(0.06, 0.05, 0.5), mm(M, s * 0.82, 0.62, 0.02), IRON);
    }
    for (let i = 0; i < 4; i++) B.add('wood', box(1.8, 0.04, 0.1, 0.012), mm(M, 0, 0.46, 0.22 - i * 0.12), wood, { tile: 0.8 });
    for (let i = 0; i < 3; i++) B.add('wood', box(1.8, 0.1, 0.035, 0.012), mm(M, 0, 0.6 + i * 0.14, -0.22 - i * 0.017, 0, -0.12), wood, { tile: 0.8 });
  }
}

// ---------- village fountain ----------

export function buildWell(L) {
  const B = new Builder(3);
  const g = new THREE.Group();
  const lights = [];
  const stone = '#9d978c';
  // octagonal basin of eight slabs
  const R = 3.0, height = 0.62;
  for (let k = 0; k < 8; k++) {
    const w = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const l = 2 * R * Math.tan(Math.PI / 8) + 0.02;
    B.add('stone', box(l, height, 0.32, 0.03), T(Math.sin(w) * (R - 0.16), height / 2, Math.cos(w) * (R - 0.16), w), moss(stone, 0.5, k));
    B.add('stone', box(l + 0.08, 0.1, 0.42, 0.03), T(Math.sin(w) * (R - 0.16), height + 0.05, Math.cos(w) * (R - 0.16), w), '#b1aa9e');
  }
  B.add('stone', cyl(R - 0.25, R - 0.25, 0.1, 8), T(0, 0.05, 0, Math.PI / 8), '#4a4a48');
  // column with bowl and finial
  B.add('stone', cyl(0.55, 0.65, 0.5, 8), T(0, 0.25, 0, Math.PI / 8), stone);
  B.add('stone', cyl(0.22, 0.28, 1.25, 12), T(0, 1.1, 0), stone);
  B.add('stone', cyl(0.85, 0.3, 0.32, 16), T(0, 1.82, 0), '#a8a296');
  B.add('stone', cyl(0.12, 0.16, 0.42, 10), T(0, 2.18, 0), stone);
  B.add('stone', sphere(0.2, 14, 10), T(0, 2.5, 0, 0, 0, 0, 1, 1.35, 1), '#a8a296');
  // gargoyles
  for (let k = 0; k < 4; k++) {
    const w = (k / 4) * Math.PI * 2;
    B.add('brass', cyl(0.035, 0.035, 0.36, 8), T(Math.sin(w) * 0.36, 1.25, Math.cos(w) * 0.36, w, Math.PI / 2 - 0.35), '#a98a4a');
  }
  B.done(g);
  const water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.3, 8), MAT.water);
  water.rotation.x = -Math.PI / 2; water.rotation.z = Math.PI / 8;
  water.position.y = 0.5;
  water.receiveShadow = true;
  g.add(water);
  const bowl = new THREE.Mesh(new THREE.CircleGeometry(0.78, 16), MAT.water);
  bowl.rotation.x = -Math.PI / 2; bowl.position.y = 1.97;
  g.add(bowl);
  // water jets as slightly glowing arcs
  const ray = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.27, 0.36), transparent: true, opacity: 0.4, depthWrite: false });
  for (let k = 0; k < 4; k++) {
    const w = (k / 4) * Math.PI * 2;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(Math.sin(w) * 0.5, 1.2, Math.cos(w) * 0.5),
      new THREE.Vector3(Math.sin(w) * 1.0, 1.25, Math.cos(w) * 1.0),
      new THREE.Vector3(Math.sin(w) * 1.35, 0.5, Math.cos(w) * 1.35));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 5), ray);
    g.add(m);
  }
  g.position.set(L.spot.x, 0, L.spot.z);
  light(lights, 0, 0.6, 0, '#7f9fd6', 0, 0, 'water', 3.6, 0.25);
  return { group: g, lights };
}

// ---------- pond ----------

export function buildPond(L) {
  const t = L.pond;
  const B = new Builder(9);
  const g = new THREE.Group();
  const rnd = rng(99);
  const form = new THREE.Shape();
  const N = 48;
  const rim = (w) => t.r * (0.9 + Math.sin(w * 3 + 1) * 0.06 + Math.sin(w * 5 + 2) * 0.04);
  for (let i = 0; i <= N; i++) {
    const w = (i / N) * Math.PI * 2;
    const r = rim(w);
    if (i === 0) form.moveTo(Math.cos(w) * r, Math.sin(w) * r); else form.lineTo(Math.cos(w) * r, Math.sin(w) * r);
  }
  const water = new THREE.Mesh(new THREE.ShapeGeometry(form, 4), MAT.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(t.x, 0.04, t.z);
  water.receiveShadow = true;
  g.add(water);
  // shore stones, reeds, water lilies
  for (let i = 0; i < 70; i++) {
    const w = rnd() * Math.PI * 2, r = rim(w) + (rnd() - 0.3) * 0.8;
    const x = t.x + Math.cos(w) * r, z = t.z - Math.sin(w) * r;
    if (rnd() < 0.45) {
      const s = 0.18 + rnd() * 0.32;
      B.add('stone', sphere(s, 9, 7), T(x, s * 0.25, z, rnd() * 6, 0, 0, 1.3, 0.6, 1), merge('#7d7a72', '#5c5a54', rnd()));
    } else if (!(w > 4.2 && w < 5.2)) {
      const n = 5 + Math.floor(rnd() * 7);
      for (let k = 0; k < n; k++) {
        const h = 0.7 + rnd() * 0.9;
        const dx = (rnd() - 0.5) * 0.5, dz = (rnd() - 0.5) * 0.5;
        B.add('leaf', cyl(0.008, 0.02, h, 4), T(x + dx, h / 2, z + dz, 0, (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25), merge('#4d5a32', '#7a7445', rnd()));
        if (rnd() < 0.3) B.add('fabric', cyl(0.03, 0.03, 0.16, 6), T(x + dx, h * 0.86, z + dz), '#4a3324');
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const w = rnd() * Math.PI * 2, r = rnd() * t.r * 0.75;
    B.add('leaf', cyl(0.28 + rnd() * 0.18, 0.28, 0.02, 12, false), T(t.x + Math.cos(w) * r, 0.06, t.z + Math.sin(w) * r, rnd() * 6), merge('#2e4a2a', '#45633a', rnd()));
    if (rnd() < 0.35) B.add('leaf', sphere(0.07, 8, 6), T(t.x + Math.cos(w) * r, 0.1, t.z + Math.sin(w) * r), '#e8d6e0');
  }
  // small jetty
  const sx = t.x + 0.5, sz = t.z + t.r * 0.62;
  for (let i = 0; i < 9; i++) B.add('wood', box(1.3, 0.06, 0.22, 0.01), T(sx, 0.3, sz + 1.6 - i * 0.26), '#6b5038', { tile: 0.6 });
  for (const dx of [-0.6, 0.6]) for (const dz of [0.0, 1.6]) B.add('wood', cyl(0.06, 0.06, 0.7, 6), T(sx + dx, 0.12, sz + dz), '#4a3626');
  B.done(g);
  return g;
}

// ---------- archway into the client quarter ----------

export function buildArchway(L) {
  const tb = L.archway;
  const B = new Builder(13);
  const g = new THREE.Group();
  const lights = [];
  const hb = 3.5;
  for (const s of [-1, 1]) {
    B.add('brick', box(1.0, 4.4, 1.0, 0.03), T(s * hb, 2.2, 0), '#ffffff');
    B.add('stone', box(1.16, 0.16, 1.16, 0.03), T(s * hb, 4.48, 0), '#cfc8bb');
    B.add('stone', box(1.1, 0.3, 1.1, 0.03), T(s * hb, 0.15, 0), '#9a958c');
  }
  // arch of clinker segments
  const n = 15, R = hb - 0.5;
  for (let i = 0; i < n; i++) {
    const w0 = (i / n) * Math.PI, w1 = ((i + 1) / n) * Math.PI, w = (w0 + w1) / 2;
    const l = 2 * (R + 0.5) * Math.sin((w1 - w0) / 2) + 0.03;
    B.add('brick', box(l, 0.6, 0.9), T(Math.cos(w) * (R + 0.3), 4.2 + Math.sin(w) * (R + 0.3) * 0.62, 0, 0, 0, w + Math.PI / 2), i % 2 ? '#ffffff' : '#e8d8d0');
  }
  B.add('stone', box(2.6, 0.7, 0.14, 0.03), T(0, 6.45, 0.47), '#e9e4da');
  B.done(g);
  const tex = textTexture({ width: 1024, height: 256, background: '#1f3557', color: '#f1ece2', light: null, frame: '#f1ece2', rows: [{ text: t('places.clients'), font: 'italic 400 132px "Instrument Serif", serif', y: 128, max: 940 }] });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, envMapIntensity: 0.6 }), null, 'enamel'));
  sign.position.set(0, 6.45, 0.545);
  g.add(sign);
  const back = sign.clone();
  back.position.z = 0.4;
  back.rotation.y = Math.PI;
  g.add(back);
  for (const s of [-1, 1]) {
    const L2 = new Builder(14);
    L2.add('metal', box(0.05, 0.05, 0.36), T(s * hb, 3.4, 0.68), IRON);
    L2.add('glass', box(0.2, 0.28, 0.2), T(s * hb, 3.25, 0.86), '#ffffff', { material: lightMaterial('#ffd29a', 3.2), uv: 'own' });
    L2.add('metal', cone(0.17, 0.12, 4), T(s * hb, 3.45, 0.86, Math.PI / 4), IRON);
    L2.done(g);
  }
  g.position.set(tb.x, 0, tb.z);
  g.rotation.y = tb.rot;
  for (const s of [-1, 1]) {
    const c = Math.cos(tb.rot), sn = Math.sin(tb.rot);
    const lx = s * hb, lz = 0.86;
    light(lights, tb.x + lx * c + lz * sn, 3.25, tb.z - lx * sn + lz * c, '#ffd29a', 4.5, 9, 'lantern', 4.4, 0.85);
  }
  return { group: g, lights };
}

// ---------- monument for delivered work ----------

export function buildMonument(o) {
  const B = new Builder(o.seed);
  const g = new THREE.Group();
  const lights = [];
  const stone = '#b9b3a7';
  B.add('stone', box(2.2, 0.2, 2.2, 0.03), T(0, 0.1, 0), '#8f8a80');
  B.add('stone', box(1.6, 0.22, 1.6, 0.03), T(0, 0.31, 0), '#a29c91');
  let plaqueY = 0.9, plaqueZ = 0.5;
  if (o.form === 'obelisk') {
    B.add('stone', box(0.9, 0.9, 0.9, 0.03), T(0, 0.87, 0), stone);
    B.add('stone', cyl(0.22, 0.36, 2.6, 4), T(0, 2.62, 0, Math.PI / 4), stone);
    B.add('stone', cone(0.25, 0.42, 4), T(0, 4.13, 0, Math.PI / 4), '#c9c3b7');
    plaqueZ = 0.455;
  } else if (o.form === 'stele') {
    B.add('stone', box(1.1, 2.1, 0.32, 0.04), T(0, 1.47, 0), stone);
    B.add('stone', box(1.22, 0.12, 0.42, 0.03), T(0, 2.58, 0), '#a29c91');
    plaqueY = 1.55; plaqueZ = 0.165;
  } else {
    B.add('stone', box(0.95, 0.95, 0.95, 0.03), T(0, 0.9, 0), stone);
    B.add('stone', box(1.05, 0.1, 1.05, 0.03), T(0, 1.42, 0), '#a29c91');
    B.add('marble', sphere(0.55, 24, 18), T(0, 2.02, 0), '#d8d2c6');
    plaqueZ = 0.48;
  }
  B.done(g);
  const tex = textTexture({ width: 512, height: 256, background: '#6b5228', color: '#e9d5a1', light: 'rgba(0,0,0,0.45)', frame: '#a88a4c', rows: [
    { text: o.repo.name, font: 'italic 400 60px "Instrument Serif", serif', y: 96, max: 440 },
    { text: t('signs.delivered', { year: formatDate(o.repo.last_push, true).slice(-4) }), font: '500 26px "Geist Mono", monospace', y: 168, max: 440 },
  ] });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.38), withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.75, envMapIntensity: 1.2 }), null, 'bronze'));
  p.position.set(0, plaqueY, plaqueZ);
  g.add(p);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot;
  const s = Math.sin(o.rot), c = Math.cos(o.rot);
  light(lights, o.x + s * 1.4, 0.3, o.z + c * 1.4, '#ffd29a', 0, 0, 'ground', 3.2, 0.45);
  return { group: g, lights };
}

export function buildClientSign(o) {
  const B = new Builder(o.seed);
  const g = new THREE.Group();
  B.add('metal', cyl(0.05, 0.06, 2.6, 8), T(-0.62, 1.3, 0), IRON);
  B.add('metal', cyl(0.05, 0.06, 2.6, 8), T(0.62, 1.3, 0), IRON);
  B.add('metal', sphere(0.07, 8, 6), T(-0.62, 2.64, 0), IRON);
  B.add('metal', sphere(0.07, 8, 6), T(0.62, 2.64, 0), IRON);
  B.done(g);
  const tex = textTexture({ width: 1024, height: 512, background: '#1f3557', color: '#f1ece2', light: null, frame: '#f1ece2', rows: [
    { text: o.client, font: 'italic 400 150px "Instrument Serif", serif', y: 230, max: 900 },
    { text: o.repos.length === 1 ? '1 Projekt' : o.repos.length + ' Projekte', font: '500 52px "Geist Mono", monospace', y: 380, max: 900 },
  ] });
  const m = withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, envMapIntensity: 0.7 }), null, 'enamel');
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.68, 0.03), [MAT.metal, MAT.metal, MAT.metal, MAT.metal, m, m]);
  panel.position.y = 2.1;
  panel.castShadow = true;
  g.add(panel);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot;
  return { group: g, lights: [] };
}

// ---------- hospice bed with a chart ----------

export function buildBed(o) {
  const r = o.repo;
  const B = new Builder(o.seed);
  const g = new THREE.Group();
  const lights = [];
  const rnd = rng(o.seed);
  const rack = '#e3ddd2';
  for (const sx of [-0.48, 0.48]) for (const sz of [-1.0, 1.0]) B.add('metal', cyl(0.025, 0.025, 0.55, 6), T(sx, 0.36, sz), rack);
  B.add('metal', box(1.0, 0.05, 2.06), T(0, 0.4, 0), rack);
  // head and foot boards of tubing
  for (const sz of [-1.0, 1.0]) {
    const high = sz < 0 ? 1.05 : 0.8;
    for (const sx of [-0.48, 0.48]) B.add('metal', cyl(0.025, 0.025, high, 6), T(sx, high / 2 + 0.1, sz), rack);
    B.add('metal', cyl(0.022, 0.022, 0.96, 6), T(0, high + 0.08, sz, 0, 0, Math.PI / 2), rack);
    for (let i = -2; i <= 2; i++) B.add('metal', cyl(0.012, 0.012, high - 0.45, 5), T(i * 0.16, 0.45 + (high - 0.45) / 2, sz), rack);
  }
  B.add('fabric', box(0.92, 0.16, 1.96, 0.05), T(0, 0.5, 0), '#efece6');
  B.add('fabric', box(0.62, 0.13, 0.36, 0.06), T(0, 0.64, -0.75), '#f6f4f0');
  // blanket with the bulge of the patient
  const ceiling = ['#b9c7d6', '#c9b9a7', '#b7c4ad'][Math.floor(rnd() * 3)];
  B.add('fabric', box(0.96, 0.08, 1.4, 0.04), T(0, 0.61, 0.3), ceiling);
  B.add('fabric', sphere(0.3, 14, 10), T(0, 0.62, 0.05, 0, 0, 0, 1.15, 0.5, 2.3), ceiling);
  B.add('fabric', sphere(0.17, 14, 10), T(0, 0.78, -0.62), '#e9d2bf');
  B.add('fabric', sphere(0.17, 12, 8), T(0, 0.86, -0.66, 0, 0, 0, 1.05, 0.6, 1.0), '#3b2d26');
  // drip stand
  B.add('metal', cyl(0.015, 0.015, 1.9, 6), T(0.75, 0.95, -0.7), '#c9ccd2');
  B.add('metal', cyl(0.18, 0.18, 0.02, 10), T(0.75, 0.02, -0.7), '#c9ccd2');
  B.add('glass', box(0.14, 0.24, 0.05, 0.02), T(0.75, 1.68, -0.62), '#d7e9f0', { material: MAT.glass, uv: 'own' });
  // bedside table with a candle
  B.add('wood', box(0.45, 0.55, 0.45, 0.02), T(-0.85, 0.275, -0.75), '#7a5a40');
  B.add('wax', cyl(0.035, 0.035, 0.16, 8), T(-0.85, 0.63, -0.75), '#efe6d2');
  B.add('flame', cone(0.018, 0.06, 6), T(-0.85, 0.74, -0.75), '#ffffff');
  B.done(g);
  // chart at the foot end
  const days = r.hospice_days_left;
  const tex = textTexture({ width: 512, height: 640, background: '#f4efe4', color: '#2a2a2e', light: null, frame: '#c9c1b2', rows: [
    { text: t('signs.chart'), font: '600 34px Geist, sans-serif', y: 70, gap: '4px' },
    { text: r.name, font: 'italic 400 64px "Instrument Serif", serif', y: 190, max: 460 },
    { text: t('signs.left'), font: '500 32px "Geist Mono", monospace', y: 320 },
    { text: String(days ?? '?'), font: '400 170px "Instrument Serif", serif', y: 450, color: '#b8323a' },
    { text: t('signs.days', { n: days }), font: '500 32px "Geist Mono", monospace', y: 560 },
  ] });
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.45), withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), null, 'paper'));
  leaf.position.set(0, 0.62, 1.05);
  leaf.rotation.x = -0.12;
  g.add(leaf);
  g.position.set(o.x, 0.18, o.z);
  g.rotation.y = o.rot;
  const s = Math.sin(o.rot), c = Math.cos(o.rot);
  light(lights, o.x - 0.85 * c - 0.75 * s, 0.9, o.z + 0.85 * s - 0.75 * c, '#ffb35c', 0.8, 3, 'candle', 1.6, 0.4);
  return { group: g, lights };
}

// ---------- signpost on the square ----------

export function buildSignpost(x, z, targets) {
  const B = new Builder(21);
  const g = new THREE.Group();
  B.add('wood', cyl(0.07, 0.08, 2.8, 8), T(0, 1.4, 0), '#5a4030');
  B.add('wood', cone(0.1, 0.14, 8), T(0, 2.87, 0), '#5a4030');
  B.done(g);
  targets.forEach((zi, i) => {
    const w = Math.atan2(zi.x - x, zi.z - z);
    const tex = textTexture({ width: 512, height: 112, background: '#ebe2cf', color: '#2b2622', light: null, rows: [{ text: zi.name, font: '500 52px Geist, sans-serif', y: 60, max: 420 }] });
    const m = withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), null, 'sign');
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.27, 0.04), [MAT.wood, MAT.wood, MAT.wood, MAT.wood, m, m]);
    const h = new THREE.Group();
    plank.position.x = 0.62 + 0.08;
    h.add(plank);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.18, 3), MAT.wood);
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 1.42;
    h.add(tip);
    h.position.y = 2.45 - i * 0.36;
    h.rotation.y = w - Math.PI / 2;
    plank.castShadow = true;
    g.add(h);
  });
  g.position.set(x, 0, z);
  return g;
}

// ---------- offerings: flowers and candles ----------

export function buildOffering(kind, seed) {
  const B = new Builder(seed);
  const g = new THREE.Group();
  const rnd = rng(seed);
  if (kind === 'candle') {
    B.add('glass', cyl(0.05, 0.045, 0.13, 12), T(0, 0.065, 0), '#ffffff', { material: lightMaterial('#ff4a2e', 1.9), uv: 'own' });
    B.add('brass', cyl(0.052, 0.052, 0.03, 12), T(0, 0.145, 0), '#a98a4a');
  } else {
    const tones = ['#c8433a', '#e9e3d6', '#d9718c', '#e8b54a', '#8b5fb8', '#f08a5d'];
    const sound = tones[Math.floor(rnd() * tones.length)];
    for (let i = 0; i < 7; i++) {
      const w = (i / 7) * Math.PI * 2, rr = i ? 0.06 : 0;
      B.add('leaf', cyl(0.006, 0.006, 0.32, 4), T(Math.cos(w) * rr * 0.5, 0.16, Math.sin(w) * rr * 0.5, 0, Math.sin(w) * 0.2, Math.cos(w) * 0.2), '#3c6a3a');
      B.add('leaf', sphere(0.045, 8, 6), T(Math.cos(w) * rr, 0.33 + (i ? 0 : 0.03), Math.sin(w) * rr), sound);
    }
    B.add('fabric', cyl(0.035, 0.05, 0.08, 8), T(0, 0.09, 0), '#e6dccb');
  }
  B.done(g);
  return g;
}

// ---------- model board: soil cut and walnut plinth with a brass plate ----------

function cutTexture() {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#2b3b2a'); gr.addColorStop(0.06, '#3a2c22'); gr.addColorStop(0.45, '#2c221c'); gr.addColorStop(0.75, '#3a3530'); gr.addColorStop(1, '#2a2622');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  const R = rng(5);
  for (let i = 0; i < 900; i++) {
    const y = 20 + R() * (H - 24), x = R() * W, r = 1 + R() * (y > H * 0.55 ? 7 : 3);
    const v = 70 + R() * 60;
    ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},${0.25 + R() * 0.4})`;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r, R() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,14,10,0.5)';
  for (let i = 0; i < 120; i++) {
    const x = R() * W; ctx.lineWidth = 0.6 + R();
    ctx.beginPath(); ctx.moveTo(x, 10); ctx.bezierCurveTo(x + R() * 20 - 10, 30, x + R() * 30 - 15, 50, x + R() * 20 - 10, 40 + R() * 60); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildPlinth(L, as_of) {
  const W = L.world;
  const bw = W.x1 - W.x0, bt = W.z1 - W.z0, cx = (W.x0 + W.x1) / 2, cz = (W.z0 + W.z1) / 2;
  const g = new THREE.Group();
  const deep = 2.6;
  const tex = cutTexture();
  const mCut = withFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), null, 'cut');
  const pages = [
    { w: bw, x: cx, z: W.z1, ry: 0 }, { w: bw, x: cx, z: W.z0, ry: Math.PI },
    { w: bt, x: W.x1, z: cz, ry: Math.PI / 2 }, { w: bt, x: W.x0, z: cz, ry: -Math.PI / 2 },
  ];
  for (const s of pages) {
    const t = tex.clone();
    t.repeat.set(s.w / 40, 1);
    t.needsUpdate = true;
    const m = mCut.clone();
    m.map = t;
    m.onBeforeCompile = mCut.onBeforeCompile;
    m.customProgramCacheKey = mCut.customProgramCacheKey;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s.w, deep), m);
    p.position.set(s.x, -deep / 2, s.z);
    p.rotation.y = s.ry;
    g.add(p);
  }
  const wood = withFog(new THREE.MeshStandardMaterial({ color: '#3a2418', map: MAT.plinth.map, roughness: 0.42, envMapIntensity: 0.5 }), null, 'walnut');
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(bw + 4, 3.2, bt + 4), wood);
  plinth.position.set(cx, -deep - 1.6, cz);
  plinth.receiveShadow = true;
  g.add(plinth);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(bw + 5, 0.5, bt + 5), wood);
  edge.position.set(cx, -deep - 3.2 - 0.25, cz);
  g.add(edge);
  // brass plate at the front
  const tx = textTexture({ width: 2048, height: 512, background: '#b8955a', color: '#2a2116', light: 'rgba(255,240,200,0.45)', frame: '#7a5f33', rows: [
    { text: config.brand, font: '600 150px Outfit, Geist, sans-serif', y: 190, gap: '2px', max: 1900 },
    { text: config.title, font: 'italic 400 130px "Instrument Serif", serif', y: 330, max: 1900 },
    { text: t('signs.asOf', { date: formatDate(as_of, true) }), font: '500 64px "Geist Mono", monospace', y: 440, max: 1900 },
  ] });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), new THREE.MeshStandardMaterial({ map: tx, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.4 }));
  sign.position.set(cx, -deep - 1.6, W.z1 + 2.02);
  g.add(sign);
  return g;
}
