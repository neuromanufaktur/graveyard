// Entry point: wires renderer, scene, world, figures, controls, interface and sound together.

import * as THREE from 'three';
import { loadData, prepareWorld } from './data.js';
import { buildLayout, blocked } from './layout.js';
import { U } from './build.js';
import { buildWorld } from './world.js';
import { buildSky, buildEnv, HORIZON } from './sky.js';
import { Light } from './light.js';
import { Post } from './post.js';
import { Camera } from './camera.js';
import { Actors, targetBefore } from './actors.js';
import { buildGrass } from './grass.js';
import { Ui } from './ui.js';
import { Sound } from './sound.js';
import { buildOffering } from './models.js';
import { hash } from './util.js';
import config from './config.js';
import { t } from './i18n.js';

const canvas = document.getElementById('world');
const loadBar = document.querySelector('#loading i');
const loadText = document.querySelector('#loading .status');
// The bar is split: first the refresh (if due), then building the world
let loadBase = 0;
const bar = (f) => { if (loadBar) loadBar.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; };
const progress = (f) => bar(loadBase + f * (1 - loadBase));
const loadMessage = (t) => { if (loadText) loadText.textContent = t || ''; };
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;

function storage(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private */ }
  return null;
}

// respect, flowers, candles: counted for everyone (server), plus your own
const KIND = { respect: 'respect', flowers: 'flower', candles: 'candle' };
class Tribute {
  constructor(all = {}, mine = {}, onServer = false) { this.all = all; this.mine = mine; this.onServer = onServer; }
  from(n) { const e = this.all[n] || {}; return { respect: e.respect || 0, flowers: e.flower || 0, candles: e.candle || 0 }; }
  // counts right here and sends it off; the answer brings back everyone's state
  plus(n, k, after) {
    const kind = KIND[k];
    const e = this.all[n] || (this.all[n] = {});
    const m = this.mine[n] || (this.mine[n] = {});
    e[kind] = (e[kind] || 0) + 1;
    m[kind] = (m[kind] || 0) + 1;
    if (this.onServer) {
      fetch('/api/tribute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: n, kind }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.tribute) { this.set(d.tribute); if (after) after(); } })
        .catch(() => {});
    }
    return m[kind];
  }
  // new state from the server, never below what is already counted here
  set(all) {
    for (const [n, e] of Object.entries(all || {})) {
      const h = this.all[n] || (this.all[n] = {});
      for (const [kind, z] of Object.entries(e)) h[kind] = Math.max(h[kind] || 0, z);
    }
  }
}

async function epitaphs() {
  const list = ['400 40px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '500 40px "Geist Mono"', '600 40px Geist', '500 40px Geist', '600 40px Outfit'];
  try { await Promise.race([Promise.all(list.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 3500))]); } catch { /* carry on without */ }
}

async function start() {
  await epitaphs();
  bar(0.03);
  let refreshed = false;
  const { world: rawData, api } = await loadData((share, text) => {
    refreshed = true;
    bar(0.03 + share * 0.5);
    loadMessage(text);
  });
  if (refreshed) { loadBase = 0.55; loadMessage(t('loading.building')); }
  progress(0.05);
  const me = rawData.me || null;
  const data = prepareWorld(rawData);
  const L = buildLayout(data);
  progress(0.12);

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  const dprMax = Math.min(window.devicePixelRatio, mobile ? 1.5 : 2);
  let dpr = dprMax;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = HORIZON.clone().multiplyScalar(0.6);
  scene.fog = new THREE.FogExp2(HORIZON.clone(), 0.0085);
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.3, 2600);
  scene.add(buildSky());
  scene.environment = buildEnv(renderer);
  scene.environmentIntensity = 0.75;

  const W = await buildWorld(scene, L, data, progress);
  const light = new Light(scene);
  const post = new Post(renderer, scene, camera);
  const cam = new Camera(camera, canvas);
  // extent of the village for the map in portrait
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const o of L.places) {
      const r = o.foot ? Math.max(o.foot.hw, o.foot.hd) : 2;
      x0 = Math.min(x0, o.x - r); x1 = Math.max(x1, o.x + r); z0 = Math.min(z0, o.z - r); z1 = Math.max(z1, o.z + r);
    }
    const F = L.graveyard, T = L.pond;
    x0 = Math.min(x0, F.x0, T.x - T.r); x1 = Math.max(x1, F.x1, T.x + T.r); z0 = Math.min(z0, F.z0, T.z - T.r); z1 = Math.max(z1, F.z1, T.z + T.r);
    cam.mapBox = { x0: x0 - 8, x1: x1 + 8, z0: z0 - 8, z1: z1 + 8 };
  }
  const grass = buildGrass(L, W.ground, { count: mobile ? 28000 : 72000, size: mobile ? 36 : 46 });
  scene.add(grass);
  progress(0.95);

  const actors = new Actors(scene, L, data, W.ground);
  const team = actors.setUp();
  // without shared storage everything only counts here in the browser, there are no other players
  const shared = api && config.multiplayer;
  const tribute = new Tribute(rawData.tribute || {}, rawData.mine || {}, shared);
  const sound = new Sound();

  // ---------- state ----------
  let phase = 'intro';
  let detailThing = null;
  let next = null;
  let hover = null;
  const mouse = { x: 0, y: 0, inside: false, updated: false };
  const keys = new Set();
  const offeringsLights = [];
  const ray = new THREE.Raycaster();
  const v2 = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const CHOICE = { x: 0, y: -0.78, z: 8.95 };

  // click boxes for figures, they follow them every frame
  const figureBox = new THREE.BoxGeometry(0.8, 1.95, 0.8);
  figureBox.translate(0, 0.98, 0);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const boxes = [];
  // building shells: faded out when they stand between camera and figure
  const SHELL = new Set(['house', 'clientHouse', 'chapel', 'mausoleum', 'hospice', 'vault']);
  const shells = [];
  {
    const bb = new THREE.Box3(), bbm = new THREE.Box3(), inv = new THREE.Matrix4(), mm = new THREE.Matrix4();
    for (const o of L.places) {
      if (!SHELL.has(o.type)) continue;
      const g = W.placeGroups.get(o.id);
      if (!g) continue;
      g.updateMatrixWorld(true);
      inv.copy(g.matrixWorld).invert();
      bb.makeEmpty();
      g.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        bb.union(bbm.copy(m.geometry.boundingBox).applyMatrix4(mm.multiplyMatrices(inv, m.matrixWorld)));
      });
      if (bb.isEmpty()) continue;
      const r = g.rotation.y, c = Math.cos(r), sn = Math.sin(r);
      const lx = (bb.min.x + bb.max.x) / 2, lz = (bb.min.z + bb.max.z) / 2;
      const cx = g.position.x + lx * c + lz * sn, cz = g.position.z - lx * sn + lz * c;
      const hw = (bb.max.x - bb.min.x) / 2 + 0.2, hd = (bb.max.z - bb.min.z) / 2 + 0.2, h = bb.max.y + 0.3;
      const box = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.set(cx, h / 2, cz);
      box.rotation.y = r;
      box.updateMatrixWorld();
      box.userData.shell = { id: o.id, cx, cz, hw, hd, c, s: sn, h };
      shells.push(box);
    }
  }
  const hidden = new Map();
  const rayV = new THREE.Raycaster();
  const dir = new THREE.Vector3(), corner = new THREE.Vector3();
  function checkOcclusion(s, dt) {
    const targets = new Map();
    if (s && phase === 'game' && cam.map < 0.1) {
      // 1. what stands between camera and figure
      for (const y of [0.2, 1.0, 1.85]) {
        dir.set(s.x, y, s.z).sub(camera.position);
        const d = dir.length();
        rayV.set(camera.position, dir.normalize());
        rayV.far = d - 0.35;
        for (const t of rayV.intersectObjects(shells, false)) targets.set(t.object.userData.shell.id, { h: t.object.userData.shell, target: 0.84, prio: 2 });
      }
      // 2. foreground: buildings in the front half between camera and figure are lifted off
      //    like the front wall of a diorama, otherwise they stand in the picture as a dark mass
      const vi = camera.matrixWorldInverse;
      const depth = -corner.set(s.x, 1, s.z).applyMatrix4(vi).z;
      for (const box of shells) {
        const h = box.userData.shell;
        if (targets.has(h.id)) continue;
        corner.set(h.cx, h.h / 2, h.cz).project(camera);
        if (Math.abs(corner.x) > 1.5 || Math.abs(corner.y) > 1.5) continue;
        let near = Infinity, remote = -Infinity;
        for (let i = 0; i < 8; i++) {
          const lx = i & 1 ? h.hw : -h.hw, lz = i & 2 ? h.hd : -h.hd;
          corner.set(h.cx + lx * h.c + lz * h.s, i & 4 ? h.h : 0, h.cz - lx * h.s + lz * h.c).applyMatrix4(vi);
          near = Math.min(near, -corner.z); remote = Math.max(remote, -corner.z);
        }
        if (remote > 0.5 && near < depth * 0.55) targets.set(h.id, { h, target: 0.94, prio: 1 });
      }
    }
    for (const [id, z] of targets) if (!hidden.has(id)) hidden.set(id, { h: z.h, w: 0, prio: z.prio });
    for (const [id, e] of hidden) {
      const z = targets.get(id);
      if (z) e.prio = z.prio;
      e.w += ((z ? z.target : 0) - e.w) * Math.min(1, dt * 7);
      if (!z && e.w < 0.01) hidden.delete(id);
    }
    const list = [...hidden.values()].sort((a, b) => (b.prio - a.prio) || (b.w - a.w));
    for (let i = 0; i < 6; i++) {
      const e = list[i], A = U.uHidden.value[i], B = U.uHiddenB.value[i];
      if (!e) { B.w = 0; continue; }
      A.set(e.h.cx, e.h.cz, e.h.hw, e.h.hd);
      B.set(e.h.c, e.h.s, e.h.h, e.w);
    }
  }

  const boxFor = (a) => { const m = new THREE.Mesh(figureBox, invisible); m.userData.actor = a; a.bbox = m; boxes.push(m); };
  team.forEach(boxFor);
  // boxes of figures that are gone (team figures not chosen, players who left)
  function clearBoxes() {
    const presence = new Set(actors.all);
    for (let i = boxes.length - 1; i >= 0; i--) if (!presence.has(boxes[i].userData.actor)) boxes.splice(i, 1);
  }

  // ---------- multiplayer: report every 1.5 s where you stand and fetch the others ----------
  let farTimer = 0, farRunning = false, lastMoved = performance.now();
  async function reportMe() {
    const s = actors.player;
    if (!s || farRunning || document.hidden) return;
    farRunning = true;
    try {
      if (s.pace > 0.3) lastMoved = performance.now();
      const r = await fetch('/api/presence', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ figure: s.f.id, x: +s.x.toFixed(2), z: +s.z.toFixed(2), rot: +s.rot.toFixed(2), bow: !!s.bow }),
      });
      if (r.status === 401) { location.replace('/login'); return; }
      const d = r.ok ? await r.json() : null;
      if (d) {
        if (actors.remote(d.others || [])) { clearBoxes(); for (const a of actors.all) if (!a.bbox) boxFor(a); }
        if (d.tribute) { tribute.set(d.tribute); syncOfferings(); }
      }
    } catch { /* next attempt */ } finally { farRunning = false; }
  }
  function multiplayer() {
    const beat = () => {
      // whoever stands still for long and is alone asks less often
      const quiet = performance.now() - lastMoved > 60_000 && !actors.farCount();
      farTimer = setTimeout(beat, quiet ? 6000 : 1500);
      reportMe();
    };
    beat();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(farTimer); beat(); } });
    addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/presence', JSON.stringify({ gone: true })); } catch { /* ignore */ } });
  }

  async function signOut() {
    try { navigator.sendBeacon('/api/presence', JSON.stringify({ gone: true })); } catch { /* ignore */ }
    let token = '';
    try { token = (await (await fetch('/api/auth/csrf')).json()).csrfToken; } catch { /* without a token Auth.js refuses */ }
    const f = document.createElement('form');
    f.method = 'POST'; f.action = '/api/auth/signout';
    for (const [k, v] of [['csrfToken', token], ['callbackUrl', '/login?signed_out=1']]) {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i);
    }
    document.body.appendChild(f);
    f.submit();
  }

  // target ring for click-to-walk
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.95, 0.45), transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  scene.add(ring);

  // ---------- offerings on graves ----------
  const offeringsNumber = new Map();
  function offeringsPlace(name) { return actors.placeOfRepo.get(name); }
  function layOffering(name, kind) {
    const o = offeringsPlace(name);
    if (!o) return;
    const k = (offeringsNumber.get(name + kind) || 0);
    if (k >= 6) return;
    offeringsNumber.set(name + kind, k + 1);
    const seed = hash(name + kind + k);
    const g = buildOffering(kind, seed);
    const j = ((seed % 1000) / 1000 - 0.5) * 0.12;
    let x, y = 0, z;
    if (o.type === 'grave') {
      const iw = o.partner ? 1.22 : 0.74;
      const slot = (kind === 'candle' ? 3 : 0) + k;
      const lx = (((slot * 2) % 5) / 4 - 0.5) * iw * 1.3 + j, lz = 0.86 + (slot % 2) * 0.24;
      const s = Math.sin(o.rot || 0), c = Math.cos(o.rot || 0);
      x = o.x + lx * c + lz * s; z = o.z - lx * s + lz * c;
      y = o.tier === 'marble' && !o.partner ? 0.08 : 0.16;
    } else {
      const [px, pz] = targetBefore(o);
      const dx = o.x - px, dz = o.z - pz, d = Math.hypot(dx, dz) || 1;
      const cross = ((k + (kind === 'candle' ? 3 : 0)) % 6 - 2.5) * 0.26 + j;
      x = px + (dx / d) * 0.9 + (-dz / d) * cross; z = pz + (dz / d) * 0.9 + (dx / d) * cross;
      y = W.ground.height(x, z);
    }
    g.position.set(x, y, z);
    g.rotation.y = (seed % 628) / 100;
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(g);
    if (kind === 'candle') offeringsLights.push({ x, y: y + 0.3, z, color: '#ff8a4a', strength: 0.8, range: 3.2, flicker: true });
  }
  // adds what others laid down since the last look (at most six of each kind per grave)
  function syncOfferings() {
    for (const name of Object.keys(tribute.all)) {
      const e = tribute.from(name);
      while ((offeringsNumber.get(name + 'flower') || 0) < Math.min(6, e.flowers)) { const k = offeringsNumber.get(name + 'flower') || 0; layOffering(name, 'flower'); if ((offeringsNumber.get(name + 'flower') || 0) === k) break; }
      while ((offeringsNumber.get(name + 'candle') || 0) < Math.min(6, e.candles)) { const k = offeringsNumber.get(name + 'candle') || 0; layOffering(name, 'candle'); if ((offeringsNumber.get(name + 'candle') || 0) === k) break; }
    }
  }
  syncOfferings();

  // ---------- interface ----------
  const ui = new Ui({
    data, L, tribute, me,
    actions: {
      button: (k) => {
        sound.start();
        if (k === 'map') map(!cam.inMap);
        else if (k === 'sound') ui.setSound(sound.toggle());
        else if (k === 'help') ui.showHelp(ui.$('.help').hidden);
        else if (k === 'switchFigure') { storage('graveyard.figure', null); location.reload(); }
        else if (k === 'signOut') signOut();
        else if (k === 'read') read();
        else if (k === 'respect') respect();
        if (k !== 'read' && k !== 'respect') sound.ui('click');
      },
      legend: (z) => { ui.setFilter(z); sound.ui('click'); },
      detail: (action, ds) => {
        if (action === 'close') return show(null);
        if (action === 'back') return show(detailThing?._back || null);
        if (action === 'partner') return openRepo(ds.name, detailThing);
        const name = ds.repoName;
        if (action === 'respect') return respect(name);
        if (action === 'flower' || action === 'candle') {
          layOffering(name, action);
          tribute.plus(name, action === 'flower' ? 'flowers' : 'candles', () => { syncOfferings(); ui.refreshDetail(); });
          sound.ui(action);
          ui.message(action === 'flower' ? t('tribute.flowerLaid') : t('tribute.candleLit'));
          ui.refreshDetail();
        }
      },
      repo: (name) => openRepo(name, detailThing),
      mapClick: (o) => { jump(o); map(false); show(o); },
      preview: (id) => { const a = team.find((t) => t.f.id === id); if (a) { a.wave = 1.6; mark(a.obj); } },
    },
  });
  ui.buildMapPoints(L.places);
  ui.setSound(sound.on);

  function mark(obj) {
    if (!obj) { post.show([]); return; }
    const list = [];
    obj.traverse((m) => { if (m.isMesh && m.visible !== false && m.material?.visible !== false) list.push(m); });
    post.show(list);
  }
  function groupOf(thing) {
    if (!thing) return null;
    if (thing.actor) return thing.actor.obj;
    return W.placeGroups.get(thing.id) || null;
  }

  function show(thing) {
    detailThing = thing;
    ui.showDetail(thing);
    if (thing) sound.ui('open');
  }
  function openRepo(name, back) {
    const r = data.byName.get(name);
    if (!r) return;
    const o = actors.placeOfRepo.get(name);
    let thing;
    if (o && o.repo === r) thing = { ...o };
    else if (o && o.partner === r) thing = { ...o, repo: r, partner: o.repo };
    else thing = { repo: r, id: o?.id };
    if (back) thing._back = back;
    show(thing);
  }

  // teleport for the map
  function jump(o) {
    const s = actors.player;
    if (!s) return;
    const [x, z] = targetBefore(o);
    s.x = x; s.z = z; s.path = []; s.arrival = null;
    s.glancesTo(o.x, o.z); s.rot = s.rotTarget;
  }
  function map(on) {
    if (phase !== 'game') return;
    cam.setMap(on);
    ui.setMap(on);
    if (on) { show(null); ui.showTip(null); mark(null); }
    sound.ui(on ? 'open' : 'close');
  }

  function read() {
    if (phase !== 'game' || cam.inMap) return;
    const d = next;
    if (!d) return;
    const same = detailThing && ((d.actor && detailThing.actor === d.actor) || (!d.actor && detailThing.id === d.id && !detailThing._back));
    if (same) return show(null);
    if (d.actor) {
      d.actor.glancesTo(actors.player.x, actors.player.z);
      if (d.actor.kind === 'online') d.actor.wave = 1.8;
    }
    show(d.actor ? { actor: d.actor } : d);
  }

  function respectTarget(name) {
    if (name) return name;
    const d = (detailThing && !detailThing.actor && detailThing) || next;
    if (!d) return null;
    if (d.actor?.kind === 'zombie') return d.actor.repo.name;
    if (d.actor) return null;
    if (d.type === 'vault') return d.id;
    if (['grave', 'mausoleum', 'bed', 'monument'].includes(d.type) && d.repo) return d.repo.name;
    if (d.repo && !d.type) return d.repo.name;
    return null;
  }
  function respect(name) {
    if (phase !== 'game') return;
    const target = respectTarget(name);
    if (!target) return;
    const n = tribute.plus(target, 'respect', () => ui.refreshDetail());
    const s = actors.player;
    s.bow = true;
    clearTimeout(respect._t);
    respect._t = setTimeout(() => { s.bow = false; }, 1500);
    sound.ui('respect');
    ui.message(t('tribute.respectPaid', { n }));
    ui.refreshDetail();
  }

  // ---------- choosing a figure ----------
  function choose(id) {
    if (phase === 'game') return;
    phase = 'game';
    storage('graveyard.figure', id);
    actors.choose(id);
    clearBoxes();
    for (const a of actors.all) if (!a.bbox) boxFor(a);
    if (shared) multiplayer();
    cam.locked = false;
    cam.distTarget = mobile ? 34 : 30;
    cam.tiltTarget = 0;
    mark(null);
    ui.zone = null;
    document.body.classList.add('game');
    if (!storage('graveyard.help')) { setTimeout(() => ui.showHelp(true), 1600); storage('graveyard.help', '1'); }
  }
  const remembered = storage('graveyard.figure');
  const choiceDist = () => Math.max(8.6, 4.6 / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect));

  // ---------- input ----------
  const CONTROL = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'q', 'e']);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (CONTROL.has(k)) e.preventDefault();
    sound.start();
    if (e.repeat && (k === ' ' || k === 'f' || k === 'm')) return;
    keys.add(k);
    if (k === 'shift') keys.add('shift');
    if (k === 'm') map(!cam.inMap);
    else if (k === ' ') read();
    else if (k === 'f') respect();
    else if (k === 'escape') { if (!ui.$('.help').hidden) ui.showHelp(false); else if (detailThing) show(null); else if (cam.inMap) map(false); }
    else if (k === 'h' || k === '?') ui.showHelp(ui.$('.help').hidden);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') keys.delete('shift'); });
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.updated = true; });
  canvas.addEventListener('pointerleave', () => { mouse.inside = false; ui.showTip(null); });
  canvas.addEventListener('pointerdown', () => sound.start());

  function hit(x, y) {
    v2.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(v2, camera);
    const targets = phase === 'game' ? boxes.filter((k) => k.userData.actor.kind !== 'player').concat(W.proxies) : boxes.filter((k) => k.userData.actor.kind === 'team');
    const t = ray.intersectObjects(targets, false)[0];
    if (!t) return null;
    if (t.object.userData.actor) return { actor: t.object.userData.actor, point: t.point };
    return { place: t.object.userData.place, point: t.point };
  }

  canvas.addEventListener('click', (e) => {
    if (cam.moved) return;
    sound.start();
    if (phase === 'choice') {
      const t = hit(e.clientX, e.clientY);
      if (t?.actor) { ui.$('.choice').hidden = true; document.body.classList.remove('choosing'); choose(t.actor.f.id); }
      return;
    }
    if (phase !== 'game') return;
    if (cam.inMap) {
      // map: jump there
      v2.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      ray.setFromCamera(v2, camera);
      const b = ray.intersectObject(W.ground.mesh, false)[0];
      if (b && !blocked(L, b.point.x, b.point.z)) {
        const s = actors.player;
        s.x = b.point.x; s.z = b.point.z; s.path = []; s.arrival = null;
        map(false);
      }
      return;
    }
    const t = hit(e.clientX, e.clientY);
    const s = actors.player;
    if (t?.actor) {
      const a = t.actor;
      show({ actor: a });
      a.glancesTo(s.x, s.z);
      s.goTo(a.x + (s.x - a.x) * 0.15, a.z + (s.z - a.z) * 0.15, L, () => s.glancesTo(a.x, a.z));
      return;
    }
    if (t?.place) {
      show(t.place);
      actors.goToPlace(t.place);
      showRing(...targetBefore(t.place));
      return;
    }
    v2.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(v2, camera);
    const b = ray.intersectObject(W.ground.mesh, false)[0];
    if (b && s.goTo(b.point.x, b.point.z, L)) showRing(b.point.x, b.point.z);
  });

  let ringTime = 0;
  function showRing(x, z) {
    ring.position.set(x, W.ground.height(x, z) + 0.04, z);
    ringTime = 1;
  }

  // ---------- size ----------
  const size = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    if (phase !== 'game') cam.distTarget = choiceDist();
  };
  window.addEventListener('resize', size);

  // start: view from above onto the whole board, then down to the three figures
  cam.locked = true;
  cam.tiltTarget = cam.tilt = -0.36;
  cam.distTarget = cam.dist = choiceDist();
  cam.target.set(CHOICE.x, CHOICE.y + 1.1, CHOICE.z);
  size();
  cam.move({ target: new THREE.Vector3(-6, 0, -20), dist: 300, el: 1.18, az: 0.35 }, 6.2);
  setTimeout(() => {
    if (me?.figure && team.some((a) => a.f.id === me.figure)) choose(me.figure);
    else if (remembered && team.some((a) => a.f.id === remembered)) choose(remembered);
    else {
      phase = 'choice';
      ui.showSelection(team, (id) => choose(id));
    }
  }, 4600);

  // ---------- frame loop ----------
  const clock = new THREE.Timer();
  let time = 0, fpsTime = 0, fpsFrames = 0, quiet = 0;
  document.body.classList.add('ready');
  const input = { direction: new THREE.Vector3(), run: false };

  function loop(ts) {
    requestAnimationFrame(loop);
    clock.update(ts);
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    U.uTime.value = time;

    // keyboard relative to the camera
    const r = input.direction.set(0, 0, 0);
    if (phase === 'game' && !cam.inMap) {
      const vo = cam.forward(), re = cam.right();
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const q = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      r.addScaledVector(vo, f).addScaledVector(re, q);
      if (r.lengthSq() > 0) { r.normalize(); ringTime = 0; }
      if (keys.has('q')) cam.rotate(dt * 1.7);
      if (keys.has('e')) cam.rotate(-dt * 1.7);
    }
    input.run = keys.has('shift');

    actors.update(dt, time, input);
    for (const ev of actors.events) if (ev.kind === 'step') sound.step(ev.ground, ev.pace);
    actors.events.length = 0;
    for (const k of boxes) { const a = k.userData.actor; k.position.set(a.x, 0, a.z); k.updateMatrixWorld(); }

    const s = actors.player;
    cam.update(dt, phase === 'game' && s ? s : CHOICE);
    if (s) U.uPlayer.value.set(s.x, 0, s.z);
    camera.updateMatrixWorld();
    checkOcclusion(s, dt);
    // cutout around your own figure
    const outer = phase === 'game' && s && cam.map < 0.1 ? 1 : 0;
    U.uCrop.value += (outer - U.uCrop.value) * Math.min(1, dt * 6);
    if (s) {
      tmp.set(s.x, 0.95, s.z);
      const depth = -tmp.clone().applyMatrix4(camera.matrixWorldInverse).z;
      tmp.project(camera);
      const bh = renderer.domElement.height, bw = renderer.domElement.width;
      U.uUmbrella.value.set((tmp.x * 0.5 + 0.5) * bw, (tmp.y * 0.5 + 0.5) * bh, (1.5 / (2 * depth * Math.tan((camera.fov * Math.PI) / 360))) * bh, depth);
    }
    grass.userData.center.copy(cam.gaze);

    // light: the moon shadow follows the view, point lights for moving sources
    const before = cam.forward().multiplyScalar(cam.curDist * 0.35);
    light.follow(cam.gaze, before, Math.max(phase === 'game' ? 40 : 18, cam.curDist * 1.25));
    const sources = actors.lights().concat(offeringsLights);
    if (phase !== 'game') for (const a of team) { a.obj.userData.fig.lantern.localToWorld(tmp.set(0, -0.68, 0.03)); sources.push({ x: tmp.x, y: tmp.y - 0.15, z: tmp.z + 0.25, color: '#ffb766', strength: 0.8, range: 4.5, flicker: true }); }
    light.distribute(sources, cam.gaze, time);
    if (s) {
      s.obj.userData.fig.lantern.localToWorld(tmp.set(0, -0.68, 0.03));
      light.lantern.position.copy(tmp);
      light.lantern.intensity = 2.3 * (0.9 + 0.1 * Math.sin(time * 11) * Math.sin(time * 6.3)) * (1 - cam.map);
    } else light.lantern.intensity = 0;

    // map, fog, depth of field
    // distance fog by camera distance: dense up close, thin from above (approach, map)
    post.bc.brightness = cam.map * 0.06;
    scene.fog.density = 0.0085 * Math.min(1, Math.max(0.17 * Math.min(1, 330 / cam.curDist), 42 / Math.max(cam.curDist, 42)));
    U.uFogStrength.value = 0.34 * (1 - cam.map * 0.6);
    const near = phase === 'game' ? 0 : 1;
    post.tilt.focusArea = 0.46 + cam.map * 0.4 - near * 0.08;
    post.tilt.feather = 0.34 + cam.map * 0.2;
    const px = renderer.getPixelRatio() * window.innerHeight / 900;
    for (const p of W.points) p.userData.px.value = px * 900 / Math.tan((camera.fov * Math.PI) / 360) / 900 * 0.5;

    // target ring
    if (ringTime > 0) {
      ringTime = s && s.path.length ? Math.max(ringTime, 0.6) : ringTime - dt * 1.5;
      ring.material.opacity = Math.max(0, Math.min(1, ringTime)) * 0.85;
      ring.scale.setScalar(1 + Math.sin(time * 5) * 0.06);
    } else ring.material.opacity = 0;

    // pointing with the mouse
    if (mouse.inside && !cam.drag && cam.map < 0.05 && phase !== 'intro') {
      const t = hit(mouse.x, mouse.y);
      const updated = t ? (t.actor ? { actor: t.actor } : t.place) : null;
      const same = (updated?.actor && hover?.actor === updated.actor) || (updated && !updated.actor && hover === updated) || (!updated && !hover);
      if (!same) {
        hover = updated;
        mark(groupOf(hover) || groupOf(detailThing?.actor ? detailThing : detailThing?.id ? detailThing : null));
        canvas.classList.toggle('pointer', !!hover);
        if (phase === 'choice' && hover?.actor) { hover.actor.wave = 1.4; }
      }
      if (phase === 'game') ui.showTip(hover, mouse.x, mouse.y); else ui.showTip(null);
    } else if (hover && (cam.map >= 0.05 || !mouse.inside)) { hover = null; mark(null); ui.showTip(null); canvas.classList.remove('pointer'); }

    // interface
    if (phase === 'game' && s) {
      const n = actors.inRange();
      const tag = n ? (n.actor || n) : null;
      if (tag !== next?.actor && tag !== next) next = n;
      if (!n) next = null;
      ui.setHint(cam.inMap ? null : next);
      ui.checkZone(s.x, s.z);
      ui.updateSigns(actors.all, camera, cam.map, s);
      sound.update(dt, { x: s.x, z: s.z, zone: ui.zone, map: cam.map });
    }
    ui.updateMapPoints(camera, cam.map);

    post.render(dt);

    // adapt the resolution to the frame rate
    fpsTime += dt; fpsFrames++;
    if (fpsTime > 2) {
      const fps = fpsFrames / fpsTime;
      fpsTime = 0; fpsFrames = 0;
      if (fps < 40 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); size(); quiet = 0; }
      else if (fps > 58 && dpr < dprMax && ++quiet > 3) { dpr = Math.min(dprMax, dpr + 0.25); renderer.setPixelRatio(dpr); size(); quiet = 0; }
    }
  }
  requestAnimationFrame(loop);

  window.__game = { cam, actors, ui, choose, team, L, W, post, light, tribute, map, show, renderer, get phase() { return phase; }, get dpr() { return dpr; } };
}

start().catch((e) => {
  console.error(e);
  const f = document.getElementById('error');
  if (f) { f.textContent = t('loading.failed', { message: e.message }); f.hidden = false; }
});
