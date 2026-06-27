import { escapeHtml } from './utils.js';

const EFFECT_IDS = new Set(['sparkle', 'snow', 'rain', 'mist', 'bubbles', 'petals', 'embers']);
const CANVAS_SIZE = 512;
const DENSITY_SCALE = { thumbnail: 0.42, scene: 0.85, field: 1.05, weather: 1.15 };
const DENSITY_LIMIT = { thumbnail: 18, scene: 42, field: 52, weather: 72 };
const DEFAULT_DENSITY_BY_EFFECT = { rain: 'weather', snow: 'weather', mist: 'weather', embers: 'field' };

const EFFECT_PROFILES = {
    sparkle: { count: 14, motion: 'float', color: '#fff7ad', glow: '#ffffff', minSize: 2.5, maxSize: 5.5, speed: 0.032, drift: 0.08 },
    snow: { count: 24, motion: 'fall', color: 'rgba(255,255,255,.98)', glow: 'rgba(14,116,144,.34)', minSize: 3.2, maxSize: 7.2, speed: 0.036, drift: 0.08 },
    rain: { count: 68, motion: 'fall', color: 'rgba(219,239,252,.78)', glow: 'rgba(125,211,252,.2)', minSize: 18, maxSize: 42, speed: 0.22, drift: 0.07 },
    mist: { count: 18, motion: 'float', color: 'rgba(248,252,255,.24)', minSize: 56, maxSize: 146, speed: 0.011, drift: 0.24 },
    bubbles: { count: 14, motion: 'rise', color: 'rgba(186,230,253,.2)', stroke: 'rgba(255,255,255,.78)', minSize: 5, maxSize: 11, speed: 0.044, drift: 0.08 },
    petals: { count: 14, motion: 'fall', color: '#f9a8d4', minSize: 4, maxSize: 8, speed: 0.034, drift: 0.12 },
    embers: { count: 24, motion: 'rise', color: '#f59e0b', glow: 'rgba(251,191,36,.95)', minSize: 3.6, maxSize: 8.4, speed: 0.05, drift: 0.08 },
};

function hashString(value) {
    const text = String(value || 'MagicHaqiParticles');
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}

function makeRng(seedText) {
    let seed = hashString(seedText) || 1;
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function parseEffectIds(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[，,\s]+/);
    return [...new Set(raw.map(item => String(item || '').trim()).filter(item => EFFECT_IDS.has(item)))];
}

function resolveDensity(effects, density) {
    if (density && DENSITY_SCALE[density]) return density;
    return effects.map(effect => DEFAULT_DENSITY_BY_EFFECT[effect]).find(Boolean) || 'scene';
}

function numberInRange(random, min, max) {
    return min + random() * (max - min);
}

export function renderParticleCanvasHtml(effects, { className = '', density = '', size = CANVAS_SIZE, seed = '' } = {}) {
    const parsed = parseEffectIds(effects);
    if (!parsed.length) return '';
    const resolvedDensity = resolveDensity(parsed, density);
    const safeSize = Math.max(128, Math.min(CANVAS_SIZE, Number(size) || CANVAS_SIZE));
    const classes = ['mh-particle-canvas', className].filter(Boolean).join(' ');
    return `<canvas class="${escapeHtml(classes)}" width="${safeSize}" height="${safeSize}" data-particle-effects="${escapeHtml(parsed.join(','))}" data-particle-density="${escapeHtml(resolvedDensity)}" data-particle-seed="${escapeHtml(seed || parsed.join('-'))}" aria-hidden="true"></canvas>`;
}

export function particleEffectsCss() {
    return `
        .mh-particle-canvas { position:absolute; inset:0; z-index:1; width:100%; height:100%; display:block; pointer-events:none; image-rendering:auto; }
        .mh-particle-canvas.is-paused { visibility:hidden; }
    `;
}

export default class ParticleEffects {
    static getInstance() {
        if (!window.__mhParticleEffects) window.__mhParticleEffects = new ParticleEffects();
        return window.__mhParticleEffects;
    }

    constructor() {
        this.layers = new Set();
        this.layerByCanvas = new WeakMap();
        this.frameId = 0;
        this.visibilityObserver = null;
        if ('IntersectionObserver' in window) {
            this.visibilityObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const layer = this.layerByCanvas.get(entry.target);
                    if (layer) layer.visible = entry.isIntersecting;
                });
            }, { root: null, threshold: 0.01 });
        }
    }

    mountAll(root = document) {
        const host = root || document;
        host.querySelectorAll?.('canvas[data-particle-effects]').forEach(canvas => this.attach(canvas));
        this.detachDisconnected();
    }

    attach(canvas) {
        if (!canvas?.getContext) return null;
        const effects = parseEffectIds(canvas.dataset.particleEffects);
        if (!effects.length) return null;
        const signature = [effects.join(','), canvas.dataset.particleDensity || 'scene', canvas.dataset.particleSeed || ''].join('|');
        let layer = this.layerByCanvas.get(canvas);
        if (layer?.signature === signature) return layer;
        if (layer) this.layers.delete(layer);
        layer = this.createLayer(canvas, effects, signature);
        this.layerByCanvas.set(canvas, layer);
        this.layers.add(layer);
        this.visibilityObserver?.observe(canvas);
        this.ensureLoop();
        return layer;
    }

    createLayer(canvas, effects, signature) {
        const density = canvas.dataset.particleDensity || 'scene';
        const safeSize = Math.max(128, Math.min(CANVAS_SIZE, Number(canvas.getAttribute('width')) || CANVAS_SIZE));
        canvas.width = safeSize;
        canvas.height = safeSize;
        return {
            canvas,
            ctx: canvas.getContext('2d', { alpha: true }),
            effects,
            density,
            signature,
            visible: true,
            particles: this.createParticles(effects, density, canvas.dataset.particleSeed || signature),
        };
    }

    createParticles(effects, density, seedText) {
        const random = makeRng(`${seedText}::${density}`);
        const scale = DENSITY_SCALE[density] || DENSITY_SCALE.scene;
        const limit = DENSITY_LIMIT[density] || DENSITY_LIMIT.scene;
        const particles = [];
        effects.forEach(effect => {
            const profile = EFFECT_PROFILES[effect];
            const count = Math.max(3, Math.round(profile.count * scale / Math.max(1, effects.length * 0.72)));
            for (let index = 0; index < count; index += 1) {
                const depth = numberInRange(random, 0.65, 1.35);
                particles.push({
                    effect,
                    baseX: random(),
                    baseY: random(),
                    offset: random(),
                    phase: random() * Math.PI * 2,
                    size: numberInRange(random, profile.minSize, profile.maxSize),
                    speed: profile.speed * numberInRange(random, 0.72, 1.28) * (effect === 'rain' ? depth : 1),
                    drift: profile.drift * numberInRange(random, 0.65, 1.35),
                    alpha: numberInRange(random, effect === 'mist' ? 0.22 : 0.48, effect === 'mist' ? 0.72 : 0.94),
                    tilt: effect === 'rain' ? numberInRange(random, -0.42, -0.26) : numberInRange(random, -0.9, 0.9),
                    depth,
                    stretch: numberInRange(random, 0.72, 1.72),
                    wobble: numberInRange(random, 0.55, 1.45),
                });
            }
        });
        return particles.slice(0, limit);
    }

    ensureLoop() {
        if (this.frameId) return;
        const step = (now) => {
            this.frameId = 0;
            this.detachDisconnected();
            this.layers.forEach(layer => this.drawLayer(layer, now / 1000));
            if (this.layers.size) {
                this.frameId = requestAnimationFrame(step);
            }
        };
        this.frameId = requestAnimationFrame(step);
    }

    detachDisconnected() {
        this.layers.forEach(layer => {
            if (!layer.canvas.isConnected) {
                this.visibilityObserver?.unobserve(layer.canvas);
                this.layers.delete(layer);
            }
        });
    }

    drawLayer(layer, time) {
        const { canvas, ctx } = layer;
        if (!ctx || !layer.visible || canvas.offsetParent === null) return;
        const width = canvas.width || CANVAS_SIZE;
        const height = canvas.height || CANVAS_SIZE;
        ctx.clearRect(0, 0, width, height);
        layer.particles.forEach(particle => this.drawParticle(ctx, particle, time, width, height));
    }

    drawParticle(ctx, particle, time, width, height) {
        const profile = EFFECT_PROFILES[particle.effect];
        const progress = (particle.offset + time * particle.speed) % 1;
        const wave = Math.sin(progress * Math.PI * 2 + particle.phase);
        let x = particle.baseX + wave * particle.drift;
        let y = particle.baseY;
        if (particle.effect === 'rain') x += progress * particle.drift * 2.8;
        if (profile.motion === 'fall') y = -0.14 + progress * 1.28;
        if (profile.motion === 'rise') y = 1.12 - progress * 1.24;
        if (profile.motion === 'float') {
            x += Math.sin(time * particle.speed * 5 + particle.phase) * particle.drift * 0.45;
            y = particle.baseY + Math.sin(time * particle.speed * 9 + particle.phase) * (particle.effect === 'mist' ? 0.035 : 0.07);
        }
        x = ((x % 1) + 1) % 1;
        const px = x * width;
        const py = y * height;
        const fade = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) || 0.22;
        ctx.save();
        ctx.globalAlpha = Math.min(1, particle.alpha * (profile.motion === 'float' ? 0.86 : fade) * (particle.depth || 1));
        ctx.translate(px, py);
        ctx.rotate(particle.tilt + (particle.effect === 'rain' ? 0 : wave * 0.35));
        this.drawShape(ctx, particle, profile, progress);
        ctx.restore();
    }

    drawShape(ctx, particle, profile, progress = 0) {
        const size = particle.size;
        if (particle.effect === 'rain') {
            const depth = particle.depth || 1;
            const length = size * (1.25 + particle.stretch * 0.58) * depth;
            const tail = ctx.createLinearGradient(0, -length * 0.58, 0, length * 0.58);
            tail.addColorStop(0, 'rgba(219,239,252,0)');
            tail.addColorStop(0.18, profile.color);
            tail.addColorStop(1, 'rgba(125,211,252,0.08)');
            ctx.strokeStyle = tail;
            ctx.lineWidth = Math.max(0.8, size * 0.055 * depth);
            ctx.lineCap = 'round';
            ctx.shadowColor = profile.glow;
            ctx.shadowBlur = size * 0.28;
            ctx.beginPath();
            ctx.moveTo(0, -length * 0.58);
            ctx.lineTo(0, length * 0.58);
            ctx.stroke();
            if (progress > 0.84) {
                ctx.globalAlpha *= 0.38;
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(226,246,255,.38)';
                ctx.lineWidth = Math.max(0.7, size * 0.035);
                ctx.beginPath();
                ctx.moveTo(-size * 0.16, length * 0.46);
                ctx.lineTo(size * 0.18, length * 0.36);
                ctx.stroke();
            }
            return;
        }
        if (particle.effect === 'petals') {
            ctx.fillStyle = profile.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, size * 0.72, size * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (particle.effect === 'mist') {
            const depth = particle.depth || 1;
            const width = size * (1.45 + particle.stretch * 0.65);
            const height = size * (0.28 + particle.wobble * 0.08);
            ctx.globalCompositeOperation = 'screen';
            ctx.filter = `blur(${Math.max(1, size * 0.025)}px)`;
            const gradient = ctx.createRadialGradient(-width * 0.18, -height * 0.08, size * 0.08, 0, 0, width);
            gradient.addColorStop(0, profile.color);
            gradient.addColorStop(0.42, `rgba(226,246,255,${0.13 * depth})`);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.filter = 'none';
            ctx.globalAlpha *= 0.42;
            ctx.strokeStyle = `rgba(255,255,255,${0.16 * depth})`;
            ctx.lineWidth = Math.max(1, size * 0.025);
            ctx.beginPath();
            ctx.moveTo(-width * 0.68, Math.sin(particle.phase) * height * 0.08);
            ctx.bezierCurveTo(-width * 0.25, -height * 0.34, width * 0.2, height * 0.28, width * 0.66, -height * 0.08);
            ctx.stroke();
            return;
        }
        if (particle.effect === 'bubbles') {
            ctx.fillStyle = profile.color;
            ctx.strokeStyle = profile.stroke;
            ctx.lineWidth = Math.max(1, size * 0.16);
            ctx.beginPath();
            ctx.arc(0, 0, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }
        if (profile.glow) {
            ctx.shadowColor = profile.glow;
            ctx.shadowBlur = size * 2.2;
        }
        ctx.fillStyle = profile.color;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
    }
}