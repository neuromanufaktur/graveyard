// Night sky: gradient, stars, moon with a halo. Also serves as the environment for reflections.

import * as THREE from 'three';
import { U } from './build.js';

export const MOON_DIRECTION = new THREE.Vector3(-0.76, 0.6, 0.27).normalize();
export const HORIZON = new THREE.Color('#0e1528');

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uMoon: { value: MOON_DIRECTION },
      uTime: U.uTime,
      uHorizon: { value: HORIZON.clone() },
      uZenith: { value: new THREE.Color('#03050b') },
      uStars: { value: 1 },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `uniform vec3 uMoon; uniform float uTime; uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uStars;
      varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = clamp(d.y, -1.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
        c = mix(c, uHorizon * 0.7, smoothstep(0.0, -0.3, y));
        // veil of clouds
        float w = n3(d * 3.0 + vec3(uTime * 0.004, 0.0, 0.0)) * 0.6 + n3(d * 7.0) * 0.4;
        c += vec3(0.05, 0.065, 0.1) * smoothstep(0.45, 0.85, w) * smoothstep(0.0, 0.35, y) * 0.6;
        // stars
        vec3 g = floor(d * 420.0);
        float s = h(g);
        float st = step(0.9965, s) * smoothstep(0.02, 0.25, y);
        float fl = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
        vec3 local = fract(d * 420.0) - 0.5;
        float point = smoothstep(0.35, 0.0, length(local));
        c += vec3(0.85, 0.9, 1.0) * st * point * fl * 2.2 * uStars * (1.0 - smoothstep(0.4, 0.9, w) * 0.7);
        // moon with a halo
        float m = dot(d, normalize(uMoon));
        float scheibe = smoothstep(0.99955, 0.99968, m);
        float krater = n3(d * 900.0) * 0.5 + n3(d * 2400.0) * 0.5;
        c = mix(c, vec3(4.2, 4.4, 4.8) * (0.82 + krater * 0.3), scheibe);
        c += vec3(0.35, 0.42, 0.62) * pow(max(m, 0.0), 900.0) * 1.6;
        c += vec3(0.12, 0.16, 0.28) * pow(max(m, 0.0), 30.0) * 0.55;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  sphere.scale.setScalar(1500);
  sphere.frustumCulled = false;
  sphere.renderOrder = -10;
  sphere.name = 'sky';
  return sphere;
}

// environment map from the sky (for marble, water, glass, brass)
export function buildEnv(renderer) {
  const env = new THREE.Scene();
  const h = buildSky();
  h.material.uniforms.uStars.value = 0;
  h.scale.setScalar(100);
  env.add(h);
  // a few warm light spots so glass and brass reflect warmth
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.4), side: THREE.BackSide });
  for (let i = 0; i < 9; i++) {
    const w = (i / 9) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), warm);
    m.position.set(Math.cos(w) * 60, -4 + (i % 3) * 3, Math.sin(w) * 60);
    env.add(m);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 24), new THREE.MeshBasicMaterial({ color: '#06080c', side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -10;
  env.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02, 0.1, 400);
  pm.dispose();
  return rt.texture;
}
