// World layout in metres. x points east, z south, village square at (0, 0).
// The graveyard lies north behind the village with the chapel at the top, the hospice in the west,
// the client quarter in the east behind the archway. Every repo stands exactly once in the world.

import { hash, rng, clamp, smooth, fbm, LIVING, DEAD } from './util.js';
import { THRESHOLDS } from './config.js';
import { t } from './i18n.js';

// Salt for the vault seeds. The value predates the English names and stays, otherwise every vault
// would move to a different spot.
const VAULT_SALT = 'gruft';

export const WORLD = { x0: -150, z0: -128, x1: 150, z1: 88 };
const BW = WORLD.x1 - WORLD.x0, BT = WORLD.z1 - WORLD.z0;

export const SPOT = { x: 0, z: 0, r: 12 };
export const CLIENT_PLAZA = { x: 95, z: 1, r: 8.5 };
export const POND = { x: -66, z: -50, r: 10 };
const GATE_Z = -52;

const STREETS = [
  { id: 'west', width: 5.2, zone: 'village', points: [[-11.5, 0], [-30, 1.2], [-55, 0.4], [-72, 2.6], [-84, 3.8]] },
  { id: 'east', width: 5.2, zone: 'village', points: [[11.5, 0], [30, -1.2], [52, -0.4], [64, -1.1], [76, -0.2], [87, 0.8]] },
  { id: 'north', width: 4.4, zone: 'village', points: [[0, -11.5], [0.8, -24], [-0.6, -38], [0, GATE_Z + 0.5]] },
  { id: 'topW', width: 4, zone: 'village', points: [[-1.5, -27], [-22, -28.6], [-40, -27.4], [-54, -29.2]] },
  { id: 'topO', width: 4, zone: 'village', points: [[1.5, -27], [22, -26], [40, -27.6], [54, -26.4]] },
  { id: 'south', width: 4.4, zone: 'village', points: [[0, 11.5], [-0.8, 21], [0, 30]] },
  { id: 'bottomW', width: 4, zone: 'village', points: [[-1.5, 30], [-22, 31], [-40, 29.8], [-54, 31.6]] },
  { id: 'bottomO', width: 4, zone: 'village', points: [[1.5, 30], [22, 29.4], [40, 31], [54, 30]] },
];

// ---------- geometry helpers ----------

export function curve(pts, step = 1) {
  const raw = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push(pts[n - 1]);
  const out = [];
  let s = 0, nearest = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    if (s >= nearest || i === raw.length - 1) { out.push({ x: raw[i][0], z: raw[i][1], s }); nearest += step; }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(i - 1, 0)], b = out[Math.min(i + 1, out.length - 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out[i].tx = dx / l; out[i].tz = dz / l;
  }
  return out;
}

// rectangle with rotation around y (as in three.js: local +z points to (sin r, cos r))
export function rect(cx, cz, hw, hd, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const p = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  return { cx, cz, hw, hd, rot, corners: [p(-hw, -hd), p(hw, -hd), p(hw, hd), p(-hw, hd)], points: [p(-hw, -hd), p(hw, -hd), p(hw, hd), p(-hw, hd), p(0, -hd), p(0, hd), p(-hw, 0), p(hw, 0), p(0, 0)] };
}
export function inRect(r, x, z, rim = 0) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const dx = x - r.cx, dz = z - r.cz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= r.hw + rim && Math.abs(lz) <= r.hd + rim;
}
function overlaps(a, b, rim) {
  const axes = [];
  for (const r of [a, b]) { axes.push([Math.cos(r.rot), -Math.sin(r.rot)], [Math.sin(r.rot), Math.cos(r.rot)]); }
  const ea = rect(a.cx, a.cz, a.hw + rim, a.hd + rim, a.rot).corners;
  const eb = rect(b.cx, b.cz, b.hw + rim, b.hd + rim, b.rot).corners;
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ea) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of eb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// grid over the whole model board
export class Field {
  constructor(cell, value = 0, Type = Float32Array) {
    this.cell = cell;
    this.nx = Math.ceil(BW / cell);
    this.nz = Math.ceil(BT / cell);
    this.d = new Type(this.nx * this.nz).fill(value);
  }
  i(x) { return Math.floor((x - WORLD.x0) / this.cell); }
  j(z) { return Math.floor((z - WORLD.z0) / this.cell); }
  get(x, z, outer = 0) {
    const i = this.i(x), j = this.j(z);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return outer;
    return this.d[j * this.nx + i];
  }
  center(i, j) { return [WORLD.x0 + (i + 0.5) * this.cell, WORLD.z0 + (j + 0.5) * this.cell]; }
}

function streetsField(streets) {
  const f = new Field(1, 99);
  for (const s of streets) {
    const hb = s.width / 2;
    for (const p of s.curve) {
      const i0 = f.i(p.x), j0 = f.j(p.z);
      for (let j = j0 - 13; j <= j0 + 13; j++) for (let i = i0 - 13; i <= i0 + 13; i++) {
        if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) continue;
        const [x, z] = f.center(i, j);
        const d = Math.hypot(x - p.x, z - p.z) - hb;
        const k = j * f.nx + i;
        if (d < f.d[k]) f.d[k] = d;
      }
    }
  }
  return f;
}

// ---------- main function ----------

export function buildLayout(data) {
  const { repos } = data;
  const L = {
    world: WORLD, spot: SPOT, clientPlaza: CLIENT_PLAZA, pond: POND,
    streets: STREETS.map((s) => ({ ...s, curve: curve(s.points, 1) })),
    paths: [], places: [], trees: [], lanterns: [], benches: [], walls: [], poi: [], obstacles: [],
  };
  const sField = streetsField(L.streets);
  L.streetsField = sField;
  const taken = [];

  // ---- graveyard first, it sets the northern border ----
  const deadAll = repos.filter((r) => DEAD.has(r.state) && !r.partOf);
  const mouse = deadAll.filter((r) => r.grave_tier === 'mausoleum').sort((a, b) => b.commits - a.commits);
  const graves = deadAll.filter((r) => r.grave_tier !== 'mausoleum')
    .sort((a, b) => new Date(b.last_push) - new Date(a.last_push));
  const COLUMNS = [3.9, -3.9, 7.6, -7.6, 11.3, -11.3, 15, -15, 18.7, -18.7];
  const courses = Math.max(2, Math.ceil(graves.length / COLUMNS.length));
  const zRow = (k) => GATE_Z - 5.2 - k * 4.6;
  const zCross = zRow(courses - 1) - 3.6;
  const zMouse = zCross - 5.4;
  const zChapel = zMouse - 6.6;
  const F = { x0: -26, x1: 26, z1: GATE_Z, z0: zChapel - 10.5, gateWidth: 4.4, cross: zCross };
  L.graveyard = F;
  L.obstacles.push({ kind: 'rect', r: rect(0, (F.z0 + F.z1) / 2, (F.x1 - F.x0) / 2 + 3, (F.z1 - F.z0) / 2 + 3, 0) });

  graves.forEach((r, k) => {
    const row = Math.floor(k / COLUMNS.length), x = COLUMNS[k % COLUMNS.length];
    const z = zRow(row) + 1.0;
    const daysDead = Math.max(0, (r.days_since_push || 0) - THRESHOLDS.deadDays);
    const wide = !!r.partner;
    const o = {
      id: 'grave:' + r.name, type: 'grave', repo: r, partner: r.partner || null, tier: wide && r.grave_tier === 'cross' ? 'stone' : r.grave_tier,
      x, z, rot: 0, daysDead, seed: hash(r.name),
    };
    o.foot = rect(x, z, wide ? 1.35 : 0.85, 1.45, 0);
    L.places.push(o);
  });
  mouse.forEach((r, k) => {
    const x = (k % 2 === 0 ? 1 : -1) * (9.5 + Math.floor(k / 2) * 7.5);
    const o = { id: 'mouse:' + r.name, type: 'mausoleum', repo: r, x, z: zMouse, rot: 0, seed: hash(r.name), daysDead: Math.max(0, r.days_since_push - THRESHOLDS.deadDays) };
    o.foot = rect(x, zMouse, 2.4, 2.9, 0);
    L.places.push(o);
  });
  const chapel = { id: 'chapel', type: 'chapel', x: 0, z: zChapel, rot: 0, deceased: deadAll.concat(deadAll.flatMap((r) => (r.partner ? [r.partner] : []))) };
  chapel.foot = rect(0, zChapel - 1.2, 4.6, 8.2, 0);
  L.places.push(chapel);
  L.gate = { x: 0, z: GATE_Z };
  L.paths.push({ kind: 'gravel', width: 3, points: [[0, GATE_Z + 1], [0, zChapel + 7.6]] });
  L.paths.push({ kind: 'gravel', width: 2.4, points: [[F.x0 + 2.5, zCross], [F.x1 - 2.5, zCross]] });

  // wall as segments, with a gap for the gate
  const m = 0.25;
  L.walls.push(
    { a: [F.x0, F.z0], b: [F.x1, F.z0] },
    { a: [F.x0, F.z0], b: [F.x0, F.z1] },
    { a: [F.x1, F.z0], b: [F.x1, F.z1] },
    { a: [F.x0, F.z1], b: [-F.gateWidth / 2 - m, F.z1] },
    { a: [F.gateWidth / 2 + m, F.z1], b: [F.x1, F.z1] },
  );

  // ---- hospice in the west ----
  const patients = repos.filter((r) => r.state === 'hospice').sort((a, b) => (a.hospice_days_left ?? 99) - (b.hospice_days_left ?? 99));
  const hospice = { id: 'hospice', type: 'hospice', x: -101, z: 3.5, rot: Math.PI / 2, patients };
  const verandaLength = Math.max(10, patients.length * 3.6 + 2);
  hospice.veranda = verandaLength;
  hospice.foot = rect(-101, 3.5, Math.max(7.5, verandaLength / 2 + 1), 3.8, Math.PI / 2);
  L.places.push(hospice);
  patients.forEach((r, k) => {
    const z = 3.5 - (patients.length - 1) * 1.8 + k * 3.6;
    const o = { id: 'bed:' + r.name, type: 'bed', repo: r, x: -93.6, z, rot: Math.PI / 2, seed: hash(r.name) };
    o.foot = rect(o.x, z, 0.6, 1.15, Math.PI / 2);
    L.places.push(o);
  });
  L.paths.push({ kind: 'gravel', width: 6, points: [[-84, 3.8], [-90, 3.6]] });
  L.obstacles.push({ kind: 'rect', r: rect(-94, 3.5, 12, 14, 0) });
  L.obstacles.push({ kind: 'circle', x: POND.x, z: POND.z, r: POND.r + 3.5 });
  L.obstacles.push({ kind: 'circle', x: CLIENT_PLAZA.x, z: CLIENT_PLAZA.z, r: CLIENT_PLAZA.r + 0.5 });

  // ---- candidates along the streets ----
  const cand = [];
  for (const s of L.streets) {
    for (let i = 2; i < s.curve.length - 1; i += 2) {
      const p = s.curve[i];
      for (const page of [-1, 1]) {
        cand.push({ x: p.x, z: p.z, nx: -p.tz * page, nz: p.tx * page, gap: s.width / 2, ring: false, clients: p.x > 66 });
      }
    }
  }
  for (let a = 0; a < 360; a += 4) {
    const w = (a * Math.PI) / 180, nx = Math.cos(w), nz = Math.sin(w);
    const nearStreet = [0, 90, 180, 270, 360].some((q) => Math.abs(a - q) < 16);
    if (nearStreet) continue;
    cand.push({ x: SPOT.x + nx * SPOT.r, z: SPOT.z + nz * SPOT.r, nx, nz, gap: 0, ring: true });
  }
  for (let a = 0; a < 360; a += 10) {
    const w = (a * Math.PI) / 180, nx = Math.cos(w), nz = Math.sin(w);
    if (Math.abs(a - 180) < 30) continue;
    cand.push({ x: CLIENT_PLAZA.x + nx * CLIENT_PLAZA.r, z: CLIENT_PLAZA.z + nz * CLIENT_PLAZA.r, nx, nz, gap: 0, ring: true, clients: true });
  }

  function pose(c, width, depth, frontYard, rnd) {
    const before = c.gap + frontYard;
    const cx = c.x + c.nx * (before + depth / 2), cz = c.z + c.nz * (before + depth / 2);
    const rot = Math.atan2(-c.nx, -c.nz) + (rnd() - 0.5) * 0.05;
    return rect(cx, cz, width / 2, depth / 2, rot);
  }
  function free(r, zone) {
    for (const [x, z] of r.points) {
      if (zone === 'village' && (x < -72 || x > 58)) return false;
      if (zone === 'clients' && (x < 68 || x > 117)) return false;
      if (sField.get(x, z, 99) < 0.9) return false;
      if (Math.hypot(x - SPOT.x, z - SPOT.z) < SPOT.r + 1.6) return false;
      for (const h of L.obstacles) {
        if (h.kind === 'circle' && Math.hypot(x - h.x, z - h.z) < h.r) return false;
        if (h.kind === 'rect' && inRect(h.r, x, z)) return false;
      }
    }
    for (const b of taken) if (overlaps(r, b, 1.35)) return false;
    return true;
  }
  function placeAt({ width, depth, target, ring, zone, seed }) {
    const rnd = rng(seed);
    const frontYard = 1.8 + rnd() * 1.5;
    const list = cand
      .filter((c) => (ring === 'only' ? c.ring : ring ? true : !c.ring) && !!c.clients === (zone === 'clients'))
      .map((c) => ({ c, d: Math.hypot(c.x - target[0], c.z - target[1]) }))
      .sort((a, b) => a.d - b.d);
    for (const { c } of list) {
      const r = pose(c, width, depth, frontYard, rnd);
      if (zone === 'clients' && c.ring && !candOk(c)) continue;
      if (free(r, zone)) { taken.push(r); return { r, c }; }
    }
    return null;
  }
  const candOk = () => true;

  // ---- village: families around the square, the largest on the square ----
  const living = repos.filter((r) => LIVING.has(r.state) && !r.partOf);
  const ancestorsBy = new Map();
  for (const r of repos.filter((x) => x.state === 'ancestor')) {
    const k = r.successor || '';
    if (!ancestorsBy.has(k)) ancestorsBy.set(k, []);
    ancestorsBy.get(k).push(r);
  }
  const families = new Map();
  for (const r of living) {
    if (!families.has(r.family)) families.set(r.family, []);
    families.get(r.family).push(r);
  }
  const famList = [...families.values()]
    .map((g) => ({ g: g.sort((a, b) => b.commits - a.commits), sum: g.reduce((s, r) => s + r.commits + (r.partner?.commits || 0), 0) }))
    .sort((a, b) => b.sum - a.sum);

  const houseOf = new Map();
  function houseMass(r, rnd) {
    const c = r.commits + (r.partner?.commits || 0);
    const tier = c >= 2000 ? 4 : c >= 500 ? 3 : c >= 100 ? 2 : c >= 20 ? 1 : 0;
    const width = [5.4, 6.3, 7.3, 8.4, 9.6][tier] + rnd() * 0.5;
    const depth = [5.6, 6.4, 7.2, 8.2, 9][tier] + rnd() * 0.5;
    const annex = r.partner ? 3.8 : 0;
    return { tier, width, depth, annex, floors: [1, 1, 2, 2, 3][tier] };
  }
  function setHouse(r, target, ring, zone, type) {
    const rnd = rng(hash(r.name));
    const m = houseMass(r, rnd);
    const total = m.width + m.annex;
    let p = placeAt({ width: total, depth: m.depth, target, ring, zone, seed: hash(r.name) + 7 });
    if (!p && ring === 'only') p = placeAt({ width: total, depth: m.depth, target, ring: false, zone, seed: hash(r.name) + 7 });
    if (!p) { console.warn('No spot for', r.name); return null; }
    const annexPage = rnd() < 0.5 ? -1 : 1;
    // shift the centre of the main house against the whole rectangle when an annex is added
    const shift = m.annex ? -annexPage * m.annex / 2 : 0;
    const c = Math.cos(p.r.rot), s = Math.sin(p.r.rot);
    const o = {
      id: type + ':' + r.name, type, repo: r, partner: r.partner || null,
      x: p.r.cx + shift * c, z: p.r.cz - shift * s, rot: p.r.rot,
      width: m.width, depth: m.depth, tier: m.tier, floors: m.floors,
      annex: m.annex ? { page: annexPage, width: 3.4, depth: Math.min(4.6, m.depth - 1) } : null,
      gableFront: rnd() < 0.62, seed: hash(r.name), foot: p.r,
    };
    L.places.push(o);
    houseOf.set(r.name, o);
    return o;
  }
  function setVault(byName) {
    const list = ancestorsBy.get(byName);
    const after = houseOf.get(byName);
    if (!list || !after) return;
    const p = placeAt({ width: 3.4, depth: 3.8, target: [after.x, after.z], ring: true, zone: 'village', seed: hash(VAULT_SALT + byName) });
    if (!p) return;
    L.places.push({ id: 'vault:' + byName, type: 'vault', successor: after.repo, repos: list, x: p.r.cx, z: p.r.cz, rot: p.r.rot, foot: p.r, seed: hash(VAULT_SALT + byName) });
    ancestorsBy.delete(byName);
  }
  for (const { g } of famList) {
    const head = g[0];
    const inRing = head.commits >= 900;
    const headHouse = setHouse(head, [SPOT.x, SPOT.z], inRing ? 'only' : false, 'village', 'house');
    if (!headHouse) continue;
    setVault(head.name);
    for (const r of g.slice(1)) {
      if (setHouse(r, [headHouse.x, headHouse.z], false, 'village', 'house')) setVault(r.name);
    }
  }
  // ancestors without a living successor: vault at the graveyard
  for (const [after, list] of ancestorsBy) {
    const p = placeAt({ width: 3.4, depth: 3.8, target: [0, GATE_Z + 8], ring: false, zone: 'village', seed: hash(VAULT_SALT + after) });
    if (p) L.places.push({ id: 'vault:' + after, type: 'vault', successor: { name: after }, repos: list, x: p.r.cx, z: p.r.cz, rot: p.r.rot, foot: p.r, seed: hash(after) });
  }

  // ---- client quarter ----
  const clients = new Map();
  for (const r of repos.filter((x) => x.state === 'client_active' || x.state === 'delivered')) {
    const k = r.client || 'Kunde';
    if (!clients.has(k)) clients.set(k, []);
    clients.get(k).push(r);
  }
  const clientsList = [...clients.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [client, list] of clientsList) {
    list.sort((a, b) => (a.state === b.state ? b.commits - a.commits : a.state === 'client_active' ? -1 : 1));
    let anchor = null;
    for (const r of list) {
      const target = anchor ? [anchor.x, anchor.z] : [71, 0];
      if (r.state === 'client_active') {
        const o = setHouse(r, target, true, 'clients', 'clientHouse');
        if (o && !anchor) anchor = o;
      } else {
        const p = placeAt({ width: 3.4, depth: 3.4, target: anchor ? target : [CLIENT_PLAZA.x, CLIENT_PLAZA.z], ring: true, zone: 'clients', seed: hash(r.name) });
        if (!p) continue;
        const shapes = ['obelisk', 'stele', 'sphere'];
        const o = { id: 'monument:' + r.name, type: 'monument', repo: r, x: p.r.cx, z: p.r.cz, rot: p.r.rot, form: shapes[hash(r.name) % 3], foot: p.r, seed: hash(r.name) };
        L.places.push(o);
        if (!anchor) anchor = o;
      }
    }
    if (anchor) {
      // sign by the street in front of the client's first house
      const c = Math.cos(anchor.rot), s = Math.sin(anchor.rot);
      const before = (anchor.depth || 3.4) / 2 + 1.2;
      const x = anchor.x + s * before - c * ((anchor.width || 3.4) / 2 + 0.6), z = anchor.z + c * before + s * ((anchor.width || 3.4) / 2 + 0.6);
      L.places.push({ id: 'sign:' + client, type: 'clientSign', client, repos: list, x, z, rot: anchor.rot, foot: rect(x, z, 0.5, 0.3, anchor.rot), seed: hash(client) });
    }
  }
  L.archway = { x: 63.5, z: -1.0, rot: Math.PI / 2 };

  // ---- street lanterns ----
  const lamps = [];
  const lampFree = (x, z) => {
    if (lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 7)) return false;
    for (const b of taken) if (inRect(b, x, z, 1.2)) return false;
    for (const o of L.places) if (o.foot && inRect(o.foot, x, z, 1.0)) return false;
    if (Math.hypot(x - SPOT.x, z - SPOT.z) < SPOT.r + 2) return false;
    if (Math.abs(x - L.archway.x) < 3 && Math.abs(z - L.archway.z) < 5) return false;
    return true;
  };
  for (const s of L.streets) {
    let page = 1;
    for (let i = 6; i < s.curve.length - 2; i += 15) {
      const p = s.curve[i];
      for (const sd of [page, -page]) {
        const x = p.x - p.tz * sd * (s.width / 2 + 0.7), z = p.z + p.tx * sd * (s.width / 2 + 0.7);
        if (lampFree(x, z)) { lamps.push({ x, z }); break; }
      }
      page = -page;
    }
  }
  for (const a of [45, 135, 225, 315]) {
    const w = (a * Math.PI) / 180;
    lamps.push({ x: SPOT.x + Math.cos(w) * (SPOT.r - 1.4), z: SPOT.z + Math.sin(w) * (SPOT.r - 1.4) });
  }
  for (const a of [60, 180, 300]) {
    const w = (a * Math.PI) / 180;
    lamps.push({ x: CLIENT_PLAZA.x + Math.cos(w) * (CLIENT_PLAZA.r - 1), z: CLIENT_PLAZA.z + Math.sin(w) * (CLIENT_PLAZA.r - 1) });
  }
  for (const x of [F.x0 + 3, F.x1 - 3]) lamps.push({ x, z: zCross - 1.6, small: true });
  for (const x of [-3.2, 3.2]) lamps.push({ x, z: zChapel + 9.6, small: true });
  L.lanterns = lamps;

  // ---- benches ----
  L.benches.push({ x: -6.2, z: 6.4, rot: Math.PI * 0.82 + Math.PI }, { x: 6.2, z: 6.4, rot: -Math.PI * 0.82 - Math.PI });
  L.benches.push({ x: -9, z: zCross + 1.9, rot: 0 }, { x: 9, z: zCross + 1.9, rot: 0 });
  L.benches.push({ x: POND.x + 9, z: POND.z + 9.5, rot: Math.PI * 1.25 });

  // ---- trees ----
  trees(L, taken, sField);

  // ---- zones ----
  L.zones = [
    { id: 'graveyard', name: t('places.graveyard'), sentence: t('zones.graveyard.sentence', { dead: THRESHOLDS.deadDays }), inside: (x, z) => x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1 },
    { id: 'hospice', name: t('places.hospice'), sentence: t('zones.hospice.sentence', { alive: THRESHOLDS.aliveDays, dead: THRESHOLDS.deadDays }), inside: (x) => x < -81 },
    { id: 'clients', name: t('places.clients'), sentence: t('zones.clients.sentence'), inside: (x) => x > 62 },
    { id: 'village', name: t('places.village'), sentence: t('zones.village.sentence'), inside: () => true },
  ];

  // ---- collision and targets for figures ----
  raster(L, taken);
  targets(L);
  return L;
}

// ---------- trees: forest around the clearing, cypresses in the graveyard ----------

function trees(L, taken, sField) {
  const F = L.graveyard;
  // clearing: distance to everything that is built
  const f = new Field(2, 9999);
  const nx = f.nx, nz = f.nz;
  const mark = (x, z) => { const i = f.i(x), j = f.j(z); if (i >= 0 && j >= 0 && i < nx && j < nz) f.d[j * nx + i] = 0; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const [x, z] = f.center(i, j);
    if (sField.get(x, z, 99) < 2) f.d[j * nx + i] = 0;
    if (Math.hypot(x - SPOT.x, z - SPOT.z) < SPOT.r + 3) f.d[j * nx + i] = 0;
    if (Math.hypot(x - CLIENT_PLAZA.x, z - CLIENT_PLAZA.z) < CLIENT_PLAZA.r + 3) f.d[j * nx + i] = 0;
    if (x > F.x0 - 3 && x < F.x1 + 3 && z > F.z0 - 3 && z < F.z1 + 3) f.d[j * nx + i] = 0;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 4) f.d[j * nx + i] = 0;
    if (x < -79 && x > -113 && Math.abs(z - 3.5) < 14) f.d[j * nx + i] = 0;
  }
  for (const b of taken) for (const [x, z] of b.points) mark(x, z);
  for (const o of L.places) if (o.foot) for (const [x, z] of o.foot.points) mark(x, z);
  // distance transform (chamfer, two passes)
  const a = 2, d2 = 2 * Math.SQRT2;
  const D = f.d;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + a);
    if (j > 0) { v = Math.min(v, D[k - nx] + a); if (i > 0) v = Math.min(v, D[k - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + d2); }
    D[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = D[k];
    if (i < nx - 1) v = Math.min(v, D[k + 1] + a);
    if (j < nz - 1) { v = Math.min(v, D[k + nx] + a); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + d2); if (i > 0) v = Math.min(v, D[k + nx - 1] + d2); }
    D[k] = v;
  }
  L.clearing = f;

  const rnd = rng(4242);
  const list = [];
  const cell = 4.6;
  for (let z = WORLD.z0 + 3; z < WORLD.z1 - 3; z += cell) {
    for (let x = WORLD.x0 + 3; x < WORLD.x1 - 3; x += cell) {
      const px = x + (rnd() - 0.5) * cell * 0.9, pz = z + (rnd() - 0.5) * cell * 0.9;
      const d = f.get(px, pz, 0);
      let p = d < 5 ? 0 : d < 9 ? 0.1 : smooth(9, 26, d) * 0.85 + 0.1;
      if (d > 45 && rnd() < 0.35) p = 0; // sparser further out, which saves computing time
      if (rnd() > p) continue;
      const north = pz < -55, east = px > 60, nearGraveyard = px > F.x0 - 30 && px < F.x1 + 30 && pz < F.z1 + 10;
      let kind;
      const w = rnd();
      if (d < 9) kind = w < 0.5 ? 'bush' : 'foliage';
      else if (nearGraveyard) kind = w < 0.12 ? 'bare' : w < 0.72 ? 'fir' : 'foliage';
      else if (north) kind = w < 0.06 ? 'bare' : w < 0.62 ? 'fir' : 'foliage';
      else kind = w < 0.03 ? 'bare' : w < (east ? 0.4 : 0.3) ? 'fir' : w < 0.92 ? 'foliage' : 'bush';
      const scale = (kind === 'bush' ? 0.8 : 0.85) + rnd() * 0.45 + smooth(10, 60, d) * 0.35;
      list.push({ x: px, z: pz, kind, scale, seed: Math.floor(rnd() * 1e9), rotation: rnd() * Math.PI * 2 });
    }
  }
  // garden trees behind some houses
  for (const o of L.places) {
    if (o.type !== 'house' || rng(o.seed + 3)() > 0.55) continue;
    const r2 = rng(o.seed + 5);
    const s = Math.sin(o.rot), c = Math.cos(o.rot);
    const back = o.depth / 2 + 2.6 + r2() * 1.5, side = (r2() - 0.5) * o.width;
    const x = o.x - s * back + c * side, z = o.z - c * back - s * side;
    if (sField.get(x, z, 99) < 2.5) continue;
    if (taken.some((b) => inRect(b, x, z, 1.2))) continue;
    if (Math.hypot(x - SPOT.x, z - SPOT.z) < SPOT.r + 3) continue;
    list.push({ x, z, kind: r2() < 0.7 ? 'foliage' : 'bush', scale: 0.75 + r2() * 0.3, seed: o.seed, rotation: r2() * 6.28 });
  }
  // lime trees on the square
  for (const [x, z] of [[-15.5, -12.5], [15.8, 12.8]]) {
    if (!taken.some((b) => inRect(b, x, z, 1.5))) list.push({ x, z, kind: 'foliage', scale: 1.35, seed: Math.floor(x * 100), rotation: 1 });
  }
  // cypresses along the graveyard wall and the main path
  for (let x = F.x0 + 2; x <= F.x1 - 2; x += 6.5) list.push({ x, z: F.z0 + 1.6, kind: 'cypress', scale: 0.95 + rnd() * 0.25, seed: Math.floor(x * 31), rotation: 0 });
  for (let z = F.z1 - 4; z > F.z0 + 4; z -= 7) {
    for (const x of [F.x0 + 1.6, F.x1 - 1.6]) list.push({ x, z, kind: 'cypress', scale: 0.85 + rnd() * 0.3, seed: Math.floor(z * 17 + x), rotation: 0 });
  }
  for (const x of [-2.6, 2.6]) list.push({ x, z: F.cross - 2.6, kind: 'cypress', scale: 0.9, seed: Math.floor(x * 9), rotation: 0 });
  // one old bare oak behind the chapel, one at the gate
  list.push({ x: F.x1 - 6, z: F.z0 + 5, kind: 'bare', scale: 1.6, seed: 77, rotation: 0.6 });
  list.push({ x: -9.5, z: F.z1 + 4.5, kind: 'bare', scale: 1.15, seed: 78, rotation: 2.2 });
  L.trees = list.filter((b) => b.x > WORLD.x0 + 2 && b.x < WORLD.x1 - 2 && b.z > WORLD.z0 + 2 && b.z < WORLD.z1 - 2);
}

// ---------- collision grid and path finding ----------

function raster(L, taken) {
  const R = new Field(1, 0, Uint8Array);
  const lock = (x, z) => { const i = R.i(x), j = R.j(z); if (i >= 0 && j >= 0 && i < R.nx && j < R.nz) R.d[j * R.nx + i] = 1; };
  const lockRect = (r, rim = 0.35) => {
    const ex = r.hw + r.hd + rim + 1;
    for (let z = Math.floor(r.cz - ex); z <= r.cz + ex; z++) for (let x = Math.floor(r.cx - ex); x <= r.cx + ex; x++) {
      if (inRect(r, x + 0.5, z + 0.5, rim)) lock(x + 0.5, z + 0.5);
    }
  };
  const lockCircle = (cx, cz, r) => {
    for (let z = Math.floor(cz - r - 1); z <= cz + r + 1; z++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) lock(x + 0.5, z + 0.5);
    }
  };
  for (const b of taken) lockRect(b, 0.2);
  for (const o of L.places) {
    if (!o.foot) continue;
    if (o.type === 'hospice') {
      // block only the house, the veranda stays walkable
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      lockRect({ ...o.foot, cx: o.x - s * 2.6, cz: o.z - c * 2.6, hd: 2.6 }, 0.3);
      continue;
    }
    lockRect(o.foot, o.type === 'grave' ? 0.15 : 0.35);
  }
  for (const m of L.walls) {
    const n = Math.ceil(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * 2);
    for (let k = 0; k <= n; k++) {
      const x = m.a[0] + ((m.b[0] - m.a[0]) * k) / n, z = m.a[1] + ((m.b[1] - m.a[1]) * k) / n;
      lock(x, z); lock(x + 0.4, z); lock(x - 0.4, z); lock(x, z + 0.4); lock(x, z - 0.4);
    }
  }
  lockCircle(L.spot.x, L.spot.z, 3.2);
  lockCircle(L.pond.x, L.pond.z, L.pond.r + 0.4);
  for (const l of L.lanterns) lock(l.x, l.z);
  for (const b of L.benches) lockRect(rect(b.x, b.z, 0.9, 0.35, b.rot), 0.1);
  for (const b of L.trees) {
    if (b.kind === 'bush') lockCircle(b.x, b.z, 0.6 * b.scale);
    else lockCircle(b.x, b.z, b.kind === 'cypress' ? 0.6 : 0.55 * b.scale);
  }
  // dense forest and edge of the model board
  for (let j = 0; j < R.nz; j++) for (let i = 0; i < R.nx; i++) {
    const [x, z] = R.center(i, j);
    if (L.clearing.get(x, z, 999) > 26 || x < WORLD.x0 + 6 || x > WORLD.x1 - 6 || z < WORLD.z0 + 6 || z > WORLD.z1 - 6) R.d[j * R.nx + i] = 1;
  }
  // keep the gate open
  for (let z = L.gate.z - 2; z <= L.gate.z + 2; z++) for (let x = -1.5; x <= 1.5; x++) {
    const i = R.i(x), j = R.j(z);
    if (i >= 0 && j >= 0) R.d[j * R.nx + i] = 0;
  }
  L.raster = R;
}

export function blocked(L, x, z) {
  return L.raster.get(x, z, 1) === 1;
}

function view(L, a, b) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2.5);
  for (let k = 1; k < n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
    if (blocked(L, x, z) || blocked(L, x + 0.3, z) || blocked(L, x - 0.3, z) || blocked(L, x, z + 0.3) || blocked(L, x, z - 0.3)) return false;
  }
  return true;
}

// A* with eight neighbours, smoothed afterwards
export function findPath(L, x0, z0, x1, z1, maxSteps = 60000) {
  const R = L.raster;
  let si = R.i(x0), sj = R.j(z0), ti = R.i(x1), tj = R.j(z1);
  const ok = (i, j) => i >= 0 && j >= 0 && i < R.nx && j < R.nz && R.d[j * R.nx + i] === 0;
  // target blocked: look for the nearest free cell
  if (!ok(ti, tj)) {
    let best = null;
    for (let r = 1; r < 8 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (ok(ti + di, tj + dj) && (!best || Math.hypot(di, dj) < best.d)) best = { i: ti + di, j: tj + dj, d: Math.hypot(di, dj) };
    }
    if (!best) return null;
    ti = best.i; tj = best.j;
  }
  if (!ok(si, sj)) {
    for (let r = 1; r < 4; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (ok(si + di, sj + dj)) { si += di; sj += dj; r = 9; dj = 99; break; }
  }
  const N = R.nx * R.nz;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const to = new Uint8Array(N);
  const heap = [];
  const push = (k, f) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
    }
    return top;
  };
  const h = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
  const s = sj * R.nx + si, t = tj * R.nx + ti;
  g[s] = 0; push(s, h(si, sj));
  let steps = 0;
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length && steps++ < maxSteps) {
    const [, k] = pop();
    if (k === t) break;
    if (to[k]) continue;
    to[k] = 1;
    const i = k % R.nx, j = (k / R.nx) | 0;
    for (const [di, dj, c] of NB) {
      const ni = i + di, nj = j + dj;
      if (!ok(ni, nj)) continue;
      if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue;
      const nk = nj * R.nx + ni, ng = g[k] + c;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(nk, ng + h(ni, nj)); }
    }
  }
  if (from[t] === -1 && t !== s) return null;
  const raw = [];
  for (let k = t; k !== -1; k = from[k]) { const [x, z] = R.center(k % R.nx, (k / R.nx) | 0); raw.push([x, z]); if (k === s) break; }
  raw.reverse();
  if (raw.length && !blocked(L, x1, z1)) raw[raw.length - 1] = [x1, z1];
  // smooth: jump as far as the view is clear
  const smoothed = [];
  let a = [x0, z0];
  let i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !view(L, a, raw[j])) j--;
    smoothed.push(raw[j]);
    a = raw[j];
    i = j + 1;
  }
  return smoothed;
}

// targets for figures: in front of doors, graves, benches
function targets(L) {
  const before = (o, d) => {
    const s = Math.sin(o.rot || 0), c = Math.cos(o.rot || 0);
    const t = (o.depth || (o.foot ? o.foot.hd * 2 : 2)) / 2 + d;
    return [o.x + s * t, o.z + c * t];
  };
  for (const o of L.places) {
    let p;
    if (o.type === 'grave') p = [o.x + 0.2, o.z + 2.2];
    else if (o.type === 'bed') p = [o.x + 1.4, o.z];
    else if (o.type === 'chapel') p = [o.x, o.z + 9.2];
    else if (o.type === 'hospice') continue;
    else p = before(o, 1.6);
    if (!blocked(L, p[0], p[1])) L.poi.push({ x: p[0], z: p[1], place: o });
  }
  for (const b of L.benches) {
    const p = [b.x + Math.sin(b.rot) * 1.1, b.z + Math.cos(b.rot) * 1.1];
    if (!blocked(L, p[0], p[1])) L.poi.push({ x: p[0], z: p[1], place: null });
  }
  for (let k = 0; k < 8; k++) {
    const w = (k / 8) * Math.PI * 2;
    L.poi.push({ x: Math.cos(w) * 6.5, z: Math.sin(w) * 6.5, place: null });
  }
}

export function zoneAt(L, x, z) {
  return L.zones.find((zo) => zo.inside(x, z));
}
