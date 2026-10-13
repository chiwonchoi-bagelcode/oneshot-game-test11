/* One place for "juice": button sounds and haptics, respecting the player's settings. */
import { audio } from '../audio/index.ts';
import { vibrate, type HapticKind } from '../platform/haptics.ts';
import { store } from '../state/store.ts';

export function sfx(kind: 'tap' | 'back'): void {
  try {
    if (kind === 'back') audio.uiBack();
    else audio.uiTap();
  } catch {
    /* audio not ready */
  }
  buzz('tick');
}

export function buzz(kind: HapticKind): void {
  if (!store.data.settings.vibration) return;
  vibrate(kind);
}

export function applyAudioSettings(): void {
  const s = store.data.settings;
  audio.setVolumes({ sfx: s.sfx, music: s.music });
}
