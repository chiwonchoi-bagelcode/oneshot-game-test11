/*
 * Settings popup (opened from the gear on every top bar) and the rules book.
 * Every switch writes store.data.settings and commits 'settings' at once; main.ts applies audio
 * volumes, reduce-motion and language from there. The popup relabels itself on a language change.
 */
import './meta.css';
import './settings.css';
import { h, onTap } from '../ui/dom.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { openPopup } from '../ui/popup.ts';
import { ruleDiagram } from '../ui/rule-diagrams.ts';
import { store } from '../state/store.ts';
import { defaultSave, type Settings } from '../state/save.ts';
import { clearedUpTo } from '../state/progress.ts';
import { mechanicsKnown } from '../levels/pack.ts';
import { CHAPTER_DEFS } from '../levels/chapters.ts';
import { TEMPO } from '../config/balance.ts';
import { restorePurchases } from '../services/iap.ts';
import { buzz } from '../services/feedback.ts';
import { audio } from '../audio/index.ts';
import { t, onLangChange, type Lang } from '../i18n/i18n.ts';
import type { MechanicKey } from '../core/sim.ts';
import { version } from '../../package.json';

const DEFAULTS = defaultSave('ko').settings;
/** Last non-zero volumes this session, restored when a sound switch is turned back on. */
const lastVol = { sfx: DEFAULTS.sfx, music: DEFAULTS.music };

const LANGS: { id: Lang; name: string }[] = [
  { id: 'ko', name: '한국어' },
  { id: 'en', name: 'English' },
];

type SwitchKey = 'sfx' | 'music' | 'vibration' | 'symbols' | 'relaxed' | 'reducedMotion';

interface SwitchDef {
  key: SwitchKey;
  icon: IconName;
  label: string;
  sub?: () => string;
}

const SWITCHES: SwitchDef[] = [
  { key: 'sfx', icon: 'sound', label: 'settings.sfx' },
  { key: 'music', icon: 'music', label: 'settings.music' },
  { key: 'vibration', icon: 'vibrate', label: 'settings.vibration' },
  { key: 'symbols', icon: 'symbols', label: 'settings.symbols', sub: () => t('settings.symbols.sub') },
  { key: 'relaxed', icon: 'tempo', label: 'settings.relaxed', sub: () => t('settings.relaxed.sub', { n: Math.round((TEMPO.relaxedMul - 1) * 100) }) },
  { key: 'reducedMotion', icon: 'motion', label: 'settings.motion', sub: () => t('settings.motion.sub') },
];

function isOn(s: Settings, k: SwitchKey): boolean {
  if (k === 'sfx' || k === 'music') return s[k] > 0;
  return !!s[k];
}

function setSwitch(k: SwitchKey, on: boolean): void {
  const s = store.data.settings;
  if (k === 'sfx' || k === 'music') {
    if (!on && s[k] > 0) lastVol[k] = s[k];
    s[k] = on ? lastVol[k] || DEFAULTS[k] : 0;
  } else s[k] = on;
  store.commit('settings');
  try { audio.toggle(on); } catch { /* audio not ready */ }
  if (k === 'vibration' && on) buzz('medium');
}

function textPopup(id: string, titleKey: string, bodyKey: string): void {
  openPopup({ id, title: t(titleKey), body: h('div.set-text', null, h('p', { text: t(bodyKey) })) });
}

export function openSettings(): void {
  const updaters: (() => void)[] = [];
  const label = (e: HTMLElement, f: () => string) => updaters.push(() => { e.textContent = f(); });

  // Switches
  const group = h('div.set-group');
  for (const sw of SWITCHES) {
    const name = h('span.set-name');
    const sub = sw.sub ? h('small') : null;
    const knob = h('span.switch');
    const row = h('button.list-row.set-row', { type: 'button', role: 'switch', html: icon(sw.icon) }, h('span.label', null, name, sub), knob);
    label(name, () => t(sw.label));
    if (sub && sw.sub) label(sub, sw.sub);
    updaters.push(() => {
      const on = isOn(store.data.settings, sw.key);
      knob.classList.toggle('on', on);
      row.setAttribute('aria-checked', String(on));
    });
    onTap(row, () => setSwitch(sw.key, !isOn(store.data.settings, sw.key)), { sound: false, guard: 220 });
    group.appendChild(row);
  }

  // Language
  const langName = h('span.set-name');
  label(langName, () => t('settings.lang'));
  const seg = h('div.seg.set-seg');
  const langBtns = LANGS.map((l) => {
    const b = h('button', { type: 'button', text: l.name, lang: l.id });
    onTap(b, () => {
      if (store.data.settings.lang === l.id) return;
      store.data.settings.lang = l.id;
      store.commit('settings');
    });
    seg.appendChild(b);
    return { b, id: l.id };
  });
  updaters.push(() => langBtns.forEach((x) => x.b.classList.toggle('on', store.data.settings.lang === x.id)));
  const langRow = h('div.list-row.set-row.lang', { html: icon('language') }, h('span.label', null, langName), seg);
  group.appendChild(langRow);

  // Links
  const links = h('div.set-group');
  const link = (ic: IconName, key: string, fn: () => void) => {
    const name = h('span.set-name');
    label(name, () => t(key));
    const row = h('button.list-row.set-row.link', { type: 'button', html: icon(ic) }, h('span.label', null, name), h('span.set-go', { html: icon('next') }));
    onTap(row, fn);
    links.appendChild(row);
  };
  link('help', 'settings.howto', () => openRulesBook());
  link('restore', 'settings.restore', () => void restorePurchases());
  link('doc', 'settings.privacy', () => textPopup('settings-privacy', 'settings.privacy', 'settings.privacy.body'));
  link('doc', 'settings.terms', () => textPopup('settings-terms', 'settings.terms', 'settings.terms.body'));

  const ver = h('div.set-version');
  label(ver, () => t('settings.version', { v: 'v' + version }));

  const body = h('div.set-body', null, group, links, ver);
  const p = openPopup({
    id: 'settings',
    title: t('settings.title'),
    body,
    cls: 'set-pop',
    onClose: () => {
      offStore();
      offLang();
    },
  });
  const refresh = () => {
    for (const f of updaters) f();
    const tt = p.sheet.querySelector('.popup-title');
    if (tt) tt.textContent = t('settings.title');
  };
  const offStore = store.on('settings', refresh);
  const offLang = onLangChange(refresh);
  refresh();
}

/** Rules learned so far, in the order the journey teaches them. */
function learnedRules(): MechanicKey[] {
  const known = mechanicsKnown(clearedUpTo());
  const order: MechanicKey[] = [];
  for (const c of CHAPTER_DEFS) for (const m of c.teaches) if (!order.includes(m)) order.push(m);
  for (const m of known) if (!order.includes(m)) order.push(m);
  const out = order.filter((m) => known.has(m));
  return out.length ? out : ['drop'];
}

export function openRulesBook(): void {
  const list = h('div.rules-list');
  for (const m of learnedRules()) {
    list.appendChild(h('div.rule-item', null,
      h('div.ri-diagram', null, ruleDiagram(m)),
      h('b.ri-title', { text: t('mech.' + m + '.title') }),
      h('p.ri-body', { text: t('mech.' + m + '.body') }),
    ));
  }
  const body = h('div.rules-body', null, h('p.rules-intro', { text: t('rules.intro') }), list);
  openPopup({ id: 'rules', title: t('rules.title'), body, cls: 'rules-pop' });
}
