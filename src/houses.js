// Buildings: houses (timber frame, plaster, clinker), ancestral vault, hospice, chapel, mausoleum.
// Everything in local coordinates, the front faces +z, merged per material at the end.

import * as THREE from 'three';
import { Builder, MAT, T, box, cyl, sphere, cone, prism, form, lightMaterial, color, merge } from './build.js';
import { rng, windowLight } from './util.js';
import { textTexture } from './textures.js';
import { t } from './i18n.js';

const PLASTER = ['#ece2cb', '#e6d3ae', '#e0c9bb', '#d3d7d6', '#dbd3b0', '#eadcc4', '#dcc5a4', '#e4d9cf'];
const ROOFS = ['#9a5038', '#83452f', '#6a473a', '#4f5868', '#5d664d', '#7a4033', '#8c5a3c'];
const SHUTTERS = ['#3f5d4c', '#475a72', '#743d33', '#5d5448', '#2f4a44', null, null, null];
const BAR = ['#3b2a20', '#34261f', '#47331f', '#2e2622'];
const DOORS = ['#5a3a26', '#3f4f5f', '#6b3328', '#3a4a3a', '#4a3a30'];
const WARM = '#ffb45e';

const _v = new THREE.Vector3();

// local point -> world
export function wp(o, lx, ly, lz) {
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
  return [o.x + lx * c + lz * s, ly, o.z - lx * s + lz * c];
}

function mm(F, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  return F.clone().multiply(T(x, y, z, ry, rx, rz));
}

function light(list, o, base, lx, ly, lz, colorHex, strength, range, kind, ground = 0, groundStrength = 1) {
  _v.set(lx, ly, lz).applyMatrix4(base);
  const [x, y, z] = wp(o, _v.x, _v.y, _v.z);
  list.push({ x, y, z, color: colorHex, strength, range, kind, ground, groundStrength, flicker: kind === 'candle' || kind === 'lantern' });
}

// ---------- parts ----------

function windows(B, F, x, y, w, h, st) {
  const rf = st.frame;
  const t = 0.1;
  B.add('wood', box(w + 0.2, 0.09, t + 0.04), mm(F, x, y + h + 0.045, (t + 0.04) / 2), rf);
  B.add('wood', box(0.09, h, t), mm(F, x - w / 2 - 0.045, y + h / 2, t / 2), rf);
  B.add('wood', box(0.09, h, t), mm(F, x + w / 2 + 0.045, y + h / 2, t / 2), rf);
  B.add('stone', box(w + 0.3, 0.07, 0.2, 0.015), mm(F, x, y - 0.035, 0.1), '#c9c1b2');
  const bright = st.on ? new THREE.Color().setScalar(0.65 + st.rnd() * 0.45) : '#ffffff';
  B.add('glass', box(w, h, 0.02), mm(F, x, y + h / 2, 0.025), bright, { material: st.on ? st.glass : MAT.glass, uv: 'own' });
  B.add('wood', box(0.045, h, 0.035), mm(F, x, y + h / 2, 0.05), rf);
  B.add('wood', box(w, 0.045, 0.035), mm(F, x, y + h * 0.64, 0.05), rf);
  if (st.shutters) {
    for (const s of [-1, 1]) {
      B.add('wood', box(w * 0.52, h + 0.06, 0.045), mm(F, x + s * (w * 0.76 + 0.12), y + h / 2, 0.035), st.shutters);
      B.add('wood', box(w * 0.46, 0.04, 0.02), mm(F, x + s * (w * 0.76 + 0.12), y + h * 0.3, 0.065), merge(st.shutters, '#000000', 0.3));
      B.add('wood', box(w * 0.46, 0.04, 0.02), mm(F, x + s * (w * 0.76 + 0.12), y + h * 0.72, 0.065), merge(st.shutters, '#000000', 0.3));
    }
  }
  if (st.planter) {
    B.add('wood', box(w + 0.1, 0.18, 0.2, 0.02), mm(F, x, y - 0.16, 0.22), '#5b3d2b');
    const R = st.rnd;
    const tones = ['#c8433a', '#e6e0d2', '#d9718c', '#e8b54a', '#b0509e'];
    const sound = tones[Math.floor(R() * tones.length)];
    for (let i = 0; i < 9; i++) {
      const fx = x - w / 2 + 0.06 + (i / 8) * (w - 0.12);
      B.add('leaf', sphere(0.055 + R() * 0.03, 7, 5), mm(F, fx, y - 0.03 + R() * 0.05, 0.22 + (R() - 0.5) * 0.08), i % 3 === 0 ? '#3e6a3c' : sound);
    }
  }
}

function door(B, F, x, w, h, st) {
  const frame = st.frameStone ? '#bab1a3' : st.frame;
  const mat = st.frameStone ? 'stone' : 'wood';
  B.add(mat, box(w + 0.36, 0.14, 0.16), mm(F, x, h + 0.07, 0.08), frame);
  B.add(mat, box(0.16, h, 0.15), mm(F, x - w / 2 - 0.09, h / 2, 0.075), frame);
  B.add(mat, box(0.16, h, 0.15), mm(F, x + w / 2 + 0.09, h / 2, 0.075), frame);
  const s = new THREE.Shape();
  if (st.round) {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0);
  } else {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  }
  B.add('wood', form(s, 0.07, 0.012, `door${w},${h},${st.round}`), mm(F, x, 0, 0.06), st.color);
  for (const yy of [0.35, h - 0.5]) B.add('metal', box(w * 0.8, 0.035, 0.02), mm(F, x, yy, 0.1), '#2a2a2e');
  B.add('brass', sphere(0.035, 8, 6), mm(F, x + w * 0.32, h * 0.47, 0.11), '#d1aa62');
  B.add('stone', box(w + 0.7, 0.16, 0.6, 0.03), mm(F, x, 0.08, 0.3), '#a39c90');
}

function wallLantern(B, F, x, y, glass) {
  B.add('metal', box(0.05, 0.05, 0.28), mm(F, x, y + 0.2, 0.14), '#1e1f24');
  B.add('metal', box(0.22, 0.04, 0.22), mm(F, x, y + 0.2, 0.3), '#1e1f24');
  B.add('glass', box(0.16, 0.24, 0.16), mm(F, x, y + 0.05, 0.3), '#ffffff', { material: glass, uv: 'own' });
  B.add('metal', cone(0.15, 0.12, 4), mm(F, x, y + 0.28, 0.3, Math.PI / 4), '#1e1f24');
  B.add('metal', box(0.18, 0.03, 0.18), mm(F, x, y - 0.08, 0.3), '#1e1f24');
}

// timber frame on a wall (local: x across, y up, z outwards)
function timber(B, F, fw, y0, y1, openings, rnd, colorB, withStruts = true) {
  const b = 0.15, t = 0.05;
  B.add('bar', box(fw, b, t), mm(F, 0, y0 + b / 2, t / 2), colorB);
  B.add('bar', box(fw, b, t), mm(F, 0, y1 - b / 2, t / 2), colorB);
  const inOpenings = (x, rim = 0) => openings.some((o) => Math.abs(x - o.x) < o.w / 2 + rim);
  const pf = [-fw / 2 + b / 2, fw / 2 - b / 2];
  for (const o of openings) pf.push(o.x - o.w / 2 - b / 2 - 0.16, o.x + o.w / 2 + b / 2 + 0.16);
  pf.sort((a, c) => a - c);
  const all = [];
  for (let i = 0; i < pf.length; i++) {
    all.push(pf[i]);
    if (i < pf.length - 1) {
      const gap = pf[i + 1] - pf[i];
      const n = Math.floor(gap / 1.25);
      for (let k = 1; k <= n; k++) { const x = pf[i] + (gap * k) / (n + 1); if (!inOpenings(x, 0.1)) all.push(x); }
    }
  }
  all.sort((a, c) => a - c);
  const post = all.filter((x, i) => (i === 0 || x - all[i - 1] > 0.3) && Math.abs(x) <= fw / 2 && !inOpenings(x, 0.05));
  const h = y1 - y0 - 2 * b;
  for (const x of post) B.add('bar', box(b, h, t), mm(F, x, (y0 + y1) / 2, t / 2), colorB);
  // breast and lintel rails
  const rails = [y0 + 0.82, y0 + 2.18].filter((y) => y < y1 - 0.3);
  for (let i = 0; i < post.length - 1; i++) {
    const a = post[i] + b / 2, c = post[i + 1] - b / 2;
    if (c - a < 0.1) continue;
    const center = (a + c) / 2;
    const open = inOpenings(center);
    for (const y of rails) {
      if (open) continue;
      B.add('bar', box(c - a, b * 0.85, t), mm(F, center, y, t / 2), colorB);
    }
    // braces in free fields, mirrored around the centre
    if (withStruts && !open && c - a > 0.55 && rnd() < 0.85) {
      const dir = center < 0 ? 1 : -1;
      const ya = y0 + b, yb = y1 - b;
      const len = Math.hypot(c - a, yb - ya);
      const ang = Math.atan2(yb - ya, (c - a) * dir);
      B.add('bar', box(len, b * 0.85, t * 0.9), mm(F, center, (ya + yb) / 2, t / 2, 0, 0, ang), colorB);
    }
  }
}

function row(fw, n) {
  if (n <= 1) return [0];
  const sp = (fw - 1.1) / n;
  return Array.from({ length: n }, (_, i) => -fw / 2 + 0.55 + sp * (i + 0.5));
}

// ---------- house ----------

function houseBody(B, base, o, p, rnd, lights, signs) {
  const { width: w, depth: d, floors, gableFront, style } = p;
  const plinthH = 0.42, gH = 2.65;
  const timberStyle = style === 'timber';
  const clinker = style === 'clinker';
  const cantilever = timberStyle && floors >= 2 ? 0.16 : 0;
  const plasterColor = color(PLASTER[Math.floor(rnd() * PLASTER.length)]);
  const roofColor = clinker ? color(['#4a5160', '#3f4655', '#525a63'][Math.floor(rnd() * 3)]) : color(ROOFS[Math.floor(rnd() * ROOFS.length)]);
  const barColor = BAR[Math.floor(rnd() * BAR.length)];
  const shutters = clinker ? null : SHUTTERS[Math.floor(rnd() * SHUTTERS.length)];
  const frame = clinker ? '#e9e4da' : rnd() < 0.5 ? '#efe8da' : barColor;
  const wallMat = clinker ? 'brick' : 'plaster';
  const wallColor = clinker ? '#ffffff' : plasterColor;
  const lightColor = p.lightColor;
  const glass = lightMaterial(lightColor, p.glow);
  const share = p.share;

  // plinth and ground floor
  B.add('stone', box(w + 0.08, plinthH, d + 0.08, 0.03), mm(base, 0, plinthH / 2, 0), '#8e8a82');
  const wand1 = gH;
  B.add(wallMat, box(w, wand1, d, 0.035), mm(base, 0, plinthH + wand1 / 2, 0), wallColor);
  let W2 = w, D2 = d;
  if (floors > 1) {
    W2 = w + cantilever * 2; D2 = d + cantilever * 2;
    const hh = (floors - 1) * gH;
    B.add(wallMat, box(W2, hh, D2, 0.035), mm(base, 0, plinthH + wand1 + hh / 2, 0), wallColor);
    if (cantilever) {
      // beam heads under the jetty
      for (const s of [-1, 1]) for (let i = 0; i < Math.floor(w / 0.6); i++) {
        const x = -w / 2 + 0.3 + i * 0.6;
        B.add('bar', box(0.12, 0.12, cantilever + 0.04), mm(base, x, plinthH + wand1 - 0.06, s * (d / 2 + cantilever / 2)), barColor);
      }
    }
  }
  const wallH = plinthH + floors * gH;

  // roof
  const pitch = (gableFront ? 50 : 44) * (Math.PI / 180) + (rnd() - 0.5) * 0.08;
  const cross = gableFront ? W2 : D2; // width under the gable
  const long = gableFront ? D2 : W2; // ridge length
  const hR = (cross / 2) * Math.tan(pitch);
  const firstY = wallH + hR;
  const over = 0.42, gableOver = clinker ? 0.05 : 0.32;
  const thick = 0.17;
  const Lp = (cross / 2 + over) / Math.cos(pitch);
  const rotY = gableFront ? 0 : Math.PI / 2;
  const D = mm(base, 0, 0, 0, rotY); // roof space: x across, z along the ridge
  // attic volume with gable faces
  B.add(wallMat, prism(cross - 0.002, hR, long - 0.002), mm(D, 0, wallH, 0), wallColor);
  const roofMat = clinker ? 'slate' : 'roof';
  for (const s of [-1, 1]) {
    const cx = s * (Math.cos(pitch) * Lp / 2 + Math.sin(pitch) * thick / 2) - s * 0.03;
    const cy = firstY - Math.sin(pitch) * Lp / 2 + Math.cos(pitch) * thick / 2;
    B.add(roofMat, box(Lp, thick, long + gableOver * 2), mm(D, cx, cy, 0, Math.PI / 2 * 0, 0, -s * pitch), roofColor, { tile: 2 });
    // eaves board
    B.add('wood', box(0.06, 0.16, long + gableOver * 2), mm(D, s * (cross / 2 + over - 0.02), wallH - over * Math.tan(pitch) - 0.06, 0), '#3a2c22');
  }
  B.add(roofMat, box(0.3, 0.2, long + gableOver * 2 + 0.04, 0.06), mm(D, 0, firstY + thick * 0.75, 0), merge(roofColor, '#000000', 0.25));
  if (!clinker) {
    for (const s of [-1, 1]) {
      // barge boards on the gables
      for (const k of [-1, 1]) {
        const len = Lp + 0.05;
        B.add('wood', box(len, 0.18, 0.05), mm(D, k * (Math.cos(pitch) * len / 2), firstY - Math.sin(pitch) * len / 2 + 0.05, s * (long / 2 + gableOver + 0.02), 0, 0, -k * pitch), '#3a2c22');
      }
    }
  } else {
    // stepped gable at front and back
    for (const s of [-1, 1]) {
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const sw = cross * (1 - i / tiers) + 0.02;
        const sh = hR / tiers;
        B.add('brick', box(sw, sh + 0.36, 0.34), mm(D, 0, wallH + i * sh + (sh + 0.36) / 2, s * (long / 2 - 0.1)), '#ffffff');
        B.add('stone', box(sw + 0.06, 0.08, 0.4), mm(D, 0, wallH + (i + 1) * sh + 0.4, s * (long / 2 - 0.1)), '#cfc8bb');
      }
    }
  }

  // wall faces: front, back, right, left
  const surfaces = [
    { F: mm(base, 0, 0, d / 2), fw: w, front: true, gable: gableFront },
    { F: mm(base, 0, 0, -d / 2, Math.PI), fw: w, gable: gableFront },
    { F: mm(base, w / 2, 0, 0, Math.PI / 2), fw: d, gable: !gableFront },
    { F: mm(base, -w / 2, 0, 0, -Math.PI / 2), fw: d, gable: !gableFront },
  ];
  const st = { frame, shutters, rnd, glass };
  const doorB = 1.05, doorH = 2.15;
  const doorX = p.doorX ?? 0;
  for (const fl of surfaces) {
    const pageFull = fl.fw;
    for (let g = 0; g < floors; g++) {
      const widthHere = g === 0 ? pageFull : pageFull + cantilever * 2;
      const Fg = g === 0 ? fl.F : mm(fl.F, 0, 0, cantilever);
      const y0 = plinthH + g * gH;
      const fh = g === 0 ? 1.28 : 1.18, fb = g === 0 ? 0.88 : 0.82;
      let n = Math.max(1, Math.round((widthHere - 0.9) / 1.95));
      if (!fl.front && !fl.gable && widthHere < 6) n = Math.max(1, n - 1);
      let xs = row(widthHere, n);
      const openings = [];
      if (fl.front && g === 0) {
        xs = xs.filter((x) => Math.abs(x - doorX) > doorB / 2 + fb / 2 + 0.38);
        openings.push({ x: doorX, w: doorB + 0.3 });
      }
      for (const x of xs) openings.push({ x, w: fb + 0.18 });
      if (timberStyle && (g > 0 || p.timberBottom)) timber(B, Fg, widthHere, y0, y0 + gH, openings, rnd, barColor);
      for (const x of xs) {
        const on = rnd() < share;
        windows(B, Fg, x, y0 + 0.86, fb, fh, { ...st, on, planter: g === 0 && fl.front && !clinker && rnd() < 0.45 });
        if (on && g === 0) {
          _v.set(x, 0, 0.8).applyMatrix4(Fg);
          const [lx, , lz] = wp(o, _v.x, 0, _v.z);
          lights.push({ x: lx, y: 1.4, z: lz, color: lightColor, strength: 0, range: 0, kind: 'windows', ground: 2.6, groundStrength: 0.55 * p.glow / 2.4 });
        }
      }
      if (fl.front && g === 0) {
        door(B, Fg, doorX, doorB, doorH, { color: DOORS[Math.floor(rnd() * DOORS.length)], frame: barColor, frameStone: clinker || !timberStyle, round: !clinker && rnd() < 0.45 });
        if (p.doors) {
          _v.set(doorX, 0, 0.45).applyMatrix4(Fg);
          const [tx, , tz] = wp(o, _v.x, 0, _v.z);
          p.doors.push({ x: tx, z: tz, nx: Math.sin(o.rot || 0), nz: Math.cos(o.rot || 0) });
        }
        const lx = doorX + doorB / 2 + 0.55;
        wallLantern(B, Fg, lx, 2.05, lightMaterial(WARM, 3.2));
        light(lights, o, Fg, lx, 2.1, 0.45, '#ffc27a', 5, 8, 'lantern', 4.2, 0.9);
        if (p.sign) signs.push({ F: Fg, x: doorX, y: doorH + 0.42, text: p.sign });
      }
    }
    // gable face: small window and timber frame in the triangle
    if (fl.gable && !clinker) {
      const Fgi = mm(fl.F, 0, 0, cantilever);
      if (hR > 1.6) windows(B, Fgi, 0, wallH + 0.35, 0.62, 0.8, { ...st, on: rnd() < share * 0.6, shutters: null });
      if (timberStyle) {
        B.add('bar', box(cross * 0.62, 0.14, 0.05), mm(Fgi, 0, wallH + hR * 0.38, 0.025), barColor);
        for (const s of [-1, 1]) {
          const x0 = s * cross * 0.42, y0 = wallH + 0.1, x1 = s * 0.25, y1 = wallH + hR * 0.8;
          const len = Math.hypot(x1 - x0, y1 - y0);
          B.add('bar', box(len, 0.13, 0.05), mm(Fgi, (x0 + x1) / 2, (y0 + y1) / 2, 0.025, 0, 0, Math.atan2(y1 - y0, x1 - x0)), barColor);
        }
      }
    }
  }
  // cornice on clinker houses
  if (clinker) {
    B.add('stone', box(w + 0.14, 0.12, d + 0.14), mm(base, 0, wallH - 0.06, 0), '#d3ccbf');
    B.add('stone', box(w + 0.1, 0.1, d + 0.1), mm(base, 0, plinthH + gH, 0), '#d3ccbf');
  }

  // chimney
  if (p.chimney) {
    const s = rnd() < 0.5 ? -1 : 1;
    const qx = s * cross * (0.18 + rnd() * 0.12), qz = (rnd() - 0.5) * long * 0.5;
    const roofY = firstY - Math.abs(qx) * Math.tan(pitch);
    const top = firstY + 0.9;
    const h = top - roofY + 0.4;
    B.add('brick', box(0.62, h, 0.62, 0.02), mm(D, qx, roofY - 0.4 + h / 2, qz), '#ffffff');
    B.add('stone', box(0.76, 0.1, 0.76, 0.02), mm(D, qx, top + 0.05, qz), '#9a958c');
    _v.set(qx, top + 0.2, qz).applyMatrix4(D);
    const [x, y, z] = wp(o, _v.x, _v.y, _v.z);
    p.smoke.push({ x, y, z });
  }
  return { wallH, firstY, W2, D2 };
}

// house with a sign above the door and an optional annex
export function buildHouse(o) {
  const r = o.repo;
  const rnd = rng(o.seed);
  const clinker = o.type === 'clientHouse';
  const alive = r.state === 'alive' || r.state === 'client_active';
  const sleeping = r.state === 'sleeping';
  const B = new Builder(o.seed);
  const lights = [], smoke = [], signs = [], doors = [];
  const style = clinker ? 'clinker' : o.tier >= 1 && rnd() < 0.72 ? 'timber' : 'plaster';
  const p = {
    width: o.width, depth: o.depth, floors: o.floors, gableFront: clinker ? true : o.gableFront, style,
    lightColor: clinker ? '#ffd29a' : windowLight(r.name),
    glow: sleeping ? 1.1 : 2.5,
    share: sleeping ? 0.18 : alive ? 0.78 : 0.4,
    chimney: alive && !clinker ? true : alive && rnd() < 0.6,
    smoke, doors, sign: r.name, timberBottom: rnd() < 0.35,
    doorX: o.width > 7 && rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) * o.width * 0.18 : 0,
  };
  const base = new THREE.Matrix4();
  houseBody(B, base, o, p, rnd, lights, signs);
  if (o.annex && o.partner) {
    const a = o.annex;
    const ab = T(a.page * (o.width / 2 + a.width / 2), 0, (o.depth - a.depth) / 2);
    const pa = {
      width: a.width, depth: a.depth, floors: 1, gableFront: false, style: style === 'clinker' ? 'clinker' : 'plaster',
      lightColor: windowLight(o.partner.name), glow: p.glow * 0.9, share: p.share, chimney: false, smoke,
      sign: o.partner.name, doorX: 0, doors,
    };
    houseBody(B, ab, o, pa, rng(o.seed + 99), lights, signs);
  }
  // fence in front of the front garden on some houses
  if (!clinker && rnd() < 0.42) {
    const zr = rng(o.seed + 17);
    const zf = zr() < 0.5 ? '#e7e1d4' : '#6b5440';
    const zv = o.depth / 2 + 1.5;
    const gw = o.width + (o.annex ? o.annex.width : 0) + 0.6;
    const off = o.annex ? o.annex.page * o.annex.width / 2 : 0;
    for (let x = -gw / 2; x <= gw / 2; x += 0.26) {
      if (Math.abs(x - p.doorX) < 0.75) continue;
      B.add('wood', box(0.07, 0.72 + (Math.round(x / 0.26) % 2) * 0.05, 0.035), T(off + x, 0.37, zv), zf);
    }
    for (const yy of [0.25, 0.55]) {
      const seg = [[-gw / 2, p.doorX - 0.75], [p.doorX + 0.75, gw / 2]];
      for (const [a, b] of seg) if (b - a > 0.1) B.add('wood', box(b - a, 0.05, 0.03), T(off + (a + b) / 2, yy, zv - 0.03), zf);
    }
  }
  const g = B.done();
  // signs above the doors: own material per house
  for (const s of signs) {
    const tex = textTexture({
      width: 512, height: 128, background: '#2c2420', color: '#efe2c4', light: 'rgba(0,0,0,0.5)', frame: '#8a6a3c',
      rows: [{ text: s.text, font: 'italic 400 60px "Instrument Serif", Georgia, serif', y: 66, max: 460 }],
    });
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const width = Math.min(1.9, 0.5 + s.text.length * 0.075);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, width / 4, 0.04), [MAT.wood, MAT.wood, MAT.wood, MAT.wood, m, MAT.wood]);
    mesh.applyMatrix4(mm(s.F, s.x, s.y, 0.09));
    mesh.castShadow = true;
    g.add(mesh);
  }
  return { group: g, lights, smoke, doors };
}

// ---------- ancestral vault ----------

export function buildVault(o) {
  const B = new Builder(o.seed);
  const lights = [];
  const w = 2.8, d = 3.2, h = 2.4;
  const base = new THREE.Matrix4();
  B.add('stone', box(w + 0.6, 0.3, d + 0.6, 0.04), T(0, 0.15, 0), '#8f8b84');
  B.add('stone', box(w, h, d, 0.04), T(0, 0.3 + h / 2, 0), '#a9a49a');
  // gabled roof of stone
  const pitch = 0.62, Lp = (w / 2 + 0.25) / Math.cos(pitch);
  for (const s of [-1, 1]) {
    B.add('stone', box(Lp, 0.16, d + 0.4, 0.02), T(s * Math.cos(pitch) * Lp / 2, 0.3 + h + Math.tan(pitch) * w / 2 - Math.sin(pitch) * Lp / 2 + 0.1, 0, 0, 0, -s * pitch), '#7f7b74');
  }
  B.add('stone', prism(w, Math.tan(pitch) * w / 2, d), T(0, 0.3 + h, 0), '#a9a49a');
  // wrought-iron gate with a faint shimmer of the ancestors
  const F = mm(base, 0, 0.3, d / 2);
  const s = new THREE.Shape();
  s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0.55, 1.35); s.absarc(0, 1.35, 0.55, 0, Math.PI, false); s.lineTo(-0.55, 0);
  B.add('glass', form(s, 0.02, 0, 'vaultGlass'), mm(F, 0, 0, 0.01), '#ffffff', { material: lightMaterial('#b8a6ff', 1.6), uv: 'own' });
  for (let i = -4; i <= 4; i++) B.add('metal', box(0.03, 1.85 - Math.abs(i) * 0.04, 0.03), mm(F, i * 0.12, (1.85 - Math.abs(i) * 0.04) / 2, 0.04), '#1c1d22');
  B.add('metal', box(1.2, 0.04, 0.04), mm(F, 0, 0.9, 0.05), '#1c1d22');
  B.add('stone', box(1.5, 0.18, 0.2), mm(F, 0, 2.05, 0.1), '#8f8b84');
  for (const sx of [-1, 1]) B.add('stone', box(0.24, 2.0, 0.22, 0.02), mm(F, sx * 0.72, 1.0, 0.1), '#8f8b84');
  // cross on the ridge
  B.add('stone', box(0.1, 0.6, 0.1), T(0, 0.3 + h + Math.tan(pitch) * w / 2 + 0.35, d / 2 - 0.1), '#8f8b84');
  B.add('stone', box(0.36, 0.1, 0.1), T(0, 0.3 + h + Math.tan(pitch) * w / 2 + 0.45, d / 2 - 0.1), '#8f8b84');
  light(lights, o, base, 0, 1.0, d / 2 + 0.6, '#b8a6ff', 2.2, 5, 'vault', 2.4, 0.5);
  const g = B.done();
  const tex = textTexture({ width: 512, height: 96, background: '#6f6a62', color: '#2b2925', light: 'rgba(255,255,255,0.25)', rows: [{ text: t('ancestorsOf', { name: o.successor?.name || '' }).toUpperCase(), font: '600 34px Geist, sans-serif', y: 50, gap: '3px', max: 480 }] });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.27), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  plaque.position.set(0, 0.3 + 2.05, d / 2 + 0.205);
  g.add(plaque);
  return { group: g, lights, smoke: [] };
}

// ---------- hospice with veranda ----------

export function buildHospice(o) {
  const rnd = rng(77);
  const B = new Builder(77);
  const lights = [], smoke = [], signs = [], doors = [];
  const width = Math.max(14, o.veranda + 2);
  const p = { width, depth: 6.6, floors: 1, gableFront: false, style: 'plaster', lightColor: '#ffd7a0', glow: 2.2, share: 0.9, chimney: true, smoke, doors, sign: t('places.hospice'), doorX: 0 };
  const base = T(0, 0, -2.2);
  houseBody(B, base, o, p, rnd, lights, signs);
  // veranda: wooden floor, posts, flat roof
  const vd = 5.2, vz = 3.3 - 2.2 + vd / 2;
  B.add('wood', box(o.veranda, 0.18, vd), T(0, 0.09, vz), '#7a5a40');
  const nP = Math.max(3, Math.round(o.veranda / 3.4) + 1);
  for (let i = 0; i < nP; i++) {
    const x = -o.veranda / 2 + 0.15 + (i * (o.veranda - 0.3)) / (nP - 1);
    B.add('wood', box(0.16, 2.7, 0.16), T(x, 1.35 + 0.18, vz + vd / 2 - 0.15), '#e6dfd0');
    // lamp under the roof
    if (i < nP - 1) {
      const lx = x + (o.veranda - 0.3) / (nP - 1) / 2;
      B.add('metal', cyl(0.01, 0.01, 0.4, 4), T(lx, 2.55, vz), '#1c1d22');
      B.add('glass', sphere(0.12, 10, 8), T(lx, 2.3, vz), '#ffffff', { material: lightMaterial('#ffcf8a', 3.4), uv: 'own' });
      light(lights, o, new THREE.Matrix4(), lx, 2.3, vz, '#ffcf8a', 4, 8, 'lantern', 3.6, 0.85);
    }
  }
  B.add('wood', box(o.veranda + 0.3, 0.12, 0.16), T(0, 2.86, vz + vd / 2 - 0.15), '#e6dfd0');
  B.add('roof', box(o.veranda + 0.6, 0.12, vd + 0.5), T(0, 3.0, vz + 0.1, 0, 0.12), '#9a5038', { tile: 2 });
  B.add('wood', box(o.veranda, 0.06, 0.06), T(0, 0.95, vz + vd / 2 - 0.15), '#e6dfd0');
  const g = B.done();
  for (const s of signs) {
    const tex = textTexture({ width: 512, height: 128, background: '#f0ebe0', color: '#7b3a30', light: null, rows: [{ text: t('places.hospice'), font: 'italic 400 70px "Instrument Serif", serif', y: 66 }] });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.38, 0.04), [MAT.wood, MAT.wood, MAT.wood, MAT.wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), MAT.wood]);
    mesh.applyMatrix4(mm(s.F, s.x, s.y, 0.09));
    g.add(mesh);
  }
  return { group: g, lights, smoke, doors };
}

// ---------- chapel with tower ----------

export function buildChapel(o) {
  const B = new Builder(91);
  const lights = [];
  const w = 7.4, d = 12.5, h = 5.4;
  const z0 = -1.2; // centre of the nave
  const stone = '#a6a198';
  B.add('stone', box(w + 0.5, 0.5, d + 0.5, 0.04), T(0, 0.25, z0), '#8c877e');
  B.add('stone', box(w, h, d, 0.04), T(0, 0.5 + h / 2, z0), stone);
  // buttresses
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = z0 - d / 2 + 1.6 + i * ((d - 3.2) / 3);
    B.add('stone', box(0.5, 3.6, 0.7, 0.03), T(s * (w / 2 + 0.22), 2.3, z), '#99948b');
    B.add('stone', box(0.5, 0.9, 0.7, 0.03), T(s * (w / 2 + 0.12), 4.3, z, 0, 0, s * 0.5), '#99948b');
  }
  // steep slate roof
  const pitch = 0.98, hR = (w / 2) * Math.tan(pitch);
  const Lp = (w / 2 + 0.4) / Math.cos(pitch);
  const wallH = 0.5 + h;
  B.add('stone', prism(w, hR, d), T(0, wallH, z0), stone);
  for (const s of [-1, 1]) {
    const cx = s * (Math.cos(pitch) * Lp / 2 + Math.sin(pitch) * 0.09) - s * 0.03;
    const cy = wallH + hR - Math.sin(pitch) * Lp / 2 + Math.cos(pitch) * 0.09;
    B.add('slate', box(Lp, 0.18, d + 0.5), T(cx, cy, z0, 0, 0, -s * pitch), '#565e6c');
  }
  B.add('metal', box(0.22, 0.18, d + 0.6), T(0, wallH + hR + 0.12, z0), '#3a3f48');
  // colourful pointed-arch windows on the sides
  const colorful = ['#3e63c9', '#b8323a', '#e0a33a', '#3c8f6a'];
  const pointed = (bw, bh) => {
    const s = new THREE.Shape();
    s.moveTo(-bw / 2, 0); s.lineTo(bw / 2, 0); s.lineTo(bw / 2, bh - bw * 0.6);
    s.quadraticCurveTo(bw / 2, bh - bw * 0.1, 0, bh); s.quadraticCurveTo(-bw / 2, bh - bw * 0.1, -bw / 2, bh - bw * 0.6); s.lineTo(-bw / 2, 0);
    return s;
  };
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = z0 - d / 2 + 2.6 + i * ((d - 4.4) / 2);
    const F = T(s * (w / 2), 0, z, s * Math.PI / 2);
    B.add('stone', form(pointed(1.25, 3.1), 0.14, 0.02, 'pointedFrame'), mm(F, 0, 1.6, 0.03), '#8c877e');
    for (let k = 0; k < 4; k++) {
      B.add('glass', box(0.42, 0.62, 0.02), mm(F, (k % 2 ? 0.22 : -0.22), 1.9 + Math.floor(k / 2) * 0.75, 0.11), '#ffffff', { material: lightMaterial(colorful[(k + i) % 4], 1.5), uv: 'own' });
    }
    B.add('glass', form(pointed(0.9, 1.2), 0.02, 0, 'pointedGlass'), mm(F, 0, 3.4, 0.11), '#ffffff', { material: lightMaterial(colorful[(i + 2) % 4], 1.3), uv: 'own' });
  }
  // tower at the front
  const tz = z0 + d / 2 + 1.0, tw = 3.2, th = 11.5;
  B.add('stone', box(tw, th, tw, 0.04), T(0, th / 2, tz), '#a29d94');
  B.add('stone', box(tw + 0.24, 0.24, tw + 0.24, 0.03), T(0, th, tz), '#8c877e');
  B.add('stone', box(tw + 0.2, 0.2, tw + 0.2, 0.03), T(0, 6.2, tz), '#8c877e');
  // belfry: dark louvred openings with a bell
  for (let k = 0; k < 4; k++) {
    const F = mm(T(0, 0, tz, (k * Math.PI) / 2), 0, 0, tw / 2);
    B.add('metal', form(pointed(0.9, 1.7), 0.04, 0, 'louver'), mm(F, 0, 8.6, 0.0), '#0b0c10');
    B.add('stone', box(0.12, 1.4, 0.1), mm(F, 0, 9.3, 0.04), '#8c877e');
  }
  B.add('brass', cyl(0.22, 0.45, 0.7, 14), T(0, 9.2, tz), '#9b7a3d');
  // spire
  B.add('slate', cone(2.45, 6.2, 4), T(0, th + 3.1, tz, Math.PI / 4), '#4e5664');
  B.add('brass', sphere(0.16, 10, 8), T(0, th + 6.35, tz), '#c9a35c');
  B.add('brass', box(0.08, 1.1, 0.08), T(0, th + 6.95, tz), '#c9a35c');
  B.add('brass', box(0.6, 0.08, 0.08), T(0, th + 7.15, tz), '#c9a35c');
  // rose window above the portal and the portal with warm light
  const Fv = T(0, 0, tz + tw / 2);
  B.add('stone', cyl(0.78, 0.78, 0.16, 24), mm(Fv, 0, 5.0, 0.05, 0, Math.PI / 2), '#8c877e');
  B.add('glass', cyl(0.6, 0.6, 0.02, 24), mm(Fv, 0, 5.0, 0.14, 0, Math.PI / 2), '#ffffff', { material: lightMaterial('#d9883a', 1.7), uv: 'own' });
  for (let k = 0; k < 6; k++) B.add('stone', box(1.2, 0.06, 0.04), mm(Fv, 0, 5.0, 0.16, 0, 0, (k * Math.PI) / 6), '#8c877e');
  B.add('stone', form(pointed(1.9, 3.4), 0.3, 0.03, 'portalR'), mm(Fv, 0, 0, 0.1), '#8c877e');
  B.add('glass', form(pointed(1.45, 2.95), 0.04, 0, 'portalG'), mm(Fv, 0, 0, 0.22), '#ffffff', { material: lightMaterial('#ffb35c', 2.0), uv: 'own' });
  B.add('wood', box(0.68, 2.3, 0.06), mm(Fv, -0.36, 1.15, 0.26, -0.6), '#4a2f22');
  B.add('wood', box(0.68, 2.3, 0.06), mm(Fv, 0.36, 1.15, 0.26, 0.6), '#4a2f22');
  for (let i = 0; i < 3; i++) B.add('stone', box(3.0 - i * 0.3, 0.16, 0.5), mm(Fv, 0, 0.08 + i * 0.16 - 0.16, 0.6 - i * 0.22), '#9d978c');
  light(lights, o, Fv, 0, 1.6, 1.4, '#ffb35c', 7, 10, 'chapel', 6, 1.1);
  for (const s of [-1, 1]) {
    wallLantern(B, Fv, s * 1.35, 2.2, lightMaterial('#ffc27a', 3.2));
    light(lights, o, Fv, s * 1.35, 2.2, 0.5, '#ffc27a', 3.5, 7, 'lantern', 3, 0.6);
  }
  for (const s of [-1, 1]) light(lights, o, new THREE.Matrix4(), s * (w / 2 + 1.5), 1, z0, '#7a8fd8', 0, 0, 'windows', 3.4, 0.35);
  return { group: B.done(), lights, smoke: [] };
}

// ---------- Mausoleum ----------

export function buildMausoleum(o) {
  const B = new Builder(o.seed);
  const lights = [];
  const rnd = rng(o.seed);
  const old = Math.min(1, (o.daysDead || 0) / 400);
  const stone = merge('#d8d2c6', '#8f8a7f', old * 0.6);
  const base = new THREE.Matrix4();
  // steps
  for (let i = 0; i < 3; i++) B.add('stone', box(4.4 - i * 0.3, 0.18, 5.4 - i * 0.3, 0.02), T(0, 0.09 + i * 0.18, 0.15 * i), merge(stone, '#000', 0.12));
  const y0 = 0.54;
  B.add('marble', box(3.2, 2.9, 3.6, 0.03), T(0, y0 + 1.45, -0.55), stone);
  // columns
  for (const x of [-1.3, -0.45, 0.45, 1.3]) {
    if (Math.abs(x) < 0.5) continue;
    B.add('marble', cyl(0.15, 0.17, 2.7, 14), T(x, y0 + 1.45, 1.45), stone);
    B.add('marble', box(0.44, 0.14, 0.44, 0.02), T(x, y0 + 0.07, 1.45), stone);
    B.add('marble', box(0.44, 0.16, 0.44, 0.02), T(x, y0 + 2.87, 1.45), stone);
  }
  B.add('marble', box(3.6, 0.3, 4.9, 0.03), T(0, y0 + 3.1, -0.1), stone);
  const hR = 0.9;
  B.add('marble', prism(3.6, hR, 4.9), T(0, y0 + 3.25, -0.1), stone);
  const pitch = Math.atan(hR / 1.8), Lp = 2.0 / Math.cos(pitch);
  for (const s of [-1, 1]) {
    B.add('stone', box(Lp, 0.12, 5.1, 0.02), T(s * Math.cos(pitch) * Lp / 2, y0 + 3.25 + hR - Math.sin(pitch) * Lp / 2 + 0.07, -0.1, 0, 0, -s * pitch), merge(stone, '#000', 0.28));
  }
  // door with a gap of light
  B.add('metal', box(1.1, 2.1, 0.06), T(0, y0 + 1.05, 1.27), '#22242a');
  B.add('glass', box(0.04, 1.9, 0.02), T(0, y0 + 1.05, 1.31), '#ffffff', { material: lightMaterial('#ffb35c', 2.6), uv: 'own' });
  B.add('brass', sphere(0.04, 8, 6), T(0.18, y0 + 1.05, 1.32), '#c9a35c');
  // urns at the steps
  for (const s of [-1, 1]) {
    B.add('stone', box(0.5, 0.6, 0.5, 0.02), T(s * 1.95, 0.3, 2.3), stone);
    B.add('marble', sphere(0.22, 12, 10), T(s * 1.95, 0.85, 2.3), stone);
    B.add('marble', cyl(0.12, 0.16, 0.12, 10), T(s * 1.95, 1.08, 2.3), stone);
  }
  void rnd;
  light(lights, o, base, 0, 1.4, 2.4, '#ffb35c', 2.4, 6, 'vault', 2.8, 0.5);
  const g = B.done();
  const tex = textTexture({ width: 1024, height: 160, background: null, color: '#3b3833', light: 'rgba(255,255,255,0.45)', rows: [{ text: o.repo.name.toUpperCase(), font: '600 64px Geist, sans-serif', y: 84, gap: '8px', max: 960 }] });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.45), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(0, y0 + 3.1, 2.351);
  g.add(m);
  return { group: g, lights, smoke: [] };
}
