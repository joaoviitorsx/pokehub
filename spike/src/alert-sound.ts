// Som do alerta do RMT. Tons:
//  - "original": composição própria, sintetizada na hora com Web Audio (arpejo de "achado" em Mi maior + brilho agudo, ~0,7 s);
//  - "confirma1", "confirma3", "vidro": sons do pacote Interface Sounds da Kenney (CC0, domínio público; licença em
//    assets/sounds/LICENSE-kenney-interface-sounds.txt), tocados por <audio> (a CSP da interface bloqueia fetch).
import confirma1 from './assets/sounds/confirmation_001.wav';
import confirma3 from './assets/sounds/confirmation_003.wav';
import vidro from './assets/sounds/glass_001.wav';

export type Tone = 'original' | 'confirma1' | 'confirma3' | 'vidro';
export const TONES: {id: Tone; nome: string}[] = [
  {id: 'confirma1', nome: 'Confirmação'}, {id: 'vidro', nome: 'Vidro'}, {id: 'confirma3', nome: 'Confirmação 2'}, {id: 'original', nome: 'PokéHub (original)'},
];
const FILES: Partial<Record<Tone, string>> = {confirma1, confirma3, vidro};
const KEY = 'pokehub.alertSound';
export interface SoundPrefs { on: boolean; volume: number; tone: Tone }
export function loadSoundPrefs(): SoundPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundPrefs>;
    return {on: v.on !== false, volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : 0.6, tone: TONES.some(t => t.id === v.tone) ? v.tone as Tone : 'confirma1'};
  } catch { return {on: true, volume: 0.6, tone: 'confirma1'}; }
}
export function saveSoundPrefs(prefs: SoundPrefs) { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* só não persiste */ } }

let ctx: AudioContext | null = null;
let last = 0;
const players = new Map<Tone, HTMLAudioElement>();
/** Toca o alerta (no máximo 1 vez a cada 1,5 s, para uma rajada de anúncios não virar barulho). `force` ignora o intervalo (botão Testar). */
export function playAlertSound(prefs: Pick<SoundPrefs, 'volume' | 'tone'> = loadSoundPrefs(), force = false): void {
  const now = performance.now();
  if ((!force && now - last < 1500) || prefs.volume <= 0) return;
  last = now;
  const file = FILES[prefs.tone];
  if (file) {
    try {
      let audio = players.get(prefs.tone);
      if (!audio) { audio = new Audio(file); audio.preload = 'auto'; players.set(prefs.tone, audio); }
      audio.volume = Math.min(1, prefs.volume);
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch { /* sem áudio: segue só o visual */ }
    return;
  }
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = Math.min(1, prefs.volume) * 0.35;
    master.connect(ctx.destination);
    const note = (freq: number, start: number, dur: number, type: OscillatorType, gain: number) => {
      const osc = ctx!.createOscillator(), env = ctx!.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, start);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(gain, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0008, start + dur);
      osc.connect(env); env.connect(master);
      osc.start(start); osc.stop(start + dur + 0.02);
    };
    [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => note(f, t0 + i * 0.075, 0.22 + i * 0.04, 'triangle', 0.9));
    note(3951, t0 + 0.32, 0.38, 'sine', 0.35);
    note(3962, t0 + 0.34, 0.36, 'sine', 0.25);
    setTimeout(() => { try { master.disconnect(); } catch { /* já desligado */ } }, 1200);
  } catch { /* sem áudio: segue só o visual */ }
}
