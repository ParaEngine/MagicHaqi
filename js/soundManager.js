/*
 * WebAudio sound manager for short MIDI-style game cues.
 *
 * Background music usage:
 *   soundManager.playBgMusic('selector');
 *   soundManager.playBgMusic('forest', { fadeMs: 1200, volume: 0.3 });
 *   soundManager.stopBgMusic();
 *
 * See config.js CONFIG.assets.bgSounds for known background music keys.
 */
import { CONFIG } from './config.js';

const ZOOM_BEEP_GAP_MS = 72;
const ZOOM_LEVEL_GAP_MS = 180;
const ITEM_PLACE_GAP_MS = 90;
const POOP_CLEAN_GAP_MS = 120;
const POOP_COLLECTOR_GAP_MS = 600;
const SPACECRAFT_GAP_MS = 260;
const BUILD_GAP_MS = 160;
const BUTTON_CLICK_GAP_MS = 24;
const POINT_REWARD_GAP_MS = 420;
const FOOD_EAT_GAP_MS = 560;
const BATH_CUE_GAP_MS = 900;
const DEFAULT_BG_MUSIC_VOLUME = 0.36;
const DEFAULT_BG_MUSIC_FADE_MS = 900;

let singletonInstance = null;

function getSharedAudioEngine() {
    if (typeof window === 'undefined') return null;
    return window.keepwork?.audioEngine
        || window.KeepworkSDK?.getSharedAudioEngine?.()
        || window.AudioEngine?.getShared?.()
        || null;
}

export default class SoundManager {
    static getInstance() {
        if (!singletonInstance) singletonInstance = new SoundManager();
        return singletonInstance;
    }

    constructor() {
        if (singletonInstance) return singletonInstance;
        this.lastZoomBeepAt = 0;
        this.lastZoomLevelAt = 0;
        this.lastItemPlaceAt = 0;
        this.lastPoopCleanAt = 0;
        this.lastPoopCollectorAt = 0;
        this.lastSpacecraftAt = 0;
        this.lastBuildAt = 0;
        this.lastButtonClickAt = 0;
        this.lastPointRewardAt = 0;
        this.lastFoodEatAt = 0;
        this.lastBathCueAt = 0;
        this.currentBgMusic = null;
        this.bgMusicMuted = false;
        this.bgMusicToken = 0;
        this.audioEngine = getSharedAudioEngine();
        singletonInstance = this;
        if (typeof window !== 'undefined') {
            this._bindUnlock();
        }
    }

    // Install capture-phase listeners that create + resume the AudioContext on
    // the very first user gesture. After this fires once, every subsequent
    // play*() call runs against an already-running context — no async timing,
    // no dropped schedule, no "first click silent" bug.
    _bindUnlock() {
        this.audioEngine?.bindUserGesture?.(window, {
            events: ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'],
        });
        const unlock = () => {
            this.resumeAudioContext();
            this._resumeBgMusicAfterGesture();
        };
        const opts = { capture: true, passive: true };
        ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach((ev) => {
            window.addEventListener(ev, unlock, opts);
        });
    }

    getAudioContext() {
        this.audioEngine = getSharedAudioEngine();
        if (!this.audioEngine?.isSupported?.()) return null;
        try {
            return this.audioEngine.getContext();
        } catch (_) {
            return null;
        }
    }

    getAudioDestination(ctx) {
        try {
            return this.audioEngine?.getDestination?.() || this.audioEngine?.getOutputNode?.() || ctx.destination;
        } catch (_) {
            return ctx.destination;
        }
    }

    resumeAudioContext() {
        const ctx = this.getAudioContext();
        if (!ctx) return null;
        try { this.audioEngine?.resume?.(); } catch (_) {}
        if (ctx.state === 'suspended') {
            try { return ctx.resume?.() || Promise.resolve(ctx); } catch (_) { return null; }
        }
        return Promise.resolve(ctx);
    }

    resolveBgMusicSource(track) {
        if (!track) return '';
        if (typeof track === 'object') return track.src || track.url || this.resolveBgMusicSource(track.id || track.key || track.name);
        const source = String(track);
        return CONFIG.assets?.bgSounds?.[source] || source;
    }

    playBgMusic(track, {
        volume = DEFAULT_BG_MUSIC_VOLUME,
        fadeMs = DEFAULT_BG_MUSIC_FADE_MS,
        restart = false,
    } = {}) {
        const src = this.resolveBgMusicSource(track);
        if (!src || typeof Audio === 'undefined') return false;

        const targetVolume = this.clampVolume(volume);
        const durationMs = this.normalizeFadeMs(fadeMs);
        const active = this.currentBgMusic;
        if (active?.src === src && !restart) {
            active.shouldPlay = true;
            active.targetVolume = targetVolume;
            active.fadeMs = durationMs;
            active.audio.loop = true;
            if (active.audio.paused) this._startBgMusicEntry(active);
            else this.fadeAudio(active.audio, this.bgMusicMuted ? 0 : targetVolume, durationMs);
            return true;
        }

        this.bgMusicToken += 1;
        if (active?.audio) {
            active.shouldPlay = false;
            this.fadeAudio(active.audio, 0, durationMs, () => this.disposeBgAudio(active.audio));
        }

        const audio = this.createBgAudio(src);
        const entry = {
            audio,
            src,
            shouldPlay: true,
            targetVolume,
            fadeMs: durationMs,
            token: this.bgMusicToken,
        };
        this.currentBgMusic = entry;
        this._startBgMusicEntry(entry);
        return true;
    }

    stopBgMusic({ fadeMs = DEFAULT_BG_MUSIC_FADE_MS } = {}) {
        const active = this.currentBgMusic;
        if (!active?.audio) return false;
        this.bgMusicToken += 1;
        this.currentBgMusic = null;
        active.shouldPlay = false;
        this.fadeAudio(active.audio, 0, this.normalizeFadeMs(fadeMs), () => this.disposeBgAudio(active.audio));
        return true;
    }

    getCurrentBgMusic() {
        const active = this.currentBgMusic;
        if (!active?.audio) return null;
        return {
            src: active.src,
            paused: active.audio.paused,
            volume: active.audio.volume,
            targetVolume: active.targetVolume,
            muted: this.bgMusicMuted,
        };
    }

    isBgMusicMuted() {
        return !!this.bgMusicMuted;
    }

    setBgMusicMuted(muted, { fadeMs = 260 } = {}) {
        this.bgMusicMuted = !!muted;
        const active = this.currentBgMusic;
        if (active?.audio) {
            if (!active.audio.paused && active.shouldPlay) {
                this.fadeAudio(active.audio, this.bgMusicMuted ? 0 : active.targetVolume, this.normalizeFadeMs(fadeMs));
            } else if (!this.bgMusicMuted && active.shouldPlay) {
                this._startBgMusicEntry(active);
            }
        }
        return this.bgMusicMuted;
    }

    toggleBgMusicMuted(options = {}) {
        return this.setBgMusicMuted(!this.bgMusicMuted, options);
    }

    createBgAudio(src) {
        const audio = new Audio(src);
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = 0;
        audio.crossOrigin = 'anonymous';
        audio.playsInline = true;
        return audio;
    }

    _startBgMusicEntry(entry) {
        if (!entry?.audio || this.currentBgMusic !== entry) return;
        entry.audio.volume = entry.audio.paused ? 0 : entry.audio.volume;
        let playResult = null;
        try {
            playResult = entry.audio.play();
        } catch (_) {
            entry.needsResume = true;
            return;
        }
        if (playResult && typeof playResult.then === 'function') {
            playResult.then(() => {
                if (this.currentBgMusic !== entry || !entry.shouldPlay) return;
                entry.needsResume = false;
                this.fadeAudio(entry.audio, this.bgMusicMuted ? 0 : entry.targetVolume, entry.fadeMs);
            }).catch(() => {
                if (this.currentBgMusic !== entry) return;
                entry.audio.volume = 0;
                entry.needsResume = true;
            });
            return;
        }
        this.fadeAudio(entry.audio, this.bgMusicMuted ? 0 : entry.targetVolume, entry.fadeMs);
    }

    _resumeBgMusicAfterGesture() {
        const active = this.currentBgMusic;
        if (!active?.shouldPlay || !active.audio?.paused) return;
        this._startBgMusicEntry(active);
    }

    fadeAudio(audio, toVolume, durationMs = DEFAULT_BG_MUSIC_FADE_MS, onComplete = null) {
        if (!audio) return false;
        if (audio._mhFadeFrame && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(audio._mhFadeFrame);
        }
        const target = this.clampVolume(toVolume);
        const duration = this.normalizeFadeMs(durationMs);
        const from = this.clampVolume(audio.volume);
        if (duration <= 0 || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
            audio.volume = target;
            if (typeof onComplete === 'function') onComplete();
            return true;
        }
        const startedAt = performance.now();
        const step = (nowMs) => {
            const progress = Math.min(1, Math.max(0, (nowMs - startedAt) / duration));
            audio.volume = from + (target - from) * progress;
            if (progress < 1) {
                audio._mhFadeFrame = requestAnimationFrame(step);
                return;
            }
            audio._mhFadeFrame = null;
            if (typeof onComplete === 'function') onComplete();
        };
        audio._mhFadeFrame = requestAnimationFrame(step);
        return true;
    }

    disposeBgAudio(audio) {
        if (!audio) return;
        if (audio._mhFadeFrame && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(audio._mhFadeFrame);
            audio._mhFadeFrame = null;
        }
        try { audio.pause(); } catch (_) {}
        try { audio.removeAttribute('src'); audio.load?.(); } catch (_) {}
    }

    normalizeFadeMs(value) {
        const fadeMs = Number(value);
        return Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : DEFAULT_BG_MUSIC_FADE_MS;
    }

    clampVolume(value) {
        const volume = Number(value);
        if (!Number.isFinite(volume)) return DEFAULT_BG_MUSIC_VOLUME;
        return Math.max(0, Math.min(1, volume));
    }

    midiToFrequency(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    canPlay(lastKey, gapMs) {
        const nowMs = performance.now();
        if (nowMs - this[lastKey] < gapMs) return false;
        this[lastKey] = nowMs;
        return true;
    }

    createToneBus(ctx, now, duration, volume = 0.2) {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        gain.connect(this.getAudioDestination(ctx));
        return gain;
    }

    enqueueSound(callback) {
        const run = () => {
            try { callback(); } catch (_) {}
        };
        if (typeof setTimeout === 'function') setTimeout(run, 0);
        else Promise.resolve().then(run);
        return true;
    }

    playMidiNote(ctx, note, start, duration, {
        type = 'sine',
        volume = 0.08,
        detune = 0,
        attack = 0.012,
        release = 0.08,
        destination = null,
        slideTo = null,
    } = {}) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.detune.setValueAtTime(detune, start);
        osc.frequency.setValueAtTime(this.midiToFrequency(note), start);
        if (slideTo != null) {
            osc.frequency.exponentialRampToValueAtTime(this.midiToFrequency(slideTo), start + duration * 0.82);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(attack + 0.01, duration - release));
        osc.connect(gain);
        gain.connect(destination || this.getAudioDestination(ctx));
        osc.start(start);
        osc.stop(start + duration + 0.05);
        return osc;
    }

    playSequence(notes, {
        step = 0.06,
        duration = 0.16,
        volume = 0.1,
        busVolume = 0.16,
        type = 'triangle',
        startOffset = 0.01,
    } = {}) {
        return this.enqueueSound(() => this._playSequenceNow(notes, {
            step,
            duration,
            volume,
            busVolume,
            type,
            startOffset,
        }));
    }

    _playSequenceNow(notes, {
        step = 0.06,
        duration = 0.16,
        volume = 0.1,
        busVolume = 0.16,
        type = 'triangle',
        startOffset = 0.01,
    } = {}) {
        const ctx = this.getAudioContext();
        if (!ctx) return false;

        const schedule = () => {
            const now = ctx.currentTime + startOffset;
            const normalizedNotes = notes.map((note, index) => {
                if (note && typeof note === 'object' && !Array.isArray(note)) {
                    const at = Number(note.time ?? note.start ?? note.at);
                    const noteDuration = Number(note.duration);
                    const noteVolume = Number(note.volume);
                    return {
                        value: note.note ?? note.midi ?? note.pitch,
                        type: note.type || type,
                        time: Number.isFinite(at) ? at : index * step,
                        duration: Number.isFinite(noteDuration) && noteDuration > 0 ? noteDuration : duration,
                        volume: Number.isFinite(noteVolume) ? noteVolume : volume,
                        attack: note.attack,
                        release: note.release,
                        detune: note.detune,
                        slideTo: note.slideTo,
                    };
                }
                const value = Array.isArray(note) ? note[0] : note;
                const noteType = Array.isArray(note) ? (note[1] || type) : type;
                const at = Array.isArray(note) ? Number(note[2]) : NaN;
                const noteDuration = Array.isArray(note) ? Number(note[3]) : NaN;
                const noteVolume = Array.isArray(note) ? Number(note[4]) : NaN;
                return {
                    value,
                    type: noteType,
                    time: Number.isFinite(at) ? at : index * step,
                    duration: Number.isFinite(noteDuration) && noteDuration > 0 ? noteDuration : duration,
                    volume: Number.isFinite(noteVolume) ? noteVolume : volume,
                };
            });
            const totalDuration = normalizedNotes.reduce((max, note) => Math.max(max, note.time + note.duration), 0) + 0.08;
            const bus = this.createToneBus(ctx, now, totalDuration, busVolume);
            normalizedNotes.forEach((note) => {
                this.playMidiNote(ctx, note.value, now + note.time, note.duration, {
                    type: note.type,
                    volume: note.volume,
                    detune: note.detune,
                    attack: note.attack,
                    release: note.release ?? Math.min(0.09, note.duration * 0.55),
                    destination: bus,
                    slideTo: note.slideTo,
                });
            });
        };

        if (ctx.state === 'running') {
            schedule();
            return true;
        }

        let invoked = false;
        const once = () => {
            if (invoked) return;
            invoked = true;
            try { schedule(); } catch (_) {}
        };
        try {
            const p = this.resumeAudioContext();
            if (p && typeof p.then === 'function') p.then(once, once);
        } catch (_) {}
        setTimeout(once, 30);
        return true;
    }

    playButtonClick() {
        if (!this.canPlay('lastButtonClickAt', BUTTON_CLICK_GAP_MS)) return;

        this.playSequence([
            { note: 84, type: 'triangle', time: 0, duration: 2.15, volume: 0.22, attack: 0.002, release: 0.08 },
            { note: 96, type: 'sine', time: 0.014, duration: 2.05, volume: 0.12, attack: 0.002, release: 0.06 },
        ], {
            busVolume: 0.22,
            startOffset: 0.005,
        });
    }

    playPointReward() {
        if (!this.canPlay('lastPointRewardAt', POINT_REWARD_GAP_MS)) return;
        this.playSequence([
            { note: 67, type: 'triangle', time: 0, duration: 2.25, volume: 0.18, attack: 0.012, release: 0.18 },
            { note: 72, type: 'sine', time: 0.1, duration: 2.18, volume: 0.16, attack: 0.01, release: 0.16 },
            { note: 76, type: 'triangle', time: 0.2, duration: 2.08, volume: 0.15, attack: 0.01, release: 0.16 },
            { note: 79, type: 'sine', time: 0.32, duration: 1.96, volume: 0.14, attack: 0.012, release: 0.18 },
            { note: 84, type: 'triangle', time: 0.52, duration: 1.68, volume: 0.12, attack: 0.018, release: 0.24 },
            { note: 91, type: 'sine', time: 0.82, duration: 1.28, volume: 0.08, attack: 0.02, release: 0.28 },
        ], {
            busVolume: 0.26,
            startOffset: 0.01,
        });
    }

    playFoodEat() {
        if (!this.canPlay('lastFoodEatAt', FOOD_EAT_GAP_MS)) return;
        this.playSequence([
            { note: 60, type: 'triangle', time: 0, duration: 2.1, volume: 0.12, attack: 0.004, release: 0.12 },
            { note: 67, type: 'sine', time: 0.14, duration: 1.95, volume: 0.1, attack: 0.004, release: 0.1 },
            { note: 64, type: 'triangle', time: 0.28, duration: 1.82, volume: 0.1, attack: 0.004, release: 0.1 },
            { note: 72, type: 'sine', time: 0.44, duration: 1.62, volume: 0.08, attack: 0.006, release: 0.14 },
            { note: 76, type: 'triangle', time: 0.72, duration: 1.28, volume: 0.07, attack: 0.008, release: 0.16 },
        ], {
            busVolume: 0.18,
            startOffset: 0.008,
        });
    }

    playBathCue(phase = 'wash') {
        if (!this.canPlay('lastBathCueAt', BATH_CUE_GAP_MS)) return;
        const patterns = {
            start: [
                { note: 67, type: 'sine', time: 0, duration: 0.34, volume: 0.13, attack: 0.02, release: 0.16, slideTo: 74 },
                { note: 79, type: 'triangle', time: 0.22, duration: 0.28, volume: 0.1, attack: 0.01, release: 0.14 },
                { note: 83, type: 'sine', time: 0.38, duration: 0.22, volume: 0.08, attack: 0.01, release: 0.12 },
            ],
            wash: [
                { note: 55, type: 'triangle', time: 0, duration: 0.22, volume: 0.1, attack: 0.015, release: 0.12, slideTo: 62 },
                { note: 62, type: 'sine', time: 0.18, duration: 0.24, volume: 0.09, attack: 0.012, release: 0.14, slideTo: 69 },
                { note: 74, type: 'triangle', time: 0.42, duration: 0.16, volume: 0.07, attack: 0.006, release: 0.1 },
                { note: 81, type: 'sine', time: 0.56, duration: 0.14, volume: 0.055, attack: 0.006, release: 0.1 },
            ],
            sparkle: [
                { note: 76, type: 'triangle', time: 0, duration: 0.18, volume: 0.09, attack: 0.006, release: 0.11 },
                { note: 83, type: 'sine', time: 0.12, duration: 0.2, volume: 0.08, attack: 0.006, release: 0.12 },
                { note: 88, type: 'triangle', time: 0.28, duration: 0.22, volume: 0.075, attack: 0.006, release: 0.13 },
                { note: 95, type: 'sine', time: 0.5, duration: 0.25, volume: 0.06, attack: 0.008, release: 0.16 },
            ],
        };
        this.playSequence(patterns[phase] || patterns.wash, {
            busVolume: phase === 'sparkle' ? 0.22 : 0.2,
            startOffset: 0.008,
        });
    }

    playZoomScrollBeep(direction = 'in') {
        if (!this.canPlay('lastZoomBeepAt', ZOOM_BEEP_GAP_MS)) return;
        const note = direction === 'out' ? 62 : 76;
        this.playSequence([
            { note, type: 'triangle', time: 0, duration: 2.0, volume: 0.26, attack: 0.006, release: 0.1 },
        ], {
            busVolume: 0.3,
            startOffset: 0.005,
        });
    }

    playZoomLevelSound(direction = 'in') {
        if (!this.canPlay('lastZoomLevelAt', ZOOM_LEVEL_GAP_MS)) return;
        const pattern = direction === 'in' ? [60, 64, 67, 72] : [72, 67, 64, 55];
        const notes = [0, 1, 2].flatMap((repeat) => pattern.map((note, index) => ({
            note,
            type: index % 2 ? 'triangle' : 'sine',
            time: repeat * 0.34 + index * 0.075,
            duration: 2.35,
            volume: 0.26,
            attack: 0.01,
            release: 0.16,
        })));
        this.playSequence(notes, {
            busVolume: 0.34,
            startOffset: 0.015,
        });
    }

    playItemPlace() {
        if (!this.canPlay('lastItemPlaceAt', ITEM_PLACE_GAP_MS)) return;
        this.playSequence([
            { note: 72, type: 'triangle', duration: 2.0, volume: 0.18 },
            { note: 79, type: 'sine', duration: 2.0, volume: 0.15 },
            { note: 84, type: 'triangle', duration: 2.0, volume: 0.18 },
        ], {
            step: 0.045,
            duration: 2.0,
            volume: 0.18,
            busVolume: 0.24,
        });
    }

    playPoopClean(count = 1) {
        if (!this.canPlay('lastPoopCleanAt', POOP_CLEAN_GAP_MS)) return;
        const notes = count > 1 ? [55, 62, 67, 74] : [62, 67, 74];
        this.playSequence(notes.map((note) => ({
            note,
            type: 'square',
            duration: 2.0,
            volume: 0.18,
            attack: 0.006,
            release: 0.12,
        })), {
            step: 0.05,
            duration: 2.0,
            volume: 0.18,
            busVolume: 0.24,
            type: 'square',
        });
    }

    playPoopCollectorSuck(count = 1) {
        if (!this.canPlay('lastPoopCollectorAt', POOP_COLLECTOR_GAP_MS)) return;
        const sparkleCount = Math.min(8, Math.max(3, Number(count) || 1));
        const sparkles = Array.from({ length: sparkleCount }, (_, index) => ({
            note: [79, 83, 86, 91][index % 4],
            type: index % 2 ? 'triangle' : 'sine',
            time: 0.18 + index * 0.22,
            duration: 0.2,
            volume: 0.08,
            attack: 0.01,
            release: 0.12,
        }));
        this.playSequence([
            { note: 45, type: 'sawtooth', time: 0, duration: 2.25, volume: 0.08, attack: 0.08, release: 0.36, slideTo: 64 },
            { note: 52, type: 'triangle', time: 0.08, duration: 2.05, volume: 0.07, attack: 0.08, release: 0.34, slideTo: 69 },
            { note: 69, type: 'sine', time: 1.58, duration: 0.48, volume: 0.11, attack: 0.03, release: 0.18 },
            ...sparkles,
        ], {
            busVolume: 0.2,
            startOffset: 0.01,
        });
    }

    playSpacecraftTakeoff() {
        if (!this.canPlay('lastSpacecraftAt', SPACECRAFT_GAP_MS)) return;
        this.playSequence([
            { note: 43, type: 'sawtooth', time: 0, duration: 2.25, volume: 0.14, release: 0.2, slideTo: 67 },
            ...[55, 62, 67, 74].map((note, index) => ({
                note,
                type: 'triangle',
                time: 0.1 + index * 0.055,
                duration: 2.0,
                volume: 0.14,
            })),
        ], {
            busVolume: 0.26,
            startOffset: 0.01,
        });
    }

    playSpacecraftArrive() {
        if (!this.canPlay('lastSpacecraftAt', SPACECRAFT_GAP_MS)) return;
        this.playSequence([
            { note: 79, type: 'sine', duration: 2.0, volume: 0.17 },
            { note: 76, type: 'triangle', duration: 2.0, volume: 0.18 },
            { note: 72, type: 'triangle', duration: 2.0, volume: 0.18 },
            { note: 84, type: 'sine', duration: 2.0, volume: 0.17 },
        ], {
            step: 0.06,
            duration: 2.0,
            volume: 0.18,
            busVolume: 0.24,
        });
    }

    playBuildCreated() {
        if (!this.canPlay('lastBuildAt', BUILD_GAP_MS)) return;
        this.playSequence([60, 67, 72, 79].map((note) => ({
            note,
            type: 'triangle',
            duration: 2.0,
            volume: 0.2,
            attack: 0.01,
            release: 0.14,
        })), {
            step: 0.07,
            duration: 2.0,
            volume: 0.2,
            busVolume: 0.26,
            type: 'triangle',
        });
    }

    playBuildLevelUp() {
        if (!this.canPlay('lastBuildAt', BUILD_GAP_MS)) return;
        this.playSequence([64, 67, 71, 76, 83].map((note) => ({
            note,
            type: 'sine',
            duration: 2.0,
            volume: 0.18,
            attack: 0.008,
            release: 0.12,
        })), {
            step: 0.055,
            duration: 2.0,
            volume: 0.18,
            busVolume: 0.25,
            type: 'sine',
        });
    }
}
