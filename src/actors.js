// Who moves: your own figure, the mourners, whoever is really online right now
// (positions from the server, about every 1.5 s) and the zombies shuffling around near their house.

import * as THREE from 'three';
import { buildFigure, animate, TEAM, AI_TEAM, ZOMBIE } from './figure.js';
import { blocked, findPath } from './layout.js';
import { rng, hash } from './util.js';
import { t } from './i18n.js';

const DECEASED = new Set(['dead', 'buried']);

function targetBefore(o) {
  const s = Math.sin(o.rot || 0), c = Math.cos(o.rot || 0);
  if (o.type === 'grave') return [o.x + 0.25, o.z + 2.25];
  if (o.type === 'bed') return [o.x + 1.5, o.z];
  if (o.type === 'chapel') return [o.x, o.z + 9.4];
  if (o.type === 'hospice') return [o.x + 9, o.z];
  const t = (o.depth || (o.foot ? o.foot.hd * 2 : 2)) / 2 + 1.7;
  return [o.x + s * t, o.z + c * t];
}

class Actor {
  constructor(kind, f, obj, x, z) {
    this.kind = kind; this.f = f; this.obj = obj;
    this.x = x; this.z = z; this.rot = Math.random() * 6; this.rotTarget = this.rot;
    this.pace = 0; this.path = []; this.wait = 1 + Math.random() * 3;
    this.bow = false; this.wave = 0; this.speaks = null; this.arrival = null;
    this.lastStep = 0;
  }
  goTo(x, z, L, arrival = null) {
    const w = findPath(L, this.x, this.z, x, z);
    this.path = w || [];
    this.arrival = arrival;
    this.bow = false;
    return !!w;
  }
  glancesTo(x, z) { this.rotTarget = Math.atan2(x - this.x, z - this.z); }
  step(dt, L, speed) {
    if (!this.path.length) { this.pace += (0 - this.pace) * Math.min(1, dt * 8); return false; }
    const [tx, tz] = this.path[0];
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.25) {
      this.path.shift();
      if (!this.path.length) { const a = this.arrival; this.arrival = null; if (a) a(); }
      return true;
    }
    this.pace += (speed - this.pace) * Math.min(1, dt * 5);
    const st = Math.min(d, this.pace * dt);
    this.x += (dx / d) * st; this.z += (dz / d) * st;
    this.rotTarget = Math.atan2(dx, dz);
    return true;
  }
  rotate(dt) {
    let d = this.rotTarget - this.rot;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rot += d * Math.min(1, dt * 10);
  }
}

export class Actors {
  constructor(scene, L, data, ground) {
    this.scene = scene; this.L = L; this.data = data; this.ground = ground;
    this.all = [];
    this.events = [];
    this.placeOfRepo = new Map();
    for (const o of L.places) {
      if (o.repo) this.placeOfRepo.set(o.repo.name, o);
      if (o.partner) this.placeOfRepo.set(o.partner.name, o);
      if (o.repos) for (const r of o.repos) if (!this.placeOfRepo.has(r.name)) this.placeOfRepo.set(r.name, o);
    }
  }

  // Choice: the team members stand in a shallow arc on the square
  setUp() {
    const entries = Object.entries(TEAM);
    this.team = entries.map(([id, f], i) => {
      const obj = buildFigure(f, { lantern: true });
      const x = (i - (entries.length - 1) / 2) * 1.6;
      const a = new Actor('team', { ...f, id }, obj, x, 9.2 - 0.375 * Math.abs(x));
      a.rot = a.rotTarget = 0;
      this.scene.add(obj);
      this.all.push(a);
      return a;
    });
    return this.team;
  }

  choose(id) {
    this.player = this.team.find((a) => a.f.id === id);
    this.player.kind = 'player';
    // the other figures leave; whoever is really online comes back via remote()
    for (const a of this.team) if (a !== this.player) this.remove(a);
    this.aiTeam();
    this.zombies();
  }

  remove(a) {
    this.scene.remove(a.obj);
    const i = this.all.indexOf(a);
    if (i >= 0) this.all.splice(i, 1);
  }

  farCount() { return this.farMap ? this.farMap.size : 0; }

  // State from the server: [{ id, name, own, figure, x, z, rot, bow }]. Returns whether someone came or went.
  remote(list) {
    const map = this.farMap || (this.farMap = new Map());
    const now = performance.now();
    let changed = false;
    const presence = new Set();
    for (const e of list) {
      const f = TEAM[e.figure];
      if (!f || typeof e.x !== 'number' || typeof e.z !== 'number') continue;
      presence.add(e.id);
      let a = map.get(e.id);
      if (a && a.figure !== e.figure) { this.remove(a); map.delete(e.id); a = null; }
      if (!a) {
        // own face only when the figure comes from the login; otherwise someone just wears the figure
        const idFor = e.own ? e.figure : `guest-${e.id}`;
        const obj = buildFigure(f, { lantern: true });
        a = new Actor('online', { ...f, id: idFor, name: e.name || f.name, role: e.own ? f.role : t('visiting') }, obj, e.x, e.z);
        a.figure = e.figure;
        a.rot = a.rotTarget = e.rot || 0;
        a.from = [e.x, e.z]; a.after = [e.x, e.z]; a.since = now;
        this.scene.add(obj);
        this.all.push(a);
        map.set(e.id, a);
        changed = true;
      }
      a.from = [a.x, a.z];
      a.after = [e.x, e.z];
      a.since = now;
      a.duration = Math.max(400, Math.min(3000, now - (a.lastMessage || now - 1500)));
      a.lastMessage = now;
      a.rotFar = e.rot || 0;
      a.bow = !!e.bow;
    }
    for (const [id, a] of map) if (!presence.has(id)) { this.remove(a); map.delete(id); changed = true; }
    return changed;
  }

  aiTeam() {
    const R = rng(11);
    for (const [id, f] of Object.entries(AI_TEAM)) {
      const obj = buildFigure(f, { accent: f.accent });
      const owned = this.data.repos.filter((r) => r.npc?.who === f.name && this.placeOfRepo.has(r.name));
      // mourners mostly visit graves, but also their houses
      const start = owned.length ? targetBefore(this.placeOfRepo.get(owned[Math.floor(R() * owned.length)].name)) : [R() * 10 - 5, R() * 10 - 5];
      const a = new Actor('ai', { ...f, id }, obj, start[0] + R(), start[1] + R());
      a.owned = owned;
      a.wait = R() * 4;
      this.scene.add(obj);
      this.all.push(a);
    }
  }

  zombies() {
    for (const r of this.data.repos.filter((x) => x.zombie)) {
      const o = this.placeOfRepo.get(r.partOf ? r.partOf.name : r.name);
      if (!o) continue;
      const obj = buildFigure(ZOMBIE);
      const [x, z] = targetBefore(o);
      const a = new Actor('zombie', { ...ZOMBIE, name: r.name }, obj, x, z);
      a.repo = r; a.home = [x, z]; a.place = o;
      a.wait = Math.random() * 3;
      this.scene.add(obj);
      this.all.push(a);
    }
  }

  lights() {
    const q = [];
    for (const a of this.all) {
      if (a.kind === 'ai') q.push({ x: a.x, y: 1.95, z: a.z, color: a.f.accent, strength: 1.6, range: 6, flicker: false });
      else if (a.kind === 'zombie') q.push({ x: a.x, y: 1.2, z: a.z, color: '#9dff7a', strength: 0.9, range: 4.5, flicker: false });
      else if (a.kind === 'online') q.push({ x: a.x, y: 0.9, z: a.z, color: '#ffb766', strength: 2.2, range: 7, flicker: true });
    }
    return q;
  }

  update(dt, time, input) {
    const L = this.L;
    for (const a of this.all) {
      if (a.kind === 'player') this.playerStep(a, dt, input);
      else if (a.kind === 'ai') this.aiStep(a, dt, time);
      else if (a.kind === 'zombie') this.zombieStep(a, dt);
      else if (a.kind === 'online') this.onlineStep(a, dt);
      else a.step(dt, L, 0);
      a.rotate(dt);
      a.obj.position.set(a.x, 0, a.z);
      a.obj.rotation.y = a.rot;
      if (a.wave > 0) a.wave -= dt;
      animate(a.obj, dt, { pace: a.pace, bow: a.bow, time, wave: a.wave > 0 });
    }
  }

  playerStep(a, dt, e) {
    const L = this.L;
    if (e.direction && (e.direction.x || e.direction.z)) {
      a.path = []; a.arrival = null; a.bow = false;
      const speed = e.run ? 7.2 : 4.4;
      a.pace += (speed - a.pace) * Math.min(1, dt * 6);
      const vx = e.direction.x * a.pace * dt, vz = e.direction.z * a.pace * dt;
      const free = (x, z) => !blocked(L, x + 0.25, z) && !blocked(L, x - 0.25, z) && !blocked(L, x, z + 0.25) && !blocked(L, x, z - 0.25);
      if (free(a.x + vx, a.z + vz)) { a.x += vx; a.z += vz; }
      else if (free(a.x + vx, a.z)) a.x += vx;
      else if (free(a.x, a.z + vz)) a.z += vz;
      a.rotTarget = Math.atan2(e.direction.x, e.direction.z);
    } else {
      a.step(dt, L, e.run ? 7.2 : 4.6);
    }
    // steps for the sound
    if (a.pace > 0.5) {
      const ph = a.obj.userData.fig.phase;
      const n = Math.floor(ph / Math.PI);
      if (n !== a.lastStep) { a.lastStep = n; this.events.push({ kind: 'step', ground: this.ground.ui(a.x, a.z), pace: a.pace }); }
    }
  }

  aiStep(a, dt, time) {
    const L = this.L;
    if (a.step(dt, L, 1.5)) { a.speaks = null; return; }
    a.wait -= dt;
    if (a.wait > 0) return;
    // next target: one of their own repos, graves preferred
    const R = Math.random;
    let target = null;
    if (a.owned.length) {
      const graves = a.owned.filter((r) => DECEASED.has(r.state) || r.state === 'hospice' || r.state === 'ancestor');
      const pool = graves.length && R() < 0.7 ? graves : a.owned;
      target = pool[Math.floor(R() * pool.length)];
    }
    if (target) {
      const o = this.placeOfRepo.get(target.name);
      const [x, z] = targetBefore(o);
      const ok = a.goTo(x + (R() - 0.5) * 0.8, z + (R() - 0.5) * 0.6, L, () => {
        a.glancesTo(o.x, o.z);
        const paysRespect = DECEASED.has(target.state) || target.state === 'hospice';
        a.bow = paysRespect;
        a.speaks = { repo: target, text: target.npc?.text || '', since: time };
        a.wait = 9 + R() * 8;
        setTimeout(() => { a.bow = false; }, 2600);
      });
      if (!ok) a.wait = 2;
    } else a.wait = 5;
  }

  zombieStep(a, dt) {
    const L = this.L;
    if (a.step(dt, L, 0.75)) return;
    a.wait -= dt;
    if (a.wait > 0) return;
    for (let i = 0; i < 8; i++) {
      const w = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5;
      const x = a.home[0] + Math.cos(w) * r, z = a.home[1] + Math.sin(w) * r;
      if (!blocked(L, x, z) && a.goTo(x, z, L)) break;
    }
    a.wait = 2 + Math.random() * 4;
  }

  // other players walk evenly from the last to the newly reported spot, one report behind
  onlineStep(a, dt) {
    if (!a.after) return;
    const [vx, vz] = a.from, [nx, nz] = a.after;
    const span = Math.hypot(nx - vx, nz - vz);
    if (span > 20) { a.x = nx; a.z = nz; a.from = [nx, nz]; a.pace = 0; return; } // jumped across the map
    const t = Math.min(1, (performance.now() - a.since) / a.duration);
    const x = vx + (nx - vx) * t, z = vz + (nz - vz) * t;
    const st = Math.hypot(x - a.x, z - a.z);
    const pace = t < 1 && span > 0.05 ? span / (a.duration / 1000) : 0;
    a.pace += (pace - a.pace) * Math.min(1, dt * 6);
    if (st > 0.002) a.rotTarget = Math.atan2(x - a.x, z - a.z);
    else if (a.pace < 0.2) a.rotTarget = a.rotFar ?? a.rotTarget;
    a.x = x; a.z = z;
  }

  // nearest place in reach of your own figure (for the hint at the bottom)
  inRange(maxD = 3.6) {
    const s = this.player;
    if (!s) return null;
    let best = null, bd = maxD;
    for (const p of this.L.poi) {
      if (!p.place) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < bd) { bd = d; best = p.place; }
    }
    for (const a of this.all) {
      if (a === s || a.kind === 'team') continue;
      const d = Math.hypot(a.x - s.x, a.z - s.z);
      if (d < Math.min(bd, 2.4)) { bd = d; best = { actor: a }; }
    }
    return best;
  }

  goToPlace(o, arrival) {
    const [x, z] = targetBefore(o);
    return this.player.goTo(x, z, this.L, () => { this.player.glancesTo(o.x, o.z); if (arrival) arrival(); });
  }
}

export { hash, targetBefore, THREE };
