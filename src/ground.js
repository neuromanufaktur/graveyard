// Ground of the model board: masks for paving, gravel, soil and grass, soft hills in the forest,
// light map of lanterns and windows, fog map (dense in the graveyard, thin in the village).

import * as THREE from 'three';
import { U, withFog } from './build.js';
import { smooth, fbm } from './util.js';
import { inRect } from './layout.js';

const PX = 4; // mask resolution: pixels per metre
const LPX = 3; // light map
const NPX = 0.5; // fog map

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// bilinear read of a field (for hills)
function bilinear(f, x, z, outer) {
  const W = f.cell;
  const gx = (x - (f.x0 ?? 0)) / W - 0.5, gz = (z - (f.z0 ?? 0)) / W - 0.5;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const g = (a, b) => (a < 0 || b < 0 || a >= f.nx || b >= f.nz ? outer : f.d[b * f.nx + a]);
  return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fz) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fz;
}

export function generateHeight(L) {
  const f = L.clearing;
  f.x0 = L.world.x0; f.z0 = L.world.z0;
  const W = L.world;
  return (x, z) => {
    const d = bilinear(f, x, z, 80);
    const rim = Math.min(x - W.x0, W.x1 - x, z - W.z0, W.z1 - z);
    const t = smooth(28, 56, d) * smooth(0, 16, rim);
    if (t <= 0) return 0;
    return t * (0.8 + fbm(x * 0.035 + 3.1, z * 0.035 - 1.7, 3) * 3.4);
  };
}

export function buildGround(L, { doors }) {
  const W = L.world;
  const bw = W.x1 - W.x0, bt = W.z1 - W.z0;
  const mx = Math.round(bw * PX), mz = Math.round(bt * PX);
  const channel = () => {
    const c = canvas(mx, mz), ctx = c.getContext('2d');
    ctx.setTransform(PX, 0, 0, PX, -W.x0 * PX, -W.z0 * PX);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    return { c, ctx };
  };
  const paving = channel(), gravel = channel(), earth = channel(), bare = channel();
  const line = (k, pts, width) => {
    k.ctx.lineWidth = width;
    k.ctx.beginPath();
    pts.forEach((p, i) => (i ? k.ctx.lineTo(p.x ?? p[0], p.z ?? p[1]) : k.ctx.moveTo(p.x ?? p[0], p.z ?? p[1])));
    k.ctx.stroke();
  };
  const circle = (k, x, z, r) => { k.ctx.beginPath(); k.ctx.arc(x, z, r, 0, Math.PI * 2); k.ctx.fill(); };
  const rectF = (k, r, rim = 0) => {
    const e = r.corners;
    k.ctx.save();
    k.ctx.translate(r.cx, r.cz);
    k.ctx.rotate(-r.rot);
    k.ctx.fillRect(-r.hw - rim, -r.hd - rim, (r.hw + rim) * 2, (r.hd + rim) * 2);
    k.ctx.restore();
    void e;
  };

  // streets and squares: cobblestones
  for (const s of L.streets) { line(paving, s.curve, s.width); line(bare, s.curve, s.width + 0.6); }
  circle(paving, L.spot.x, L.spot.z, L.spot.r + 0.4); circle(bare, L.spot.x, L.spot.z, L.spot.r + 0.9);
  circle(paving, L.clientPlaza.x, L.clientPlaza.z, L.clientPlaza.r + 0.3); circle(bare, L.clientPlaza.x, L.clientPlaza.z, L.clientPlaza.r + 0.8);
  // gravel paths
  for (const w of L.paths) { line(gravel, w.points, w.width); line(bare, w.points, w.width + 0.5); }
  // house paths from the door to the street
  for (const t of doors) {
    let x = t.x, z = t.z;
    const pts = [[x, z]];
    for (let i = 0; i < 30; i++) {
      x += t.nx * 0.5; z += t.nz * 0.5;
      pts.push([x, z]);
      if (L.streetsField.get(x, z, 99) < 0.2 || Math.hypot(x - L.spot.x, z - L.spot.z) < L.spot.r) break;
    }
    line(gravel, pts, 1.25);
    line(bare, pts, 1.6);
  }
  // graves and buildings: soil or no grass
  for (const o of L.places) {
    if (!o.foot) continue;
    if (o.type === 'grave') { rectF(earth, o.foot, 0.25); rectF(bare, o.foot, 0.2); }
    else if (o.type === 'monument' || o.type === 'mausoleum') { rectF(gravel, o.foot, 0.6); rectF(bare, o.foot, 0.8); }
    else if (o.type === 'clientSign' || o.type === 'bed') { /* nothing */ }
    else rectF(bare, o.foot, 0.4);
  }
  // pond shore
  earth.ctx.filter = 'blur(3px)';
  circle(earth, L.pond.x, L.pond.z, L.pond.r * 0.98 + 1.4);
  earth.ctx.filter = 'none';
  circle(bare, L.pond.x, L.pond.z, L.pond.r + 0.6);
  // hospice forecourt and veranda
  const h = L.places.find((o) => o.type === 'hospice');
  if (h) { rectF(gravel, { ...h.foot, hw: h.foot.hw * 0.8, hd: h.foot.hd + 4 }, 0); rectF(bare, h.foot, 2); }

  // combine and blur slightly
  const data = new Uint8Array(mx * mz * 4);
  const read = (k) => {
    const c2 = canvas(mx, mz), x2 = c2.getContext('2d');
    x2.filter = 'blur(1.2px)';
    x2.drawImage(k.c, 0, 0);
    return x2.getImageData(0, 0, mx, mz).data;
  };
  const dp = read(paving), dk = read(gravel), de = read(earth), dg = read(bare);
  for (let i = 0; i < mx * mz; i++) {
    data[i * 4] = dp[i * 4];
    data[i * 4 + 1] = dk[i * 4];
    data[i * 4 + 2] = de[i * 4];
    data[i * 4 + 3] = dg[i * 4];
  }
  const mask = new THREE.DataTexture(data, mx, mz, THREE.RGBAFormat);
  mask.flipY = false;
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  mask.needsUpdate = true;
  const ui = (x, z) => {
    const i = Math.floor((x - W.x0) * PX), j = Math.floor((z - W.z0) * PX);
    if (i < 0 || j < 0 || i >= mx || j >= mz) return 'grass';
    const k = (j * mx + i) * 4;
    if (data[k] > 120) return 'paving';
    if (data[k + 1] > 120) return 'gravel';
    if (data[k + 2] > 120) return 'earth';
    return 'grass';
  };

  // ---- fog map: R density, G cold (graveyard) ----
  const nx = Math.round(bw * NPX), nz = Math.round(bt * NPX);
  const nd = new Uint8Array(nx * nz * 4);
  const F = L.graveyard;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = W.x0 + (i + 0.5) / NPX, z = W.z0 + (j + 0.5) / NPX;
    const inGraveyard = smooth(6, -2, Math.max(F.x0 - x, x - F.x1, F.z0 - z, z - F.z1));
    const forest = smooth(6, 30, L.clearing.get(x, z, 60));
    const pond = smooth(16, 6, Math.hypot(x - L.pond.x, z - L.pond.z));
    const spot = smooth(16, 6, Math.hypot(x - L.spot.x, z - L.spot.z));
    let d = 0.3 + forest * 0.4 + inGraveyard * 0.42 + pond * 0.45 - spot * 0.2;
    if (x < -81) d += 0.15;
    const k = (j * nx + i) * 4;
    nd[k] = Math.max(0, Math.min(255, d * 255));
    nd[k + 1] = inGraveyard * 255;
    nd[k + 2] = forest * 255;
    nd[k + 3] = 255;
  }
  const fog = new THREE.DataTexture(nd, nx, nz, THREE.RGBAFormat);
  fog.magFilter = THREE.LinearFilter; fog.minFilter = THREE.LinearFilter;
  fog.needsUpdate = true;
  U.uFogMap.value = fog;

  // ---- geometry with hills at the edge ----
  const height = generateHeight(L);
  const geo = new THREE.PlaneGeometry(bw, bt, Math.round(bw / 1.25), Math.round(bt / 1.25));
  geo.rotateX(-Math.PI / 2);
  geo.translate((W.x0 + W.x1) / 2, 0, (W.z0 + W.z1) / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, height(x, z));
  }
  geo.computeVertexNormals();

  const mat = withFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 }), groundShader, 'ground', false);
  mat.defines = { NB_GROUND: '' };
  mat.userData.mask = mask;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return { mesh, mask, ui, height, maskData: { data, mx, mz, PX } };

  function groundShader(shader) {
    shader.uniforms.uMask = { value: mask };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMask;
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 bHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float bNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += bNoise(p) * a; p = p * 2.03 + 1.7; a *= 0.5; } return s / 0.9375; }
vec3 bVoronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float F1 = 8.0, F2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = bHash2(n + g) * 0.76 + 0.12;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = bHash(n + g + 3.7); } else if (d < F2) { F2 = d; }
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
vec3 bPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 bP = vFogWorld.xz;
  vec2 bUv = (bP - uWorldRect.xy) / uWorldRect.zw;
  vec4 bM = texture2D(uMask, bUv);
  vec4 bK = texture2D(uFogMap, bUv);
  float bPix = length(fwidth(bP));
  float bDetail = 1.0 - smoothstep(0.08, 0.35, bPix);
  float bN = bFbm(bP * 0.07);
  float bF = bNoise(bP * 1.9) * 0.6 + bNoise(bP * 5.3) * 0.4;
  // grass with patches, autumn leaves and a cold graveyard
  vec3 bGrass = mix(vec3(0.075, 0.135, 0.075), vec3(0.15, 0.24, 0.11), bN);
  bGrass = mix(bGrass, vec3(0.2, 0.19, 0.1), smoothstep(0.62, 0.8, bFbm(bP * 0.045 + 9.0)) * 0.7);
  bGrass *= 0.82 + bF * 0.3 * bDetail + 0.09;
  vec3 bFoliageV = bVoronoi(bP * 2.6);
  float bFoliage = step(0.86, bFoliageV.z) * smoothstep(0.24, 0.12, bFoliageV.x) * (0.35 + bK.b * 0.8) * bDetail;
  bGrass = mix(bGrass, mix(vec3(0.32, 0.12, 0.05), vec3(0.42, 0.28, 0.08), fract(bFoliageV.z * 13.0)), bFoliage);
  bGrass = mix(bGrass, vec3(0.13, 0.17, 0.16) * (0.85 + bF * 0.3), bK.g * 0.35);
  float bH = 0.0;
  // soil
  vec3 bEarth = mix(vec3(0.11, 0.08, 0.06), vec3(0.17, 0.13, 0.09), bF) * (0.85 + bN * 0.3);
  float wEarth = smoothstep(0.3, 0.7, bM.b + (bF - 0.5) * 0.35);
  // gravel
  float bK1 = bNoise(bP * 11.0), bK2 = bNoise(bP * 27.0 + 5.0);
  vec3 bGravel = mix(vec3(0.17, 0.155, 0.135), vec3(0.29, 0.27, 0.235), bK1 * 0.6 + bK2 * 0.4) * (0.9 + bN * 0.2);
  float wGravel = smoothstep(0.3, 0.68, bM.g + (bF - 0.5) * 0.3);
  // cobblestones
  vec3 bV = bVoronoi(bP * 4.1);
  float bEdge = bV.y - bV.x;
  float bStone = smoothstep(0.03, 0.2, bEdge) * (1.0 - smoothstep(0.25, 0.62, bV.x) * 0.45);
  vec3 bSound = mix(vec3(0.17, 0.165, 0.155), vec3(0.27, 0.255, 0.235), bV.z);
  bSound = mix(bSound, bSound * vec3(0.95, 0.98, 1.08), step(0.7, fract(bV.z * 7.0)));
  bSound = mix(bSound, bSound * vec3(1.08, 1.0, 0.9), step(0.8, fract(bV.z * 3.0)));
  vec3 bJoint = mix(vec3(0.06, 0.065, 0.055), vec3(0.05, 0.08, 0.045), bF);
  vec3 bPave = mix(bJoint, bSound * (0.86 + bF * 0.22), bStone);
  float wPave = smoothstep(0.32, 0.62, bM.r + (bF - 0.5) * 0.25);
  vec3 bColor = bGrass;
  bColor = mix(bColor, bEarth, wEarth);
  bColor = mix(bColor, bGravel, wGravel);
  bColor = mix(bColor, bPave, wPave);
  bH = mix(bF * 0.15, (bK1 * 0.6 + bK2 * 0.4) * 0.5, wGravel);
  bH = mix(bH, sqrt(bStone) * 0.9 + bF * 0.05, wPave);
  // worn dark patches under trees and on slopes
  bColor *= 1.0 - bK.b * 0.18;
  diffuseColor.rgb = bColor;
  float bRauh = mix(0.95, mix(0.62, 0.9, smoothstep(0.1, 0.0, bEdge)), wPave);
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = bRauh;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float bScale = mix(0.05, 0.11, wPave) * bDetail;
    vec2 dH = vec2(dFdx(bH), dFdy(bH)) * bScale * 10.0;
    normal = bPerturb(-vViewPosition, normal, dH, faceDirection);
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 bL = texture2D(uLightMap, bUv).rgb;
    totalEmissiveRadiance += diffuseColor.rgb * bL * bL * uLightStrength * 1.25;
  }`);
  }
}

// ---------- light map: warm pools under lanterns, windows and candles ----------

export function paintLightMap(L, lights) {
  const W = L.world;
  const bw = W.x1 - W.x0, bt = W.z1 - W.z0;
  const c = canvas(Math.round(bw * LPX), Math.round(bt * LPX));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(LPX, 0, 0, LPX, -W.x0 * LPX, -W.z0 * LPX);
  ctx.globalCompositeOperation = 'lighter';
  const col = new THREE.Color();
  for (const l of lights) {
    if (!l.ground || !l.groundStrength) continue;
    col.set(l.color);
    const s = Math.min(1, l.groundStrength);
    const r = l.ground;
    const g = ctx.createRadialGradient(l.x, l.z, 0, l.x, l.z, r);
    const f = (a) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${(a * s).toFixed(3)})`;
    g.addColorStop(0, f(0.75)); g.addColorStop(0.18, f(0.5)); g.addColorStop(0.45, f(0.2)); g.addColorStop(0.75, f(0.055)); g.addColorStop(1, f(0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(l.x, l.z, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  U.uLightMap.value = t;
  return t;
}

// mask for the grass (A: no grass)
export function grassAllowed(maskData, W, x, z) {
  const { data, mx, mz, PX: p } = maskData;
  const i = Math.floor((x - W.x0) * p), j = Math.floor((z - W.z0) * p);
  if (i < 0 || j < 0 || i >= mx || j >= mz) return false;
  return data[(j * mx + i) * 4 + 3] < 90;
}

export { inRect };
