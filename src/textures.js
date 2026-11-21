// Procedural textures: colour plus normal map from a height field.
// The colour textures are almost neutral on purpose, the tint comes from the vertex colours.

import * as THREE from 'three';
import { rng, noise, fbm } from './util.js';

const N = 512;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function asTexture(c, color) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function normals(h, w, hh, strength) {
  const c = canvas(w, hh), ctx = c.getContext('2d'), img = ctx.createImageData(w, hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const l = h[y * w + ((x - 1 + w) % w)], r = h[y * w + ((x + 1) % w)];
    const u = h[((y - 1 + hh) % hh) * w + x], d = h[((y + 1) % hh) * w + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const k = (y * w + x) * 4;
    img.data[k] = (nx / len * 0.5 + 0.5) * 255;
    img.data[k + 1] = (ny / len * 0.5 + 0.5) * 255;
    img.data[k + 2] = (nz / len * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return asTexture(c, false);
}

// tileable noise
function tileNoise(x, y, period, oct) {
  const fx = x / period, fy = y / period;
  const a = fbm(x, y, oct), b = fbm(x - period, y, oct), c = fbm(x, y - period, oct), d = fbm(x - period, y - period, oct);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

function noiseField(w, h, scale) {
  const oct = scale <= 6 ? 2 : scale <= 20 ? 3 : 4;
  const f = new Float32Array(w * h);
  const p = w / scale;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = tileNoise(x / scale, y / scale, p, oct);
  return f;
}

function colorImage(w, h, fn) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y);
    const k = (y * w + x) * 4;
    img.data[k] = Math.max(0, Math.min(255, r * 255));
    img.data[k + 1] = Math.max(0, Math.min(255, g * 255));
    img.data[k + 2] = Math.max(0, Math.min(255, b * 255));
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- plaster ----------
function plaster() {
  const coarse = noiseField(N, N, 64), fine = noiseField(N, N, 6);
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = coarse[i] * 0.6 + fine[i] * 0.5;
  const color = colorImage(N, N, (x, y) => {
    const v = 0.86 + (coarse[y * N + x] - 0.5) * 0.18 + (fine[y * N + x] - 0.5) * 0.08;
    return [v, v * 0.995, v * 0.985];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 3.2) };
}

// ---------- roof tiles (beaver tail, rounded ends) ----------
function rooftile() {
  const R = rng(11);
  const courses = 8, perRow = 6;
  const h = new Float32Array(N * N);
  const sound = new Float32Array(courses * perRow * 2 + 4).map(() => 0.82 + R() * 0.3);
  const fine = noiseField(N, N, 5);
  const rh = N / courses, tw = N / perRow;
  const color = colorImage(N, N, (x, y) => {
    const r = Math.floor(y / rh), fy = (y % rh) / rh;
    const offset = (r % 2) * tw * 0.5;
    const xx = (x + offset) % N;
    const t = Math.floor(xx / tw), fx = (xx % tw) / tw;
    // rounded lower end: distance to the centre of the tile
    const round = Math.sqrt(Math.max(0, 1 - Math.pow((fx - 0.5) * 2, 2)));
    const edge = fy > 0.72 + round * 0.26 ? 1 : 0; // shadow under the tile
    const bulge = Math.sin(fx * Math.PI);
    let v = 0.35 + 0.55 * fy + bulge * 0.18;
    if (edge) v = 0.12;
    if (fx < 0.04 || fx > 0.96) v *= 0.55;
    h[y * N + x] = v + fine[y * N + x] * 0.08;
    const k = sound[(r * perRow + t) % sound.length];
    const l = (0.72 + 0.28 * fy) * k * (edge ? 0.45 : 1) * (0.92 + fine[y * N + x] * 0.14);
    return [l, l * 0.97, l * 0.95];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 6) };
}

// ---------- slate ----------
function slate() {
  const R = rng(23);
  const courses = 10;
  const rh = N / courses;
  const h = new Float32Array(N * N);
  const fine = noiseField(N, N, 4);
  const widths = [];
  for (let r = 0; r < courses; r++) {
    const b = []; let x = R() * 40;
    while (x < N + 80) { const w = 34 + R() * 34; b.push([x, w, 0.8 + R() * 0.35]); x += w; }
    widths.push(b);
  }
  const color = colorImage(N, N, (x, y) => {
    const r = Math.floor(y / rh), fy = (y % rh) / rh;
    let st = null;
    for (const s of widths[r]) { const xx = ((x - s[0]) % N + N) % N; if (xx < s[1]) { st = [xx / s[1], s[2]]; break; } }
    if (!st) st = [0.5, 1];
    const joint = st[0] < 0.035 || st[0] > 0.965 || fy > 0.9;
    let v = 0.4 + fy * 0.5;
    if (joint) v = 0.15;
    h[y * N + x] = v + fine[y * N + x] * 0.12;
    const l = (joint ? 0.35 : (0.7 + 0.3 * fy)) * st[1] * (0.9 + fine[y * N + x] * 0.2);
    return [l * 0.92, l * 0.97, l];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 5) };
}

// ---------- brick (clinker) ----------
function brick() {
  const R = rng(37);
  const courses = 16, perRow = 4;
  const rh = N / courses, bw = N / perRow;
  const fine = noiseField(N, N, 3), coarse = noiseField(N, N, 40);
  const tones = Array.from({ length: courses * perRow * 2 }, () => [0.62 + R() * 0.2, 0.3 + R() * 0.1, 0.24 + R() * 0.08, R()]);
  const h = new Float32Array(N * N);
  const color = colorImage(N, N, (x, y) => {
    const r = Math.floor(y / rh), fy = (y % rh) / rh;
    const xx = (x + (r % 2) * bw * 0.5) % N;
    const t = Math.floor(xx / bw), fx = (xx % bw) / bw;
    const joint = fy < 0.12 || fx < 0.025;
    const k = tones[(r * perRow + t) % tones.length];
    h[y * N + x] = joint ? 0.1 : 0.7 + fine[y * N + x] * 0.25;
    if (joint) { const v = 0.55 + fine[y * N + x] * 0.1; return [v, v * 0.97, v * 0.92]; }
    const dark = k[3] < 0.12 ? 0.6 : 1;
    const f = (0.85 + fine[y * N + x] * 0.25 + (coarse[y * N + x] - 0.5) * 0.15) * dark;
    return [k[0] * f, k[1] * f, k[2] * f];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 5) };
}

// ---------- rubble stone (wall, chapel, plinth) ----------
function rubble() {
  const R = rng(51);
  const fine = noiseField(N, N, 4), coarse = noiseField(N, N, 30);
  const h = new Float32Array(N * N);
  const courses = [];
  let y = 0;
  while (y < N) { const hh = 44 + R() * 30; courses.push([y, Math.min(hh, N - y)]); y += hh; }
  const stones = courses.map(() => { const b = []; let x = R() * 30; while (x < N + 120) { const w = 60 + R() * 70; b.push([x, w, 0.78 + R() * 0.3]); x += w; } return b; });
  const color = colorImage(N, N, (x, y) => {
    let ri = 0; while (ri < courses.length - 1 && y >= courses[ri][0] + courses[ri][1]) ri++;
    const [y0, hh] = courses[ri];
    const fy = (y - y0) / hh;
    let st = null;
    for (const s of stones[ri]) { const xx = ((x - s[0]) % N + N) % N; if (xx < s[1]) { st = [xx / s[1], s[2]]; break; } }
    if (!st) st = [0.5, 1];
    const rx = Math.min(st[0], 1 - st[0]) * 2, ry = Math.min(fy, 1 - fy) * 2;
    const rim = Math.min(rx * 3.2, ry * 2.6, 1);
    const joint = rim < 0.12;
    h[y * N + x] = joint ? 0.05 : Math.sqrt(rim) * 0.6 + fine[y * N + x] * 0.3 + coarse[y * N + x] * 0.2;
    if (joint) { const v = 0.32 + fine[y * N + x] * 0.08; return [v, v, v * 0.98]; }
    const v = st[1] * (0.74 + coarse[y * N + x] * 0.25 + fine[y * N + x] * 0.12);
    return [v, v * 0.985, v * 0.96];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 4.5) };
}

// ---------- wood (planks) ----------
function wood() {
  const R = rng(61);
  const boards = 8, bw = N / boards;
  const tones = Array.from({ length: boards }, () => 0.78 + R() * 0.3);
  const h = new Float32Array(N * N);
  const fine = noiseField(N, N, 3);
  const color = colorImage(N, N, (x, y) => {
    const b = Math.floor(x / bw), fx = (x % bw) / bw;
    const veining = Math.sin((y / N) * Math.PI * 2 * 3 + noise(x * 0.08, y * 0.004 + b * 7) * 6) * 0.5 + 0.5;
    const joint = fx < 0.04 || fx > 0.97;
    h[y * N + x] = joint ? 0.1 : 0.6 + veining * 0.15 + fine[y * N + x] * 0.1;
    const v = joint ? 0.35 : tones[b] * (0.82 + veining * 0.14 + fine[y * N + x] * 0.08);
    return [v, v * 0.96, v * 0.92];
  });
  return { map: asTexture(color, true), normal: normals(h, N, N, 3) };
}

// ---------- granite (headstones) ----------
function granite() {
  const R = rng(71);
  const fine = noiseField(N, N, 2.2), mid = noiseField(N, N, 9), coarse = noiseField(N, N, 48);
  const h = new Float32Array(N * N);
  const color = colorImage(N, N, (x, y) => {
    const s = fine[y * N + x];
    const grain = s > 0.66 ? 1.16 : s < 0.32 ? 0.8 : 1;
    const v = (0.84 + (mid[y * N + x] - 0.5) * 0.12 + (coarse[y * N + x] - 0.5) * 0.14) * grain;
    h[y * N + x] = mid[y * N + x] * 0.4 + coarse[y * N + x] * 0.6;
    return [v, v, v * 1.01];
  });
  void R;
  return { map: asTexture(color, true), normal: normals(h, N, N, 1.4) };
}

// ---------- marble ----------
function marble() {
  const coarse = noiseField(N, N, 70), mid = noiseField(N, N, 18);
  const color = colorImage(N, N, (x, y) => {
    const t = (x + y * 0.6) / N * 6 + coarse[y * N + x] * 7 + mid[y * N + x] * 2;
    const vein = Math.pow(Math.abs(Math.sin(t * Math.PI)), 18);
    const v = 0.95 - vein * 0.32 - (1 - mid[y * N + x]) * 0.04;
    return [v, v * 0.995, v * 0.985];
  });
  return { map: asTexture(color, true) };
}

// ---------- water: waves as a normal map ----------
function waves() {
  const n = 256;
  const f = noiseField(n, n, 18), g = noiseField(n, n, 7);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = f[i] * 0.7 + g[i] * 0.3;
  return normals(h, n, n, 2.2);
}

// round soft light for sparks, smoke, light cones
function soft() {
  const c = canvas(128, 128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function smoke() {
  const n = 128, c = canvas(n, n), ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - n / 2, y - n / 2) / (n / 2);
    const r = fbm(x / 18, y / 18, 4);
    const a = Math.max(0, 1 - d * (1.1 - r * 0.5)) ** 1.6 * (0.55 + r * 0.6);
    const k = (y * n + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function generateTextures() {
  return {
    plaster: plaster(), rooftile: rooftile(), slate: slate(), brick: brick(), rubble: rubble(),
    wood: wood(), granite: granite(), marble: marble(), waves: waves(), soft: soft(), smoke: smoke(),
  };
}

// text on a surface: grave inscription, signs, plaque
export function textTexture({ rows, width = 512, height = 512, background = null, color = '#2a2a2e', light = 'rgba(255,255,255,0.35)', frame = null }) {
  const c = canvas(width, height), ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 6; ctx.strokeRect(14, 14, width - 28, height - 28); }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const z of rows) {
    ctx.font = z.font;
    if (z.gap) ctx.letterSpacing = z.gap;
    else ctx.letterSpacing = '0px';
    let text = z.text;
    const max = z.max || width - 60;
    while (ctx.measureText(text).width > max && text.length > 4) text = text.slice(0, -2) + '…';
    if (light) { ctx.fillStyle = light; ctx.fillText(text, width / 2, z.y + 2); }
    ctx.fillStyle = z.color || color;
    ctx.fillText(text, width / 2, z.y);
    if (z.line) { ctx.fillRect(width / 2 - z.line / 2, z.y + 22, z.line, 3); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
