// Builds the whole world from the layout: buildings, graves, nature, ground, light map, click targets.

import * as THREE from 'three';
import { t } from './i18n.js';
import { MAT, generateMaterials } from './build.js';
import { generateTextures } from './textures.js';
import { buildHouse, buildVault, buildHospice, buildChapel, buildMausoleum } from './houses.js';
import {
  Stack, buildGrave, buildWalls, buildGate, buildLanterns, buildBenches, buildWell, buildPond, buildArchway,
  buildMonument, buildClientSign, buildBed, buildSignpost, buildPlinth,
} from './models.js';
import { buildTrees, buildWisps, buildSmoke } from './nature.js';
import { buildGround, paintLightMap } from './ground.js';

// height of the click boxes per place
const PROXY_H = { house: 7, clientHouse: 7, grave: 1.3, mausoleum: 4.5, chapel: 12, hospice: 5, bed: 1.2, vault: 3.6, monument: 3.5, clientSign: 3 };

export async function buildWorld(scene, L, data, progress = () => {}) {
  const T = generateTextures();
  generateMaterials(T);
  progress(0.25);
  const lights = [], smokeSources = [], doors = [];
  const proxies = [];
  const placeGroups = new Map();
  const world = new THREE.Group();
  scene.add(world);

  const take = (o, result, set = true) => {
    if (set) { result.group.position.set(o.x, 0, o.z); result.group.rotation.y = o.rot || 0; }
    world.add(result.group);
    lights.push(...(result.lights || []));
    smokeSources.push(...(result.smoke || []));
    doors.push(...(result.doors || []));
    placeGroups.set(o.id, result.group);
    result.group.userData.place = o;
  };

  let i = 0;
  for (const o of L.places) {
    switch (o.type) {
      case 'house': case 'clientHouse': take(o, buildHouse(o)); break;
      case 'vault': take(o, buildVault(o)); break;
      case 'hospice': take(o, buildHospice(o)); break;
      case 'chapel': take(o, buildChapel(o)); break;
      case 'mausoleum': take(o, buildMausoleum(o)); break;
      case 'grave': take(o, buildGrave(o), false); break;
      case 'monument': take(o, buildMonument(o), false); break;
      case 'clientSign': take(o, buildClientSign(o), false); break;
      case 'bed': take(o, buildBed(o), false); break;
    }
    if (++i % 8 === 0) { progress(0.25 + (i / L.places.length) * 0.35); await new Promise((r) => setTimeout(r, 0)); }
  }

  const stack = new Stack(48);
  buildWalls(L, stack);
  lights.push(...buildLanterns(L, stack));
  buildBenches(L, stack);
  stack.done(world);
  const gate = buildGate(L); world.add(gate.group); lights.push(...gate.lights);
  const br = buildWell(L); world.add(br.group); lights.push(...br.lights);
  world.add(buildPond(L));
  const tb = buildArchway(L); world.add(tb.group); lights.push(...tb.lights);
  world.add(buildSignpost(3.7, -13.4, [
    { name: t('places.graveyard'), x: 0, z: -60 },
    { name: t('places.hospice'), x: -100, z: 3 },
    { name: t('places.clients'), x: 80, z: 0 },
  ]));
  progress(0.7);
  await new Promise((r) => setTimeout(r, 0));

  // ground and nature
  const ground = buildGround(L, { doors });
  world.add(ground.mesh);
  world.add(buildTrees(L, T, ground.height));
  world.add(buildPlinth(L, data.as_of));
  const irr = buildWisps(L);
  world.add(irr);
  const smoke = buildSmoke(smokeSources, T);
  world.add(smoke);
  paintLightMap(L, lights);
  progress(0.9);

  // click targets: invisible boxes per place
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const o of L.places) {
    if (!o.foot) continue;
    const h = PROXY_H[o.type] || 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.foot.hw * 2, h, o.foot.hd * 2), proxyMat);
    m.position.set(o.foot.cx, h / 2, o.foot.cz);
    m.rotation.y = o.foot.rot;
    m.userData.place = o;
    m.updateMatrixWorld();
    proxies.push(m);
  }
  return { world, lights, proxies, placeGroups, ground, T, points: [irr, smoke], MAT };
}
