// Grass fibres like on a model railway board: a field of blades that moves along with the camera.
// Every blade has a fixed spot in the world (offset in the tile grid), only the window moves.
// Mask and height come from the ground, the wind from the time, your own figure pushes the grass aside.

import * as THREE from 'three';
import { U, withFog } from './build.js';

const HMAX = 6; // metres covered by the height channel

function blade() {
  // three sections, tip as a single point; x = side (-0.5..0.5), y = height (0..1)
  const st = [0, 0.38, 0.72, 1];
  const br = [1, 0.78, 0.45, 0];
  const pos = [], idx = [];
  for (let k = 0; k < 3; k++) { pos.push(-0.5 * br[k], st[k], 0, 0.5 * br[k], st[k], 0); }
  pos.push(0, 1, 0);
  for (let k = 0; k < 2; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push(4, 5, 6);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export function buildGrass(L, ground, { count = 70000, size = 46 } = {}) {
  const W = L.world;
  // height map, 1 pixel per metre
  const hx = Math.round(W.x1 - W.x0), hz = Math.round(W.z1 - W.z0);
  const hd = new Uint8Array(hx * hz);
  for (let j = 0; j < hz; j++) for (let i = 0; i < hx; i++) hd[j * hx + i] = Math.max(0, Math.min(255, (ground.height(W.x0 + i + 0.5, W.z0 + j + 0.5) / HMAX) * 255));
  const height = new THREE.DataTexture(hd, hx, hz, THREE.RedFormat, THREE.UnsignedByteType);
  height.magFilter = THREE.LinearFilter; height.minFilter = THREE.LinearFilter; height.needsUpdate = true;

  const g = blade();
  const v = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    v[i * 4] = Math.random() * size;
    v[i * 4 + 1] = Math.random() * size;
    v[i * 4 + 2] = Math.random() * Math.PI * 2;
    v[i * 4 + 3] = Math.random();
  }
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(v, 4));
  g.instanceCount = count;

  const uni = {
    uGrassCenter: { value: new THREE.Vector3() },
    uGrassSize: { value: size },
    uGrassMask: { value: ground.mask },
    uGrassHeight: { value: height },
  };
  const mat = withFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }), (s) => {
    Object.assign(s.uniforms, uni);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aOffset;
        uniform vec3 uGrassCenter;
        uniform float uGrassSize;
        uniform sampler2D uGrassMask;
        uniform sampler2D uGrassHeight;
        uniform float uTime;
        uniform vec4 uWorldRect;
        uniform vec3 uPlayer;
        varying vec3 vGrassColor;
        float grH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float grR(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(grH(i), grH(i + vec2(1.0, 0.0)), u.x), mix(grH(i + vec2(0.0, 1.0)), grH(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <beginnormal_vertex>', `
        vec2 gW = aOffset.xy + floor((uGrassCenter.xz - aOffset.xy) / uGrassSize + 0.5) * uGrassSize;
        vec2 gUv = (gW - uWorldRect.xy) / uWorldRect.zw;
        vec4 gM = texture2D(uGrassMask, gUv);
        float gFlur = grR(gW * 0.11);
        float gBushes = smoothstep(0.55, 0.85, grR(gW * 0.045 + 7.3));
        float gD = distance(gW, uGrassCenter.xz);
        float gFar = 1.0 - smoothstep(uGrassSize * 0.3, uGrassSize * 0.49, gD);
        float gPresence = (1.0 - smoothstep(0.18, 0.5, gM.a)) * step(0.0, gUv.x) * step(gUv.x, 1.0) * step(0.0, gUv.y) * step(gUv.y, 1.0);
        float gH = (0.1 + aOffset.w * 0.16 + gFlur * 0.1 + gBushes * 0.16) * gPresence * gFar;
        float gRot = aOffset.z;
        float gC = cos(gRot), gS = sin(gRot);
        // wind: gusts move over the meadow as waves
        float gWind = sin(uTime * 1.3 + gW.x * 0.21 + gW.y * 0.13) * 0.6 + sin(uTime * 2.7 + gW.x * 0.7 - gW.y * 0.4) * 0.25;
        float gT = position.y;
        float gBieg = (0.25 + aOffset.w * 0.3 + gWind * 0.35) * gT * gT * gH;
        vec3 gL = vec3(position.x * (0.028 + aOffset.w * 0.016), gT * gH, 0.0);
        vec3 gPos = vec3(gL.x * gC, gL.y, -gL.x * gS);
        gPos.xz += vec2(0.8, 0.45) * gBieg;
        gPos.xz += vec2(gS, gC) * gBieg * 0.35;
        // your own figure pushes the grass away
        vec2 gAb = gW - uPlayer.xz;
        float gDs = length(gAb);
        gPos.xz += (gAb / max(gDs, 0.001)) * smoothstep(0.9, 0.15, gDs) * 0.18 * gT;
        gPos.y -= smoothstep(0.9, 0.15, gDs) * 0.4 * gT * gH;
        float gY = texture2D(uGrassHeight, gUv).r * ${HMAX.toFixed(1)};
        gPos += vec3(gW.x, gY - 0.015, gW.y);
        vec3 gBase = mix(vec3(0.08, 0.14, 0.075), vec3(0.11, 0.18, 0.09), gFlur);
        vec3 gTip = mix(vec3(0.24, 0.36, 0.15), vec3(0.33, 0.38, 0.16), gFlur * 0.7 + aOffset.w * 0.3);
        gTip = mix(gTip, vec3(0.34, 0.27, 0.13), smoothstep(0.7, 0.95, grR(gW * 0.07 + 3.0)) * 0.6);
        vGrassColor = mix(gBase, gTip, smoothstep(0.0, 1.0, gT));
        vec3 objectNormal = normalize(vec3(gS * 0.35, 1.0, gC * 0.35));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vGrassColor;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);')
      // lantern light as on the ground, otherwise the blades stand dark in the light cone
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 gL = texture2D(uLightMap, (vFogWorld.xz - uWorldRect.xy) / uWorldRect.zw).rgb;
          totalEmissiveRadiance += diffuseColor.rgb * gL * gL * uLightStrength * 1.15;
        }`);
  }, 'grass');
  mat.defines = { ...(mat.defines || {}), NB_GRASS: '' };
  // blades write no depth: otherwise the ambient occlusion draws a dark halo around every blade.
  // So they still sit correctly in front of and behind figures, they are drawn last.
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'grass';
  mesh.userData.center = uni.uGrassCenter.value;
  return mesh;
}
