// Building kit for the models: shared materials, fog in the shader, merging parts.
// Every model is built from real measurements in metres and merged into one mesh per material at the end.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD } from './layout.js';

const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
empty.needsUpdate = true;

// Shared uniforms for all materials
export const U = {
  uTime: { value: 0 },
  uFogHeight: { value: 1.9 },
  uFogStrength: { value: 0.5 },
  uFogColor: { value: new THREE.Color('#3f4d70') },
  uLightFog: { value: 0.35 },
  uLightMap: { value: empty },
  uFogMap: { value: empty },
  uLightStrength: { value: 1.6 },
  uWorldRect: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0) },
  uPlayer: { value: new THREE.Vector3() },
  // Cutout: screen point of your own figure (x, y in pixels, radius, depth) and strength
  uUmbrella: { value: new THREE.Vector4() },
  uCrop: { value: 0 },
  // up to four buildings in front of the figure: centre and half size (x, z, hw, hd), rotation, height, strength
  // up to six buildings that are being faded out (centre, half size; rotation, height, strength)
  uHidden: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uHiddenB: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

const FOG_PARS_F = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
varying vec3 vFogWorld;
uniform float uTime;
uniform float uFogHeight;
uniform float uFogStrength;
uniform vec3 uFogColor;
uniform float uLightFog;
uniform float uLightStrength;
uniform sampler2D uLightMap;
uniform sampler2D uFogMap;
uniform vec4 uWorldRect;
uniform vec4 uUmbrella;
uniform float uCrop;
uniform vec4 uHidden[6];
uniform vec4 uHiddenB[6];
float nbBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float nbBayer(vec2 a) { return nbBayer2(0.5 * a) * 0.25 + nbBayer2(a); }
float nbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nbHash(i), nbHash(i + vec2(1.0, 0.0)), u.x), mix(nbHash(i + vec2(0.0, 1.0)), nbHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const FOG_F = /* glsl */ `
#if !defined(NB_GROUND) && !defined(NB_GRASS)
  // whatever stands between the camera and your own figure is faded out with a dither pattern
  if (uCrop > 0.001) {
    float nbDist = length(gl_FragCoord.xy - uUmbrella.xy);
    float nbFront = 1.0 - smoothstep(uUmbrella.w - 2.4, uUmbrella.w - 0.9, vViewPosition.z);
    float nbCut = (1.0 - smoothstep(uUmbrella.z * 0.5, uUmbrella.z, nbDist)) * nbFront * uCrop * 0.86;
    for (int i = 0; i < 6; i++) {
      vec4 nbA = uHidden[i], nbB = uHiddenB[i];
      if (nbB.w < 0.001) continue;
      vec2 nbD = vFogWorld.xz - nbA.xy;
      vec2 nbL = vec2(nbD.x * nbB.x - nbD.y * nbB.y, nbD.x * nbB.y + nbD.y * nbB.x);
      vec2 nbQ = abs(nbL) - nbA.zw;
      // only what lies in front of the figure: the figure itself and everything behind it stays
      float nbIn = step(max(nbQ.x, nbQ.y), 0.0) * step(vFogWorld.y, nbB.z) * step(vViewPosition.z, uUmbrella.w - 0.6);
      nbCut = max(nbCut, nbIn * nbB.w * uCrop);
    }
    if (nbCut > nbBayer(gl_FragCoord.xy)) discard;
  }
#endif
#ifdef USE_FOG
  {
    vec2 nbUv = (vFogWorld.xz - uWorldRect.xy) / uWorldRect.zw;
    vec4 nbMap = texture2D(uFogMap, nbUv);
    vec3 nbLight = texture2D(uLightMap, nbUv).rgb;
    #ifdef NB_LIGHT
      // light map as warm scattered light on walls, stones and figures, direction from the slope of the map
      {
        vec2 nbD = vec2(1.5) / uWorldRect.zw;
        float lx0 = dot(texture2D(uLightMap, nbUv - vec2(nbD.x, 0.0)).rgb, vec3(0.333));
        float lx1 = dot(texture2D(uLightMap, nbUv + vec2(nbD.x, 0.0)).rgb, vec3(0.333));
        float lz0 = dot(texture2D(uLightMap, nbUv - vec2(0.0, nbD.y)).rgb, vec3(0.333));
        float lz1 = dot(texture2D(uLightMap, nbUv + vec2(0.0, nbD.y)).rgb, vec3(0.333));
        vec3 nbDir = normalize(vec3(lx1 - lx0, 0.22, lz1 - lz0) + vec3(0.0, 0.0001, 0.0));
        vec3 nbN = inverseTransformDirection(normal, viewMatrix);
        float nbLam = 0.3 + 0.7 * clamp(dot(nbN, nbDir) * 0.8 + 0.2, 0.0, 1.0);
        float nbHf = clamp(1.0 - vFogWorld.y / 6.5, 0.0, 1.0);
        gl_FragColor.rgb += diffuseColor.rgb * nbLight * nbLight * uLightStrength * 0.9 * nbLam * nbHf * nbHf;
      }
    #endif
    vec2 nbP = vFogWorld.xz * 0.055 + vec2(uTime * 0.018, uTime * 0.009);
    float nbN2 = nbNoise(nbP) * 0.6 + nbNoise(nbP * 2.6 + 4.7) * 0.4;
    float nbH = clamp(1.0 - vFogWorld.y / max(uFogHeight, 0.01), 0.0, 1.0);
    float nbGround = nbH * nbH * uFogStrength * nbMap.r * smoothstep(0.25, 0.95, nbN2);
    vec3 nbColor = uFogColor + nbLight * nbLight * uLightFog;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, nbColor, clamp(nbGround, 0.0, 0.85));
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  }
#endif
`;

// build fog (ground and distance fog) into a standard material; extra() may patch further
export function withFog(mat, extra, key = '', light = null) {
  if (light ?? (mat.isMeshStandardMaterial || mat.isMeshLambertMaterial)) mat.defines = { ...(mat.defines || {}), NB_LIGHT: '' };
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(U)) shader.uniforms[k] = U[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vFogWorld;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      {
        vec4 nbW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          nbW = instanceMatrix * nbW;
        #endif
        vFogWorld = (modelMatrix * nbW).xyz;
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS_F)
      .replace('#include <fog_fragment>', FOG_F);
    if (extra) extra(shader);
  };
  mat.customProgramCacheKey = () => 'fog:' + key;
  return mat;
}

// ---------- materials ----------

export const MAT = {};
const TILE = { plaster: 3, bar: 1.2, wood: 1.2, roof: 2, slate: 2, brick: 1.3, stone: 2.4, granite: 1.1, marble: 1.4, earth: 1.6, plinth: 3 };
const WITHOUT_SHADOW = new Set(['glass', 'flame', 'water']);

export function generateMaterials(T) {
  const std = (o, key) => withFog(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }), null, key);
  MAT.plaster = std({ map: T.plaster.map, normalMap: T.plaster.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.93 }, 'plaster');
  MAT.bar = std({ map: T.wood.map, normalMap: T.wood.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.86 }, 'bar');
  MAT.wood = std({ map: T.wood.map, normalMap: T.wood.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.8 }, 'wood');
  MAT.roof = std({ map: T.rooftile.map, normalMap: T.rooftile.normal, normalScale: new THREE.Vector2(1, 1), roughness: 0.82 }, 'roof');
  MAT.slate = std({ map: T.slate.map, normalMap: T.slate.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.62, envMapIntensity: 0.6 }, 'slate');
  MAT.brick = std({ map: T.brick.map, normalMap: T.brick.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9 }, 'brick');
  MAT.stone = std({ map: T.rubble.map, normalMap: T.rubble.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92 }, 'stone');
  MAT.granite = std({ map: T.granite.map, normalMap: T.granite.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.62, envMapIntensity: 0.5 }, 'granite');
  MAT.marble = std({ map: T.marble.map, roughness: 0.18, envMapIntensity: 0.9 }, 'marble');
  MAT.earth = std({ map: T.granite.map, roughness: 1 }, 'earth');
  MAT.leaf = std({ roughness: 0.88 }, 'leaf');
  MAT.fabric = std({ roughness: 0.96 }, 'fabric');
  MAT.matt = std({ roughness: 0.9 }, 'matt');
  MAT.metal = std({ metalness: 0.65, roughness: 0.42, envMapIntensity: 0.7 }, 'metal');
  MAT.brass = std({ metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2 }, 'brass');
  MAT.glass = std({ roughness: 0.08, metalness: 0.1, envMapIntensity: 1.4 }, 'glass');
  MAT.wax = std({ roughness: 0.55 }, 'wax');
  MAT.plinth = std({ map: T.wood.map, normalMap: T.wood.normal, roughness: 0.55, envMapIntensity: 0.5 }, 'plinth');
  MAT.flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.9), toneMapped: false });
  MAT.water = withFog(new THREE.MeshStandardMaterial({ color: new THREE.Color('#14243a'), roughness: 0.1, metalness: 0.2, normalMap: T.waves, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 2.6 }), (s) => {
    // lanterns reflect in the water: light map, distorted by the waves
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec2 wUv = (vFogWorld.xz - uWorldRect.xy) / uWorldRect.zw;
        vec2 wv = vec2(sin(vFogWorld.x * 3.1 + uTime * 1.3), cos(vFogWorld.z * 2.7 + uTime * 1.1)) * 0.0009;
        vec3 wl = texture2D(uLightMap, wUv + wv + vec2(0.0, 0.004)).rgb;
        totalEmissiveRadiance += wl * wl * 1.6 + vec3(0.012, 0.018, 0.03);
      }`);
  }, 'water');
  return MAT;
}

// glowing glass per colour and strength; the vertex colour scales the glow per window
const lightCache = new Map();
export function lightMaterial(color, strength = 2.4) {
  const k = color + ':' + strength;
  if (lightCache.has(k)) return lightCache.get(k);
  const m = withFog(new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(color), emissiveIntensity: strength, roughness: 0.35, vertexColors: true }), (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
  }, 'light');
  lightCache.set(k, m);
  return m;
}

// ---------- geometry ----------

const geoCache = new Map();
function mark(k, f) {
  if (!geoCache.has(k)) geoCache.set(k, f());
  return geoCache.get(k);
}
export const box = (w, h, d, r = 0, seg = 2) =>
  mark(`k${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r},${seg}`, () => (r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)) : new THREE.BoxGeometry(w, h, d)));
export const cyl = (rt, rb, h, seg = 12, open = false) => mark(`z${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
export const sphere = (r, ws = 14, hs = 10) => mark(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const cone = (r, h, seg = 10) => mark(`c${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
export const torus = (R, r, rs = 8, ts = 24, arch = Math.PI * 2) => mark(`t${R},${r},${rs},${ts},${arch}`, () => new THREE.TorusGeometry(R, r, rs, ts, arch));

// triangular prism for gables: base w, height h, depth d (centred in z)
export function prism(w, h, d) {
  return mark(`p${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  });
}

// extrude a shape from an outline, centred in z, with a soft edge
export function form(shape, depth, bevel = 0.02, key = null) {
  const f = () => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 18 });
    g.translate(0, 0, -(depth - bevel * 2) / 2);
    return g;
  };
  return key ? mark(key, f) : f();
}

// matrix from position, rotation (y, x, z) and scale
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function T(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// UV from the position in space (projection along the main axis of the normal), in metres / tile
function projectUV(g, tile, offset) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = p.getZ(i); v = p.getY(i); }
    else if (ny >= nz) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / tile + offset;
    uv[i * 2 + 1] = v / tile + offset * 0.7;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
export class Builder {
  constructor(seed = 1) {
    this.parts = new Map();
    this.n = seed;
  }
  // color: hex, Color or function (x, y, z) => Color in object space
  add(key, geo, m, color = 0xffffff, opt = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (opt.uv !== 'own') projectUV(g, opt.tile ?? TILE[key] ?? 1, ((this.n = (this.n * 9301 + 49297) % 233280) / 233280) * 7);
    else if (!g.attributes.uv) projectUV(g, 1, 0);
    if (m) g.applyMatrix4(m);
    const cnt = g.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    if (typeof color === 'function') {
      const p = g.attributes.position;
      for (let i = 0; i < cnt; i++) {
        const c = color(p.getX(i), p.getY(i), p.getZ(i));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    } else {
      const c = color && color.isColor ? color : _c.set(color);
      for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mk = opt.material ? opt.material : key;
    if (!this.parts.has(mk)) this.parts.set(mk, { list: [], material: opt.material || null, key });
    this.parts.get(mk).list.push(g);
    return this;
  }
  done(group = new THREE.Group(), shadow = true) {
    for (const [, t] of this.parts) {
      const geo = mergeGeometries(t.list, false);
      for (const g of t.list) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, t.material || MAT[t.key]);
      mesh.castShadow = shadow && !WITHOUT_SHADOW.has(t.key) && !(t.material && t.material.emissive && t.material.emissiveIntensity > 0.5);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

export function color(hex) {
  return new THREE.Color(hex);
}
export function merge(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}
export { _v as tmpV };
