/** Instant audio + haptic feedback for field scanning (no audio assets needed). */
export type FeedbackKind = "success" | "warning" | "error" | "info";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = "sine", gain = 0.18) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + duration);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + duration + 0.02);
}

/** Must be called once from a user gesture so iOS allows audio playback. */
export function unlockAudio() {
  audio();
}

export function feedback(kind: FeedbackKind, { sound = true, vibrate = true } = {}) {
  if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
    const pattern = { success: [45], warning: [70, 60, 70], error: [220, 90, 220], info: [25] }[kind];
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  }
  if (!sound) return;
  switch (kind) {
    case "success":
      tone(1046, 0, 0.09);
      tone(1568, 0.08, 0.11);
      break;
    case "warning":
      tone(660, 0, 0.12, "triangle");
      tone(660, 0.18, 0.12, "triangle");
      break;
    case "error":
      tone(196, 0, 0.32, "square", 0.12);
      break;
    case "info":
      tone(880, 0, 0.06);
      break;
  }
}
