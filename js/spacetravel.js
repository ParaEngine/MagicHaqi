/**
 * SpaceTravel - programmatic spacecraft traffic for the planet view.
 *
 * Usage:
 *   const travel = createSpaceTravel({
 *       userPlanet: {
 *           id: 'user',
 *           name: '宠物星',
 *           x: 70,
 *           y: 65,
 *           radius: 15,
 *           depth: 1,
 *           selector: '#mhPlanet .planet-body',
 *       },
 *       remotePlanets: [
 *           { id: 'haqi', name: '哈奇岛', x: 12, y: 16, radius: 9, depth: 10, selector: '#mhHaqiIsland .remote-planet-body' },
 *           { id: 'ice', name: '冰环星', x: 12, y: 76, radius: 7, depth: 8 },
 *       ],
 *       targetVisible: 4,
 *       haqiTrafficRatio: 0.5,
 *       flyOverRatio: 0.2,
 *   }).mount(document);
 *
 *   // Call when leaving the planet level.
 *   travel.destroy();
 *
 * Required markup:
 *   spaceTravelHtml() returns the rear and front traffic layers. Render it inside
 *   the same positioned space container as the planets before calling mount().
 *
 * Coordinate system:
 *   - x/y are percentages of the space travel layer, not viewport pixels.
 *   - (0, 0) is the top-left of the layer; (100, 100) is the bottom-right.
 *   - Values may go outside 0..100 for off-screen entry/exit points.
 *   - radius is also in layer-percent units and is used only for route jitter.
 *   - selector is optional. If present, the planet x/y/radius are recalculated
 *     from the rendered DOM element on mount and after window resize. This keeps
 *     routes aligned with responsive CSS positions.
 *
 * Depth system:
 *   - depth is camera distance. The user planet is depth 1 by convention.
 *   - Far planets use larger depths; 哈奇岛 defaults to depth 10.
 *   - Aircraft sample interpolated route depth and scale by 1 / depth, then apply
 *     the local near-pass perspective scale. A craft near depth 10 is therefore
 *     about one tenth the size of an equivalent craft near the user planet.
 *
 * Motion model:
 *   - Routes are generated as Catmull-Rom splines through planet/flyby points.
 *   - Progress uses easing for acceleration/deceleration.
 *   - Heading is sampled from a centered tangent and smoothed per aircraft.
 *   - Close fly-over craft are duplicated into the front layer with alpha handoff
 *     so they can pass above the user planet without changing DOM z-index mid-flight.
 */

const AIRCRAFT_TYPES = ['ufo', 'rocket', 'shuttle'];

const DEFAULT_OPTIONS = {
    minVisible: 2,
    maxVisible: 4,
    targetVisible: 4,
    haqiTrafficRatio: 0.5,
    flyOverRatio: 0.2,
};

const ROTATION_RESPONSE_MS = 180;

const REMOTE_PLANETS = [
    { id: 'haqi', name: '哈奇岛', x: 12, y: 16, radius: 9, depth: 10, selector: '#mhHaqiIsland .remote-planet-body' },
    { id: 'ice', name: '冰环星', x: 12, y: 76, radius: 7, depth: 8 },
    { id: 'amber', name: '琥珀星', x: 90, y: 24, radius: 7, depth: 7 },
    { id: 'deep', name: '深蓝星', x: 92, y: 82, radius: 7, depth: 9 },
];

export function spaceTravelHtml() {
    return `
        <div class="space-travel-layer" id="mhSpaceTravelRear" aria-hidden="true"></div>
        <div class="space-travel-front-layer" id="mhSpaceTravelFront" aria-hidden="true"></div>`;
}

export function createSpaceTravel(options = {}) {
    return new SpaceTravel({ ...DEFAULT_OPTIONS, ...options });
}

class SpaceTravel {
    constructor(options) {
        this.options = options;
        this.root = null;
        this.rearLayer = null;
        this.frontLayer = null;
        this.aircraft = [];
        this.missionRafs = new Set();
        this.raf = 0;
        this.lastTime = 0;
        this.layerWidth = 1;
        this.layerHeight = 1;
        this.userPlanet = normalizePlanet(options.userPlanet || { id: 'user', name: '宠物星', x: 70, y: 65, radius: 14, depth: 1, selector: '#mhPlanet' });
        this.remotePlanets = (options.remotePlanets || REMOTE_PLANETS).map(normalizePlanet);
        this.resizeTimer = 0;
        this.boundTick = (time) => this.tick(time);
        this.boundResize = () => this.scheduleRecalculatePlanetLocations();
    }

    mount(root = document) {
        this.root = root;
        this.rearLayer = root.getElementById?.('mhSpaceTravelRear') || document.getElementById('mhSpaceTravelRear');
        this.frontLayer = root.getElementById?.('mhSpaceTravelFront') || document.getElementById('mhSpaceTravelFront');
        if (!this.rearLayer || !this.frontLayer) return this;
        this.rearLayer.innerHTML = '';
        this.frontLayer.innerHTML = '';
        this.aircraft = [];
        this.recalculatePlanetLocations();
        window.addEventListener('resize', this.boundResize);
        for (let i = 0; i < this.options.targetVisible; i++) {
            this.spawnAircraft({ phase: i / this.options.targetVisible });
        }
        this.lastTime = 0;
        this.raf = requestAnimationFrame(this.boundTick);
        return this;
    }

    destroy() {
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.missionRafs.forEach(id => cancelAnimationFrame(id));
        this.raf = 0;
        this.resizeTimer = 0;
        this.missionRafs.clear();
        window.removeEventListener('resize', this.boundResize);
        this.aircraft.forEach(item => {
            item.rearEl?.remove();
            item.frontEl?.remove();
        });
        this.aircraft = [];
    }

    getPlanetPoint(id = 'user') {
        this.updateLayerSize();
        const planet = id === 'user' ? this.userPlanet : this.remotePlanets.find(item => item.id === id);
        if (!planet) return null;
        return {
            x: (planet.x / 100) * this.layerWidth,
            y: (planet.y / 100) * this.layerHeight,
            radius: Math.max(12, (planet.radius / 100) * Math.min(this.layerWidth, this.layerHeight)),
            depth: pointDepth(planet),
        };
    }

    playMission(remoteId, { direction = 'outbound', duration = 2200, type = 'shuttle', cargoClass = '', cargoHue = null } = {}) {
        if (!this.rearLayer || !this.frontLayer) return Promise.resolve(false);
        this.recalculatePlanetLocations();
        const remote = this.remotePlanets.find(item => item.id === remoteId);
        if (!remote) return Promise.resolve(false);
        const outbound = direction !== 'return';
        const startPlanet = outbound ? this.userPlanet : remote;
        const endPlanet = outbound ? remote : this.userPlanet;
        const start = planetCenterPoint(startPlanet);
        const end = planetCenterPoint(endPlanet);
        const mid = curvePoint(start, end, 0.52);
        mid.depth = Math.max(pointDepth(start), pointDepth(end)) * 0.62;
        const route = {
            points: [start, curvePoint(start, mid, 0.36), mid, curvePoint(mid, end, 0.68), end],
            duration,
            minScale: 0.38,
            maxScale: 1.22,
            nearBias: outbound ? 0.16 : 0.84,
        };
        return this.animateMissionRoute(route, type, { cargoClass, cargoHue });
    }

    animateMissionRoute(route, type, { cargoClass = '', cargoHue = null } = {}) {
        const frontEl = createAircraftElement(type, 'mission-front');
        frontEl.classList.add('space-travel-mission-aircraft');
        attachMissionCargo(frontEl, cargoClass, cargoHue);
        this.frontLayer.appendChild(frontEl);
        let startedAt = 0;
        let displayRotation = null;
        let rafId = 0;
        return new Promise(resolve => {
            const step = (time) => {
                if (rafId) this.missionRafs.delete(rafId);
                if (!startedAt) startedAt = time;
                const progress = Math.min(1, (time - startedAt) / route.duration);
                const sample = sampleRoute(route, progress);
                displayRotation = smoothAngle(displayRotation, sample.rotation, 32);
                const displaySample = { ...sample, rotation: displayRotation };
                const depth = depthProfile(progress, route.nearBias);
                const scale = route.minScale + (route.maxScale - route.minScale) * depth;
                const opacity = 0.58 + 0.42 * depth;
                applyAircraftTransform(frontEl, displaySample, scale, opacity, 0, route, this.layerWidth, this.layerHeight);
                if (progress < 1) {
                    rafId = requestAnimationFrame(step);
                    this.missionRafs.add(rafId);
                } else {
                    frontEl.remove();
                    resolve(true);
                }
            };
            rafId = requestAnimationFrame(step);
            this.missionRafs.add(rafId);
        });
    }

    tick(time) {
        if (!this.lastTime) this.lastTime = time;
        const dt = Math.min(80, time - this.lastTime);
        this.lastTime = time;

        this.aircraft.forEach(item => this.updateAircraft(item, dt));
        this.ensureVisibleTraffic();
        this.raf = requestAnimationFrame(this.boundTick);
    }

    scheduleRecalculatePlanetLocations() {
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
            this.resizeTimer = 0;
            this.recalculatePlanetLocations();
            this.resetAircraft();
        }, 120);
    }

    recalculatePlanetLocations() {
        this.updateLayerSize();
        this.userPlanet = recalculatePlanetFromDom(this.userPlanet, this.rearLayer);
        this.remotePlanets = this.remotePlanets.map(planet => recalculatePlanetFromDom(planet, this.rearLayer));
    }

    updateLayerSize() {
        const rect = this.rearLayer?.getBoundingClientRect?.();
        this.layerWidth = rect?.width || 1;
        this.layerHeight = rect?.height || 1;
    }

    ensureVisibleTraffic() {
        const visible = this.aircraft.filter(item => item.alive).length;
        if (visible >= this.options.minVisible) return;
        const missing = Math.min(this.options.maxVisible - visible, this.options.targetVisible - visible);
        for (let i = 0; i < missing; i++) this.spawnAircraft();
    }

    resetAircraft() {
        this.aircraft.forEach(item => {
            item.rearEl?.remove();
            item.frontEl?.remove();
        });
        this.aircraft = [];
        if (!this.rearLayer || !this.frontLayer) return;
        for (let i = 0; i < this.options.targetVisible; i++) {
            this.spawnAircraft({ phase: i / this.options.targetVisible });
        }
    }

    spawnAircraft({ phase = 0 } = {}) {
        const route = this.createRoute();
        const type = randomItem(AIRCRAFT_TYPES);
        const flyOver = Math.random() < this.options.flyOverRatio;
        const rearEl = createAircraftElement(type, 'rear');
        const frontEl = flyOver ? createAircraftElement(type, 'front') : null;
        this.rearLayer.appendChild(rearEl);
        if (frontEl) this.frontLayer.appendChild(frontEl);
        const aircraft = {
            type,
            route,
            flyOver,
            rearEl,
            frontEl,
            age: route.duration * phase,
            alive: true,
            displayRotation: null,
        };
        this.aircraft.push(aircraft);
        this.updateAircraft(aircraft, 0);
        return aircraft;
    }

    updateAircraft(item, dt) {
        item.age += dt;
        const progress = item.age / item.route.duration;
        if (progress >= 1) {
            item.alive = false;
            item.rearEl.remove();
            item.frontEl?.remove();
            this.aircraft = this.aircraft.filter(candidate => candidate !== item);
            this.spawnAircraft();
            return;
        }

        const sample = sampleRoute(item.route, progress);
        item.displayRotation = smoothAngle(item.displayRotation, sample.rotation, dt);
        const displaySample = { ...sample, rotation: item.displayRotation };
        const depth = depthProfile(progress, item.route.nearBias);
        const scale = item.route.minScale + (item.route.maxScale - item.route.minScale) * depth;
        const opacity = 0.42 + 0.58 * depth;
        const blur = 0.9 * (1 - depth);
        const frontAlpha = item.flyOver ? nearPassAlpha(progress) : 0;
        const rearAlpha = item.flyOver ? 1 - frontAlpha : 1;
        applyAircraftTransform(item.rearEl, displaySample, scale, opacity * rearAlpha, blur, item.route, this.layerWidth, this.layerHeight);
        if (item.frontEl) applyAircraftTransform(item.frontEl, displaySample, scale, opacity * frontAlpha, blur, item.route, this.layerWidth, this.layerHeight);
    }

    createRoute() {
        const haqiTraffic = Math.random() < this.options.haqiTrafficRatio;
        const routeKind = Math.random();
        if (haqiTraffic) return this.createPlanetRoute('haqi');
        const nonHaqiPlanets = this.remotePlanets.filter(item => item.id !== 'haqi');
        if (routeKind < 0.48) return this.createPlanetRoute(randomItem(nonHaqiPlanets, this.remotePlanets[0])?.id);
        if (routeKind < 0.82) return this.createFlybyRoute();
        return this.createPlanetToPlanetRoute({ avoidHaqi: true });
    }

    createPlanetRoute(remoteId) {
        const remote = remoteId ? this.remotePlanets.find(item => item.id === remoteId) : randomItem(this.remotePlanets);
        if (!remote) return this.createFlybyRoute();
        const outbound = Math.random() < 0.5;
        const start = jitterPoint(outbound ? remote : edgePointNear(this.userPlanet), outbound ? remote.radius : 18, outbound ? remote.depth : this.userPlanet.depth);
        const end = jitterPoint(outbound ? edgePointAwayFrom(this.userPlanet, remote) : remote, outbound ? 18 : remote.radius, outbound ? this.userPlanet.depth : remote.depth);
        const near = jitterPoint(this.userPlanet, 11 + Math.random() * 8, this.userPlanet.depth);
        return makeRoute([start, curvePoint(start, near, 0.34), near, curvePoint(near, end, 0.62), end], { nearBias: 0.58 });
    }

    createFlybyRoute() {
        const leftToRight = Math.random() < 0.5;
        const start = { x: leftToRight ? -18 : 122, y: rand(14, 88), depth: rand(8, 14) };
        const end = { x: leftToRight ? 122 : -18, y: rand(12, 90), depth: rand(8, 14) };
        const near = jitterPoint(this.userPlanet, rand(10, 28), this.userPlanet.depth);
        return makeRoute([start, curvePoint(start, near, 0.28), near, curvePoint(near, end, 0.68), end], { nearBias: 0.54 });
    }

    createPlanetToPlanetRoute({ avoidHaqi = false } = {}) {
        const pool = avoidHaqi ? this.remotePlanets.filter(item => item.id !== 'haqi') : this.remotePlanets;
        if (pool.length < 2) return this.createFlybyRoute();
        const startPlanet = randomItem(pool);
        const endPlanet = randomItem(pool.filter(item => item.id !== startPlanet.id));
        const nearUser = Math.random() < 0.58;
        const near = nearUser ? jitterPoint(this.userPlanet, rand(12, 30), this.userPlanet.depth) : { x: rand(34, 82), y: rand(20, 82), depth: rand(4, 9) };
        const start = jitterPoint(startPlanet, startPlanet.radius);
        const end = jitterPoint(endPlanet, endPlanet.radius);
        return makeRoute([start, curvePoint(start, near, 0.32), near, curvePoint(near, end, 0.66), end], { nearBias: nearUser ? 0.56 : 0.42 });
    }
}

function makeRoute(points, { nearBias = 0.5 } = {}) {
    return {
        points,
        duration: rand(34000, 62000),
        minScale: rand(0.16, 0.26),
        maxScale: rand(0.86, 1.34),
        nearBias,
    };
}

function sampleRoute(route, progress) {
    const eased = easeInOutSine(progress);
    const points = route.points;
    const segmentCount = points.length - 1;
    const raw = Math.min(segmentCount - 0.0001, eased * segmentCount);
    const index = Math.floor(raw);
    const localT = raw - index;
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const pos = catmullRom(p0, p1, p2, p3, localT);
    const tangent = routeTangent(points, index, localT);
    const dx = tangent.x;
    const dy = tangent.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const flip = dx < 0 ? -1 : 1;
    const rotation = flip < 0 ? normalizeAngle(angle - 180) : normalizeAngle(angle);
    return { x: pos.x, y: pos.y, depth: Math.max(0.1, pos.depth || 1), rotation, flip };
}

function routeTangent(points, index, localT) {
    const delta = 0.012;
    const before = sampleRoutePosition(points, Math.max(0, index + localT - delta));
    const after = sampleRoutePosition(points, Math.min(points.length - 1.0001, index + localT + delta));
    return { x: after.x - before.x, y: after.y - before.y };
}

function sampleRoutePosition(points, raw) {
    const segmentCount = points.length - 1;
    const index = Math.max(0, Math.min(segmentCount - 1, Math.floor(raw)));
    const localT = Math.max(0, Math.min(1, raw - index));
    return catmullRom(
        points[Math.max(0, index - 1)],
        points[index],
        points[index + 1],
        points[Math.min(points.length - 1, index + 2)],
        localT,
    );
}

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        depth: 0.5 * ((2 * pointDepth(p1)) + (-pointDepth(p0) + pointDepth(p2)) * t + (2 * pointDepth(p0) - 5 * pointDepth(p1) + 4 * pointDepth(p2) - pointDepth(p3)) * t2 + (-pointDepth(p0) + 3 * pointDepth(p1) - 3 * pointDepth(p2) + pointDepth(p3)) * t3),
    };
}

function applyAircraftTransform(el, sample, scale, opacity, blur, route, layerWidth, layerHeight) {
    const z = scale > route.maxScale * 0.74 ? 1 : 0;
    const depthScale = 1 / Math.max(0.1, sample.depth || 1);
    const finalScale = scale * depthScale;
    const x = (sample.x / 100) * layerWidth;
    const y = (sample.y / 100) * layerHeight;
    el.style.opacity = opacity.toFixed(3);
    el.style.filter = `blur(${blur.toFixed(2)}px)`;
    el.style.transform = `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0) translate(-50%, -50%) scale(${finalScale.toFixed(4)})`;
    const body = el.firstElementChild;
    if (body) body.style.transform = `rotate(${sample.rotation.toFixed(2)}deg) scaleX(${sample.flip})`;
    el.dataset.near = z ? '1' : '0';
}

function createAircraftElement(type, depth) {
    const el = document.createElement('span');
    el.className = `space-travel-aircraft space-travel-${depth}`;
    el.innerHTML = `<span class="spacecraft-body spacecraft-${type}">${spacecraftSvg(type)}</span>`;
    return el;
}

function attachMissionCargo(el, cargoClass, cargoHue) {
    if (!cargoClass) return;
    const body = el.firstElementChild;
    if (!body) return;
    const cargo = document.createElement('span');
    cargo.className = `spacecraft-cargo ${cargoClass}`;
    if (cargoHue != null) cargo.style.setProperty('--remote-artifact-hue', cargoHue);
    body.appendChild(cargo);
}

function depthProfile(progress, nearBias) {
    const distance = Math.abs(progress - nearBias) / Math.max(nearBias, 1 - nearBias);
    return Math.max(0, 1 - Math.pow(distance, 1.7));
}

function nearPassAlpha(progress) {
    if (progress < 0.44 || progress > 0.66) return 0;
    if (progress < 0.52) return (progress - 0.44) / 0.08;
    if (progress > 0.60) return (0.66 - progress) / 0.06;
    return 1;
}

function curvePoint(a, b, ratio) {
    const bend = rand(-18, 18);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
        x: a.x + dx * ratio + (-dy / length) * bend,
        y: a.y + dy * ratio + (dx / length) * bend,
        depth: pointDepth(a) + (pointDepth(b) - pointDepth(a)) * ratio,
    };
}

function jitterPoint(point, radius = 8, depth = pointDepth(point)) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;
    return {
        x: point.x + Math.cos(angle) * distance,
        y: point.y + Math.sin(angle) * distance,
        depth,
    };
}

function planetCenterPoint(point) {
    return { x: point.x, y: point.y, depth: pointDepth(point) };
}

function edgePointNear(point) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return { x: point.x + side * rand(32, 58), y: point.y + rand(-30, 30), depth: pointDepth(point) };
}

function edgePointAwayFrom(point, remote) {
    const direction = point.x > remote.x ? 1 : -1;
    return { x: point.x + direction * rand(36, 60), y: point.y + rand(-24, 24), depth: pointDepth(point) };
}

function normalizePlanet(planet) {
    return {
        ...planet,
        x: Number(planet.x) || 50,
        y: Number(planet.y) || 50,
        radius: Number(planet.radius) || 8,
        depth: Math.max(0.1, Number(planet.depth) || 1),
    };
}

function recalculatePlanetFromDom(planet, layer) {
    if (!planet.selector || !layer) return planet;
    const el = document.querySelector(planet.selector);
    if (!el) return planet;
    const layerRect = layer.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height || !rect.width || !rect.height) return planet;
    return {
        ...planet,
        x: ((rect.left + rect.width / 2 - layerRect.left) / layerRect.width) * 100,
        y: ((rect.top + rect.height / 2 - layerRect.top) / layerRect.height) * 100,
        radius: Math.max(4, Math.max(rect.width / layerRect.width, rect.height / layerRect.height) * 50),
    };
}

function pointDepth(point) {
    return Math.max(0.1, Number(point?.depth) || 1);
}

function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

function normalizeAngle(angle) {
    let normalized = angle;
    while (normalized > 180) normalized -= 360;
    while (normalized < -180) normalized += 360;
    return normalized;
}

function smoothAngle(current, target, dt) {
    if (current == null || !dt) return target;
    const delta = normalizeAngle(target - current);
    const factor = 1 - Math.exp(-dt / ROTATION_RESPONSE_MS);
    return normalizeAngle(current + delta * factor);
}

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function randomItem(items, fallback = null) {
    if (!items?.length) return fallback;
    return items[Math.floor(Math.random() * items.length)];
}

function spacecraftSvg(type) {
    if (type === 'ufo') return `
        <svg viewBox="0 0 96 64" role="img" focusable="false">
            <ellipse class="ship-trail-glow" cx="24" cy="35" rx="20" ry="8"/>
            <path class="ship-trail" d="M6 37c17-11 36-12 57-4"/>
            <ellipse class="ufo-dome" cx="58" cy="28" rx="22" ry="14"/>
            <ellipse class="ufo-rim" cx="58" cy="38" rx="34" ry="12"/>
            <circle class="ufo-light" cx="42" cy="39" r="3"/><circle class="ufo-light" cx="58" cy="41" r="3"/><circle class="ufo-light" cx="74" cy="39" r="3"/>
        </svg>`;
    if (type === 'rocket') return `
        <svg viewBox="0 0 96 64" role="img" focusable="false">
            <path class="ship-trail rocket-trail" d="M7 42c18-14 35-18 55-13"/>
            <path class="rocket-fin" d="M51 43L35 57l6-22z"/>
            <path class="rocket-fin" d="M62 27l-22-4 17-13z"/>
            <path class="rocket-body" d="M32 38c16-24 36-31 57-33-4 21-16 38-43 49z"/>
            <circle class="rocket-window" cx="65" cy="24" r="6"/>
            <path class="rocket-flame" d="M31 39c-7 2-14 8-20 17 10-3 17-7 22-13z"/>
        </svg>`;
    return `
        <svg viewBox="0 0 112 58" role="img" focusable="false">
            <path class="ship-trail shuttle-trail" d="M7 38c28-15 52-18 82-10"/>
            <path class="shuttle-wing rear" d="M53 36L30 53l8-21z"/>
            <path class="shuttle-body" d="M18 31c25-14 58-20 88-18-11 14-37 25-76 30z"/>
            <path class="shuttle-wing" d="M58 25L33 8l8 22z"/>
            <path class="shuttle-cockpit" d="M84 17c6-1 11-1 17 0-5 4-10 6-18 8z"/>
            <circle class="shuttle-light" cx="38" cy="34" r="2.5"/><circle class="shuttle-light" cx="49" cy="31" r="2"/>
        </svg>`;
}
