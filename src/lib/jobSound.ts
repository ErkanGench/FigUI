// Audible job-end notices, synthesized with Web Audio so no sound files ship
// in the ESP32 bundle. Plain-HTTP pages cannot use system notifications, but
// Web Audio works anywhere once the page has had a user gesture.

export type JobSound = 'finished' | 'warning'

type Note = { frequency: number; start: number; length: number }

const chime = (start: number): Note[] => [
  { frequency: 523.25, start, length: 0.25 },
  { frequency: 659.25, start: start + 0.18, length: 0.25 },
  { frequency: 783.99, start: start + 0.36, length: 0.5 },
]

const PATTERNS: Record<JobSound, { wave: OscillatorType; peak: number; notes: Note[] }> = {
  // A rising chime played three times, so it carries over fans and extraction.
  finished: { wave: 'sine', peak: 0.4, notes: [0, 1.2, 2.4].flatMap(chime) },
  // An alternating two-tone alarm for a job that did not run to its end.
  warning: {
    wave: 'square',
    peak: 0.15,
    notes: [0, 0.5, 1, 1.5, 2, 2.5].map((start, index) => ({ frequency: index % 2 ? 660 : 880, start, length: 0.4 })),
  },
}

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  const Context = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return null
  context ??= new Context()
  if (context.state === 'suspended') context.resume().catch(() => { /* needs a user gesture first */ })
  return context
}

/** Browsers only start audio after a user gesture, so prepare it on the first one. */
export function prepareJobSoundOnFirstGesture(): () => void {
  const prepare = () => {
    audioContext()
    window.removeEventListener('pointerdown', prepare)
    window.removeEventListener('keydown', prepare)
  }
  window.addEventListener('pointerdown', prepare)
  window.addEventListener('keydown', prepare)
  return () => {
    window.removeEventListener('pointerdown', prepare)
    window.removeEventListener('keydown', prepare)
  }
}

export function playJobSound(kind: JobSound) {
  const ctx = audioContext()
  if (!ctx) return
  const { wave, peak, notes } = PATTERNS[kind]
  const now = ctx.currentTime + 0.05
  for (const { frequency, start, length } of notes) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = wave
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, now + start)
    gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(now + start)
    oscillator.stop(now + start + length + 0.05)
  }
}
