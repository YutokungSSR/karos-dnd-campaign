"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./UiSoundSystem.module.css";

type DiceSoundTier = "white" | "green" | "blue" | "red" | "gold" | "rainbow";
type SoundChannel = "ui" | "dice";

type SoundKind =
  | "hover"
  | "click"
  | "tab"
  | "open"
  | "close"
  | "success"
  | "warning"
  | "dice-charge"
  | "dice-tick"
  | "dice-reveal"
  | "dice-stop";

type SoundRequest = {
  kind?: SoundKind;
  progress?: number;
  durationMs?: number;
  tier?: DiceSoundTier;
  meteor?: boolean;
  tick?: number;
};

const ENABLED_KEY = "karos.ui-sound.enabled";
const VOLUME_KEY = "karos.ui-sound.volume";
const MASTER_VOLUME_BOOST = 1.72;
const UI_CHANNEL_BOOST = 1.22;
const DICE_CHANNEL_BOOST = 1.58;
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  "[role='tab']",
  "summary",
  "select",
  "input[type='button']",
  "input[type='submit']",
  "input[type='reset']",
  "[data-ui-sound]",
].join(",");

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function elementText(element: HTMLElement) {
  return [
    element.dataset.uiSound,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.textContent,
    element.className,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("th-TH");
}

function isDisabled(element: HTMLElement) {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    element.dataset.uiSound === "off"
  );
}

function classifyClick(element: HTMLElement): SoundKind | null {
  const explicit = element.dataset.uiSound;
  if (explicit === "off") return null;
  if (
    explicit === "click" ||
    explicit === "tab" ||
    explicit === "open" ||
    explicit === "close" ||
    explicit === "success" ||
    explicit === "warning"
  ) {
    return explicit;
  }

  const text = elementText(element);
  const role = element.getAttribute("role");

  if (
    role === "tab" ||
    /\btab\b|แท็บ|ภาพรวม|คลังพระเจ้า|ตั้งค่าแคมเปญ/.test(text)
  ) {
    return "tab";
  }

  if (
    /danger|delete|remove|trash|ลบ|ทำลาย|ถอดยศ|ยกเลิกการ|ปฏิเสธ/.test(
      text
    )
  ) {
    return "warning";
  }

  if (/close|dismiss|ปิด|ย้อนกลับ|กลับหน้า|×|✕/.test(text)) {
    return "close";
  }

  if (
    /success|confirm|submit|save|publish|send|grant|บันทึก|ยืนยัน|เผยแพร่|ส่ง|มอบ|สร้าง|เพิ่ม/.test(
      text
    )
  ) {
    return "success";
  }

  if (/open|studio|menu|เปิด|ดูรายละเอียด|แก้ไข|จัดการ/.test(text)) {
    return "open";
  }

  return "click";
}

function createNoiseBuffer(context: AudioContext, duration: number) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount;
    const envelope = Math.sin(Math.PI * Math.min(1, progress * 1.6)) *
      Math.pow(1 - progress, 1.45);
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  return buffer;
}

function createReverbImpulse(context: AudioContext) {
  const duration = 1.45;
  const frameCount = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(2, frameCount, context.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount;
      const shimmer = Math.sin(index * (0.017 + channel * 0.003)) * 0.18;
      data[index] =
        (Math.random() * 2 - 1 + shimmer) * Math.pow(1 - progress, 3.4);
    }
  }

  return buffer;
}

export default function UiSoundSystem() {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const [panelOpen, setPanelOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const reverbInputRef = useRef<GainNode | null>(null);
  const diceDryBusRef = useRef<GainNode | null>(null);
  const diceWetBusRef = useRef<GainNode | null>(null);
  const enabledRef = useRef(enabled);
  const volumeRef = useRef(volume);
  const lastGlobalHoverRef = useRef(0);
  const hoverTimesRef = useRef(new WeakMap<HTMLElement, number>());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const knownDialogsRef = useRef(new Set<Element>());

  useEffect(() => {
    enabledRef.current = enabled;
    volumeRef.current = volume;
    const master = masterGainRef.current;
    if (master) {
      master.gain.setTargetAtTime(
        enabled ? volume * MASTER_VOLUME_BOOST : 0,
        master.context.currentTime,
        0.02
      );
    }
  }, [enabled, volume]);

  useEffect(() => {
    try {
      const storedEnabled = window.localStorage.getItem(ENABLED_KEY);
      const storedVolume = Number(window.localStorage.getItem(VOLUME_KEY));
      if (storedEnabled !== null) setEnabled(storedEnabled === "true");
      if (Number.isFinite(storedVolume)) {
        setVolume(clamp(storedVolume, 0, 1));
      }
    } catch {
      // Browsers with blocked storage still keep the in-memory defaults.
    }
  }, []);

  const ensureContext = useCallback(async () => {
    if (!contextRef.current) {
      const context = new AudioContext({ latencyHint: "interactive" });
      const master = context.createGain();
      const dry = context.createGain();
      const reverbInput = context.createGain();
      const convolver = context.createConvolver();
      const reverbReturn = context.createGain();
      const compressor = context.createDynamicsCompressor();

      master.gain.value = enabledRef.current
        ? volumeRef.current * MASTER_VOLUME_BOOST
        : 0;
      dry.gain.value = 1.08;
      reverbInput.gain.value = 1;
      reverbReturn.gain.value = 0.3;
      convolver.buffer = createReverbImpulse(context);

      compressor.threshold.value = -20;
      compressor.knee.value = 16;
      compressor.ratio.value = 3.6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;

      dry.connect(master);
      reverbInput.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(master);
      master.connect(compressor);
      compressor.connect(context.destination);

      contextRef.current = context;
      masterGainRef.current = master;
      dryGainRef.current = dry;
      reverbInputRef.current = reverbInput;
    }

    const context = contextRef.current;
    if (context.state === "suspended") await context.resume();
    setUnlocked(context.state === "running");
    return context;
  }, []);

  const fadeDiceBus = useCallback((context: AudioContext, duration = 0.16) => {
    const now = context.currentTime;
    const buses = [diceDryBusRef.current, diceWetBusRef.current];

    for (const bus of buses) {
      if (!bus) continue;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    }
  }, []);

  const resetDiceBus = useCallback((context: AudioContext) => {
    fadeDiceBus(context, 0.09);

    const dry = dryGainRef.current;
    const reverbInput = reverbInputRef.current;
    if (!dry || !reverbInput) return;

    const dryBus = context.createGain();
    const wetBus = context.createGain();
    dryBus.gain.value = 1.34;
    wetBus.gain.value = 1.18;
    dryBus.connect(dry);
    wetBus.connect(reverbInput);
    diceDryBusRef.current = dryBus;
    diceWetBusRef.current = wetBus;
  }, [fadeDiceBus]);

  const connectTone = useCallback(
    (
      context: AudioContext,
      options: {
        type?: OscillatorType;
        frequency: number;
        endFrequency?: number;
        gain: number;
        duration: number;
        start?: number;
        attack?: number;
        pan?: number;
        reverb?: number;
        channel?: SoundChannel;
      }
    ) => {
      const dry = options.channel === "dice"
        ? diceDryBusRef.current ?? dryGainRef.current
        : dryGainRef.current;
      const reverbInput = options.channel === "dice"
        ? diceWetBusRef.current ?? reverbInputRef.current
        : reverbInputRef.current;
      if (!dry || !reverbInput) return;

      const now = context.currentTime + (options.start ?? 0);
      const attack = options.attack ?? 0.014;
      const channelBoost = options.channel === "dice"
        ? DICE_CHANNEL_BOOST
        : UI_CHANNEL_BOOST;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      const reverbSend = context.createGain();

      oscillator.type = options.type ?? "sine";
      oscillator.frequency.setValueAtTime(options.frequency, now);
      if (options.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(40, options.endFrequency),
          now + options.duration
        );
      }

      panner.pan.value = clamp(options.pan ?? 0, -1, 1);
      reverbSend.gain.value = clamp(options.reverb ?? 0.38, 0, 1);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, options.gain * channelBoost),
        now + attack
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(dry);
      panner.connect(reverbSend);
      reverbSend.connect(reverbInput);

      oscillator.start(now);
      oscillator.stop(now + options.duration + 0.05);
    },
    []
  );

  const connectNoise = useCallback(
    (
      context: AudioContext,
      options: {
        frequency: number;
        endFrequency?: number;
        gain: number;
        duration: number;
        start?: number;
        type?: BiquadFilterType;
        q?: number;
        pan?: number;
        reverb?: number;
        attack?: number;
        channel?: SoundChannel;
      }
    ) => {
      const dry = options.channel === "dice"
        ? diceDryBusRef.current ?? dryGainRef.current
        : dryGainRef.current;
      const reverbInput = options.channel === "dice"
        ? diceWetBusRef.current ?? reverbInputRef.current
        : reverbInputRef.current;
      if (!dry || !reverbInput) return;

      const now = context.currentTime + (options.start ?? 0);
      const channelBoost = options.channel === "dice"
        ? DICE_CHANNEL_BOOST
        : UI_CHANNEL_BOOST;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      const reverbSend = context.createGain();

      source.buffer = createNoiseBuffer(context, options.duration);
      filter.type = options.type ?? "bandpass";
      filter.frequency.setValueAtTime(options.frequency, now);
      if (options.endFrequency) {
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(40, options.endFrequency),
          now + options.duration
        );
      }
      filter.Q.value = options.q ?? 0.55;
      panner.pan.value = clamp(options.pan ?? 0, -1, 1);
      reverbSend.gain.value = clamp(options.reverb ?? 0.28, 0, 1);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, options.gain * channelBoost),
        now + (options.attack ?? 0.022)
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(dry);
      panner.connect(reverbSend);
      reverbSend.connect(reverbInput);

      source.start(now);
      source.stop(now + options.duration + 0.04);
    },
    []
  );

  const playSound = useCallback(
    async (kind: SoundKind, force = false, request: SoundRequest = {}) => {
      if (kind === "dice-stop") {
        const context = contextRef.current;
        if (context) fadeDiceBus(context, 0.22);
        return;
      }

      if (!force && !enabledRef.current) return;
      const context = await ensureContext();
      if (context.state !== "running") return;

      const drift = 1 + (Math.random() - 0.5) * 0.018;
      const soft = 0.8 + Math.random() * 0.12;
      const panDrift = (Math.random() - 0.5) * 0.24;

      if (kind === "dice-charge") {
        resetDiceBus(context);
        const duration = clamp((request.durationMs ?? 2600) / 1000, 1.6, 4.2);
        const meteor = Boolean(request.meteor);

        connectTone(context, {
          type: "sine",
          frequency: meteor ? 55 : 82.41,
          endFrequency: meteor ? 86 : 130.81,
          gain: meteor ? 0.034 : 0.028,
          duration,
          attack: 0.24,
          pan: -0.08,
          reverb: 0.22,
          channel: "dice",
        });
        connectTone(context, {
          type: "triangle",
          frequency: meteor ? 110 : 164.81,
          endFrequency: meteor ? 196 : 261.63,
          gain: meteor ? 0.019 : 0.015,
          duration: Math.max(1.2, duration - 0.08),
          start: 0.025,
          attack: 0.3,
          pan: 0.1,
          reverb: 0.36,
          channel: "dice",
        });
        connectNoise(context, {
          frequency: meteor ? 180 : 320,
          endFrequency: meteor ? 5200 : 3100,
          gain: meteor ? 0.032 : 0.021,
          duration,
          type: "bandpass",
          q: meteor ? 0.3 : 0.42,
          pan: 0,
          reverb: 0.48,
          attack: 0.34,
          channel: "dice",
        });

        const runeNotes = meteor
          ? [220, 329.63, 493.88, 739.99]
          : [392, 523.25, 659.25, 783.99];
        runeNotes.forEach((frequency, index) => {
          const start = 0.22 + index * Math.min(0.46, duration * 0.14);
          connectTone(context, {
            frequency: frequency * drift,
            endFrequency: frequency * 1.018 * drift,
            gain: (0.009 + index * 0.0012) * soft,
            duration: 0.56 + index * 0.07,
            start,
            attack: 0.025,
            pan: -0.34 + index * 0.22,
            reverb: 0.72,
            channel: "dice",
          });
        });

        const pulseStarts = [0.3, 0.52, 0.7, 0.84].map(
          (ratio) => Math.min(duration - 0.2, duration * ratio)
        );
        pulseStarts.forEach((start, index) => {
          connectTone(context, {
            frequency: (meteor ? 72 : 96) + index * 3,
            endFrequency: meteor ? 38 : 58,
            gain: (meteor ? 0.025 : 0.018) * (0.82 + index * 0.07),
            duration: 0.2,
            start,
            attack: 0.012,
            pan: index % 2 === 0 ? -0.08 : 0.08,
            reverb: 0.12,
            channel: "dice",
          });
        });

        const tensionStart = Math.max(0.45, duration - 0.86);
        connectTone(context, {
          type: "triangle",
          frequency: meteor ? 174.61 : 220,
          endFrequency: meteor ? 523.25 : 659.25,
          gain: meteor ? 0.012 : 0.009,
          duration: Math.min(0.84, duration - tensionStart + 0.02),
          start: tensionStart,
          attack: 0.24,
          pan: 0,
          reverb: 0.32,
          channel: "dice",
        });
        connectNoise(context, {
          frequency: 2100,
          endFrequency: 7200,
          gain: meteor ? 0.018 : 0.011,
          duration: Math.min(0.8, duration - tensionStart + 0.02),
          start: tensionStart,
          type: "highpass",
          q: 0.24,
          pan: 0,
          reverb: 0.5,
          attack: 0.28,
          channel: "dice",
        });

        if (meteor) {
          connectNoise(context, {
            frequency: 460,
            endFrequency: 6800,
            gain: 0.038,
            duration: 1.72,
            start: 0.46,
            type: "bandpass",
            q: 0.24,
            pan: -0.42,
            reverb: 0.58,
            attack: 0.18,
            channel: "dice",
          });
          const impactStart = Math.min(2.15, Math.max(1.25, duration - 1.15));
          connectTone(context, {
            frequency: 76,
            endFrequency: 34,
            gain: 0.058,
            duration: 0.82,
            start: impactStart,
            attack: 0.012,
            pan: 0,
            reverb: 0.18,
            channel: "dice",
          });
          connectNoise(context, {
            frequency: 760,
            endFrequency: 130,
            gain: 0.036,
            duration: 0.52,
            start: impactStart,
            type: "lowpass",
            q: 0.5,
            pan: 0,
            reverb: 0.32,
            attack: 0.008,
            channel: "dice",
          });
        }
        return;
      }

      if (kind === "dice-tick") {
        const progress = clamp(request.progress ?? 0, 0, 1);
        const tick = request.tick ?? 0;
        const pitch = 520 + progress * 920 + (tick % 4) * 32;
        const pan = (tick % 2 === 0 ? -0.22 : 0.22) + panDrift * 0.35;

        connectTone(context, {
          frequency: pitch * drift,
          endFrequency: pitch * (1.035 + progress * 0.025) * drift,
          gain: (0.0048 + progress * 0.0042) * soft,
          duration: 0.065 + progress * 0.018,
          attack: 0.004,
          pan,
          reverb: 0.48,
          channel: "dice",
        });
        if (progress > 0.68 && tick % 3 === 0) {
          connectTone(context, {
            frequency: pitch * 1.5 * drift,
            endFrequency: pitch * 1.58 * drift,
            gain: 0.0028 * soft,
            duration: 0.12,
            attack: 0.006,
            pan: -pan,
            reverb: 0.7,
            channel: "dice",
          });
        }
        return;
      }

      if (kind === "dice-reveal") {
        resetDiceBus(context);
        const tier = request.tier ?? "white";
        const meteor = Boolean(request.meteor);
        const intensity = {
          white: 0.82,
          green: 0.88,
          blue: 0.96,
          red: 1.02,
          gold: 1.14,
          rainbow: 1.28,
        }[tier];
        const chords: Record<DiceSoundTier, number[]> = {
          white: [392, 523.25, 659.25],
          green: [392, 493.88, 659.25],
          blue: [440, 587.33, 783.99],
          red: [293.66, 440, 587.33],
          gold: [523.25, 659.25, 783.99, 1046.5],
          rainbow: [523.25, 659.25, 783.99, 987.77, 1318.51],
        };

        connectTone(context, {
          frequency: meteor ? 54 : 108,
          endFrequency: meteor ? 27 : 43,
          gain: (meteor ? 0.072 : 0.052) * intensity,
          duration: meteor ? 1.2 : 0.82,
          attack: 0.008,
          pan: 0,
          reverb: 0.16,
          channel: "dice",
        });
        connectNoise(context, {
          frequency: meteor ? 1100 : 820,
          endFrequency: meteor ? 120 : 190,
          gain: (meteor ? 0.048 : 0.029) * intensity,
          duration: meteor ? 0.78 : 0.48,
          type: "lowpass",
          q: 0.42,
          pan: 0,
          reverb: 0.28,
          attack: 0.006,
          channel: "dice",
        });

        chords[tier].forEach((frequency, index, notes) => {
          connectTone(context, {
            frequency: frequency * drift,
            endFrequency: frequency * (tier === "red" ? 0.99 : 1.012) * drift,
            gain: Math.max(0.008, (0.024 - index * 0.0025) * intensity),
            duration: 0.86 + index * 0.14,
            start: index * (tier === "rainbow" ? 0.055 : 0.075),
            attack: 0.012 + index * 0.004,
            pan: notes.length === 1 ? 0 : -0.42 + (index / (notes.length - 1)) * 0.84,
            reverb: tier === "rainbow" ? 0.88 : 0.72,
            channel: "dice",
          });
        });

        connectTone(context, {
          frequency: tier === "rainbow" ? 2093 : 1567.98,
          endFrequency: tier === "rainbow" ? 2349.32 : 1760,
          gain: 0.0085 * intensity,
          duration: meteor ? 1.9 : 1.35,
          start: 0.14,
          attack: 0.025,
          pan: 0.28,
          reverb: 0.94,
          channel: "dice",
        });

        if (tier === "gold" || tier === "rainbow" || meteor) {
          connectNoise(context, {
            frequency: 3600,
            endFrequency: 9400,
            gain: (tier === "rainbow" ? 0.019 : 0.012) * intensity,
            duration: meteor ? 1.7 : 1.15,
            start: 0.08,
            type: "highpass",
            q: 0.22,
            pan: -0.12,
            reverb: 0.9,
            attack: 0.18,
            channel: "dice",
          });
        }

        const revealBuses = [diceDryBusRef.current, diceWetBusRef.current];
        window.setTimeout(() => {
          const now = context.currentTime;
          for (const bus of revealBuses) {
            if (!bus) continue;
            bus.gain.cancelScheduledValues(now);
            bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
            bus.gain.exponentialRampToValueAtTime(
              0.0001,
              now + (meteor ? 1.2 : 0.82)
            );
          }
        }, meteor ? 2900 : 2200);
        return;
      }

      if (kind === "hover") {
        connectTone(context, {
          frequency: 1174.66 * drift,
          endFrequency: 1318.51 * drift,
          gain: 0.012 * soft,
          duration: 0.12,
          attack: 0.018,
          pan: panDrift,
          reverb: 0.42,
        });
        connectTone(context, {
          frequency: 1760 * drift,
          endFrequency: 1864.66 * drift,
          gain: 0.0045 * soft,
          duration: 0.16,
          start: 0.012,
          attack: 0.02,
          pan: -panDrift,
          reverb: 0.58,
        });
        return;
      }

      if (kind === "click") {
        connectTone(context, {
          frequency: 783.99 * drift,
          endFrequency: 739.99 * drift,
          gain: 0.019 * soft,
          duration: 0.17,
          attack: 0.009,
          pan: panDrift,
          reverb: 0.4,
        });
        connectTone(context, {
          frequency: 1174.66 * drift,
          endFrequency: 1108.73 * drift,
          gain: 0.008 * soft,
          duration: 0.24,
          start: 0.014,
          attack: 0.012,
          pan: -panDrift,
          reverb: 0.62,
        });
        return;
      }

      if (kind === "tab") {
        connectNoise(context, {
          frequency: 2850 * drift,
          gain: 0.008 * soft,
          duration: 0.19,
          type: "bandpass",
          q: 0.36,
          pan: -0.18 + panDrift,
          reverb: 0.24,
          attack: 0.035,
        });
        connectTone(context, {
          frequency: 659.25 * drift,
          endFrequency: 783.99 * drift,
          gain: 0.014 * soft,
          duration: 0.22,
          start: 0.018,
          attack: 0.025,
          pan: 0.14 + panDrift,
          reverb: 0.5,
        });
        return;
      }

      if (kind === "open") {
        [392, 523.25, 783.99].forEach((frequency, index) => {
          connectTone(context, {
            frequency: frequency * drift,
            endFrequency: frequency * 1.025 * drift,
            gain: (0.015 - index * 0.0025) * soft,
            duration: 0.36 + index * 0.08,
            start: index * 0.055,
            attack: 0.022,
            pan: (-0.2 + index * 0.2) + panDrift,
            reverb: 0.58 + index * 0.08,
          });
        });
        connectNoise(context, {
          frequency: 4300 * drift,
          gain: 0.0045 * soft,
          duration: 0.34,
          start: 0.025,
          type: "highpass",
          q: 0.25,
          pan: panDrift,
          reverb: 0.48,
          attack: 0.08,
        });
        return;
      }

      if (kind === "close") {
        [659.25, 493.88, 392].forEach((frequency, index) => {
          connectTone(context, {
            frequency: frequency * drift,
            endFrequency: frequency * 0.97 * drift,
            gain: (0.013 - index * 0.002) * soft,
            duration: 0.28 + index * 0.04,
            start: index * 0.045,
            attack: 0.02,
            pan: (0.18 - index * 0.18) + panDrift,
            reverb: 0.5,
          });
        });
        return;
      }

      if (kind === "success") {
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
          connectTone(context, {
            frequency: frequency * drift,
            endFrequency: frequency * 1.008 * drift,
            gain: (0.017 - index * 0.0022) * soft,
            duration: 0.5 + index * 0.08,
            start: index * 0.055,
            attack: 0.012 + index * 0.004,
            pan: (-0.28 + index * 0.18) + panDrift,
            reverb: 0.65,
          });
        });
        connectTone(context, {
          frequency: 1567.98 * drift,
          endFrequency: 1480 * drift,
          gain: 0.005 * soft,
          duration: 0.82,
          start: 0.09,
          attack: 0.02,
          pan: 0.25 + panDrift,
          reverb: 0.8,
        });
        return;
      }

      [246.94, 369.99, 493.88].forEach((frequency, index) => {
        connectTone(context, {
          frequency: frequency * drift,
          endFrequency: frequency * 0.955 * drift,
          gain: (0.018 - index * 0.003) * soft,
          duration: 0.42 + index * 0.06,
          start: index * 0.045,
          attack: 0.03,
          pan: (-0.12 + index * 0.12) + panDrift,
          reverb: 0.48,
        });
      });
      connectTone(context, {
        frequency: 739.99 * drift,
        endFrequency: 698.46 * drift,
        gain: 0.0045 * soft,
        duration: 0.58,
        start: 0.04,
        attack: 0.04,
        pan: panDrift,
        reverb: 0.65,
      });
    },
    [connectNoise, connectTone, ensureContext, fadeDiceBus, resetDiceBus]
  );

  useEffect(() => {
    const unlock = () => {
      void ensureContext();
    };
    window.addEventListener("pointerdown", unlock, { capture: true, once: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [ensureContext]);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      if (!enabledRef.current || event.pointerType !== "mouse") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!element || isDisabled(element)) return;
      if (element.closest("[data-ui-sound-scope='off']")) return;
      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;

      const now = performance.now();
      const lastElementHover = hoverTimesRef.current.get(element) ?? 0;
      if (now - lastGlobalHoverRef.current < 70 || now - lastElementHover < 170) {
        return;
      }
      lastGlobalHoverRef.current = now;
      hoverTimesRef.current.set(element, now);
      void playSound("hover");
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!element || isDisabled(element)) return;
      if (element.closest("[data-ui-sound-scope='off']")) return;
      const kind = classifyClick(element);
      if (kind) void playSound(kind);
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [playSound]);

  useEffect(() => {
    const selector = "dialog[open],[role='dialog'][aria-modal='true'],[data-ui-modal='open']";
    const syncDialogs = () => {
      const current = new Set(document.querySelectorAll(selector));
      for (const dialog of current) {
        if (!knownDialogsRef.current.has(dialog)) void playSound("open");
      }
      for (const dialog of knownDialogsRef.current) {
        if (!current.has(dialog)) void playSound("close");
      }
      knownDialogsRef.current = current;
    };

    syncDialogs();
    const observer = new MutationObserver(syncDialogs);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal", "data-ui-modal"],
    });
    return () => observer.disconnect();
  }, [playSound]);

  useEffect(() => {
    const onCustomSound = (event: Event) => {
      const detail = (event as CustomEvent<SoundRequest>).detail;
      if (detail?.kind) void playSound(detail.kind, false, detail);
    };
    window.addEventListener("karos-ui-sound", onCustomSound);
    return () => window.removeEventListener("karos-ui-sound", onCustomSound);
  }, [playSound]);

  useEffect(() => {
    const closePanel = (event: PointerEvent) => {
      if (!panelOpen) return;
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setPanelOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("pointerdown", closePanel, true);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closePanel, true);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [panelOpen]);

  useEffect(() => {
    return () => {
      void contextRef.current?.close();
    };
  }, []);

  const volumePercent = useMemo(() => Math.round(volume * 100), [volume]);

  function changeEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    if (!nextEnabled && contextRef.current) {
      fadeDiceBus(contextRef.current, 0.08);
    }
    try {
      window.localStorage.setItem(ENABLED_KEY, String(nextEnabled));
    } catch {
      // Ignore unavailable storage.
    }
    if (nextEnabled) {
      window.setTimeout(() => void playSound("success", true), 30);
    }
  }

  function changeVolume(nextVolume: number) {
    const safeVolume = clamp(nextVolume, 0, 1);
    setVolume(safeVolume);
    try {
      window.localStorage.setItem(VOLUME_KEY, String(safeVolume));
    } catch {
      // Ignore unavailable storage.
    }
  }

  return (
    <div
      ref={panelRef}
      className={styles.soundDock}
      data-ui-sound-scope="off"
    >
      {panelOpen ? (
        <section className={styles.soundPanel} aria-label="ตั้งค่าเสียง UI">
          <div className={styles.panelAura} aria-hidden="true" />
          <header>
            <div>
              <small>FANTASY ASMR</small>
              <strong>เสียงตอบสนอง UI</strong>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => {
                void playSound("close", true);
                setPanelOpen(false);
              }}
              aria-label="ปิดการตั้งค่าเสียง"
            >
              ×
            </button>
          </header>

          <label className={styles.toggleRow}>
            <span>
              <strong>{enabled ? "เปิดเสียง UI" : "ปิดเสียง UI"}</strong>
              <small>ประกายเวท คริสตัล และเสียงทอยแบบ Cinematic ที่ชัดขึ้น</small>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event: { target: { checked: boolean } }) =>
                changeEnabled(event.target.checked)
              }
            />
            <i aria-hidden="true" />
          </label>

          <div className={styles.volumeBlock}>
            <div>
              <span>ระดับเสียงรวม</span>
              <strong>{volumePercent}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volumePercent}
              onChange={(event: { target: { value: string } }) =>
                changeVolume(Number(event.target.value) / 100)
              }
              onPointerUp={() => void playSound("click", true)}
              aria-label="ระดับเสียง UI"
            />
          </div>

          {!unlocked && enabled ? (
            <p className={styles.unlockNote}>
              คลิกภายในเว็บไซต์หนึ่งครั้งเพื่อเปิดระบบเสียงของ Browser
            </p>
          ) : null}

          <div className={styles.previewGrid}>
            <button type="button" onClick={() => void playSound("hover", true)}>
              สัมผัส
            </button>
            <button type="button" onClick={() => void playSound("click", true)}>
              แตะ
            </button>
            <button type="button" onClick={() => void playSound("success", true)}>
              สำเร็จ
            </button>
            <button type="button" onClick={() => void playSound("warning", true)}>
              เตือน
            </button>
          </div>

          <p className={styles.detailText}>
            โทนเสียงเวทคริสตัลแบบนุ่ม พร้อมเสียงทอย Cinematic ที่ซิงก์กับการสุ่ม
          </p>
        </section>
      ) : null}

      <button
        type="button"
        className={`${styles.soundButton} ${enabled ? styles.enabled : styles.muted}`}
        onClick={async () => {
          await ensureContext();
          void playSound(panelOpen ? "close" : "open", true);
          setPanelOpen((current) => !current);
        }}
        aria-label={enabled ? "ตั้งค่าเสียง UI" : "เปิดการตั้งค่าเสียง UI ที่ปิดอยู่"}
        title="เสียง UI"
      >
        <span aria-hidden="true">{enabled ? "♫" : "×"}</span>
        <i aria-hidden="true" />
      </button>
    </div>
  );
}
