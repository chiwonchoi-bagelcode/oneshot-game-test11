/*
 * Haptics: Capacitor Haptics plugin on native builds, navigator.vibrate on Android web,
 * silent elsewhere (iOS Safari has no web vibration).
 */
export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 6,
  light: 10,
  medium: 18,
  heavy: 30,
  success: [14, 50, 22],
  warning: [20, 60, 20],
  error: [30, 40, 30, 40, 30],
};

function capHaptics(): any {
  const w = window as any;
  return w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform() && w.Capacitor.Plugins && w.Capacitor.Plugins.Haptics;
}

let lastAt = 0;

export function vibrate(kind: HapticKind): void {
  const now = performance.now();
  // Never stack buzzes faster than the motor can render them.
  if (now - lastAt < 35 && (kind === 'tick' || kind === 'light')) return;
  lastAt = now;
  try {
    const cap = capHaptics();
    if (cap) {
      if (kind === 'success' || kind === 'warning' || kind === 'error') cap.notification({ type: kind.toUpperCase() });
      else cap.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      return;
    }
    if (navigator.vibrate) navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* not supported */
  }
}
