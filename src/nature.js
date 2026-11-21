// Trees like scale-model trees (foam flakes on a wire frame), instanced in tiles,
// plus will-o'-the-wisps over graveyard and pond and smoke from the chimneys.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, U, withFog } from './build.js';
import { rng, noise } from './util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

// part with colour and crown share
function part(geo, m, colorFn, crown) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const n of Object.keys(g.attributes)) if (!['position', 'normal'].includes(n)) g.deleteAttribute(n);
  g.applyMatrix4(m);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), kr = new Float32Array(n), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = colorFn(p.getX(i), p.getY(i), p.getZ(i), g.attributes.normal.getY(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    kr[i] = crown;
    uv[i * 2] = p.getX(i) * 0.9 + p.getZ(i) * 0.4; uv[i * 2 + 1] = p.getY(i) * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(kr, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function M(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// clump: icosahedron with noise, like torn foam
function lump(r, seed, detail = 2, rough = 0.28) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i);
    const n = _p.clone().normalize();
    const v = noise(n.x * 2.3 + seed, n.y * 2.3 + n.z * 1.7 + seed * 0.3) * 0.65 + noise(n.x * 6.1 - seed, n.z * 6.1 + n.y * 4.3) * 0.35;
    _p.multiplyScalar(1 + (v - 0.5) * rough * 2);
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

function stem(r0, r1, h, seg = 7) {
  return new THREE.CylinderGeometry(r1, r0, h, seg, 3);
}

const BARK = new THREE.Color('#2f2621');

// colour gradient in the crown: dark at the bottom and inside, lighter on top
function crownsColor(base, bright, bottom, top) {
  const b = new THREE.Color(base), h = new THREE.Color(bright);
  return (x, y, z, ny) => {
    const t = Math.max(0, Math.min(1, (y - bottom) / (top - bottom)));
    const f = 0.42 + t * 0.5 + Math.max(0, ny) * 0.18;
    return _c.copy(b).lerp(h, t * 0.7 + Math.max(0, ny) * 0.2).multiplyScalar(f).clone();
  };
}

function foliage(seed) {
  const R = rng(seed);
  const parts = [];
  const h = 2.3 + R() * 0.8;
  parts.push(part(stem(0.2, 0.12, h + 0.6), M(0, (h + 0.6) / 2, 0), () => BARK, 0));
  for (let i = 0; i < 3; i++) {
    const w = R() * Math.PI * 2;
    parts.push(part(stem(0.07, 0.04, 1.3), M(Math.cos(w) * 0.35, h - 0.1, Math.sin(w) * 0.35, w, 0, 0.75 + R() * 0.3), () => BARK, 0.3));
  }
  const n = 6 + Math.floor(R() * 4);
  const ck = crownsColor('#26412a', '#4a6b3a', h - 1, h + 3.6);
  for (let i = 0; i < n; i++) {
    const w = (i / n) * Math.PI * 2 + R() * 0.7;
    const rr = i === 0 ? 0 : 0.7 + R() * 0.8;
    const y = h + 0.8 + (i === 0 ? 1.4 : R() * 1.8);
    const r = 0.95 + R() * 0.65;
    parts.push(part(lump(r, seed + i * 3.1, 2), M(Math.cos(w) * rr, y, Math.sin(w) * rr, R() * 6, 0, 0, 1, 0.82, 1), ck, 1));
  }
  return mergeGeometries(parts);
}

function fir(seed) {
  const R = rng(seed);
  const parts = [];
  const storeys = 5 + Math.floor(R() * 2);
  const high = 6.5 + R() * 2;
  parts.push(part(stem(0.16, 0.08, high * 0.5), M(0, high * 0.25, 0), () => BARK, 0));
  const ck = crownsColor('#17302a', '#2f5244', 0.6, high);
  for (let i = 0; i < storeys; i++) {
    const t = i / (storeys - 1);
    const r = 1.75 * (1 - t * 0.78) + R() * 0.15;
    const h = 2.0 * (1 - t * 0.45);
    const y = 0.9 + t * (high - 2.2);
    const g = new THREE.ConeGeometry(r, h, 11, 2, true);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      if (yy < -h / 2 + 0.01) {
        const a = Math.atan2(p.getZ(k), p.getX(k));
        const f = 1 + Math.sin(a * 11 + seed) * 0.1 + (R() - 0.5) * 0.12;
        p.setX(k, p.getX(k) * f); p.setZ(k, p.getZ(k) * f); p.setY(k, yy - 0.18 * f);
      }
    }
    g.computeVertexNormals();
    parts.push(part(g, M(0, y + h / 2, 0, R() * 6), ck, Math.min(1, 0.3 + t)));
    // close the underside
    const ground = new THREE.CircleGeometry(r * 0.96, 11);
    parts.push(part(ground, M(0, y + 0.02, 0, 0, Math.PI / 2), () => new THREE.Color('#0e1a16'), Math.min(1, 0.3 + t)));
  }
  return mergeGeometries(parts);
}

function cypress(seed) {
  const R = rng(seed);
  const parts = [];
  parts.push(part(stem(0.1, 0.07, 1), M(0, 0.5, 0), () => BARK, 0));
  const ck = crownsColor('#152a22', '#2c4a3b', 0.3, 6.5);
  for (let i = 0; i < 4; i++) {
    const y = 1.3 + i * 1.25;
    const r = 0.62 - i * 0.09;
    parts.push(part(lump(r, seed + i, 2, 0.18), M((R() - 0.5) * 0.1, y + r, (R() - 0.5) * 0.1, R() * 6, 0, 0, 1, 2.0, 1), ck, 0.4 + i * 0.2));
  }
  return mergeGeometries(parts);
}

function bare(seed) {
  const R = rng(seed);
  const parts = [];
  const color = () => new THREE.Color('#2a2420');
  const branch = (x, y, z, pyLen, thickness, rich, tilt, depth) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rich, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = new THREE.CylinderGeometry(thickness * 0.62, thickness, pyLen, 6, 1);
    g.translate(0, pyLen / 2, 0);
    parts.push(part(g, m, color, Math.min(1, depth * 0.35)));
    if (depth >= 3) return;
    const end = new THREE.Vector3(0, pyLen, 0).applyMatrix4(m);
    const n = depth === 0 ? 4 : 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      branch(end.x, end.y, end.z, pyLen * (0.55 + R() * 0.2), thickness * 0.6, rich + (i / n) * Math.PI * 2 + R() * 0.8, Math.min(1.25, tilt + 0.35 + R() * 0.45), depth + 1);
    }
  };
  branch(0, 0, 0, 3.0, 0.32, R() * 6, 0.05, 0);
  return mergeGeometries(parts);
}

function bush(seed) {
  const R = rng(seed);
  const parts = [];
  const ck = crownsColor('#203a28', '#3f5d36', 0, 1.6);
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const w = R() * Math.PI * 2, rr = R() * 0.6;
    const r = 0.5 + R() * 0.4;
    parts.push(part(lump(r, seed + i * 1.7, 1, 0.3), M(Math.cos(w) * rr, r * 0.75, Math.sin(w) * rr, R() * 6, 0, 0, 1, 0.8, 1), ck, 0.5));
  }
  return mergeGeometries(parts);
}

const BUILDER = { foliage, fir, cypress, bare, bush };
const VARIANTS = { foliage: 3, fir: 2, cypress: 2, bare: 2, bush: 2 };

// autumn tint per tree (November)
function tone(kind, R) {
  if (kind === 'foliage') {
    const w = R();
    if (w < 0.55) return _c.setRGB(0.85 + R() * 0.3, 0.9 + R() * 0.25, 0.8 + R() * 0.25);
    if (w < 0.75) return _c.setRGB(1.5, 1.15, 0.5);
    if (w < 0.9) return _c.setRGB(1.75, 0.85, 0.4);
    return _c.setRGB(1.25, 1.2, 0.55);
  }
  if (kind === 'bush') return R() < 0.25 ? _c.setRGB(1.4, 0.9, 0.5) : _c.setRGB(0.9 + R() * 0.2, 0.95 + R() * 0.2, 0.85);
  return _c.setRGB(0.88 + R() * 0.24, 0.92 + R() * 0.2, 0.92 + R() * 0.2);
}

function treeMaterial(T) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, normalMap: T.plaster.normal, normalScale: new THREE.Vector2(1.2, 1.2) });
  return withFog(m, (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCrown;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 wi = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float ph = uTime * 1.1 + wi.x * 0.21 + wi.z * 0.17;
        float amp = aCrown * max(position.y, 0.0) * 0.016;
        transformed.x += (sin(ph) + 0.35 * sin(ph * 2.7 + position.y * 1.3)) * amp;
        transformed.z += (cos(ph * 0.83) * 0.6 + 0.3 * sin(ph * 3.1 + position.x)) * amp;
      }`);
  }, 'tree');
}

export function buildTrees(L, T, height) {
  const group = new THREE.Group();
  const geos = {};
  for (const kind of Object.keys(BUILDER)) geos[kind] = Array.from({ length: VARIANTS[kind] }, (_, i) => BUILDER[kind](101 + i * 37 + kind.length * 13));
  const mat = treeMaterial(T);
  const TILE = 75;
  const tiles = new Map();
  for (const b of L.trees) {
    const v = b.seed % VARIANTS[b.kind];
    const k = `${Math.floor(b.x / TILE)},${Math.floor(b.z / TILE)}|${b.kind}|${v}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(b);
  }
  for (const [k, list] of tiles) {
    const [, kind, v] = k.split('|');
    const inst = new THREE.InstancedMesh(geos[kind][+v], mat, list.length);
    const R = rng(list.length * 7 + kind.length);
    list.forEach((b, i) => {
      const y = height(b.x, b.z) - 0.05;
      _e.set((R() - 0.5) * 0.06, b.rotation, (R() - 0.5) * 0.06, 'YXZ');
      _q.setFromEuler(_e);
      const s = b.scale;
      _m.compose(_p.set(b.x, y, b.z), _q, _s.set(s, s * (0.9 + R() * 0.2), s));
      inst.setMatrixAt(i, _m);
      inst.setColorAt(i, tone(b.kind, R));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}

// ---------- will-o'-the-wisps ----------

export function buildWisps(L) {
  const R = rng(17);
  const n = 26;
  const pos = new Float32Array(n * 3), phase = new Float32Array(n);
  const F = L.graveyard;
  for (let i = 0; i < n; i++) {
    let x, z;
    if (i < 18) { x = F.x0 + 3 + R() * (F.x1 - F.x0 - 6); z = F.z0 + 3 + R() * (F.z1 - F.z0 - 6); }
    else { const w = R() * Math.PI * 2; x = L.pond.x + Math.cos(w) * (L.pond.r + 1 + R() * 3); z = L.pond.z + Math.sin(w) * (L.pond.r + 1 + R() * 3); }
    pos[i * 3] = x; pos[i * 3 + 1] = 0.6 + R() * 0.9; pos[i * 3 + 2] = z;
    phase[i] = R() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPx: { value: 1 } },
    vertexShader: `attribute float aPhase; uniform float uTime; uniform float uPx; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.35 + aPhase;
        p.x += sin(t * 0.9) * 1.6 + sin(t * 2.3) * 0.3;
        p.z += cos(t * 0.7) * 1.6;
        p.y += sin(t * 1.7) * 0.35;
        vA = smoothstep(-0.2, 0.6, sin(t * 0.6 + aPhase * 3.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * 42.0 / -mv.z;
      }`,
    fragmentShader: `varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 5.0) * vA;
        gl_FragColor = vec4(vec3(0.55, 1.0, 0.85) * 3.2 * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.px = mat.uniforms.uPx;
  return pts;
}

// ---------- smoke from chimneys ----------

export function buildSmoke(sources, T) {
  const perSource = 14;
  const n = sources.length * perSource;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n);
  sources.forEach((q, i) => {
    for (let k = 0; k < perSource; k++) {
      const j = i * perSource + k;
      pos[j * 3] = q.x; pos[j * 3 + 1] = q.y; pos[j * 3 + 2] = q.z;
      ph[j] = k / perSource + (i * 0.37) % 1;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uMap: { value: T.smoke }, uPx: { value: 1 } },
    vertexShader: `attribute float aPhase; uniform float uTime; uniform float uPx; varying float vA; varying float vR;
      void main() {
        float t = fract(uTime * 0.07 + aPhase);
        vec3 p = position;
        p.y += t * 7.0;
        p.x += t * t * 4.5 + sin(t * 6.0 + aPhase * 20.0) * 0.4;
        p.z += t * t * 1.5;
        vA = smoothstep(0.0, 0.12, t) * (1.0 - t);
        vR = aPhase * 6.283;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.2 + t * 4.0) * 300.0 / -mv.z;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA; varying float vR;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float s = sin(vR), co = cos(vR);
        c = mat2(co, -s, s, co) * c + 0.5;
        float a = texture2D(uMap, c).a * vA * 0.16;
        gl_FragColor = vec4(vec3(0.24, 0.27, 0.34) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, premultipliedAlpha: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.px = mat.uniforms.uPx;
  return pts;
}
