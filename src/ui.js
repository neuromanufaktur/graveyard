// Interface above the world: header, zone name, legend, hints, detail card, tooltip, name tags,
// speech bubbles, map with points and the choice at the start. Texts come from the locale files, no emojis.

import * as THREE from 'three';
import { STATES, DOT, formatDate, daysAgo, formatNumber, esc } from './util.js';
import { countStates } from './data.js';
import { zoneAt } from './layout.js';
import config, { THRESHOLDS } from './config.js';
import { t } from './i18n.js';

// portraits of the team members (from the configuration, optional)
const PHOTO = Object.fromEntries(Object.entries(config.team).filter(([, p]) => p.photo).map(([id, p]) => [id, p.photo]));
// point colour per mourner
const GUEST = Object.fromEntries(Object.values(config.mourners.members).map((p) => [p.name, p.accent || '#ffb35c']));
const GUEST_KICKER = (config.mourners.label ? config.mourners.label + ' · ' : '') + t('mourner');
const { aliveDays: ALIVE, deadDays: DEAD, zombiePauseDays: ZOMBIE } = THRESHOLDS;
const ICON = {
  respect: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14.5c0-4.2 2.2-7.5 5-7.5s5 3.3 5 7.5"/><path d="M3 15.5c2.5 1.6 5.6 2.5 9 2.5s6.5-.9 9-2.5"/><path d="M8.6 11.5h6.8" stroke="#ffb35c"/></svg>',
  flower: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="2.2" stroke="#ffb35c"/><path d="M12 5.8c0-2.2 3.2-2.2 3.2 0M14.2 8c2.2 0 2.2 3.2 0 3.2M12 10.2c0 2.2-3.2 2.2-3.2 0M9.8 8c-2.2 0-2.2-3.2 0-3.2"/><path d="M12 10.5V20M12 16c-2.6 0-4-1.4-4.4-3.4 2.4 0 3.8 1.2 4.4 3.4z"/></svg>',
  candle: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2c1.4 1.6 2 2.7 2 3.6a2 2 0 0 1-4 0c0-.9.6-2 2-3.6z" stroke="#ffb35c"/><rect x="9" y="10.5" width="6" height="9.5" rx="1"/><path d="M6.5 20h11"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>',
  map: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  soundOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
  soundOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  help: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 1.9-2.2 3.4"/><circle cx="12" cy="16.9" r="0.4" fill="currentColor"/></svg>',
};

const zoneOf = (r) => STATES[r.state]?.zone || '';
const LEGEND = ['alive', 'sleeping', 'client_active', 'delivered', 'hospice', 'dead', 'ancestor', 'zombie'].map((k) => [k, t('legend.' + k)]);

function lifeDates(r) {
  const from = formatDate(r.first_commit || r.created_at);
  if (['dead', 'buried', 'ancestor', 'delivered'].includes(r.state)) return t('lifeDates.span', { from: from, to: formatDate(r.last_push) });
  return t('lifeDates.since', { from: from });
}

function rows(r) {
  const z = [];
  z.push([t('facts.commits'), formatNumber(r.commits)]);
  if (r.files) z.push([t('facts.files'), formatNumber(r.files)]);
  if (r.language) z.push([t('facts.language'), esc(r.language)]);
  z.push([t('facts.lastPush'), `${formatDate(r.last_push, true)}, ${daysAgo(r.days_since_push)}`]);
  if (r.client) z.push([t('facts.client'), esc(r.client)]);
  if (r.successor && r.state === 'ancestor') z.push([t('facts.livesOnIn'), esc(r.successor)]);
  if (r.cause_of_death) z.push([r.state === 'hospice' ? t('facts.diagnosis') : t('facts.causeOfDeath'), esc(r.cause_of_death)]);
  if (r.authors?.length) z.push([t('facts.authors', { n: r.authors.length }), esc(r.authors.join(', '))]);
  return `<dl>${z.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
}

const MON = t('months');
const monthName = (k) => { const [j, mo] = k.split('-').map(Number); return `${MON[mo - 1]} ${j}`; };

function history(r) {
  const m = r.commits_per_month || {};
  const keys = Object.keys(m).sort();
  if (keys.length < 2) return '';
  const [j0, m0] = keys[0].split('-').map(Number);
  const [j1, m1] = keys[keys.length - 1].split('-').map(Number);
  const months = [];
  for (let j = j0, mo = m0; j < j1 || (j === j1 && mo <= m1); mo++) { if (mo > 12) { mo = 1; j++; } months.push(`${j}-${String(mo).padStart(2, '0')}`); if (months.length > 60) break; }
  const max = Math.max(...months.map((k) => m[k] || 0), 1);
  const w = 100 / months.length, bw = Math.min(w * 0.7, 5.5);
  const bar = months.map((k, i) => { const h = Math.max(m[k] ? 6 : 0, ((m[k] || 0) / max) * 100); return `<rect x="${(i * w + (w - bw) / 2).toFixed(2)}" y="${(100 - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"><title>${esc(t('history.bar', { month: monthName(k), n: m[k] || 0 }))}</title></rect>`; }).join('');
  return `<div class="history"><div class="kicker">${esc(t('history.title'))}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none">${bar}</svg><div class="axis"><span>${monthName(keys[0])}</span><span>${monthName(keys[keys.length - 1])}</span></div></div>`;
}

export class Ui {
  constructor({ data, L, tribute, me, actions }) {
    this.data = data; this.L = L; this.tribute = tribute; this.me = me; this.actions = actions;
    this.count = countStates(data.repos);
    this.signs = new Map();
    this.points = [];
    this.filter = new Set();
    this.zone = null;
    this._build();
  }

  _build() {
    const d = document.createElement('div');
    d.id = 'ui';
    const z = this.count;
    d.innerHTML = `
      <header class="head">
        <div class="brand">${esc(config.brand)}</div>
        <h1>${esc(config.title)}</h1>
        <div class="as_of">${esc(t('header.asOf', { n: this.data.repos.length, date: formatDate(this.data.as_of.toISOString(), true) }))}</div>
      </header>
      <nav class="buttons">
        <button data-k="map" title="${esc(t('nav.mapTitle'))}">${ICON.map}<span>${esc(t('nav.map'))}</span><kbd>M</kbd></button>
        <button data-k="sound" title="${esc(t('nav.sound'))}">${ICON.soundOff}</button>
        <button data-k="help" title="${esc(t('nav.help'))}">${ICON.help}</button>
      </nav>
      <div class="zone" aria-live="polite"><div class="kicker"></div><div class="name"></div><div class="sentence"></div></div>
      <div class="legend" title="${esc(t('legend.title'))}">
        <div class="rows">${LEGEND.map(([k, n]) => `<button data-z="${k}" style="--p:${DOT[k]}"><i></i><span>${n}</span><b>${z[k] || 0}</b></button>`).join('')}</div>
        <i class="divider"></i>
        <button class="back" data-k="map"><kbd>M</kbd>${esc(t('legend.back'))}</button>
      </div>
      <div class="hint"></div>
      <aside class="detail" hidden><div class="content"></div></aside>
      <div class="tip" hidden></div>
      <div class="signs"></div>
      <div class="mapPoints"></div>
      <div class="veil" hidden></div>
      <div class="help" hidden>
        <div class="kicker">${esc(t('help.kicker'))}</div>
        <h3>${esc(t('help.title'))}</h3>
        <dl>
${t(matchMedia('(pointer: coarse)').matches ? 'help.touch' : 'help.desktop').map(([a, b]) => `          <dt>${a}</dt><dd>${b}</dd>`).join('\n')}
        </dl>
        <div class="foot">${this.me ? `<button class="signOut">${esc(t('help.signOut'))}</button>` : ''}${this.me?.figure ? '' : `<button class="switchFigure">${esc(t('help.switchFigure'))}</button>`}<button class="ok">${esc(t('help.ok'))}</button></div>
      </div>
      <div class="choice" hidden>
        <div class="kicker">${esc(t('choice.kicker'))}</div>
        <h2>${esc(t('choice.title'))}</h2>
        <div class="cards"></div>
        <p class="quiet">${esc(t('choice.note'))}</p>
      </div>`;
    document.body.appendChild(d);
    this.el = d;
    this.$ = (s) => d.querySelector(s);
    d.querySelector('.buttons').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.actions.button(b.dataset.k);
    });
    this.$('.help .ok').addEventListener('click', () => this.showHelp(false));
    this.$('.veil').addEventListener('click', () => this.showHelp(false));
    this.$('.help .switchFigure')?.addEventListener('click', () => this.actions.button('switchFigure'));
    this.$('.help .signOut')?.addEventListener('click', () => this.actions.button('signOut'));
    this.$('.hint').addEventListener('click', (e) => {
      const b = e.target.closest('[data-h]'); if (b) this.actions.button(b.dataset.h);
    });
    this.$('.legend').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k) this.actions.button(b.dataset.k); else this.actions.legend(b.dataset.z);
    });
    this.$('.detail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b) { this.actions.detail(b.dataset.action, b.dataset); return; }
      const r = e.target.closest('[data-repo]');
      if (r) this.actions.repo(r.dataset.repo);
    });
  }

  // ---------- choice ----------
  showSelection(team, choice) {
    const w = this.$('.choice');
    w.querySelector('.cards').innerHTML = team.map((a) => `<button data-id="${a.f.id}">${PHOTO[a.f.id] ? `<img class="photo" src="${PHOTO[a.f.id]}" alt="">` : ''}<b>${esc(a.f.name)}</b><span>${esc(a.f.role)}</span></button>`).join('');
    w.hidden = false;
    document.body.classList.add('choosing');
    w.querySelector('.cards').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      w.hidden = true;
      document.body.classList.remove('choosing');
      choice(b.dataset.id);
    };
    w.querySelector('.cards').onmouseover = (e) => {
      const b = e.target.closest('button'); if (b) this.actions.preview?.(b.dataset.id);
    };
  }

  showHelp(on) { this.$('.help').hidden = !on; this.$('.veil').hidden = !on; }
  setSound(on) { this.$('[data-k="sound"]').innerHTML = on ? ICON.soundOn : ICON.soundOff; }
  setMap(on) { document.body.classList.toggle('map', on); this.$('[data-k="map"]').classList.toggle('on', on); }

  // ---------- zones ----------
  checkZone(x, z) {
    const zo = zoneAt(this.L, x, z);
    if (!zo || zo.id === this.zone) return;
    const first = this.zone === null;
    this.zone = zo.id;
    const el = this.$('.zone');
    const SENTENCE = { graveyard: 'graveyard', hospice: 'hospice', clients: 'clients', village: 'village' };
    el.querySelector('.kicker').textContent = SENTENCE[zo.id] ? t(`zones.${SENTENCE[zo.id]}.${first ? 'standing' : 'entering'}`) : '';
    el.querySelector('.name').textContent = zo.name;
    el.querySelector('.sentence').textContent = zo.sentence;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(this._zt);
    this._zt = setTimeout(() => el.classList.remove('on'), 3800);
    this.actions.zone?.(zo.id);
  }

  // ---------- hint at the bottom ----------
  // short feedback in the same spot as the hint
  message(text) {
    const h = this.$('.hint');
    h.innerHTML = `<span class="message">${esc(text)}</span>`;
    h.classList.add('on', 'reports');
    this._messageUntil = performance.now() + 1900;
    this._hintThing = undefined;
  }

  setHint(thing) {
    if (this._messageUntil && performance.now() < this._messageUntil) return;
    this.$('.hint').classList.remove('reports');
    if (thing === this._hintThing) return;
    this._hintThing = thing;
    const h = this.$('.hint');
    if (!thing) { h.classList.remove('on'); return; }
    let text = '', respect = false;
    if (thing.actor) {
      const a = thing.actor;
      text = a.kind === 'zombie' ? t('hint.zombie', { name: a.f.name }) : t('hint.talk', { name: a.f.name });
    } else {
      const o = thing;
      const name = o.repo?.name || o.successor?.name || o.client || '';
      text = {
        grave: t('hint.grave', { name }), mausoleum: t('hint.mausoleum', { name }), house: t('hint.house', { name }), clientHouse: t('hint.house', { name }),
        bed: t('hint.bed', { name }), vault: t('hint.vault', { name }), monument: t('hint.monument', { name }),
        clientSign: t('hint.clientSign', { name }), chapel: t('hint.chapel'), hospice: t('hint.hospice'),
      }[o.type] || name;
      respect = ['grave', 'mausoleum', 'bed', 'vault', 'monument'].includes(o.type);
    }
    h.innerHTML = `<button data-h="read"><kbd>${esc(t('hint.space'))}</kbd>${esc(text)}</button>${respect ? `<i></i><button data-h="respect"><kbd>F</kbd>${esc(t('hint.respect'))}</button>` : ''}`;
    h.classList.add('on');
  }

  // ---------- Tooltip ----------
  showTip(thing, x, y) {
    const t = this.$('.tip');
    if (!thing) { t.hidden = true; return; }
    const i = this.tipContent(thing);
    if (!i) { t.hidden = true; return; }
    t.innerHTML = `<div class="kicker"><i style="background:${i.point}"></i>${esc(i.kicker)}</div><b>${esc(i.title)}</b><span>${esc(i.sentence)}</span>`;
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.transform = `translate(${Math.min(x + 18, innerWidth - w - 12)}px, ${Math.min(y + 18, innerHeight - h - 12)}px)`;
  }

  tipContent(thing) {
    if (thing.actor) {
      const a = thing.actor;
      if (a.kind === 'zombie') return { point: DOT.zombie, kicker: t('tip.zombie'), title: a.repo.name, sentence: t('tip.zombieSentence', { days: ZOMBIE, date: formatDate(a.repo.resurrected_at) }) };
      if (a.kind === 'ai') return { point: a.f.accent, kicker: GUEST_KICKER, title: a.f.name, sentence: a.f.role };
      return { point: '#8be0b0', kicker: a.kind === 'player' ? t('tip.you') : t('tip.online'), title: a.f.name, sentence: a.f.role };
    }
    const o = thing;
    const r = o.repo;
    if (r) {
      const z = STATES[r.state];
      const p = o.partner ? ' ' + t('tip.with', { name: o.partner.name }) : '';
      return { point: DOT[r.state], kicker: `${zoneOf(r)} · ${z?.title || ''}`, title: r.name, sentence: (z ? z.sentence(r) : '') + p };
    }
    switch (o.type) {
      case 'vault': return { point: DOT.ancestor, kicker: t('tip.vaultKicker'), title: t('ancestorsOf', { name: o.successor.name }), sentence: t('tip.vaultSentence', { n: o.repos.length }) };
      case 'clientSign': return { point: DOT.client_active, kicker: t('places.clients'), title: o.client, sentence: t('tip.projects', { n: o.repos.length }) };
      case 'hospice': return { point: DOT.hospice, kicker: t('places.hospice'), title: t('places.hospice'), sentence: t('tip.hospiceSentence', { alive: ALIVE, dead: DEAD }) };
      case 'chapel': return { point: DOT.dead, kicker: t('places.graveyard'), title: t('places.chapel'), sentence: t('tip.chapelSentence') };
    }
    return null;
  }

  // ---------- Detail ----------
  showDetail(thing) {
    const d = this.$('.detail');
    // with the map open the hint at the bottom is redundant (reading is already shown) and runs into the map
    document.body.classList.toggle('detail-open', !!thing);
    if (!thing) { d.hidden = true; d.classList.remove('on'); this.detailThing = null; return; }
    this.detailThing = thing;
    d.querySelector('.content').innerHTML = this.detailHtml(thing);
    d.hidden = false;
    requestAnimationFrame(() => d.classList.add('on'));
    d.querySelector('.content').scrollTop = 0;
  }
  refreshDetail() { if (this.detailThing) this.$('.detail .content').innerHTML = this.detailHtml(this.detailThing); }

  detailHtml(thing) {
    const close = `<button class="close" data-action="close" aria-label="${esc(t('detail.close'))}">${ICON.close}</button>`;
    if (thing.list) return close + this.listHtml(thing.list);
    if (thing.actor && thing.actor.kind !== 'zombie') {
      const a = thing.actor, f = a.f;
      if (a.kind === 'ai') {
        const owned = a.owned || [];
        const now = a.speaks?.text ? `<div class="guest" style="--point:${f.accent}"><i></i><div><b>${esc(t('detail.about', { name: f.name, repo: a.speaks.repo.name }))}</b><span>${esc(a.speaks.text)}</span></div></div>` : '';
        return `${close}<div class="kicker">${esc(GUEST_KICKER)}</div><h3>${esc(f.name)}</h3><div class="data">${esc(f.role)}</div>
          <p class="inscription">${esc(t('detail.mournerSentence', { n: owned.length }))}</p>${now}
          <div class="ancestors">${owned.slice(0, 40).map((r) => `<div class="ancestor" data-repo="${esc(r.name)}"><b><i style="background:${DOT[r.state]}"></i>${esc(r.name)}</b><span class="serif">${esc(r.npc.text)}</span></div>`).join('')}</div>`;
      }
      return `${close}${PHOTO[f.id] ? `<img class="portrait" src="${PHOTO[f.id]}" alt="">` : ''}<div class="kicker">${esc(a.kind === 'player' ? t('tip.you') : t('tip.online'))}</div><h3>${esc(f.name)}</h3><div class="data">${esc(f.role)}</div>
        <p class="inscription">${esc(a.kind === 'player' ? t('detail.player') : t('detail.online'))}</p>`;
    }
    const r = thing.actor?.repo || thing.repo;
    if (r) return close + this.repoHtml(r, thing, thing.actor);
    switch (thing.type) {
      case 'vault': return close + this.vaultHtml(thing);
      case 'clientSign': return close + this.listHtml({ kicker: t('places.clients'), title: thing.client, text: t('detail.clientText'), repos: thing.repos });
      case 'hospice': return close + this.listHtml({ kicker: t('places.hospice'), title: t('places.hospice'), text: t('detail.hospiceText', { alive: ALIVE, dead: DEAD }), repos: thing.patients || [] });
      case 'chapel': return close + this.chapelHtml(thing);
    }
    return close;
  }

  repoHtml(r, o, actor) {
    const z = STATES[r.state];
    const zombie = actor?.kind === 'zombie';
    const kicker = zombie ? t('detail.zombieKicker', { date: formatDate(r.resurrected_at) }) : `${zoneOf(r)} · ${z?.title || ''}`;
    const stone = ['dead', 'buried', 'ancestor'].includes(r.state) && !zombie;
    const inscription = r.inscription ? (stone
      ? `<div class="stone"><div class="crossLine"></div><div class="kicker">${esc(t('detail.hereLies'))}</div><p class="inscription">${esc(r.inscription)}</p></div>`
      : `<p class="inscription">${esc(r.inscription)}</p>`) : '';
    const sentence = z && !stone ? `<div class="sentence">${esc(z.sentence(r))}</div>` : '';
    const live = r.live?.ok && r.live?.url ? `<a class="link" href="${esc(r.live.url)}" target="_blank" rel="noopener">${esc(t('detail.open', { url: r.live.url.replace(/^https?:\/\//, '').replace(/\/$/, '') }))}</a>` : '';
    const words = r.last_words ? `<div class="words"><div class="kicker">${esc(t('detail.lastWords'))}</div><q>${esc(r.last_words)}</q></div>` : '';
    const guest = r.npc?.who && r.npc?.text ? `<div class="guest" style="--point:${GUEST[r.npc.who] || '#ffb35c'}"><i></i><div><b>${esc(r.npc.who)}</b><span>${esc(r.npc.text)}</span></div></div>` : '';
    const showTribute = ['dead', 'buried', 'ancestor', 'hospice', 'delivered'].includes(r.state) || zombie;
    const e = this.tribute.from(r.name);
    const tributeHtml = showTribute ? `<div class="tribute">
        <button data-action="respect" data-repo-name="${esc(r.name)}">${ICON.respect}<div class="z">${e.respect || 0}</div><div class="l">${esc(t('tribute.respect'))} <kbd>F</kbd></div></button>
        <button data-action="flower" data-repo-name="${esc(r.name)}">${ICON.flower}<div class="z">${e.flowers || 0}</div><div class="l">${esc(t('tribute.flower'))}</div></button>
        <button data-action="candle" data-repo-name="${esc(r.name)}">${ICON.candle}<div class="z">${e.candles || 0}</div><div class="l">${esc(t('tribute.candle'))}</div></button>
      </div>` : '';
    const p = o?.partner || r.partner;
    const partner = p ? `<div class="partner"><div class="kicker">${esc(stone ? t('detail.sameGrave') : t('detail.belongs'))}</div>
        <div class="ancestor" data-action="partner" data-name="${esc(p.name)}"><b><i style="background:${DOT[p.state]}"></i>${esc(p.name)}</b><div class="data">${lifeDates(p)} · ${esc(t('commitsN', { n: formatNumber(p.commits) }))} · ${esc(STATES[p.state]?.sentence(p) || '')}</div>${p.inscription ? `<span class="serif">${esc(p.inscription)}</span>` : ''}</div></div>` : '';
    const back = o?._back ? `<button class="back" data-action="back">${esc(t('detail.backToList'))}</button>` : '';
    return `${back}<div class="kicker"><i style="background:${zombie ? DOT.zombie : DOT[r.state]}"></i>${esc(kicker)}</div>
      <h3>${esc(r.name)}</h3>
      <div class="data">${lifeDates(r)}</div>
      ${sentence}${live}${inscription}${tributeHtml}${rows(r)}${history(r)}${words}${guest}${partner}`;
  }

  vaultHtml(o) {
    const list = o.repos.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return `<div class="kicker"><i style="background:${DOT.ancestor}"></i>${esc(t('tip.vaultKicker'))}</div>
      <h3>${esc(t('ancestorsOf', { name: o.successor.name }))}</h3>
      <p class="inscription">${esc(t('detail.vaultText', { name: o.successor.name }))}</p>
      <div class="ancestors">${list.map((r) => `<div class="ancestor" data-repo="${esc(r.name)}"><b>${esc(r.name)}</b><div class="data">${lifeDates(r)} · ${esc(t('commitsN', { n: formatNumber(r.commits) }))}</div><span class="serif">${esc(r.inscription || '')}</span></div>`).join('')}</div>`;
  }

  listHtml({ kicker, title, text, repos, color }) {
    return `<div class="kicker">${color ? `<i style="background:${color}"></i>` : ''}${esc(kicker)}</div><h3>${esc(title)}</h3>
      ${text ? `<p class="inscription">${esc(text)}</p>` : ''}
      <div class="ancestors">${repos.map((r) => `<div class="ancestor" data-repo="${esc(r.name)}"><b><i style="background:${DOT[r.zombie && r.state !== 'dead' ? 'zombie' : r.state]}"></i>${esc(r.name)}</b><div class="data">${esc(STATES[r.state]?.sentence(r) || '')}</div>${r.inscription ? `<span class="serif">${esc(r.inscription)}</span>` : ''}</div>`).join('')}</div>`;
  }

  chapelHtml(o) {
    const deceased = o.deceased || [];
    const commits = deceased.reduce((s, r) => s + (r.commits || 0), 0);
    const byPush = deceased.slice().sort((a, b) => new Date(a.last_push) - new Date(b.last_push));
    const oldest = byPush[0], youngest = byPush[byPush.length - 1];
    const respect = deceased.reduce((s, r) => s + (this.tribute.from(r.name).respect || 0), 0);
    return `<div class="kicker"><i style="background:${DOT.dead}"></i>${esc(t('chapel.kicker'))}</div>
      <h3>${esc(t('places.chapel'))}</h3>
      <p class="inscription">${esc(t('chapel.text', { n: deceased.length, commits: formatNumber(commits) }))}</p>
      <dl>
        ${oldest ? `<dt>${esc(t('chapel.longestDead'))}</dt><dd>${esc(t('chapel.since', { name: oldest.name, date: formatDate(oldest.last_push, true) }))}</dd>` : ''}
        ${youngest ? `<dt>${esc(t('chapel.lastDied'))}</dt><dd>${esc(youngest.name)}, ${formatDate(youngest.last_push, true)}</dd>` : ''}
        <dt>${esc(t('chapel.respect'))}</dt><dd>${esc(t('chapel.respectCount', { n: formatNumber(respect) }))}</dd>
      </dl>
      <div class="ancestors">${byPush.reverse().map((r) => `<div class="ancestor" data-repo="${esc(r.name)}"><b>${esc(r.name)}</b><div class="data">${lifeDates(r)}</div></div>`).join('')}</div>`;
  }

  // ---------- name tags, speech bubbles, map points ----------
  updateSigns(actors, camera, map, player) {
    const box = this.$('.signs');
    const v = new THREE.Vector3();
    const seen = new Set();
    for (const a of actors) {
      if (a.kind === 'team' || a.kind === 'player') continue;
      let s = this.signs.get(a);
      if (!s) {
        s = document.createElement('div');
        s.className = 'sign ' + a.kind;
        const color = a.kind === 'ai' ? a.f.accent : a.kind === 'zombie' ? DOT.zombie : a.kind === 'online' ? '#8be0b0' : '#ffb35c';
        s.style.setProperty('--p', color);
        const brand = a.kind === 'online' && PHOTO[a.f.id] ? `<img src="${PHOTO[a.f.id]}" alt="">` : '<i></i>';
        s.innerHTML = `<div class="bubble" hidden></div><div class="name">${brand}${esc(a.kind === 'zombie' ? a.repo.name : a.f.name)}${a.kind === 'online' ? `<em>${esc(t('online'))}</em>` : ''}</div>`;
        box.appendChild(s);
        this.signs.set(a, s);
      }
      seen.add(a);
      v.set(a.x, a.kind === 'ai' ? 2.35 : 2.1, a.z).project(camera);
      // only those whose head is in the picture: otherwise the tag of a figure outside sticks to the edge
      const visible = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && map < 0.3;
      const dist = player ? Math.hypot(a.x - player.x, a.z - player.z) : 0;
      const near = a.kind === 'player' || dist < 26;
      if (!visible || !near) { s.style.opacity = '0'; continue; }
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
      s.style.opacity = a.kind === 'player' ? '0.75' : String(Math.max(0.35, 1 - dist / 30));
      s.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // the name tag stays fully in the picture, even when the figure stands at the edge
      const nm = s._nm || (s._nm = s.querySelector('.name'));
      const nw = s._nw || (s._nw = nm.offsetWidth);
      const nx = x - nw / 2 < 8 ? 8 - (x - nw / 2) : x + nw / 2 > innerWidth - 8 ? innerWidth - 8 - (x + nw / 2) : 0;
      if (Math.abs(nx - (s._nx || 0)) > 0.5) { s._nx = nx; nm.style.setProperty('--nx', nx.toFixed(0) + 'px'); }
      const bubble = s.querySelector('.bubble');
      const text = a.speaks?.text && dist < 11 ? a.speaks.text : '';
      if (text !== s._text) {
        s._text = text;
        bubble.hidden = !text;
        s._bw = 0;
        if (text) bubble.innerHTML = `<b>${esc(a.speaks.repo.name)}</b>${esc(text)}`;
      }
      if (text) {
        // keep the bubble in the picture, the tip stays above the figure
        const w = s._bw || (s._bw = bubble.offsetWidth);
        const li = x - w / 2, re = x + w / 2;
        let dx = li < 12 ? 12 - li : re > innerWidth - 12 ? innerWidth - 12 - re : 0;
        dx = Math.max(-(w / 2 - 18), Math.min(w / 2 - 18, dx));
        if (Math.abs(dx - (s._dx || 0)) > 0.5) { s._dx = dx; bubble.style.setProperty('--dx', dx.toFixed(0) + 'px'); }
      }
    }
    for (const [a, s] of this.signs) if (!seen.has(a)) { s.remove(); this.signs.delete(a); }
  }

  buildMapPoints(places) {
    const box = this.$('.mapPoints');
    box.innerHTML = '';
    this.points = [];
    // area names stand above their area, however the map is rotated
    const F = this.L.graveyard, T = this.L.pond;
    const outline = (list) => {
      const b = [Infinity, -Infinity, Infinity, -Infinity];
      for (const o of list) {
        const r = o.foot ? Math.max(o.foot.hw, o.foot.hd) : 2;
        b[0] = Math.min(b[0], o.x - r); b[1] = Math.max(b[1], o.x + r); b[2] = Math.min(b[2], o.z - r); b[3] = Math.max(b[3], o.z + r);
      }
      return b;
    };
    const zones = [
      { name: t('places.graveyard'), box: [F.x0, F.x1, F.z0, F.z1] },
      { name: t('places.hospice'), box: outline(this.L.places.filter((o) => o.x < -81)) },
      { name: t('places.clients'), box: outline(this.L.places.filter((o) => o.x > 62)) },
      { name: t('places.pond'), box: [T.x - T.r, T.x + T.r, T.z - T.r, T.z + T.r] },
      { name: t('places.square'), x: 0, z: 0 },
    ];
    for (const zo of zones) {
      const el = document.createElement('div');
      el.className = 'mapZone' + (zo.box ? ' over' : '');
      el.textContent = zo.name;
      box.appendChild(el);
      this.points.push({ el, x: zo.x, z: zo.z, y: 0, zone: true, box: zo.box });
    }
    for (const o of places) {
      const r = o.repo;
      const stateKey = r ? (r.zombie ? 'zombie' : r.state) : o.type === 'vault' ? 'ancestor' : null;
      if (!stateKey) continue;
      const el = document.createElement('button');
      el.className = 'mapPoint';
      el.style.setProperty('--p', DOT[stateKey]);
      const name = r ? r.name : t('ancestorsOf', { name: o.successor.name });
      el.innerHTML = `<i></i><span>${esc(name)}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.actions.mapClick(o); });
      box.appendChild(el);
      this.points.push({ el, x: o.x, z: o.z, y: 0, stateKey, o });
    }
  }

  updateMapPoints(camera, map) {
    if (map < 0.02) { if (this._mp) { this.$('.mapPoints').style.opacity = '0'; this._mp = false; } return; }
    this._mp = true;
    const box = this.$('.mapPoints');
    box.style.opacity = String(Math.max(0, (map - 0.55) / 0.45));
    box.style.pointerEvents = map > 0.9 ? 'auto' : 'none';
    const v = new THREE.Vector3();
    for (const p of this.points) {
      let x, y;
      if (p.box) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
        for (let i = 0; i < 8; i++) {
          v.set(p.box[i & 1], i & 4 ? 5 : 0, p.box[2 + ((i >> 1) & 1)]).project(camera);
          const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy);
        }
        const w = p.w || (p.w = p.el.offsetWidth);
        x = Math.max(w / 2 + 12, Math.min(innerWidth - w / 2 - 12, (x0 + x1) / 2));
        y = Math.max(96, y0 - 6);
      } else {
        v.set(p.x, p.y, p.z).project(camera);
        x = (v.x * 0.5 + 0.5) * innerWidth; y = (-v.y * 0.5 + 0.5) * innerHeight;
      }
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (p.stateKey) p.el.classList.toggle('off', this.filter.size > 0 && !this.filter.has(p.stateKey));
    }
  }

  setFilter(z) {
    if (this.filter.has(z)) this.filter.delete(z); else this.filter.add(z);
    for (const b of this.el.querySelectorAll('.legend button')) b.classList.toggle('on', this.filter.has(b.dataset.z));
  }
}
