/*
 * ThreeJsModelGenerator.js — Reusable core for the "3D Vibe DevTools" workflow.
 *
 * 输入：一段普通的 Three.js 建模源码（字符串）。约定：
 *   - 顶部 PARAMS 区：顶格的 `const name = number;  // 注释` 行 → 可拖动的真实参数。
 *   - 对象分段：每组对象前一行顶格注释 `// label 中文说明` → 用作对象名 + 高亮范围。
 *   - 零侵入：用 `scene.add(mesh)` 加入对象，无需任何探针调用。
 *
 * 输出：一个交互式控制器（挂载到 canvas），支持：
 *   - color-id picking：点击 3D 像素 → 反查对象 → 高亮源码块 + 抓取相关参数。
 *   - 实时调参：拖动滑块改写源码字面量并重建（改一处、动多处）。
 *   - 干净导出：getCurrentSource() 返回带最新参数值的纯净 Three.js 源码（无调试色注入）。
 *
 * 用法：
 *   const ctrl = createThreeModelEditor({ canvas, source, helpers, onPick, onSourceChange });
 *   ctrl.getCurrentSource();   // 导出
 *   ctrl.setSource(newSrc);    // 切换 snippet
 *   ctrl.destroy();
 *
 * THREE 直接在本模块内静态 import（keepwork CDN ESM），无需调用方传入、
 * 也无需在 HTML 里再用 <script> 引入。仍可通过 opts.THREE 覆盖。
 */

// Three.js as a static ES module import from the keepwork CDN. This makes the
// widget self-contained — the host HTML no longer needs a <script> tag or to
// pass a THREE instance in.
import * as THREE_DEFAULT from 'https://cdn.keepwork.com/npm/three@0.160.0/build/three.module.min.js';

// Same-version build URL of THREE, reused to patch the example modules' bare `three`
// specifier so they resolve to *our* instance (single THREE → instanceof stays valid).
const THREE_MODULE_URL = 'https://cdn.keepwork.com/npm/three@0.160.0/build/three.module.min.js';
const TRANSFORM_CONTROLS_URL = 'https://cdn.keepwork.com/npm/three@0.160.0/examples/jsm/controls/TransformControls.js';

// Lazy, self-contained loader for the official TransformControls gizmo. The jsm module
// imports from the bare specifier `'three'`, which won't resolve next to our full-URL
// import. We fetch the source, rewrite the specifier to the full CDN URL, and import it
// via a Blob URL — no host <script type="importmap"> needed, and it shares our THREE.
let _tcLoading = null;
function loadTransformControls(url = TRANSFORM_CONTROLS_URL) {
	if (!_tcLoading) {
		_tcLoading = (async () => {
			const res = await fetch(url);
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const code = (await res.text()).replace(/from\s*['"]three['"]/g, `from '${THREE_MODULE_URL}'`);
			const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
			try {
				const mod = await import(/* @vite-ignore */ blobUrl);
				return mod.TransformControls;
			} finally {
				URL.revokeObjectURL(blobUrl);
			}
		})().catch((e) => { _tcLoading = null; throw e; });   // allow a later retry
	}
	return _tcLoading;
}

/* ============================================================
 *  Source parsing helpers (pure, no THREE needed)
 * ============================================================ */

// 顶格 `const name = <rhs>;  // 注释`。rhs 既可以是单个数字字面量（如 `1.5`），
// 也可以是一个 material 调用（如 `mat(0x263fc8, 0.86, 0.01)`）。
const PARAM_LINE_RE = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*?)\s*;(?:\s*\/\/\s*(.*))?$/;
// 单一数字字面量（不含十六进制、不含科学计数）。
const SINGLE_NUM_RE = /^-?\d+(?:\.\d+)?$/;
// material 调用：mat( arg0 , arg1 , ... )。
const MAT_CALL_RE = /^(mat)\s*\(\s*([^)]*?)\s*\)$/;

function fmtNum(v) {
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}

// 16 进制颜色 → "#rrggbb"（给 <input type=color> 用）。
function hexToCss(num) {
	return '#' + (num >>> 0).toString(16).padStart(6, '0').slice(-6);
}
// "#rrggbb" / 数字 → 0xRRGGBB 字面量字符串。
function cssToHexLiteral(css) {
	const n = typeof css === 'number' ? css : parseInt(String(css).replace(/^#/, ''), 16);
	return '0x' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

// 把 material 调用的参数切成数组，并标注每个参数的类型：
//   { kind:'color', hex, raw } | { kind:'num', value, raw } | { kind:'const', raw }
// color：十六进制字面量 0x..（可用取色器编辑）。
// num：十进制数字（rough / metal 等，可拖动）。
// const：标识符 / 其它表达式（如 skinColor）→ 原样保留、不可编辑。
function parseMatArgs(argStr) {
	if (!argStr.trim()) return [];
	return argStr.split(',').map((part) => {
		const raw = part.trim();
		if (/^0x[0-9a-fA-F]+$/.test(raw)) return { kind: 'color', hex: parseInt(raw, 16), raw };
		if (SINGLE_NUM_RE.test(raw)) return { kind: 'num', value: parseFloat(raw), raw };
		return { kind: 'const', raw };
	});
}

// material 参数的位置标签（mat(color, rough, metal)）。
const MAT_ARG_LABELS = ['color', 'rough', 'metal'];

// 把源码顶部的 PARAMS 行解析为可调参数列表。
// kind:'number'   → 经典单数字行，key = 变量名。
// kind:'material' → 一个 mat(...) 调用作为「单个属性」，含一个取色器 + 若干数字子控件。
export function parseParams(source) {
	const lines = String(source || '').replace(/\n$/, '').split('\n');
	const params = Object.create(null);
	const order = [];
	lines.forEach((ln, i) => {
		const m = ln.match(PARAM_LINE_RE);
		if (!m) return;
		const varName = m[1];
		const rhs = m[2];
		const comment = (m[3] || '').trim();

		// ① material 调用：作为单个属性。
		const matM = rhs.match(MAT_CALL_RE);
		if (matM) {
			const args = parseMatArgs(matM[2]);
			// 至少要有一个可编辑字段（颜色或数字）才值得作为参数。
			const editable = args.some(a => a.kind === 'color' || a.kind === 'num');
			if (!editable) return;
			const fields = args.map((a, ai) => {
				const label = MAT_ARG_LABELS[ai] || ('arg' + (ai + 1));
				if (a.kind === 'color') return { kind: 'color', label, orig: a.hex, value: a.hex, saved: a.hex };
				if (a.kind === 'num') return { kind: 'num', label, orig: a.value, value: a.value, saved: a.value };
				return { kind: 'const', label, raw: a.raw };
			});
			params[varName] = { name: varName, varName, kind: 'material', line: i + 1, comment, fn: matM[1], fields };
			order.push(varName);
			return;
		}

		// ② 经典单数字行。
		if (SINGLE_NUM_RE.test(rhs)) {
			const num = parseFloat(rhs);
			params[varName] = { name: varName, varName, kind: 'number', line: i + 1, comment, orig: num, value: num, saved: num };
			order.push(varName);
		}
	});
	return { params, order, lines };
}

// 用当前参数值重建源码字符串：只重写 PARAM 行的 rhs，保留变量名、注释、
// material 里的常量 / 标识符参数（如 skinColor）原样不动。
export function buildSource(lines, params, order) {
	const out = lines.slice();
	for (const name of order) {
		const p = params[name];
		if (!p) continue;
		const ln = out[p.line - 1];
		const m = ln.match(PARAM_LINE_RE);
		if (!m) continue;
		const varName = m[1];
		const cm = m[3];
		let rhs;
		if (p.kind === 'material') {
			const argsTxt = p.fields.map((f) => {
				if (f.kind === 'color') return cssToHexLiteral(f.value);
				if (f.kind === 'num') return fmtNum(f.value);
				return f.raw;
			}).join(', ');
			rhs = p.fn + '(' + argsTxt + ')';
		} else {
			rhs = fmtNum(p.value);
		}
		out[p.line - 1] = 'const ' + varName + ' = ' + rhs + ';' + (cm !== undefined ? '  // ' + cm : '');
	}
	return out.join('\n');
}

// 顶格 `// word ...` 注释 = 一个对象段的开始（跳过文件头）。
export function buildSectionRanges(lines, opts = {}) {
	const headerMark = opts.headerMark || /\.three\.js/;
	const sectionLines = [];
	lines.forEach((ln, i) => {
		if (/^\/\/\s*[A-Za-z]/.test(ln)) {
			if (headerMark.test(ln)) return;
			sectionLines.push(i + 1);
		}
	});
	const ranges = [];
	for (let k = 0; k < sectionLines.length; k++) {
		const start = sectionLines[k];
		const end = (k + 1 < sectionLines.length ? sectionLines[k + 1] - 1 : lines.length);
		ranges.push([start, end]);
	}
	return ranges;
}

// 某行往上最近的对象注释 → 标签（注释里第一个英文单词）。
export function labelForLine(lines, line) {
	for (let n = line; n >= 1; n--) {
		const s = (lines[n - 1] || '').trim();
		const m = s.match(/^\/\/\s*([A-Za-z][A-Za-z0-9_]*)/);
		if (m) return m[1];
	}
	return 'object';
}

/* ============================================================
 *  Lightweight syntax highlighting for the code panel
 * ============================================================ */

export function escapeHtml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightLine(raw) {
	let h = escapeHtml(raw);
	h = h.replace(/(\/\/.*)$/, '<span class="tok-c">$1</span>');
	if (h.includes('tok-c')) return h;
	h = h.replace(/(&#39;[^&]*?&#39;|'[^']*'|`[^`]*`)/g, '<span class="tok-s">$1</span>');
	h = h.replace(/\b(const|let|var|for|of|in|new|return|function|if|else|continue|break|while)\b/g, '<span class="tok-k">$1</span>');
	h = h.replace(/\b(scene|add|box|boxAt|circle|cyl|sphere|cone|torus|plane|mat|quality|extrudeShape|hideFace|forEach|map|push|set|absarc|moveTo|lineTo)\b/g, '<span class="tok-f">$1</span>');
	h = h.replace(/\b(0x[0-9a-fA-F]+|\d+\.?\d*)\b/g, '<span class="tok-n">$1</span>');
	return h;
}

/* ============================================================
 *  Default geometry helpers exposed to user source code.
 *  调用方可通过 helpers 覆盖/扩展。
 * ============================================================ */

export function createDefaultHelpers(THREE, opts = {}) {
	const segHi = opts.lowPoly ? false : true;
	// Global poly-quality multiplier. opts.quality may be a number or a getter (so the
	// live editor can change it at runtime and have it picked up on the next rebuild).
	// seg() scales a base segment count by the current quality and clamps to a sane floor
	// so curved built-in shapes (sphere / cyl / cone / torus / circle / extrude) can be
	// made cheaper — fewer segments ⇒ fewer triangles — without editing the model source.
	const getQ = typeof opts.quality === 'function' ? opts.quality : () => (Number(opts.quality) || 1);
	const seg = (base, min = 3) => Math.max(min, Math.round(base * getQ()));
	const mat = (color, rough = 0.7, metal = 0.05) =>
		new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
	const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
	const boxAt = (size, pos, m) => {
		const b = box(size[0], size[1], size[2], m);
		b.position.set(pos[0], pos[1], pos[2]);
		return b;
	};
	const cyl = (rt, rb, h, m, open = false) =>
		new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg(segHi ? 40 : 18), 1, open), m);
	const cone = (r, h, m) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg(segHi ? 36 : 16)), m);
	const sphere = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, seg(segHi ? 28 : 16), seg(segHi ? 20 : 12, 2)), m);
	const circle = (r, m) => new THREE.Mesh(new THREE.CircleGeometry(r, seg(segHi ? 56 : 24)), m);
	const torus = (r, tube, m) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, seg(12), seg(segHi ? 40 : 18)), m);
	const plane = (w, h, m) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
	const extrudeShape = (shape, depth, m) => {
		const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: seg(segHi ? 30 : 14) });
		const mesh = new THREE.Mesh(g, m);
		mesh.rotation.x = Math.PI / 2;
		return mesh;
	};
	const hideFace = (material, faceIndex) => {
		const hidden = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false });
		return [0, 1, 2, 3, 4, 5].map(i => (i === faceIndex ? hidden : material));
	};
	return { mat, box, boxAt, cyl, cone, sphere, circle, torus, plane, extrudeShape, hideFace };
}

/* ============================================================
 *  Main editor controller
 * ============================================================ */

export function createThreeModelEditor(config) {
	const {
		THREE = THREE_DEFAULT,   // defaults to the statically-imported keepwork ESM build
		canvas,
		source = '',
		helpers: helperOverrides = {},
		lowPoly = false,
		background = 0x223052,
		onPick = null,            // (meta|null, { relatedParams }) => void
		onSourceChange = null,    // (currentSource) => void
		onStats = null,           // ({ triangles }) => void — fired after every (re)build
		polyQuality: initialPolyQuality = 1,   // global segment-count multiplier for built-in curved shapes
		onReady = null,
		transformControlsUrl = TRANSFORM_CONTROLS_URL,   // override the gizmo module URL (optional)
		onNotice = null,          // (msg) => void — transient user-facing hints (e.g. non-writable part)
		onGizmoReady = null,      // (ok:boolean) => void — fired once the transform gizmo loads (or fails)
	} = config;

	if (!THREE) throw new Error('createThreeModelEditor requires a THREE module');
	if (!canvas) throw new Error('createThreeModelEditor requires a canvas');

	const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

	// ---- source state ----
	let lines = [];
	let params = Object.create(null);
	let paramOrder = [];
	let sectionRanges = [];
	let buildFn = null;

	function loadSource(src) {
		const parsed = parseParams(src);
		lines = parsed.lines;
		params = parsed.params;
		paramOrder = parsed.order;
		sectionRanges = buildSectionRanges(lines);
	}
	loadSource(source);

	function currentSource() {
		return buildSource(lines, params, paramOrder);
	}

	// Persist the poly-quality into the source as a top-of-file `quality(<n>)` builtin call:
	// update the existing line in place, or insert one just below the header comment. When inserting
	// we shift PARAM/section line numbers in place (rather than re-parsing) so in-flight slider values
	// and the changed/saved baselines are preserved.
	const QUALITY_LINE_RE = /^\s*quality\s*\(/;
	function writeQualityLine(q) {
		const text = `quality(${fmtNum(q)});   // 精度（内置曲面分段倍率，越低面越少；随模型保存）`;
		const idx = lines.findIndex(ln => QUALITY_LINE_RE.test(ln));
		if (idx >= 0) { lines[idx] = text; return; }
		const insertAt = (lines[0] && /^\s*\/\//.test(lines[0])) ? 1 : 0;   // keep below the `// file.three.js` header
		lines.splice(insertAt, 0, text);
		for (const name of paramOrder) { const p = params[name]; if (p && p.line >= insertAt + 1) p.line += 1; }
		sectionRanges = buildSectionRanges(lines);
	}

	// ---- helpers passed to user source ----
	// polyQuality scales the segment counts of built-in curved shapes at build time. The model
	// source persists it per-model via a top-of-file `quality(<n>)` builtin call (see the `quality`
	// helper below + setPolyQuality), so each rebuild reads the current value through this getter.
	// Lowering it cuts triangle count for spheres / cylinders / cones / etc.
	const clampQuality = (q) => Math.max(0.1, Math.min(4, Number(q) || 1));
	// defaultQuality is what a model gets when its source has no `quality(...)` call. Each build
	// resets to it so the source's call is authoritative (and quality never leaks between snippets).
	const defaultQuality = clampQuality(initialPolyQuality);
	let polyQuality = defaultQuality;
	const helpers = {
		...createDefaultHelpers(THREE, { lowPoly, quality: () => polyQuality }),
		// builtin: quality(q) — set this model's poly-quality multiplier. Call it once near the top
		// of the source (before any shape). The 精度 slider writes/updates this line so it is saved
		// with the model. Returns the clamped value.
		quality: (q) => { polyQuality = clampQuality(q); return polyQuality; },
		...helperOverrides,
	};

	// ---- renderer / scene ----
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	// Color management — works across Three.js versions:
	//   r152+  : renderer.outputColorSpace = THREE.SRGBColorSpace (default already sRGB)
	//   r128–r151: renderer.outputEncoding = THREE.sRGBEncoding (NOT default → must set,
	//             otherwise lighting/colors render in linear space and look washed-out/dark).
	if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
		renderer.outputColorSpace = THREE.SRGBColorSpace;
	} else if (THREE.sRGBEncoding !== undefined) {
		renderer.outputEncoding = THREE.sRGBEncoding;
	}
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.4;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const vh = () => Math.max(320, canvas.clientHeight || 320);
	const setSize = () => renderer.setSize(canvas.clientWidth, vh(), false);
	setSize();

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(background);
	scene.fog = new THREE.Fog(background, 22, 60);

	const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / vh(), 0.1, 200);
	const cam = { yaw: -0.6, pitch: 0.7, dist: 13.5, target: new THREE.Vector3(0, -0.2, 0) };
	const DIST_MIN = 3, DIST_MAX = 60, PITCH_MIN = 0.05, PITCH_MAX = 1.5;
	function updateCamera() {
		const hh = Math.cos(cam.pitch) * cam.dist;
		camera.position.set(
			cam.target.x + Math.sin(cam.yaw) * hh,
			cam.target.y + Math.sin(cam.pitch) * cam.dist,
			cam.target.z + Math.cos(cam.yaw) * hh);
		camera.lookAt(cam.target);
	}

	// ---- lights (kept as named refs so the lighting panel can tweak them live) ----
	const hemi = new THREE.HemisphereLight(0xffffff, 0x53606e, 1.1);
	scene.add(hemi);
	const ambient = new THREE.AmbientLight(0xffffff, 0.35);
	scene.add(ambient);
	const key = new THREE.DirectionalLight(0xfff6df, 1.8);
	key.position.set(-4.8, 9.5, 5.8);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.near = 1;
	key.shadow.camera.far = 40;
	key.shadow.camera.left = -14;
	key.shadow.camera.right = 14;
	key.shadow.camera.top = 12;
	key.shadow.camera.bottom = -12;
	key.shadow.bias = -0.0004;
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xbfe0ff, 0.85);
	fill.position.set(5.5, 6, -5);
	scene.add(fill);

	// Snapshot the original lighting so the panel's "reset" can restore defaults.
	const LIGHT_DEFAULTS = {
		exposure: renderer.toneMappingExposure,
		hemi: { intensity: hemi.intensity },
		ambient: { intensity: ambient.intensity },
		key: { intensity: key.intensity, color: '#' + key.color.getHexString(), x: key.position.x, y: key.position.y, z: key.position.z },
		fill: { intensity: fill.intensity, color: '#' + fill.color.getHexString() },
	};
	// Flat, panel-friendly view of every adjustable light parameter.
	function getLights() {
		return {
			exposure: renderer.toneMappingExposure,
			hemiIntensity: hemi.intensity,
			ambientIntensity: ambient.intensity,
			keyIntensity: key.intensity,
			keyColor: '#' + key.color.getHexString(),
			keyX: key.position.x, keyY: key.position.y, keyZ: key.position.z,
			fillIntensity: fill.intensity,
			fillColor: '#' + fill.color.getHexString(),
		};
	}

	// ---- lighting persistence (localStorage, shared across snippets/sessions) ----
	const LIGHT_STORAGE_KEY = 'ThreeJsModelGenerator.lighting.v1';
	function saveLightsToStorage() {
		try { localStorage.setItem(LIGHT_STORAGE_KEY, JSON.stringify(getLights())); } catch (_) {}
	}
	function applyLights(values) {
		if (!values || typeof values !== 'object') return;
		for (const name of Object.keys(values)) setLightRaw(name, values[name]);
	}
	function loadLightsFromStorage() {
		try {
			const raw = localStorage.getItem(LIGHT_STORAGE_KEY);
			if (raw) applyLights(JSON.parse(raw));
		} catch (_) {}
	}

	// setLightRaw applies a value without persisting (used during bulk load); setLight
	// applies + persists (used by the panel's interactive controls).
	function setLightRaw(name, value) {
		switch (name) {
			case 'exposure': renderer.toneMappingExposure = Number(value); break;
			case 'hemiIntensity': hemi.intensity = Number(value); break;
			case 'ambientIntensity': ambient.intensity = Number(value); break;
			case 'keyIntensity': key.intensity = Number(value); break;
			case 'keyColor': key.color.set(value); break;
			case 'keyX': key.position.x = Number(value); break;
			case 'keyY': key.position.y = Number(value); break;
			case 'keyZ': key.position.z = Number(value); break;
			case 'fillIntensity': fill.intensity = Number(value); break;
			case 'fillColor': fill.color.set(value); break;
		}
	}
	function setLight(name, value) {
		setLightRaw(name, value);
		saveLightsToStorage();
	}
	function resetLights() {
		renderer.toneMappingExposure = LIGHT_DEFAULTS.exposure;
		hemi.intensity = LIGHT_DEFAULTS.hemi.intensity;
		ambient.intensity = LIGHT_DEFAULTS.ambient.intensity;
		key.intensity = LIGHT_DEFAULTS.key.intensity;
		key.color.set(LIGHT_DEFAULTS.key.color);
		key.position.set(LIGHT_DEFAULTS.key.x, LIGHT_DEFAULTS.key.y, LIGHT_DEFAULTS.key.z);
		fill.intensity = LIGHT_DEFAULTS.fill.intensity;
		fill.color.set(LIGHT_DEFAULTS.fill.color);
		try { localStorage.removeItem(LIGHT_STORAGE_KEY); } catch (_) {}
	}

	// Restore any previously-saved lighting now that all light refs + helpers exist.
	loadLightsFromStorage();

	// ground (not pickable)
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(80, 60),
		new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.95 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = 0;   // the ground plane (1 unit = 1 m). Models stand with base at y=0, so shadows land here.
	floor.receiveShadow = true;
	scene.add(floor);

	// Measurement grid on the ground plane (1 unit = 1 meter). The cell size auto-switches between
	// 1 m and 1 cm depending on the model's footprint, so the grid stays useful for both a building
	// and a small prop. Rebuilt by updateGroundGrid() after each build (see runBuild).
	let groundGrid = null;
	// Two colored center lines overlaid on the grid so the X (red) and Z (blue) axes read at a glance.
	let groundAxes = null;
	const AXIS_X_COLOR = 0xff6b6b, AXIS_Z_COLOR = 0x4d9fff;
	let gridInfo = { unit: 'm', cell: 1, size: 0, divisions: 0 };

	// ============================================================
	//  Color-injection picking infrastructure
	// ============================================================
	const group = new THREE.Group();
	scene.add(group);
	const pickGroup = new THREE.Group();
	const pickScene = new THREE.Scene();
	pickScene.add(pickGroup);
	pickScene.background = new THREE.Color(0x000000); // id 0 = nothing

	let nextId = 0;
	const idToMeta = new Map();
	const pickEntries = []; // { id, pickMat, exact }
	// Green wireframe overlays for the currently selected shape (declared early because
	// disposeGroup → clearHighlightOverlay can run during initial measureAffected()).
	let highlightWires = [];

	// Transform-gizmo state. Declared here (not next to the gizmo functions further down)
	// because measureAffected()/rebuild() run during construction and call refreshGizmoTarget(),
	// which reads `gizmo` — a `let` further down would still be in its temporal dead zone.
	let gizmo = null;             // THREE TransformControls (lazy-loaded)
	let gizmoLoadStarted = false;
	let transformMode = 'camera'; // 'camera' | 'translate' | 'scale' | 'rotate'
	let draggingGizmo = false;
	let pivot = null;             // temp parent for multi-select transforms
	// Per-category snap increments (null = that category snaps freely / off).
	//   snapTranslate: null | number (world units, 1 unit = 1 m). Default 0.1 = 10 cm.
	//   snapRotateDeg: null | degrees
	//   snapScaleStep: null | step
	let snapTranslate = 0.1;
	let snapRotateDeg = 15;
	let snapScaleStep = 0.1;

	// ---- render options (wireframe / shadow / ground / grid) ----
	// wireframe must be re-applied after every rebuild (materials are recreated); shadow/ground/grid
	// are renderer/scene-level and persist across rebuilds.
	const renderOpts = { wireframe: false, shadow: true, ground: true, grid: true };
	function applyRenderOptions() {
		group.traverse(o => {
			if (!o.isMesh) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) if (m && 'wireframe' in m) m.wireframe = renderOpts.wireframe;
		});
	}
	function setWireframe(on) { renderOpts.wireframe = !!on; applyRenderOptions(); }
	function setShadow(on) {
		renderOpts.shadow = !!on;
		renderer.shadowMap.enabled = renderOpts.shadow;
		key.castShadow = renderOpts.shadow;
		// toggling shadowMap.enabled after materials have compiled requires a shader recompile
		scene.traverse(o => {
			if (!o.isMesh) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) if (m) m.needsUpdate = true;
		});
	}
	function setGround(on) { renderOpts.ground = !!on; floor.visible = renderOpts.ground; }
	function setGrid(on) { renderOpts.grid = !!on; if (groundGrid) groundGrid.visible = renderOpts.grid; if (groundAxes) groundAxes.visible = renderOpts.grid; }
	function getRenderOptions() { return { ...renderOpts }; }
	function getGridInfo() { return { ...gridInfo }; }

	// Intrinsic (un-rotated) bounding box of the model. The group auto-rotates, so we momentarily
	// neutralize its transform to measure the object's own size rather than its spinning AABB.
	const _gridBox = new THREE.Box3(), _gridSize = new THREE.Vector3(), _gridCenter = new THREE.Vector3();
	function modelBounds() {
		if (!group.children.length) return null;
		const rot = group.rotation.clone(), pos = group.position.clone();
		group.rotation.set(0, 0, 0); group.position.set(0, 0, 0); group.updateMatrixWorld(true);
		_gridBox.setFromObject(group);
		group.rotation.copy(rot); group.position.copy(pos); group.updateMatrixWorld(true);
		if (_gridBox.isEmpty()) return null;
		_gridBox.getSize(_gridSize); _gridBox.getCenter(_gridCenter);
		return { size: _gridSize.clone(), center: _gridCenter.clone(), minY: _gridBox.min.y };
	}
	// Two center lines through the grid origin, colored per axis (X red, Z blue) so model orientation
	// reads instantly. Local coords centered at 0 — positioned with the grid in updateGroundGrid().
	function buildGroundAxes(size) {
		const h = size / 2;
		const positions = new Float32Array([-h, 0, 0, h, 0, 0, /* X */ 0, 0, -h, 0, 0, h /* Z */]);
		const cx = new THREE.Color(AXIS_X_COLOR), cz = new THREE.Color(AXIS_Z_COLOR);
		const colors = new Float32Array([cx.r, cx.g, cx.b, cx.r, cx.g, cx.b, cz.r, cz.g, cz.b, cz.r, cz.g, cz.b]);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
		return new THREE.LineSegments(geo, mat);
	}
	// Rebuild the ground grid sized to the model. cell = 1 m normally, 1 cm for small (<0.5 m) props.
	function updateGroundGrid() {
		const b = modelBounds();
		const footprint = b ? Math.max(b.size.x, b.size.z) : 1;
		const useCm = footprint < 0.5;                 // sub-half-meter objects read better in cm
		const cell = useCm ? 0.01 : 1;                 // world units per cell (1 unit = 1 meter)
		let divisions = Math.round((footprint / cell) * 2) || 1;
		divisions = Math.min(80, Math.max(8, divisions));   // keep line count sane while covering the model
		const size = +(divisions * cell).toFixed(6);
		if (!groundGrid || gridInfo.cell !== cell || gridInfo.divisions !== divisions) {
			if (groundGrid) { scene.remove(groundGrid); groundGrid.geometry.dispose(); groundGrid.material.dispose(); }
			// uniform light lines (lighter than the floor 0x2b3550 so they read clearly); the X/Z center
			// lines are drawn separately by groundAxes below in distinct colors.
			groundGrid = new THREE.GridHelper(size, divisions, 0x6a7da6, 0x6a7da6);
			groundGrid.material.transparent = true;
			groundGrid.material.opacity = 0.7;
			groundGrid.visible = renderOpts.grid;
			scene.add(groundGrid);
			// rebuild the colored axis overlay to match the new grid extent
			if (groundAxes) { scene.remove(groundAxes); groundAxes.geometry.dispose(); groundAxes.material.dispose(); }
			groundAxes = buildGroundAxes(size);
			groundAxes.visible = renderOpts.grid;
			scene.add(groundAxes);
		}
		// sit the grid on the y=0 ground (where the floor + model base are), centered on the footprint.
		// a hair above 0 so the grid lines don't z-fight with the coplanar floor plane.
		groundGrid.position.set(b ? b.center.x : 0, 0.002, b ? b.center.z : 0);
		// axes sit a touch higher still so they draw cleanly over the grid lines they cross.
		groundAxes.position.set(b ? b.center.x : 0, 0.003, b ? b.center.z : 0);
		gridInfo = { unit: useCm ? 'cm' : 'm', cell, size, divisions };
	}
	const labelSeq = Object.create(null);

	function idToColor(id) {
		return new THREE.Color(((id >> 16) & 255) / 255, ((id >> 8) & 255) / 255, (id & 255) / 255);
	}
	function colorToId(r, g, b) { return (r << 16) | (g << 8) | b; }
	function vizColor(id) {
		const c = new THREE.Color();
		c.setHSL((id * 0.61803398875) % 1, 0.85, 0.55);
		return c;
	}

	function registerMesh(mesh, line) {
		if (!mesh || !mesh.isMesh) return;
		const label = labelForLine(lines, line);
		const id = ++nextId;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const pickMat = new THREE.MeshBasicMaterial({ color: vizColor(id) });
		const pm = new THREE.Mesh(mesh.geometry, pickMat);
		pm.position.copy(mesh.position);
		pm.quaternion.copy(mesh.quaternion);
		pm.scale.copy(mesh.scale);
		pickGroup.add(pm);
		// keep `src` so syncPick() can re-copy the live transform every pick — the override
		// footer (and any other post-add transform) moves the mesh *after* registration.
		pickEntries.push({ id, pickMat, exact: idToColor(id), pm, src: mesh });
		const mats = [];
		const mm = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (mm && mm.emissive) mats.push({ mat: mm });
		const seq = (labelSeq[label] = (labelSeq[label] || 0) + 1);
		idToMeta.set(id, { id, label: label + '_' + seq, baseLabel: label, line, mats, meshes: [mesh] });
	}

	function installPickHook(target) {
		const origAdd = target.add.bind(target);
		target.add = function (...objs) {
			const line = srcLineFromStack();
			const r = origAdd(...objs);
			for (const o of objs) if (o && o.isMesh) registerMesh(o, line);
			return r;
		};
		return () => { target.add = origAdd; };
	}

	let stackOffset = null;
	function srcLineFromStack() {
		const st = (new Error()).stack || '';
		const m = st.match(/threeModelSource\.js:(\d+):\d+/);
		if (!m) return null;
		const raw = parseInt(m[1], 10);
		if (stackOffset == null) {
			let firstAddLine = null;
			for (let i = 0; i < lines.length; i++) {
				if (/scene\.add\s*\(/.test(lines[i])) { firstAddLine = i + 1; break; }
			}
			if (firstAddLine != null) stackOffset = raw - firstAddLine;
		}
		return stackOffset != null ? raw - stackOffset : raw;
	}

	// ---- compile + run user source ----
	let buildError = null;
	function compile() {
		buildError = null;
		const argNames = ['THREE', 'IS_MOBILE', 'scene', ...Object.keys(helpers)];
		const argHelpers = Object.values(helpers);
		try {
			buildFn = new Function(...argNames, currentSource() + '\n//# sourceURL=threeModelSource.js');
			buildFn._args = argHelpers;
		} catch (e) {
			buildError = e;
			buildFn = null;
		}
	}

	function runBuild() {
		if (!buildFn) return;
		stackOffset = null;
		// Reset the group transform so the source's own `scene.position/rotation/scale` calls
		// (written back by the whole-model gizmo) are authoritative — otherwise a removed
		// `// layout` block would leave a stale group transform from the previous run.
		group.position.set(0, 0, 0);
		group.rotation.set(0, 0, 0);
		group.scale.set(1, 1, 1);
		polyQuality = defaultQuality;   // source's `quality(...)` call (if any) overrides this during the run
		for (const k in labelSeq) delete labelSeq[k];
		const uninstall = installPickHook(group);
		try {
			buildFn(THREE, IS_MOBILE, group, ...buildFn._args);
		} catch (e) {
			buildError = e;
		} finally {
			uninstall();
		}
		applyRenderOptions();   // re-apply wireframe to the freshly built materials
		updateGroundGrid();     // resize the measurement grid (auto m / cm) to the new model
		emitStats();
	}

	// ---- triangle count of the live model (the visible `group`, excluding ground/lights) ----
	function countTriangles() {
		let tris = 0;
		group.traverse(o => {
			if (!o.isMesh || !o.geometry) return;
			const g = o.geometry;
			if (g.index) tris += g.index.count / 3;
			else if (g.attributes && g.attributes.position) tris += g.attributes.position.count / 3;
		});
		return Math.round(tris);
	}
	function emitStats() { if (onStats) { try { onStats({ triangles: countTriangles(), grid: getGridInfo() }); } catch (_) {} } }

	function disposeGroup() {
		clearHighlightOverlay();   // drop green wireframe overlays before tearing down their host meshes
		while (group.children.length) {
			const c = group.children.pop();
			c.geometry && c.geometry.dispose();
		}
		while (pickGroup.children.length) {
			const c = pickGroup.children.pop();
			c.material && c.material.dispose();
		}
		idToMeta.clear();
		pickEntries.length = 0;
		nextId = 0;
	}

	function rebuild() {
		disposeGroup();
		compile();
		runBuild();
		refreshGizmoTarget();   // re-anchor the gizmo to the freshly rebuilt meshes (no-op until loaded)
	}

	compile();
	runBuild();
	if (buildError && onReady) {/* surfaced via getError */ }

	// ============================================================
	//  Picking read (1x1 pixel from hidden id buffer)
	// ============================================================
	const pickTarget = new THREE.WebGLRenderTarget(1, 1);
	const pixel = new Uint8Array(4);
	function syncPick() {
		pickGroup.rotation.copy(group.rotation);
		pickGroup.position.copy(group.position);
		pickGroup.scale.copy(group.scale);
		// mirror each part's live transform so the id buffer matches what's on screen even after
		// the override footer / gizmo moved a mesh post-registration.
		for (const e of pickEntries) {
			if (!e.src) continue;
			e.pm.position.copy(e.src.position);
			e.pm.quaternion.copy(e.src.quaternion);
			e.pm.scale.copy(e.src.scale);
		}
	}

	function pickAt(clientX, clientY) {
		const rect = canvas.getBoundingClientRect();
		const ratio = renderer.getPixelRatio();
		const px = (clientX - rect.left) * ratio;
		const py = (clientY - rect.top) * ratio;
		const w = canvas.clientWidth * ratio;
		const h = vh() * ratio;
		syncPick();
		for (const e of pickEntries) e.pickMat.color.copy(e.exact);
		const prevTone = renderer.toneMapping;
		renderer.toneMapping = THREE.NoToneMapping;
		camera.setViewOffset(w, h, px, py, 1, 1);
		camera.updateProjectionMatrix();
		renderer.setRenderTarget(pickTarget);
		renderer.render(pickScene, camera);
		renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pixel);
		camera.clearViewOffset();
		camera.updateProjectionMatrix();
		renderer.setRenderTarget(null);
		renderer.toneMapping = prevTone;
		for (const e of pickEntries) e.pickMat.color.copy(vizColor(e.id));
		const id = colorToId(pixel[0], pixel[1], pixel[2]);
		return idToMeta.get(id) || null;
	}

	// ---- block range + related params for a picked object ----
	function sectionForLine(line) {
		for (const [a, b] of sectionRanges) if (line >= a && line <= b) return [a, b];
		return null;
	}
	function blockRange(meta) {
		if (!meta || !meta.line) return null;
		return sectionForLine(meta.line);
	}
	function objectText(meta) {
		const r = blockRange(meta);
		if (!r) return '';
		return lines.slice(r[0] - 1, r[1]).join('\n');
	}
	function relatedParams(meta) {
		const text = objectText(meta);
		const set = new Set();
		if (!text) return set;
		for (const name of paramOrder) {
			// multi-slot 参数的 key 形如 `varName·N`，要用底层变量名去匹配源码引用。
			const varName = (params[name] && params[name].varName) || name;
			if (new RegExp('\\b' + varName + '\\b').test(text)) set.add(name);
		}
		return set;
	}

	// ---- ground-truth affected-object count per param ----
	const affected = Object.create(null);
	function sigOf(meta) {
		let s = '';
		for (const mesh of (meta.meshes || [])) {
			if (!mesh.geometry) { s += '|'; continue; }
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			const bb = mesh.geometry.boundingBox;
			s += [mesh.position.x, mesh.position.y, mesh.position.z,
				bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]
				.map(v => (+v).toFixed(3)).join(',') + '|';
		}
		return s;
	}
	function snapshotByLabel() {
		const map = Object.create(null);
		for (const m of idToMeta.values()) (map[m.label] || (map[m.label] = [])).push(sigOf(m));
		return map;
	}
	// material 改的是外观（颜色 / 粗糙 / 金属），不改几何，因此 geometry 签名探测不到。
	// 用「源码里有多少个对象段引用了该变量」来估算受影响对象数。
	function countRefByVar(varName) {
		const re = new RegExp('\\b' + varName + '\\b');
		const labels = new Set();
		for (const m of idToMeta.values()) {
			const text = objectText(m);
			if (text && re.test(text)) labels.add(m.label);
		}
		return labels.size;
	}
	function measureAffected() {
		if (buildError) return;
		const base = snapshotByLabel();
		for (const name of paramOrder) {
			const p = params[name];
			if (p.kind === 'material') {
				affected[name] = countRefByVar(p.varName);
				continue;
			}
			const keep = p.value;
			p.value = keep + Math.max(Math.abs(keep) * 0.25, 0.15);
			rebuild();
			const now = snapshotByLabel();
			let n = 0;
			for (const label in base) {
				const a = base[label].join(';');
				const b = (now[label] || []).join(';');
				if (a !== b) n++;
			}
			affected[name] = n;
			p.value = keep;
		}
		rebuild();
	}
	measureAffected();

	// ============================================================
	//  Selection + highlight (green wireframe overlay on the picked shape)
	// ============================================================
	// Selection is a set of object labels (single-select replaces it; Shift-click toggles
	// membership for multi-part transforms). firstSelected() keeps the legacy single-label
	// behaviour for code-highlight / related-params lookups.
	const selectedLabels = new Set();
	const firstSelected = () => { for (const l of selectedLabels) return l; return null; };
	// We outline only the picked geometry — NOT the material — because a material
	// (e.g. a shared mat(...)) can be reused by many meshes; tinting it would light up
	// every shape that uses it. highlightWires is declared near the group state above.
	function clearHighlightOverlay() {
		for (const w of highlightWires) {
			w.parent && w.parent.remove(w);
			w.geometry && w.geometry.dispose();
			w.material && w.material.dispose();
		}
		highlightWires = [];
	}
	function highlightSelectedMesh() {
		clearHighlightOverlay();
		if (!selectedLabels.size) return;
		for (const m of idToMeta.values()) {
			if (!selectedLabels.has(m.label)) continue;
			for (const mesh of (m.meshes || [])) {
				if (!mesh.geometry) continue;
				// Build the wireframe in the mesh's own geometry space and parent it to the
				// mesh, so it inherits the exact position/rotation/scale and rotates with the group.
				const wire = new THREE.LineSegments(
					new THREE.WireframeGeometry(mesh.geometry),
					new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, depthTest: false })
				);
				wire.renderOrder = 999;   // draw on top so the outline is always visible
				mesh.add(wire);
				highlightWires.push(wire);
			}
		}
	}
	function metaByLabel(label) {
		for (const m of idToMeta.values()) if (m.label === label) return m;
		return null;
	}
	function instanceInfo(meta) {
		if (!meta) return null;
		let total = 0, idx = 0;
		for (const m of idToMeta.values()) {
			if (m.baseLabel === meta.baseLabel) { total++; if (m.id <= meta.id) idx++; }
		}
		return { base: meta.baseLabel, idx, total };
	}
	function displayLabel(meta) {
		const info = instanceInfo(meta);
		if (!info) return meta ? meta.label : '';
		return info.total > 1 ? info.base + ' #' + info.idx + '/' + info.total : info.base;
	}

	function selectMeta(meta, opts = {}) {
		const additive = !!opts.additive;
		if (!meta) {
			if (!additive) selectedLabels.clear();
		} else if (additive) {
			if (selectedLabels.has(meta.label)) selectedLabels.delete(meta.label);
			else selectedLabels.add(meta.label);
		} else {
			selectedLabels.clear();
			selectedLabels.add(meta.label);
		}
		highlightSelectedMesh();
		refreshGizmoTarget();
		if (onPick) {
			// Report the just-clicked object (or the surviving selection) so the host can
			// localize code + grab related params. On a multi-select toggle that removed the
			// clicked part, fall back to whatever remains selected.
			const reportLabel = (meta && selectedLabels.has(meta.label)) ? meta.label : firstSelected();
			const report = reportLabel ? metaByLabel(reportLabel) : null;
			onPick(report, {
				relatedParams: report ? [...relatedParams(report)] : [],
				range: blockRange(report),
				displayLabel: report ? displayLabel(report) : '',
			});
		}
	}

	// ============================================================
	//  Transform gizmo (camera / move / scale / rotate)  — writes back into source
	//  (state declared earlier, before measureAffected/rebuild can run)
	// ============================================================
	function metaByMesh(mesh) {
		for (const m of idToMeta.values()) if ((m.meshes || []).includes(mesh)) return m;
		return null;
	}
	function selectedMeshes() {
		const out = [];
		for (const m of idToMeta.values()) {
			if (!selectedLabels.has(m.label)) continue;
			for (const mesh of (m.meshes || [])) out.push(mesh);
		}
		return out;
	}
	// A mesh's transform expressed in the build group's local space, regardless of its current
	// parent (it may be temporarily under the multi-select pivot). Used to measure the gizmo
	// delta in the same space the source writes (group-local), so we can append an offset that
	// preserves the original parametric `.set(...)` line instead of overwriting it.
	const _glM = new THREE.Matrix4();
	function groupLocalTransform(mesh) {
		group.updateMatrixWorld(true);
		mesh.updateMatrixWorld(true);
		_glM.copy(group.matrixWorld).invert().multiply(mesh.matrixWorld);
		const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
		_glM.decompose(pos, quat, scale);
		return { pos, quat, scale };
	}
	const dragStarts = new Map();   // mesh → group-local transform snapshot at drag start
	function captureDragStart() {
		dragStarts.clear();
		for (const mesh of selectedMeshes()) dragStarts.set(mesh, groupLocalTransform(mesh));
	}
	function applySnap() {
		if (!gizmo) return;
		gizmo.setTranslationSnap(snapTranslate == null ? null : snapTranslate);
		gizmo.setRotationSnap(snapRotateDeg == null ? null : THREE.MathUtils.degToRad(snapRotateDeg));
		gizmo.setScaleSnap(snapScaleStep == null ? null : snapScaleStep);
	}
	function dropPivot() {
		if (!pivot) return;
		for (const child of [...pivot.children]) group.attach(child);   // restore world transform into group space
		group.remove(pivot);
		pivot = null;
	}
	// Resolve what the gizmo should act on: nothing → whole model (group); one part → that
	// mesh; many parts → a temp pivot at their centroid (so they move/scale/rotate together).
	function refreshGizmoTarget() {
		if (!gizmo) return;
		dropPivot();
		if (transformMode === 'camera') {
			gizmo.detach();
			gizmo.visible = false;
			gizmo.enabled = false;
			return;
		}
		gizmo.enabled = true;
		gizmo.visible = true;
		gizmo.setMode(transformMode);
		applySnap();
		autoRotate = false;
		const meshes = selectedMeshes();
		if (meshes.length === 0) {
			gizmo.attach(group);                  // 什么都不选 → 调整所有模型
		} else if (meshes.length === 1) {
			gizmo.attach(meshes[0]);
		} else {
			group.updateMatrixWorld(true);
			const box = new THREE.Box3();
			for (const mesh of meshes) box.expandByObject(mesh);
			const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
			pivot = new THREE.Group();
			group.add(pivot);
			group.updateMatrixWorld(true);
			pivot.position.copy(group.worldToLocal(center.clone()));
			group.updateMatrixWorld(true);
			for (const mesh of meshes) pivot.attach(mesh);
			gizmo.attach(pivot);
		}
	}

	// ---- writeback helpers (edit the raw `lines[]`; buildSource preserves them verbatim) ----
	const _wbEuler = new THREE.Euler();
	function fmtVec3(v) { return `${fmtNum(v.x)}, ${fmtNum(v.y)}, ${fmtNum(v.z)}`; }
	function isIdentity(obj) {
		const p = obj.position, s = obj.scale;
		_wbEuler.setFromQuaternion(obj.quaternion, 'XYZ');
		return Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) < 1e-6
			&& Math.abs(_wbEuler.x) + Math.abs(_wbEuler.y) + Math.abs(_wbEuler.z) < 1e-6
			&& Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) < 1e-6;
	}
	// Build `<prefix>.position/.rotation/.scale.set(...)` lines, omitting identity components.
	function transformLines(obj, prefix, indent = '') {
		const out = [];
		const p = obj.position, s = obj.scale;
		_wbEuler.setFromQuaternion(obj.quaternion, 'XYZ');
		out.push(`${indent}${prefix}.position.set(${fmtVec3(p)});`);
		if (Math.abs(_wbEuler.x) + Math.abs(_wbEuler.y) + Math.abs(_wbEuler.z) > 1e-6)
			out.push(`${indent}${prefix}.rotation.set(${fmtNum(_wbEuler.x)}, ${fmtNum(_wbEuler.y)}, ${fmtNum(_wbEuler.z)});`);
		if (Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) > 1e-6)
			out.push(`${indent}${prefix}.scale.set(${fmtVec3(s)});`);
		return out;
	}
	function notice(msg) { if (onNotice) { try { onNotice(msg); } catch (_) {} } }

	// Remove the deprecated `// overrides` IIFE footer that earlier versions appended. We now
	// always write transforms into the object's own code, so on the next gizmo edit we strip any
	// leftover footer (otherwise it would keep re-applying a stale transform after the build).
	function stripOverrideFooter() {
		for (let i = lines.length - 1; i >= 0; i--) {
			if (!/scene\.traverse\(\s*o\s*=>\s*o\.isMesh\s*&&\s*M\.push/.test(lines[i])) continue;
			let start = i;
			if (start > 0 && /^\/\/\s*overrides\b/.test(lines[start - 1])) start--;
			if (start > 0 && lines[start - 1].trim() === '') start--;   // also drop a leading blank
			lines.splice(start, i - start + 1);
		}
	}

	// Whole-model transform → a `// layout` footer block that sets it on `scene` (=== group
	// inside the source). Replaces an existing block; removed entirely when back at identity.
	function writeGroupTransform(g) {
		const ranges = buildSectionRanges(lines);
		let found = null;
		for (const [a, b] of ranges) if (/^\/\/\s*layout\b/.test(lines[a - 1])) { found = [a, b]; break; }
		if (isIdentity(g)) {
			if (found) lines.splice(found[0] - 1, found[1] - found[0] + 1);
			return;
		}
		const block = ['// layout 整体布局（gizmo 编辑）', ...transformLines(g, 'scene')];
		if (found) lines.splice(found[0] - 1, found[1] - found[0] + 1, ...block);
		else {
			if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
			lines.push(...block);
		}
	}

	const NZ = 1e-5;
	// Parse a `<var>.<kind>.<axis> <op>= n; …  // gizmo` offset line → { x, y, z } (missing axes
	// default to identity: 0 for +=, 1 for *=), or null if the line isn't this var/kind/op.
	function parseOffsetLine(line, varName, kind, op) {
		const e = op === '*=' ? '\\*=' : '\\+=';
		const v = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!new RegExp(`(?:^|;|\\s)${v}\\.${kind}\\.[xyz]\\s*${e}`).test(line)) return null;
		const ident = op === '*=' ? 1 : 0;
		const out = { x: ident, y: ident, z: ident };
		for (const ax of ['x', 'y', 'z']) {
			const m = line.match(new RegExp(`${v}\\.${kind}\\.${ax}\\s*${e}\\s*(-?[0-9.]+)`));
			if (m) out[ax] = parseFloat(m[1]);
		}
		return out;
	}
	// Build the `// gizmo` offset lines for the accumulated deltas — only the components that
	// actually moved (identity axes are omitted, so no `+= 0` / `*= 1` noise).
	function offsetLines(varName, dPos, dRot, fScale, indent) {
		const out = [];
		const emit = (kind, v, ident, op) => {
			const parts = [];
			for (const ax of ['x', 'y', 'z']) if (Math.abs(v[ax] - ident) > NZ) parts.push(`${varName}.${kind}.${ax} ${op} ${fmtNum(v[ax])};`);
			if (parts.length) out.push(`${indent}${parts.join(' ')}   // gizmo`);
		};
		emit('position', dPos, 0, '+=');
		emit('rotation', dRot, 0, '+=');
		emit('scale', fScale, 1, '*=');
		return out;
	}
	// Apply one mesh's drag delta to a section's line array (in place, returning the new array),
	// PRESERVING the original parametric `.set(...)` line and only appending/updating this var's
	// `// gizmo` offset line. `addRel` is the index of this mesh's `scene.add(<var>)` within `sec`.
	// Operates on the passed array so several meshes in the same section can be folded one by one.
	function offsetEditOnSection(sec, addRel, mesh, start, end) {
		if (addRel < 0 || addRel >= sec.length) return null;
		const m = sec[addRel].match(/scene\s*\.\s*add\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
		if (!m) return null;                          // inline add → no variable to offset
		const varName = m[1];
		const indent = (sec[addRel].match(/^\s*/) || [''])[0];

		// this gesture's delta, group-local: position additive, rotation additive (euler), scale multiplicative
		const dPos = { x: end.pos.x - start.pos.x, y: end.pos.y - start.pos.y, z: end.pos.z - start.pos.z };
		const se = new THREE.Euler().setFromQuaternion(end.quat, 'XYZ');
		const ss = new THREE.Euler().setFromQuaternion(start.quat, 'XYZ');
		const dRot = { x: se.x - ss.x, y: se.y - ss.y, z: se.z - ss.z };
		const fScale = {
			x: start.scale.x ? end.scale.x / start.scale.x : 1,
			y: start.scale.y ? end.scale.y / start.scale.y : 1,
			z: start.scale.z ? end.scale.z / start.scale.z : 1,
		};

		// keep everything except THIS var's existing `// gizmo` offset lines, accumulating their
		// values; reinsert the merged offset lines right before scene.add(var).
		let pPos = { x: 0, y: 0, z: 0 }, pRot = { x: 0, y: 0, z: 0 }, pScale = { x: 1, y: 1, z: 1 };
		const kept = [];
		let addIdx = -1;
		for (let i = 0; i < sec.length; i++) {
			if (/\/\/\s*gizmo\s*$/.test(sec[i])) {
				const pp = parseOffsetLine(sec[i], varName, 'position', '+=');
				const pr = parseOffsetLine(sec[i], varName, 'rotation', '+=');
				const psc = parseOffsetLine(sec[i], varName, 'scale', '*=');
				if (pp) { pPos = pp; continue; }
				if (pr) { pRot = pr; continue; }
				if (psc) { pScale = psc; continue; }
			}
			if (i === addRel) addIdx = kept.length;
			kept.push(sec[i]);
		}
		if (addIdx < 0) return null;
		const nPos = { x: pPos.x + dPos.x, y: pPos.y + dPos.y, z: pPos.z + dPos.z };
		const nRot = { x: pRot.x + dRot.x, y: pRot.y + dRot.y, z: pRot.z + dRot.z };
		const nScale = { x: pScale.x * fScale.x, y: pScale.y * fScale.y, z: pScale.z * fScale.z };
		kept.splice(addIdx, 0, ...offsetLines(varName, nPos, nRot, nScale, indent));
		return kept;
	}
	function applyEdits(edits) {
		// bottom-up so earlier splices don't shift later (start, removeCount) ranges
		edits.sort((x, y) => y.start - x.start);
		for (const e of edits) lines.splice(e.start - 1, e.removeCount, ...e.newSec);
	}
	function findBlockRange(re) {
		const ranges = buildSectionRanges(lines);
		for (const [a, b] of ranges) if (re.test(lines[a - 1])) return [a, b];
		return null;
	}
	const rangeLines = ([a, b]) => { const out = []; for (let n = a; n <= b; n++) out.push(n); return out; };
	// Char spans of the numeric literals we wrote on a changed line (the `// gizmo` offset line,
	// or the whole-model `scene.position.set(...)`), so the host can paint just those green. Skips
	// numbers glued to identifiers and anything inside the trailing line comment.
	function numberSpans(text) {
		const codeEnd = (() => { const c = text.indexOf('//'); return c === -1 ? text.length : c; })();
		const spans = []; const re = /-?\d+(?:\.\d+)?/g; let m;
		while ((m = re.exec(text))) {
			if (m.index >= codeEnd) break;
			const before = text[m.index - 1] || '', after = text[m.index + m[0].length] || '';
			if (/[A-Za-z_$.]/.test(before) || /[A-Za-z_$]/.test(after)) continue;   // part of an identifier/member
			spans.push([m.index, m.index + m[0].length]);
		}
		return spans;
	}
	// Build the highlight payload for a set of 1-based line numbers: each gets a green line
	// background; clean .set() lines also get green spans on their numbers.
	function changesForLines(lineNums) {
		return lineNums.map((ln) => ({ line: ln, ranges: numberSpans(lines[ln - 1] || '') }));
	}
	function finalizeWriteback(changes) {
		sectionRanges = buildSectionRanges(lines);
		rebuild();
		highlightSelectedMesh();
		refreshGizmoTarget();
		const list = changes && changes.length ? changes : null;
		// A gizmo commit is a discrete edit → ask the host to record one undo entry (unlike
		// slider drags, which pass no flag) and green-highlight + scroll to the value(s) we wrote.
		if (onSourceChange) onSourceChange(currentSource(), { history: true, changes: list, scrollLine: list ? list[0].line : null });
	}

	// Fired when a gizmo drag ends → persist the result into the source.
	function onGizmoCommit() {
		if (!gizmo) return;
		const target = gizmo.object;
		if (!target) return;
		try {
			stripOverrideFooter();   // migrate away from any leftover deprecated footer
			if (target === group) {
				writeGroupTransform(group);
				const r = findBlockRange(/^\/\/\s*layout\b/);
				const lineNums = r ? rangeLines(r) : [];
				finalizeWriteback(changesForLines(lineNums));
				return;
			}
			// Collect the affected meshes (single mesh, or the pivot's children for multi-select).
			const meshes = (target === pivot) ? [...pivot.children] : [target];
			if (target === pivot) dropPivot();   // reparent into group → world transforms baked to local
			// Group meshes by their source section so several parts in ONE section fold into a single
			// edit (two edits with the same start would otherwise clobber each other).
			const bySection = new Map();   // start → { range, items:[{mesh,start,end,addRel}] }
			let unlocated = 0;
			for (const mesh of meshes) {
				const start = dragStarts.get(mesh);
				const meta = metaByMesh(mesh);
				if (!start || !meta || !meta.line) { unlocated++; continue; }
				const range = blockRange(meta) || [meta.line, meta.line];
				const g = bySection.get(range[0]) || { range, items: [] };
				g.items.push({ mesh, start, end: groupLocalTransform(mesh), addRel: meta.line - range[0] });
				bySection.set(range[0], g);
			}
			dragStarts.clear();
			const edits = [];
			for (const { range, items } of bySection.values()) {
				const [a, b] = range;
				let sec = lines.slice(a - 1, b);
				// fold meshes bottom-up within the section so inserts don't shift earlier add lines
				items.sort((x, y) => y.addRel - x.addRel);
				let any = false;
				for (const it of items) {
					const next = offsetEditOnSection(sec, it.addRel, it.mesh, it.start, it.end);
					if (next) { sec = next; any = true; } else unlocated++;
				}
				if (any) edits.push({ start: a, removeCount: b - a + 1, newSec: sec });
			}
			if (edits.length) {
				applyEdits(edits);                        // bottom-up across sections (distinct starts)
				// green-highlight every `// gizmo` line in the touched sections. Walk ascending and
				// carry the running line shift so each section's final position accounts for the
				// growth of the sections above it.
				const changedLines = [];
				let shift = 0;
				for (const e of [...edits].sort((x, y) => x.start - y.start)) {
					e.newSec.forEach((ln, k) => { if (/\/\/\s*gizmo\s*$/.test(ln)) changedLines.push(e.start + shift + k); });
					shift += e.newSec.length - e.removeCount;
				}
				finalizeWriteback(changesForLines(changedLines));
			} else {
				refreshGizmoTarget();                     // nothing written → just re-anchor the gizmo
			}
			if (unlocated) notice(`有 ${unlocated} 个部件是内联生成（scene.add(box(...))），源码里没有可写入的变量，未写回`);
		} catch (err) {
			console.error('[ThreeModel] gizmo writeback failed:', err);
			notice('写回失败：' + (err && err.message || err));
		}
	}

	function ensureGizmo() {
		if (gizmo || gizmoLoadStarted) return;
		gizmoLoadStarted = true;
		loadTransformControls(transformControlsUrl).then((TC) => {
			if (disposed || !TC) return;
			gizmo = new TC(camera, renderer.domElement);
			gizmo.addEventListener('dragging-changed', (e) => {
				draggingGizmo = e.value;
				if (e.value) { autoRotate = false; captureDragStart(); return; }
				// Defer the commit: writeback rebuilds (disposing the dragged mesh), so run it
				// after TransformControls finishes its own pointer-up dispatch, not during it.
				Promise.resolve().then(() => { if (!disposed) onGizmoCommit(); });
			});
			scene.add(gizmo);
			gizmo.visible = false;
			gizmo.enabled = false;
			applySnap();
			refreshGizmoTarget();
			if (onGizmoReady) onGizmoReady(true);
		}).catch((err) => {
			gizmoLoadStarted = false;   // permit a retry on the next mode switch
			console.warn('[ThreeModel] TransformControls 加载失败，已禁用变换模式：', err);
			if (onGizmoReady) onGizmoReady(false);
		});
	}

	function setTransformMode(mode) {
		transformMode = (mode === 'translate' || mode === 'scale' || mode === 'rotate') ? mode : 'camera';
		if (transformMode !== 'camera') { autoRotate = false; ensureGizmo(); }
		refreshGizmoTarget();
		return transformMode;
	}
	// Snap config: pass any subset of { translate, rotateDeg, scale }. Each value is the
	// increment in world units / degrees, or null to turn that category off.
	function setSnapConfig(cfg = {}) {
		if ('translate' in cfg) snapTranslate = cfg.translate;
		if ('rotateDeg' in cfg) snapRotateDeg = cfg.rotateDeg;
		if ('scale' in cfg) snapScaleStep = cfg.scale;
		applySnap();
		return getSnapConfig();
	}
	function getSnapConfig() { return { translate: snapTranslate, rotateDeg: snapRotateDeg, scale: snapScaleStep }; }

	// ============================================================
	//  Pointer: orbit + pinch + click-pick
	// ============================================================
	const pointers = new Map();
	let gesture = null, downPos = null, downShift = false, moved = false, autoRotate = true;

	// Pan the orbit target along the camera's right/up axes (screen-space drag).
	// dx/dy are pixel deltas; the world scale tracks distance so panning feels
	// consistent at any zoom level.
	const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
	function panCamera(dx, dy) {
		camera.getWorldDirection(_fwd);
		_right.crossVectors(_fwd, camera.up).normalize();
		_up.crossVectors(_right, _fwd).normalize();
		const scale = cam.dist * 0.0016;     // px → world units, scaled by zoom
		cam.target.addScaledVector(_right, -dx * scale);
		cam.target.addScaledVector(_up, dy * scale);
		updateCamera();
	}
	// A primary-button (left) drag with no modifier orbits; middle/right button,
	// or left+Shift/Ctrl, pans. Touch: 1 finger orbits, 2 fingers pinch-zoom + pan.
	function isPanButton(e) {
		return e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
	}
	function midpoint(pts) {
		return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
	}

	function onDown(e) {
		// In a transform mode, when the pointer is over a gizmo handle, let TransformControls
		// own the gesture — don't start an orbit/pan or capture the pointer.
		if (transformMode !== 'camera' && gizmo && gizmo.enabled && gizmo.axis) return;
		canvas.setPointerCapture?.(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		autoRotate = false;
		if (pointers.size === 1) {
			downPos = { x: e.clientX, y: e.clientY };
			downShift = !!e.shiftKey;
			moved = false;
			// mouse: middle/right button or modifier → pan; otherwise orbit (rotate).
			const pan = e.pointerType === 'mouse' && isPanButton(e);
			gesture = { type: pan ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
		} else if (pointers.size === 2) {
			const p = [...pointers.values()];
			const mid = midpoint(p);
			// two fingers: simultaneous pinch-zoom + pan (track distance + midpoint).
			gesture = { type: 'pinch', dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx: mid.x, my: mid.y };
		}
		e.preventDefault();
	}
	function onMove(e) {
		if (draggingGizmo) return;   // gizmo owns the drag → suppress orbit/pan
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (gesture?.type === 'rotate' && pointers.size === 1) {
			const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
			if (Math.hypot(dx, dy) > 3) moved = true;
			cam.yaw -= dx * 0.008;
			cam.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, cam.pitch + dy * 0.006));
			gesture.x = e.clientX;
			gesture.y = e.clientY;
			updateCamera();
		} else if (gesture?.type === 'pan' && pointers.size === 1) {
			const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
			if (Math.hypot(dx, dy) > 3) moved = true;
			panCamera(dx, dy);
			gesture.x = e.clientX;
			gesture.y = e.clientY;
		} else if (gesture?.type === 'pinch' && pointers.size === 2) {
			const p = [...pointers.values()];
			const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
			cam.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, cam.dist * (gesture.dist / d)));
			// two-finger drag of the midpoint also pans (RDP-style touch navigation).
			const mid = midpoint(p);
			panCamera(mid.x - gesture.mx, mid.y - gesture.my);
			gesture.dist = d;
			gesture.mx = mid.x;
			gesture.my = mid.y;
			moved = true;
		}
		e.preventDefault();
	}
	function onUp(e) {
		const wasSingle = pointers.size === 1;
		pointers.delete(e.pointerId);
		// A tap (no drag) picks. When the gizmo is mid-drag (it clears `draggingGizmo` in its
		// own later-registered pointerup handler), skip picking. Shift toggles multi-select.
		if (wasSingle && !moved && downPos && !draggingGizmo) selectMeta(pickAt(downPos.x, downPos.y), { additive: downShift });
		gesture = pointers.size === 1
			? { type: 'rotate', x: [...pointers.values()][0].x, y: [...pointers.values()][0].y }
			: null;
		downPos = null;
	}
	function onWheel(e) {
		autoRotate = false;
		cam.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
		updateCamera();
		e.preventDefault();
	}

	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerup', onUp);
	canvas.addEventListener('pointercancel', onUp);
	canvas.addEventListener('wheel', onWheel, { passive: false });
	// suppress the browser context menu so right-button drag can pan the camera.
	const onContextMenu = (e) => e.preventDefault();
	canvas.addEventListener('contextmenu', onContextMenu);

	function onResize() {
		camera.aspect = canvas.clientWidth / vh();
		camera.updateProjectionMatrix();
		setSize();
	}
	window.addEventListener('resize', onResize);

	// ============================================================
	//  Render loop
	// ============================================================
	let disposed = false;
	let showPick = false;
	let rafId = 0;
	updateCamera();
	function animate() {
		if (disposed) return;
		rafId = requestAnimationFrame(animate);
		if (autoRotate && transformMode === 'camera') { cam.yaw += 0.0025; updateCamera(); }
		if (showPick) { syncPick(); renderer.render(pickScene, camera); }
		else renderer.render(scene, camera);
	}
	animate();
	if (onReady) onReady();

	// ============================================================
	//  Public API
	// ============================================================
	return {
		// source
		getCurrentSource: currentSource,
		getOriginalLines: () => lines.slice(),
		setSource(src) {
			loadSource(src);
			selectedLabels.clear();
			rebuild();
			refreshGizmoTarget();
			measureAffected();
			if (onSourceChange) onSourceChange(currentSource());
		},
		getError: () => buildError,

		// params
		getParams: () => paramOrder.map(name => ({ ...params[name], affected: affected[name] || 0 })),
		getParamOrder: () => paramOrder.slice(),
		setParam(name, value) {
			const p = params[name];
			if (!p || p.kind === 'material') return;
			p.value = Number(value);
			rebuild();
			highlightSelectedMesh();
			if (onSourceChange) onSourceChange(currentSource());
		},
		// material：改某个字段（fieldIndex 对应 fields[]，color 传 0xRRGGBB 数字或 "#rrggbb"，num 传数字）。
		setMaterialField(name, fieldIndex, value) {
			const p = params[name];
			if (!p || p.kind !== 'material') return;
			const f = p.fields[fieldIndex];
			if (!f) return;
			if (f.kind === 'color') {
				f.value = typeof value === 'number' ? value : parseInt(String(value).replace(/^#/, ''), 16);
			} else if (f.kind === 'num') {
				f.value = Number(value);
			} else return;            // const 字段不可改
			rebuild();
			highlightSelectedMesh();
			if (onSourceChange) onSourceChange(currentSource());
		},
		commitParams() {
			for (const name of paramOrder) {
				const p = params[name];
				if (p.kind === 'material') p.fields.forEach(f => { if ('value' in f) f.saved = f.value; });
				else p.saved = p.value;
			}
			if (onSourceChange) onSourceChange(currentSource());
		},
		resetParams() {
			let any = false;
			for (const name of paramOrder) {
				const p = params[name];
				if (p.kind === 'material') {
					p.fields.forEach(f => {
						if (!('value' in f)) return;
						if (Math.abs(f.value - f.saved) > 1e-9) any = true;
						f.value = f.saved;
					});
				} else {
					if (Math.abs(p.value - p.saved) > 1e-9) any = true;
					p.value = p.saved;
				}
			}
			if (any) { rebuild(); highlightSelectedMesh(); }
			if (onSourceChange) onSourceChange(currentSource());
			return any;
		},
		affectedCount: (name) => affected[name] || 0,
		relatedParamsForSelection() {
			const meta = metaByLabel(firstSelected());
			return meta ? [...relatedParams(meta)] : [];
		},

		// selection
		getSelectedLabel: () => firstSelected(),
		getSelectedLabels: () => [...selectedLabels],
		clearSelection() { selectMeta(null); },

		// transform gizmo (move / scale / rotate)
		setTransformMode,
		getTransformMode: () => transformMode,
		setSnapConfig,
		getSnapConfig,

		// stats + poly quality
		getTriangleCount: () => countTriangles(),
		getPolyQuality: () => polyQuality,
		setPolyQuality(v) {
			const next = clampQuality(v);
			polyQuality = next;
			writeQualityLine(next);    // persist into the source's top-of-file `quality(<n>)` call
			rebuild();                 // re-runs source → curved shapes pick up the new segment counts (emits stats)
			highlightSelectedMesh();   // re-attach the green wireframe to the rebuilt mesh
			if (onSourceChange) onSourceChange(currentSource());   // mirror the edited line into the code editor / snippet
			return polyQuality;
		},

		// rendering modes
		setShowPick(v) { showPick = !!v; },
		isShowingPick: () => showPick,
		getRenderOptions,
		setWireframe,
		setShadow,
		setGround,
		setGrid,
		getGridInfo,
		setAutoRotate(v) { autoRotate = !!v; },
		resize: onResize,

		// camera
		resetCamera() {
			cam.yaw = -0.6; cam.pitch = 0.7; cam.dist = 13.5;
			cam.target.set(0, -0.2, 0);
			autoRotate = true;
			updateCamera();
		},
		panBy(dx, dy) { autoRotate = false; panCamera(dx, dy); },

		// lighting
		getLights,
		setLight,
		resetLights,

		destroy() {
			disposed = true;
			cancelAnimationFrame(rafId);
			dropPivot();
			if (gizmo) { gizmo.detach(); scene.remove(gizmo); if (gizmo.dispose) gizmo.dispose(); gizmo = null; }
			window.removeEventListener('resize', onResize);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerup', onUp);
			canvas.removeEventListener('pointercancel', onUp);
			canvas.removeEventListener('wheel', onWheel);
			canvas.removeEventListener('contextmenu', onContextMenu);
			disposeGroup();
			if (groundGrid) { scene.remove(groundGrid); groundGrid.geometry.dispose(); groundGrid.material.dispose(); groundGrid = null; }
			if (groundAxes) { scene.remove(groundAxes); groundAxes.geometry.dispose(); groundAxes.material.dispose(); groundAxes = null; }
			pickTarget.dispose();
			renderer.dispose();
		},
	};
}

/* ============================================================
 *  Self-contained widget: mountThreeModelDevtools(container, opts)
 *  ------------------------------------------------------------
 *  把「前端 demo 同款 UI（深色霓虹风）+ 3 列布局（code | 3D | params）
 *  + color-id picking + 实时调参」整块注入到任意容器里——所有 HTML/CSS/JS
 *  都在本 .js 文件内，方便在不同页面复用。
 *
 *  用法：
 *    import { mountThreeModelDevtools } from './ThreeJsModelGenerator.js';
 *    const ui = await mountThreeModelDevtools(document.getElementById('host'), {
 *      source: '// model.three.js ...',      // 初始源码（可选）
 *      filename: 'model.three.js',           // 标题栏文件名（可选）
 *      THREE,                                // 可传入已加载的 THREE（可选，否则自动从 CDN 加载）
 *      onSourceChange: (src) => {},          // 源码变化回调（参数编辑/保存）
 *      onPick: (meta, info) => {},           // 点选回调
 *    });
 *    ui.getCurrentSource();   // 导出当前（带最新参数）的纯净源码
 *    ui.setSource(newSrc, { filename });     // 切换源码
 *    ui.destroy();
 * ============================================================ */

const WIDGET_STYLE_ID = 'three-model-devtools-style';
const WIDGET_CSS = `
.tmd-root{--bg-900:#060914;--bg-800:#0b1020;--panel:rgba(20,28,54,.72);--panel-line:rgba(120,150,255,.18);--cyan:#2de2e6;--violet:#7b61ff;--amber:#ffb02e;--green:#3ddc84;--ink:#eaf0ff;--ink-soft:#9aa7d0;--ink-dim:#6b78a6;
  /* establish a size-query container so the layout responds to the host
     container's width, not the viewport (the widget can be embedded in a
     narrow column inside a wide page). */
  container-type:inline-size;container-name:tmd;
  /* In the wide (3-column) layout the widget fills its host's bounded height so the
     columns fill it and the params list scrolls inside its own column instead of
     growing the whole widget. */
  /* fill the host container (#devtoolsHost is a flex-1 panel child) instead of a
     fixed viewport share, so the widget never leaves empty space below it. The
     stacked container/media queries below reset this to height:auto so the page scrolls. */
  font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;color:var(--ink);height:100%;min-height:520px;display:flex;flex-direction:column;}
.tmd-root *{box-sizing:border-box;}
/* thin custom scrollbars (Firefox + WebKit) */
.tmd-root,.tmd-root *{scrollbar-width:thin;scrollbar-color:rgba(123,150,255,.35) transparent;}
.tmd-root *::-webkit-scrollbar{width:8px;height:8px;}
.tmd-root *::-webkit-scrollbar-track{background:transparent;}
.tmd-root *::-webkit-scrollbar-thumb{background:rgba(123,150,255,.28);border-radius:999px;border:2px solid transparent;background-clip:padding-box;}
.tmd-root *::-webkit-scrollbar-thumb:hover{background:rgba(45,226,230,.5);background-clip:padding-box;}
.tmd-root *::-webkit-scrollbar-corner{background:transparent;}
.tmd-card{border:1px solid var(--panel-line);border-radius:18px;background:var(--panel);box-shadow:0 30px 60px -28px rgba(0,0,0,.8);overflow:hidden;backdrop-filter:blur(8px);flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.tmd-bar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--panel-line);flex-wrap:wrap;background:rgba(6,9,20,.35);}
.tmd-bar .histbtns{display:inline-flex;gap:4px;border:1px solid var(--panel-line);border-radius:8px;padding:3px;background:rgba(255,255,255,.03);}
/* !important resets so host base styles (e.g. Tailwind's global button rule with
   min-height/border/background/padding) can't turn these into white boxes. */
.tmd-bar .histbtns button{display:inline-flex!important;align-items:center;justify-content:center;width:28px!important;height:26px!important;min-height:0!important;padding:0!important;margin:0!important;border:none!important;background:transparent!important;color:var(--ink-soft)!important;cursor:pointer;border-radius:6px!important;line-height:1!important;box-shadow:none!important;transition:background .18s,color .18s;}
.tmd-bar .histbtns button:hover:not(:disabled){color:var(--ink)!important;background:rgba(45,226,230,.12)!important;}
.tmd-bar .histbtns button:disabled{opacity:.35;cursor:default;background:transparent!important;}
.tmd-bar .histbtns button svg{width:16px!important;height:16px!important;display:block!important;color:inherit;stroke:currentColor;}
.tmd-bar .file{font-size:12.5px;color:var(--ink-soft);font-family:"JetBrains Mono","Fira Code",Consolas,monospace;}
.tmd-bar .modepill{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--ink-soft);}
.tmd-bar .sw{display:inline-flex;gap:4px;border:1px solid var(--panel-line);border-radius:999px;padding:3px;background:rgba(255,255,255,.03);}
.tmd-bar .sw button{border:none;background:transparent;color:var(--ink-soft);cursor:pointer;font-size:11px;padding:4px 10px;border-radius:999px;font-family:inherit;transition:background .2s,color .2s;}
.tmd-bar .sw button.active{color:#04121a;font-weight:700;background:linear-gradient(120deg,var(--cyan),var(--violet));}
.tmd-bar .act{border:1px solid var(--panel-line);background:rgba(255,255,255,.04);color:var(--ink-soft);cursor:pointer;font-size:11px;padding:5px 11px;border-radius:8px;font-family:inherit;transition:all .18s;}
.tmd-bar .act:hover{color:var(--ink);border-color:var(--cyan);}
.tmd-bar .act.save{color:#04121a;font-weight:700;border:none;background:linear-gradient(120deg,var(--green),#2bb673);}
.tmd-bar .act.active{color:var(--cyan);border-color:var(--cyan);background:rgba(45,226,230,.12);}
.tmd-bar .act.chat{color:#04121a;font-weight:700;border:none;background:linear-gradient(120deg,var(--cyan),var(--violet));box-shadow:0 6px 16px -8px rgba(45,226,230,.8);}
.tmd-bar .act.chat:hover{filter:brightness(1.08);color:#04121a;}
.tmd-bar .act.chat:active{transform:scale(.97);}
.tmd-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.2fr) minmax(300px,.9fr);grid-auto-rows:minmax(0,1fr);flex:1 1 auto;min-height:0;}
.tmd-code{border-right:1px solid var(--panel-line);background:#070b18;overflow:hidden;min-height:0;height:100%;position:relative;display:flex;flex-direction:column;}
.tmd-code .tmd-cm-host{flex:1 1 auto;min-height:0;overflow:hidden;}
/* CodeMirror always-editable code panel */
.tmd-code .CodeMirror{height:100%;font-family:"JetBrains Mono","Fira Code",Consolas,monospace;font-size:12.5px;line-height:1.55;background:#070b18;}
.tmd-code .CodeMirror-gutters{background:#070b18;border-right:1px solid rgba(120,150,255,.08);}
.tmd-code .CodeMirror-linenumber{color:var(--ink-dim);opacity:.6;}
/* highlighted source range for the picked object */
.tmd-code .CodeMirror-line-hl{background:linear-gradient(90deg,rgba(45,226,230,.16),rgba(123,97,255,.10));box-shadow:inset 3px 0 0 var(--cyan);}
/* green highlight of the value(s) a gizmo move just wrote back */
.tmd-code .CodeMirror-line-changed{background:linear-gradient(90deg,rgba(61,220,132,.16),rgba(61,220,132,.04));box-shadow:inset 3px 0 0 var(--green);}
.tmd-code .tmd-num-changed{background:rgba(61,220,132,.42);color:#eafff1!important;border-radius:3px;box-shadow:0 0 0 1px rgba(61,220,132,.6);}
.tmd-code .CodeMirror-gutter-hl{color:var(--cyan)!important;opacity:1!important;}
.tmd-edit-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--panel-line);background:rgba(6,9,20,.6);}
.tmd-edit-hint{font-size:11px;color:var(--ink-dim);flex:1 1 auto;min-width:120px;}
.tmd-edit-hint.err{color:#ff6b6b;}
.tmd-view{position:relative;display:flex;flex-direction:column;border-right:1px solid var(--panel-line);}
.tmd-canvas{width:100%;flex:1;min-height:360px;display:block;cursor:crosshair;background:radial-gradient(circle at 50% 40%,#0e1530,#060914);}
.tmd-hud{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;pointer-events:none;}
.tmd-hud .hint{font-size:11px;color:var(--cyan);background:rgba(6,9,20,.6);border:1px solid var(--panel-line);border-radius:999px;padding:4px 12px;backdrop-filter:blur(6px);}
/* always-on triangle-count badge in the HUD (full controls live in the 显示 panel) */
.tmd-hud .tmd-tris-badge{margin-left:auto;font-size:11px;font-weight:700;color:var(--amber);font-family:"JetBrains Mono",monospace;white-space:nowrap;background:rgba(6,9,20,.6);border:1px solid var(--panel-line);border-radius:999px;padding:4px 12px;backdrop-filter:blur(6px);cursor:pointer;pointer-events:auto;}
.tmd-hud .tmd-tris-badge:hover{border-color:var(--amber);}
.tmd-mode-bar{position:absolute;left:12px;bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:rgba(6,9,20,.62);border:1px solid var(--panel-line);border-radius:999px;padding:4px;backdrop-filter:blur(6px);z-index:3;}
.tmd-mode-bar button{font-size:12px;line-height:1;color:var(--ink-soft);background:transparent;border:1px solid transparent;border-radius:999px;padding:6px 11px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s,border-color .12s;}
.tmd-mode-bar button:hover{color:var(--ink);background:rgba(120,150,255,.12);}
.tmd-mode-bar button.active{color:#06121a;background:var(--cyan);border-color:var(--cyan);font-weight:700;}
.tmd-mode-bar button.snap{margin-left:4px;border-color:var(--panel-line);}
.tmd-mode-bar button.snap.on{color:var(--amber);border-color:var(--amber);background:rgba(255,176,46,.12);}
.tmd-mode-bar button:disabled{opacity:.4;cursor:not-allowed;}
/* render panel extras (reuses .tmd-light-panel chrome) */
.tmd-light-panel .lp-head .lp-tris{color:var(--amber);font-size:11px;font-weight:700;font-family:"JetBrains Mono",monospace;}
.tmd-light-panel .lp-hint{margin-top:3px;font-size:10px;line-height:1.4;color:var(--ink-dim);}
.tmd-light-panel .lp-toggle{flex-direction:row;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;cursor:pointer;color:var(--ink-soft);}
.tmd-light-panel .lp-toggle:hover{color:var(--ink);}
.tmd-light-panel .lp-toggle input[type=checkbox]{width:15px;height:15px;min-height:0;margin:0;padding:0;accent-color:var(--violet);cursor:pointer;}
/* ---- lighting popover panel (top-right of the 3D view) ---- */
.tmd-light-panel{position:absolute;top:48px;right:12px;width:248px;max-height:calc(100% - 60px);overflow-y:auto;z-index:5;padding:12px 14px;border:1px solid var(--panel-line);border-radius:12px;background:rgba(8,12,26,.42);backdrop-filter:blur(10px);box-shadow:0 20px 40px -18px rgba(0,0,0,.8);font-size:11.5px;color:var(--ink-soft);}
.tmd-light-panel[hidden]{display:none;}
.tmd-light-panel .lp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.tmd-light-panel .lp-head b{color:var(--ink);font-size:12.5px;}
.tmd-light-panel .lp-reset{border:1px solid var(--panel-line);background:rgba(255,255,255,.04);color:var(--ink-soft);cursor:pointer;font-size:10.5px;padding:3px 8px;border-radius:6px;font-family:inherit;}
.tmd-light-panel .lp-reset:hover{color:var(--ink);border-color:var(--cyan);}
.tmd-light-panel .lp-row{display:flex;flex-direction:column;gap:3px;margin-bottom:9px;}
.tmd-light-panel .lp-row .lp-label{display:flex;justify-content:space-between;align-items:baseline;font-family:"JetBrains Mono",monospace;}
.tmd-light-panel .lp-row .lp-label .lv{color:var(--amber);}
.tmd-light-panel .lp-row.lp-color{flex-direction:row;align-items:center;justify-content:space-between;}
.tmd-light-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;min-height:0;padding:0;margin:2px 0;border:none;border-radius:999px;background:linear-gradient(90deg,var(--cyan),var(--violet));outline:none;cursor:pointer;}
.tmd-light-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin-top:-4px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;}
.tmd-light-panel input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;}
.tmd-light-panel input[type=color]{width:34px;height:22px;min-height:0;padding:0;border:1px solid var(--panel-line);border-radius:5px;background:transparent;cursor:pointer;}
.tmd-light-panel .lp-group{margin:10px 0 4px;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-dim);}
/* snap panel — anchored bottom-left near the mode bar instead of top-right */
.tmd-light-panel.tmd-snap-panel{top:auto;bottom:56px;left:12px;right:auto;width:210px;}
.tmd-snap-panel .snap-opts{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:2px;}
.tmd-snap-panel .snap-opts button{flex:0 0 auto;font-size:11px;line-height:1;color:var(--ink-soft);background:rgba(255,255,255,.04);border:1px solid var(--panel-line);border-radius:6px;padding:5px 9px;cursor:pointer;font-family:inherit;}
.tmd-snap-panel .snap-opts button:hover{color:var(--ink);border-color:var(--cyan);}
.tmd-snap-panel .snap-opts button.active{color:#06121a;background:var(--cyan);border-color:var(--cyan);font-weight:700;}
.tmd-side{background:rgba(8,12,26,.45);display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden;}
.tmd-foot{padding:12px 16px;font-size:12.5px;color:var(--ink-soft);min-height:64px;display:flex;flex-direction:column;gap:6px;justify-content:center;flex:0 0 auto;}
.tmd-foot .row1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.tmd-foot .pick{color:#04121a;font-weight:700;padding:3px 10px;border-radius:6px;font-size:11.5px;background:linear-gradient(120deg,var(--cyan),var(--violet));}
.tmd-foot code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
.tmd-foot .ai{font-size:12px;color:var(--ink-soft);border-left:2px solid var(--violet);padding-left:10px;}
.tmd-foot .ai b{color:var(--ink);}
.tmd-params{border-top:1px solid var(--panel-line);padding:14px 16px;background:rgba(8,12,26,.55);flex:1 1 auto;min-height:0;overflow-y:auto;}
.tmd-params .pp-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.tmd-params .pp-head .tag2{font-size:11.5px;font-weight:700;color:#04121a;padding:3px 10px;border-radius:6px;background:linear-gradient(120deg,var(--amber),#ff8a3d);}
.tmd-params .pp-head .who{font-size:12.5px;color:var(--ink-soft);}
.tmd-params .pp-head .who b{color:var(--ink);}
.tmd-params .pp-head .who code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
.tmd-params .pp-grid{display:grid;grid-template-columns:1fr;gap:12px 18px;}
.tmd-row{display:flex;flex-direction:column;gap:5px;}
.tmd-row .pp-label{display:flex;justify-content:space-between;align-items:baseline;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--ink-soft);}
.tmd-row .pp-label .k{color:var(--cyan);}
.tmd-row .pp-label .v{color:var(--amber);}
.tmd-row .pp-label .v.changed{color:var(--green);font-weight:700;}
.tmd-row.rel{padding:6px 8px;margin:-6px -8px;border-radius:8px;background:rgba(45,226,230,.06);box-shadow:inset 2px 0 0 var(--cyan);}
.tmd-row .rel-dot{color:var(--cyan);font-size:9px;font-style:normal;}
.tmd-row .arg-tag{margin-left:4px;padding:0 5px;border-radius:999px;background:rgba(139,92,246,.16);color:var(--violet);font-size:9.5px;font-style:normal;font-weight:600;vertical-align:middle;}
/* material param: collapsible dropdown row */
.tmd-mat .mat-dd{margin:0;}
.tmd-mat summary{list-style:none;cursor:pointer;outline:none;}
.tmd-mat summary::-webkit-details-marker{display:none;}
.tmd-mat summary .pp-label{width:100%;min-width:0;}
.tmd-mat .mat-sum{display:inline-flex;align-items:center;gap:7px;min-width:0;flex:0 1 auto;}
.tmd-mat .mat-sum .v{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tmd-mat .mat-swatch{flex:none;width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.35);box-shadow:0 0 0 1px rgba(0,0,0,.25);}
.tmd-mat .dd-caret{font-style:normal;color:var(--ink-dim);font-size:10px;transition:transform .15s;}
.tmd-mat .mat-dd[open] .dd-caret{transform:rotate(180deg);}
.tmd-mat .mat-fields{margin:8px 0 2px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);display:flex;flex-direction:column;gap:9px;}
.tmd-mat .mat-field{display:grid;grid-template-columns:54px 1fr auto;align-items:center;gap:8px;font-family:"JetBrains Mono",monospace;font-size:11px;}
.tmd-mat .mat-fl{color:var(--cyan);}
.tmd-mat .mat-fv{color:var(--amber);min-width:48px;text-align:right;}
.tmd-mat .mat-field input[type=color]{width:100%;height:22px;min-height:0;padding:0;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:none;cursor:pointer;}
.tmd-mat .mat-field input[type=color]::-webkit-color-swatch-wrapper{padding:2px;}
.tmd-mat .mat-field input[type=color]::-webkit-color-swatch{border:none;border-radius:4px;}
.tmd-mat .mat-const .mat-fc{color:var(--ink-dim);text-align:right;font-style:italic;}
.tmd-mat .mat-const{opacity:.75;}
.tmd-row .pp-meta{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--ink-dim);}
.tmd-row .pp-meta b{color:var(--amber);}
/* Use !important + explicit resets so host base styles (e.g. Tailwind's global
   input rule with min-height/border/background/padding) can't break the
   thin gradient track + round thumb. */
.tmd-row input[type=range]{-webkit-appearance:none!important;appearance:none!important;display:block;width:100%!important;height:5px!important;min-height:0!important;padding:0!important;margin:6px 0!important;border:none!important;border-radius:999px!important;background:linear-gradient(90deg,var(--cyan),var(--violet))!important;outline:none;cursor:pointer;box-shadow:none!important;}
.tmd-row input[type=range]:focus{outline:none;box-shadow:none!important;}
.tmd-row input[type=range]::-webkit-slider-runnable-track{-webkit-appearance:none;appearance:none;height:5px;border-radius:999px;background:transparent;border:none;}
.tmd-row input[type=range]::-moz-range-track{height:5px;border-radius:999px;background:transparent;border:none;}
.tmd-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none!important;appearance:none!important;width:15px;height:15px;margin-top:-5px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.5);}
.tmd-row input[type=range]::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.5);}
.tmd-empty{font-size:12.5px;color:var(--ink-dim);padding:4px 0;}
.tmd-empty code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
/* ---- container-query responsive (preferred: reacts to the host width) ----
   Keep the 3-column layout (code | 3D | params) as long as there's room — the
   2-column fallback only kicks in below 1000px, so a ~1180–1280px container
   still gets all three columns. Below 1000px we stack into 2 columns, and below
   640px into a single column. In every stacked mode each block is capped with a
   max-height (a share of the viewport) so the params list scrolls instead of
   running off the page. */
@container tmd (max-width:1000px){
  /* stacked layout: grow to natural height (no fixed-height clipping) and let the page scroll */
  .tmd-root{height:auto;max-height:none;min-height:0;}
  .tmd-card{flex:none;height:auto;}
  .tmd-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-rows:auto;flex:none;min-height:0;}
  .tmd-code{height:auto;max-height:min(420px,55vh);}
  .tmd-side{grid-column:1 / -1;height:auto;border-top:1px solid var(--panel-line);overflow:hidden;}
  /* cap the params block height so a long params list scrolls inside the panel */
  .tmd-params{flex:none;min-height:0;max-height:min(420px,55vh);overflow-y:auto;}
  .tmd-params .pp-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
}
@container tmd (max-width:640px){
  .tmd-grid{grid-template-columns:1fr;}
  .tmd-code{border-right:none;border-bottom:1px solid var(--panel-line);height:auto;max-height:min(340px,45vh);}
  .tmd-view{border-right:none;}
  .tmd-params{max-height:min(360px,48vh);}
}
/* ---- viewport fallback for browsers without container-query support ---- */
@media (max-width:1000px){
  .tmd-root{height:auto;max-height:none;min-height:0;}
  .tmd-card{flex:none;height:auto;}
  .tmd-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-rows:auto;flex:none;min-height:0;}
  .tmd-code{height:auto;max-height:min(420px,55vh);}
  .tmd-side{grid-column:1 / -1;height:auto;border-top:1px solid var(--panel-line);overflow:hidden;}
  .tmd-params{flex:none;min-height:0;max-height:min(420px,55vh);overflow-y:auto;}
  .tmd-params .pp-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
}
@media (max-width:640px){
  .tmd-grid{grid-template-columns:1fr;}
  .tmd-code{border-right:none;border-bottom:1px solid var(--panel-line);height:auto;max-height:min(340px,45vh);}
  .tmd-view{border-right:none;}
  .tmd-params{max-height:min(360px,48vh);}
}
`;

function ensureWidgetStyles(doc) {
	if (doc.getElementById(WIDGET_STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = WIDGET_STYLE_ID;
	style.textContent = WIDGET_CSS;
	doc.head.appendChild(style);
}

/* ============================================================
 *  CodeMirror 5 loader (classic <script>/<link>, global window.CodeMirror).
 *  Self-contained so this widget can be dropped into any page without an
 *  external config module. URLs default to the keepwork CDN mirror.
 * ============================================================ */
const CODEMIRROR_CDN = {
	css: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/codemirror.min.css',
	theme: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/material-darker.min.css',
	core: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/codemirror.min.js',
	javascript: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/javascript.min.js',
};

function loadStyleOnce(doc, href) {
	if (!href || doc.querySelector(`link[href="${href}"]`)) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.onload = resolve;
		link.onerror = reject;
		doc.head.appendChild(link);
	});
}

function loadScriptOnce(doc, src) {
	if (!src) return Promise.resolve();
	const existing = doc.querySelector(`script[src="${src}"]`);
	if (existing?.dataset.loaded === '1') return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (existing) {
			existing.addEventListener('load', resolve, { once: true });
			existing.addEventListener('error', reject, { once: true });
			return;
		}
		const script = doc.createElement('script');
		script.src = src;
		script.onload = () => { script.dataset.loaded = '1'; resolve(); };
		script.onerror = reject;
		doc.head.appendChild(script);
	});
}

let _cmLoading = null;
async function loadCodeMirror(doc, cdn = {}) {
	const urls = { ...CODEMIRROR_CDN, ...cdn };
	if (window.CodeMirror) {
		await loadStyleOnce(doc, urls.css);
		await loadStyleOnce(doc, urls.theme);
		return window.CodeMirror;
	}
	if (!_cmLoading) {
		_cmLoading = (async () => {
			await Promise.all([loadStyleOnce(doc, urls.css), loadStyleOnce(doc, urls.theme)]);
			await loadScriptOnce(doc, urls.core);
			await loadScriptOnce(doc, urls.javascript);
			return window.CodeMirror || null;
		})();
	}
	return _cmLoading;
}

export async function mountThreeModelDevtools(container, opts = {}) {
	if (!container) throw new Error('mountThreeModelDevtools requires a container element');
	const doc = container.ownerDocument || document;
	ensureWidgetStyles(doc);

	const {
		THREE: providedTHREE = null,
		source = '',
		filename = 'model.three.js',
		showToolbarActions = true,    // 重置 / 保存 buttons in the title bar
		onSourceChange = null,
		onPick = null,
		onChat = null,                // 提供时在 params 头部显示「💬 AI 改模型」按钮，点击调用此回调

		lowPoly = false,
		background = 0x223052,
	} = opts;

	// THREE comes from the static module import by default; opts.THREE still wins.
	const THREE = providedTHREE || THREE_DEFAULT;

	// ---- build the widget DOM (front-page live-card layout) ----
	const root = doc.createElement('div');
	root.className = 'tmd-root';
	root.innerHTML = `
	<div class="tmd-card">
		<div class="tmd-bar">
			<span class="histbtns">
				<button data-tmd="undo" type="button" title="撤销 (Ctrl/⌘+Z)" disabled aria-label="撤销">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>
				</button>
				<button data-tmd="redo" type="button" title="重做 (Ctrl/⌘+Y)" disabled aria-label="重做">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>
				</button>
			</span>
			<span class="file" data-tmd="file">${escapeHtml(filename)}</span>
			<span class="modepill">
				${onChat ? '<button type="button" class="act chat" data-tmd="chatBtn" title="用 AI 对话修改这个模型的源码（keepwork 编辑工具）">💬 AI 改模型</button>' : ''}
				<span class="sw">
					<button data-tmd="modeNormal" class="active">正常渲染</button>
					<button data-tmd="modePick">显示 color id</button>
				</span>
				<button class="act" data-tmd="lightBtn" title="调整灯光">💡 灯光</button>
				<button class="act" data-tmd="renderBtn" title="显示与渲染选项（三角形 / 精度 / 线框 / 阴影 / 地面）">🔺 显示</button>
				${showToolbarActions ? '<button class="act" data-tmd="reset">↺ 重置</button><button class="act save" data-tmd="save">✓ 保存</button>' : ''}
			</span>
		</div>
		<div class="tmd-grid">
			<div class="tmd-code">
				<div class="tmd-cm-host" data-tmd="cmhost"></div>
				<div class="tmd-edit-bar">
					<span class="tmd-edit-hint" data-tmd="edithint">代码可直接编辑，停止输入后自动重跑（Ctrl/⌘+Enter 立即重跑）。</span>
				</div>
			</div>
			<div class="tmd-view">
				<canvas data-tmd="canvas" class="tmd-canvas"></canvas>
				<div class="tmd-hud">
					<span class="hint">↳ 点击部件 → 定位代码 + 调参 · Shift 点击多选 · 拖动旋转 · 右键/中键或双指拖动平移 · 滚轮/双指缩放</span>
					<span class="tmd-tris-badge" data-tmd="trisBadge" title="当前模型的三角形总数（点击打开「显示」面板）">△ —</span>
				</div>
				<div class="tmd-mode-bar" data-tmd="modebar" title="变换模式：相机浏览 / 移动 / 缩放 / 旋转（未选中部件时变换整个模型）">
						<button type="button" data-tmd="mCam" class="active">🎥 相机</button>
						<button type="button" data-tmd="mMove">✥ 移动</button>
						<button type="button" data-tmd="mScale">⤢ 缩放</button>
						<button type="button" data-tmd="mRot">⟳ 旋转</button>
						<button type="button" data-tmd="snap" class="snap on" title="吸附设置（位置 / 角度 / 缩放）">🧲 吸附</button>
					</div>
					<div class="tmd-light-panel tmd-snap-panel" data-tmd="snapPanel" hidden></div>
						<div class="tmd-light-panel" data-tmd="lightPanel" hidden></div>
				<div class="tmd-light-panel" data-tmd="renderPanel" hidden></div>
			</div>
			<div class="tmd-side">
				<div class="tmd-foot" data-tmd="foot">
					<div class="row1"><span class="pick">picking</span><span>点击 3D 部件，工具会定位代码并抓取相关真实参数 →</span></div>
				</div>
				<div class="tmd-params">
					<div class="pp-head">
						<span class="tag2">params</span>
						<span class="who" data-tmd="who">源码顶部的真实参数（PARAMS）—— 拖动滑块直接改写源码字面量并重跑。</span>
					</div>
					<div class="pp-grid" data-tmd="ppgrid"></div>
				</div>
			</div>
		</div>
	</div>`;
	container.appendChild(root);

	const q = (sel) => root.querySelector(`[data-tmd="${sel}"]`);
	const cmHost = q('cmhost');
	const canvas = q('canvas');
	const foot = q('foot');
	const who = q('who');
	const ppGrid = q('ppgrid');
	const btnNormal = q('modeNormal');
	const btnPick = q('modePick');
	const btnReset = q('reset');
	const btnSave = q('save');
	const btnUndo = q('undo');
	const btnRedo = q('redo');
	const editHint = q('edithint');
	const btnLight = q('lightBtn');
	const lightPanel = q('lightPanel');
	const btnChat = q('chatBtn');
	if (btnChat && onChat) btnChat.addEventListener('click', (e) => { e.stopPropagation(); onChat(); });
	const trisBadge = q('trisBadge');
	const btnRender = q('renderBtn');
	const renderPanel = q('renderPanel');
	// transform mode bar (camera / move / scale / rotate + snap toggle)
	const modeBtns = { camera: q('mCam'), translate: q('mMove'), scale: q('mScale'), rotate: q('mRot') };
	const btnSnap = q('snap');
	const snapPanel = q('snapPanel');
	// Latest triangle count, refreshed after every build via the editor's onStats. The HUD badge is
	// always present; the render panel's readout (data-tmd="trisPanel") only exists while the panel is open.
	let lastTris = 0;
	let lastGrid = { unit: 'm', cell: 1 };
	const fmtTris = (n) => '△ ' + Number(n || 0).toLocaleString('en-US') + ' tris';
	// Human label for one grid cell's real size, e.g. "1 m" or "1 cm".
	const fmtGrid = (g) => !g ? '1 m' : (g.unit === 'cm' ? `${+(+(g.cell || 0) * 100).toFixed(2)} cm` : `${+(+(g.cell || 1)).toFixed(2)} m`);
	function setTris(n) {
		lastTris = Number(n || 0);
		if (trisBadge) trisBadge.textContent = fmtTris(lastTris);
		const panelTris = renderPanel && renderPanel.querySelector('[data-tmd="trisPanel"]');
		if (panelTris) panelTris.textContent = fmtTris(lastTris);
	}
	function setGridReadout(g) {
		if (g) lastGrid = g;
		const el = renderPanel && renderPanel.querySelector('[data-tmd="gridInfo"]');
		if (el) el.textContent = fmtGrid(lastGrid);
	}

	let picked = null;

	// ---- CodeMirror (always-editable, single view) ----
	let cm = null;               // CodeMirror instance
	let hlMarks = [];            // 0-based line numbers currently highlighted
	let lastRange = null;        // last picked source range [start,end] (1-based)
	let editTimer = null;        // debounce timer for auto re-run
	let suppressChange = false;  // skip change handler during programmatic setValue
	let savedBaseline = '';      // editor text as of the last save / snippet load

	function setEditHint(text, isErr) {
		if (!editHint) return;
		editHint.textContent = text;
		editHint.classList.toggle('err', !!isErr);
	}

	// Enable/disable the undo/redo buttons based on CodeMirror's history depth.
	function updateHistoryButtons() {
		if (!cm) return;
		const h = cm.historySize ? cm.historySize() : { undo: 0, redo: 0 };
		if (btnUndo) btnUndo.disabled = !(h.undo > 0);
		if (btnRedo) btnRedo.disabled = !(h.redo > 0);
	}

	// Fold all the (history-less) slider edits made since the last save into a
	// single undoable entry: briefly restore the baseline text (no history), then
	// re-apply the current text *with* history so one undo reverts the whole save.
	function commitHistoryFromBaseline() {
		if (!cm) return;
		const current = editor.getCurrentSource();
		if (current === savedBaseline) { savedBaseline = current; return; }
		suppressChange = true;
		const snap = cm.getHistory();
		cm.setValue(savedBaseline);   // back to baseline …
		cm.setHistory(snap);          // … without leaving a history trace
		cm.replaceRange(current,      // one recorded edit: baseline → current
			{ line: 0, ch: 0 },
			{ line: cm.lineCount(), ch: 0 });
		suppressChange = false;
		savedBaseline = current;
		updateHistoryButtons();
	}

	// Re-run the model from the current editor text. Validates syntax first so a
	// typo mid-edit doesn't wipe the working scene; on success rebuilds + repaints.
	function rerunFromEditor() {
		if (!cm) return;
		const src = cm.getValue();
		try {
			// eslint-disable-next-line no-new-func
			new Function(src);
		} catch (e) {
			setEditHint('语法错误（未重跑）：' + e.message, true);
			return;
		}
		setEditHint('代码可直接编辑，停止输入后自动重跑（Ctrl/⌘+Enter 立即重跑）。', false);
		picked = null;
		editor.setSource(src);            // triggers onSourceChange → setCodeValue (suppressed)
		const e2 = editor.getError();
		if (e2) {
			foot.innerHTML = `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>建模脚本执行失败：${escapeHtml(e2.message)}</span></div>`;
		}
		// typed edits keep their own (real) history; treat the typed text as the
		// new save-folding baseline so later slider edits fold cleanly onto it.
		savedBaseline = editor.getCurrentSource();
		clearHighlight();
		renderParams();
		if (onSourceChange) onSourceChange(editor.getCurrentSource());
	}

	function scheduleRerun() {
		clearTimeout(editTimer);
		editTimer = setTimeout(rerunFromEditor, 600);
	}

	// Push source text into the editor without firing the auto-rerun (used when
	// the engine itself changes the source, e.g. slider edits / setSource).
	// When `skipHistory` is true (the default for slider/reset/save edits) the
	// programmatic change is made invisible to undo/redo by snapshotting the
	// CodeMirror history before the edit and restoring it afterwards — otherwise
	// dragging a slider would flood the undo stack with hundreds of entries.
	function setCodeValue(src, skipHistory = true) {
		if (!cm) return;                 // pre-init: CodeMirror reads getCurrentSource() on mount
		const text = String(src || '');
		if (cm.getValue() === text) return;
		const snapshot = skipHistory ? cm.getHistory() : null;
		suppressChange = true;
		cm.setValue(text);
		if (snapshot) cm.setHistory(snapshot);   // drop the edit from undo history
		suppressChange = false;
		updateHistoryButtons();
	}

	// ---- highlight the source range of the picked object ----
	function clearHighlight() {
		lastRange = null;
		clearChangeHighlight();   // a new pick/typed edit supersedes the last gizmo write
		if (!cm) return;
		hlMarks.forEach((ln) => {
			cm.removeLineClass(ln, 'background', 'CodeMirror-line-hl');
			cm.removeLineClass(ln, 'gutter', 'CodeMirror-gutter-hl');
		});
		hlMarks = [];
	}

	// ---- green highlight of the exact value(s) a gizmo commit just wrote ----
	let changeTextMarks = [];   // CodeMirror TextMarker handles (number spans)
	let changeLineNos = [];     // 0-based line numbers carrying the green line background
	function clearChangeHighlight() {
		if (!cm) { changeTextMarks = []; changeLineNos = []; return; }
		changeTextMarks.forEach((mk) => { try { mk.clear(); } catch (_) {} });
		changeLineNos.forEach((ln) => cm.removeLineClass(ln, 'background', 'CodeMirror-line-changed'));
		changeTextMarks = [];
		changeLineNos = [];
	}
	// changes: [{ line (1-based), ranges: [[ch0,ch1], …] }]; scrollLine 1-based.
	function applyChangeHighlight(changes, scrollLine) {
		if (!cm || !changes || !changes.length) return;
		clearChangeHighlight();
		clearHighlight();   // drop the cyan pick highlight so the green stands alone
		const last = cm.lineCount();
		for (const c of changes) {
			const ln = c.line - 1;
			if (ln < 0 || ln >= last) continue;
			cm.addLineClass(ln, 'background', 'CodeMirror-line-changed');
			changeLineNos.push(ln);
			for (const [a, b] of (c.ranges || [])) {
				changeTextMarks.push(cm.markText({ line: ln, ch: a }, { line: ln, ch: b }, { className: 'tmd-num-changed' }));
			}
		}
		const s = (scrollLine || changes[0].line) - 1;
		if (s >= 0 && s < last) cm.scrollIntoView({ line: s, ch: 0 }, 80);
	}
	function applyHighlight(range) {
		if (!cm) { lastRange = range || null; return; } // buffer until CodeMirror mounts
		clearHighlight();
		lastRange = range || null;   // (re)set after clear, which nulls it
		if (!range) return;
		const [a, b] = range;
		const last = cm.lineCount();
		for (let n = a; n <= b && n <= last; n++) {
			const ln = n - 1; // CodeMirror is 0-based
			cm.addLineClass(ln, 'background', 'CodeMirror-line-hl');
			cm.addLineClass(ln, 'gutter', 'CodeMirror-gutter-hl');
			hlMarks.push(ln);
		}
		if (a >= 1 && a <= last) {
			cm.scrollIntoView({ line: a - 1, ch: 0 }, 60);
		}
	}

	// ---- params render ----
	function renderParams() {
		if (!editor) { ppGrid.innerHTML = '<div class="tmd-empty">载入源码后显示真实参数。</div>'; return; }
		const params = editor.getParams();
		const related = new Set(editor.relatedParamsForSelection());
		if (picked) {
			who.innerHTML = `已选中 <b>${escapeHtml(picked.displayLabel || '')}</b> · 源码 <code>L${picked.line || '—'}</code> · 下方为它引用的真实参数：`;
		} else {
			who.innerHTML = '源码顶部的<b>真实参数</b>（PARAMS）—— 拖动滑块直接改写源码字面量并重跑。';
		}
		if (!params.length) { ppGrid.innerHTML = '<div class="tmd-empty">源码顶部没有可识别的 <code>const name = number;</code> 或 <code>const xxxMat = mat(0x.., …);</code> 参数。</div>'; return; }
		const fmtN = (v) => Number.isInteger(+v) ? String(+v) : String(+(+v).toFixed(3));
		const hex6 = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
		// 摘要单行短标签：rough→r、metal→m，其它取首字母。
		const shortLabel = (lab) => ({ rough: 'r', metal: 'm', color: 'c' }[lab] || String(lab || '').charAt(0) || '?');
		const ordered = params.slice().sort((x, y) => (related.has(x.name) ? 0 : 1) - (related.has(y.name) ? 0 : 1));
		ppGrid.innerHTML = ordered.map(p => {
			const isRel = related.has(p.name);
			const relDot = isRel ? ' <em class="rel-dot">●</em>' : '';
			const meta = `L${p.line} · ${escapeHtml(p.comment || 'const ' + p.varName)} · 影响 <b>${p.affected || 0}</b> 个对象`;

			// ---- material：单个属性，用下拉展开「取色器 + rough/metal 滑块」 ----
			if (p.kind === 'material') {
				const colorF = p.fields.find(f => f.kind === 'color');
				const matChanged = p.fields.some(f => ('value' in f) && Math.abs(f.value - f.saved) > 1e-9);
				const swatch = colorF ? hex6(colorF.value) : '#888888';
				// 摘要：颜色块 + 各数字字段的当前值，单行短标签（r: / m:）。
				const summaryNums = p.fields.filter(f => f.kind === 'num')
					.map(f => `${escapeHtml(shortLabel(f.label))}:${fmtN(f.value)}`).join(' · ');
				const fieldsHtml = p.fields.map((f, fi) => {
					if (f.kind === 'color') {
						return `<div class="mat-field" data-fi="${fi}" data-fk="color">
							<span class="mat-fl">${escapeHtml(f.label)}</span>
							<input type="color" value="${hex6(f.value)}">
							<span class="mat-fv">${hex6(f.value)}</span>
						</div>`;
					}
					if (f.kind === 'num') {
						const span = Math.max(Math.abs(f.orig) * 1.2, 0.4);
						const min = +(Math.max(0, f.orig - span)).toFixed(3), max = +(f.orig + span).toFixed(3);
						const step = +(span / 120).toFixed(4) || 0.001;
						return `<div class="mat-field" data-fi="${fi}" data-fk="num">
							<span class="mat-fl">${escapeHtml(f.label)}</span>
							<input type="range" min="${min}" max="${max}" step="${step}" value="${f.value}">
							<span class="mat-fv">${fmtN(f.value)}</span>
						</div>`;
					}
					// const：原样展示、不可改。
					return `<div class="mat-field mat-const" data-fi="${fi}" data-fk="const">
						<span class="mat-fl">${escapeHtml(f.label)}</span>
						<span class="mat-fc">${escapeHtml(f.raw)}</span>
					</div>`;
				}).join('');
				return `<div class="tmd-row${isRel ? ' rel' : ''} tmd-mat" data-name="${escapeHtml(p.name)}" data-kind="material">
					<details class="mat-dd">
						<summary>
							<span class="pp-label"><span class="k">${escapeHtml(p.varName)} <em class="arg-tag">mat</em>${relDot}</span>
							<span class="mat-sum"><span class="mat-swatch" style="background:${swatch}"></span><span class="v${matChanged ? ' changed' : ''}">${escapeHtml(summaryNums || 'material')}</span><em class="dd-caret">▾</em></span></span>
						</summary>
						<div class="mat-fields">${fieldsHtml}</div>
					</details>
					<div class="pp-meta">${meta}</div>
				</div>`;
			}

			// ---- number：经典滑块 ----
			const span = Math.max(Math.abs(p.orig) * 1.2, 0.4);
			const min = +(p.orig - span).toFixed(3), max = +(p.orig + span).toFixed(3);
			const step = +(span / 120).toFixed(4) || 0.001;
			const changed = Math.abs(p.value - p.saved) > 1e-9;
			return `<div class="tmd-row${isRel ? ' rel' : ''}" data-name="${escapeHtml(p.name)}" data-kind="number">
				<div class="pp-label"><span class="k">${escapeHtml(p.name)}${relDot}</span><span class="v${changed ? ' changed' : ''}">${fmtN(p.value)}</span></div>
				<input type="range" min="${min}" max="${max}" step="${step}" value="${p.value}">
				<div class="pp-meta">${meta}</div>
			</div>`;
		}).join('');

		// ---- wire up: number rows ----
		ppGrid.querySelectorAll('.tmd-row[data-kind="number"]').forEach(row => {
			const name = row.getAttribute('data-name');
			const input = row.querySelector('input[type=range]');
			const vEl = row.querySelector('.v');
			input.addEventListener('input', () => {
				editor.setParam(name, parseFloat(input.value));
				vEl.textContent = fmtN(input.value);
				vEl.classList.add('changed');
			});
		});

		// ---- wire up: material rows (dropdown with color + num fields) ----
		ppGrid.querySelectorAll('.tmd-row[data-kind="material"]').forEach(row => {
			const name = row.getAttribute('data-name');
			const sumV = row.querySelector('.mat-sum .v');
			const swatchEl = row.querySelector('.mat-swatch');
			row.querySelectorAll('.mat-field').forEach(fEl => {
				const fi = +fEl.getAttribute('data-fi');
				const fk = fEl.getAttribute('data-fk');
				const fvEl = fEl.querySelector('.mat-fv');
				if (fk === 'color') {
					const ci = fEl.querySelector('input[type=color]');
					ci.addEventListener('input', () => {
						editor.setMaterialField(name, fi, ci.value);
						if (fvEl) fvEl.textContent = ci.value;
						if (swatchEl) swatchEl.style.background = ci.value;
						if (sumV) sumV.classList.add('changed');
					});
				} else if (fk === 'num') {
					const ri = fEl.querySelector('input[type=range]');
					ri.addEventListener('input', () => {
						editor.setMaterialField(name, fi, parseFloat(ri.value));
						if (fvEl) fvEl.textContent = fmtN(ri.value);
						// 刷新摘要里的数字部分（单行短标签 r:/m:）。
						const nums = [...row.querySelectorAll('.mat-field[data-fk=num]')].map(el => {
							const lab = el.querySelector('.mat-fl').textContent;
							const val = el.querySelector('.mat-fv').textContent;
							return shortLabel(lab) + ':' + val;
						}).join(' · ');
						if (sumV) { sumV.textContent = nums; sumV.classList.add('changed'); }
					});
				}
			});
		});
	}

	// ---- the engine ----
	let editor;
	try {
		editor = createThreeModelEditor({
		THREE, canvas, source, lowPoly, background,
		onPick: (meta, info) => {
			picked = meta ? { displayLabel: info.displayLabel, line: meta.line } : null;
			applyHighlight(info ? info.range : null);
			renderParams();
			if (meta) {
				foot.innerHTML = `<div class="row1"><span class="pick">picked</span><span><b style="color:var(--ink)">${escapeHtml(info.displayLabel)}</b> · hook 自动捕获 · 源码 <code>L${meta.line}</code></span></div>`
					+ `<div class="ai">该对象引用的真实参数 <code>${info.relatedParams.length ? escapeHtml(info.relatedParams.join(', ')) : '（无）'}</code> → 改一个参数会同步影响所有用到它的对象。</div>`;
			} else {
				foot.innerHTML = '<div class="row1"><span class="pick">picking</span><span>没点到部件，下方仍可直接调全局真实参数（改一处、动多处）。</span></div>';
			}
			if (onPick) onPick(meta, info);
		},
		onSourceChange: (src, info) => {
			// engine-driven source change (slider edits / setSource) → mirror into the
			// editor without re-triggering the auto-rerun. A gizmo transform commit passes
			// { history:true } → record one undoable entry so ↶ / Ctrl+Z reverts the move.
			if (info && info.history) {
				setCodeValue(src, false);                    // keep this edit in undo history
				savedBaseline = editor.getCurrentSource();   // fold baseline forward (Save won't double-count)
				updateHistoryButtons();
				if (info.changes) applyChangeHighlight(info.changes, info.scrollLine);   // green-mark the written values
			} else {
				setCodeValue(src);
			}
			if (onSourceChange) onSourceChange(src);
		},
		onStats: ({ triangles, grid }) => { setTris(triangles); setGridReadout(grid); },
		transformControlsUrl: opts.transformControlsUrl,
		onNotice: (msg) => { setEditHint(msg, false); },
		onGizmoReady: (ok) => {
			if (ok) return;
			// gizmo failed to load → keep camera mode only, disable the transform buttons.
			[modeBtns.translate, modeBtns.scale, modeBtns.rotate, btnSnap].forEach(b => { if (b) b.disabled = true; });
			setEditHint('变换 gizmo 加载失败，仅相机模式可用。', true);
		},
		});
	} catch (e) {
		// Construction failed → don't leave an orphan card in the DOM (the host may retry the
		// mount, which would otherwise stack a second widget). Clean up and rethrow.
		root.remove();
		throw e;
	}

	const err = editor.getError();
	if (err) {
		foot.innerHTML = `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>建模脚本执行失败：${escapeHtml(err.message)}</span></div>`;
	}
	renderParams();

	setTris(editor.getTriangleCount());   // seed the readout (the build during construction already counted)

	// ---- mount the always-editable CodeMirror code panel ----
	loadCodeMirror(doc, opts.codeMirrorCdn).then((CodeMirror) => {
		if (!CodeMirror || !cmHost || !cmHost.isConnected) return;
		cm = CodeMirror(cmHost, {
			value: editor.getCurrentSource(),
			mode: 'javascript',
			theme: 'material-darker',
			lineNumbers: true,
			lineWrapping: false,
			indentUnit: 2,
			tabSize: 2,
			indentWithTabs: false,
			viewportMargin: 80,
			extraKeys: {
				'Ctrl-Enter': () => { clearTimeout(editTimer); rerunFromEditor(); },
				'Cmd-Enter': () => { clearTimeout(editTimer); rerunFromEditor(); },
				Tab: (instance) => instance.replaceSelection('  ', 'end'),
			},
		});
		cm.setSize('100%', '100%');
		savedBaseline = editor.getCurrentSource();   // baseline for save-folding
		cm.on('change', () => { if (!suppressChange) scheduleRerun(); updateHistoryButtons(); });
		// re-apply any highlight that was requested before the editor mounted
		if (lastRange) applyHighlight(lastRange);
		updateHistoryButtons();
		requestAnimationFrame(() => cm && cm.refresh());
	}).catch((e) => {
		setEditHint('CodeMirror 加载失败：' + (e && e.message || e), true);
	});

	// ---- toolbar wiring ----
	btnNormal.addEventListener('click', () => { editor.setShowPick(false); btnNormal.classList.add('active'); btnPick.classList.remove('active'); });
	btnPick.addEventListener('click', () => { editor.setShowPick(true); btnPick.classList.add('active'); btnNormal.classList.remove('active'); });

	// ---- transform mode bar (camera / move / scale / rotate + snap) ----
	function selectModeButton(mode) {
		for (const [k, b] of Object.entries(modeBtns)) if (b) b.classList.toggle('active', k === mode);
		canvas.style.cursor = (mode === 'camera') ? 'crosshair' : 'move';
	}
	for (const [mode, btn] of Object.entries(modeBtns)) {
		if (!btn) continue;
		btn.addEventListener('click', () => { editor.setTransformMode(mode); selectModeButton(mode); });
	}
	// ---- snap panel (position / angle / scale increments) ----
	const SNAP_OPTS = {
		translate: { label: '位置 Position', key: 'translate', def: 0.1, opts: [
			{ v: null, t: '关' }, { v: 1, t: '1 m' }, { v: 0.1, t: '10 cm' }, { v: 0.01, t: '1 cm' },
		] },
		rotate: { label: '角度 Angle', key: 'rotateDeg', def: 15, opts: [
			{ v: null, t: '关' }, { v: 5, t: '5°' }, { v: 15, t: '15°' }, { v: 45, t: '45°' }, { v: 90, t: '90°' },
		] },
		scale: { label: '缩放 Scale', key: 'scale', def: 0.1, opts: [
			{ v: null, t: '关' }, { v: 0.1, t: '0.1' }, { v: 0.25, t: '0.25' }, { v: 0.5, t: '0.5' },
		] },
	};
	const snapValEq = (a, b) => (a == null && b == null) ? true : a === b;
	function refreshSnapActive() {
		if (!snapPanel) return;
		const cfg = editor.getSnapConfig();
		snapPanel.querySelectorAll('.snap-opts').forEach(grp => {
			const meta = SNAP_OPTS[grp.dataset.cat];
			const cur = cfg[meta.key];
			grp.querySelectorAll('button').forEach(b => {
				b.classList.toggle('active', snapValEq(JSON.parse(b.dataset.v), cur));
			});
		});
		// the 🧲 button glows when at least one category is snapping
		const anyOn = cfg.translate != null || cfg.rotateDeg != null || cfg.scale != null;
		if (btnSnap) btnSnap.classList.toggle('on', anyOn);
	}
	function buildSnapPanel() {
		if (!snapPanel) return;
		const groups = Object.values(SNAP_OPTS).map(meta => {
			const btns = meta.opts.map(o =>
				`<button type="button" data-v='${JSON.stringify(o.v)}'>${escapeHtml(o.t)}</button>`).join('');
			return `<div class="lp-group">${escapeHtml(meta.label)}</div><div class="snap-opts" data-cat="${meta.key === 'rotateDeg' ? 'rotate' : meta.key === 'translate' ? 'translate' : 'scale'}">${btns}</div>`;
		}).join('');
		snapPanel.innerHTML = `<div class="lp-head"><b>🧲 吸附</b><button type="button" class="lp-reset" data-tmd="snapReset">↺ 默认</button></div>${groups}`;
		snapPanel.querySelectorAll('.snap-opts').forEach(grp => {
			const meta = SNAP_OPTS[grp.dataset.cat];
			grp.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
				editor.setSnapConfig({ [meta.key]: JSON.parse(b.dataset.v) });
				refreshSnapActive();
			}));
		});
		const reset = snapPanel.querySelector('[data-tmd="snapReset"]');
		if (reset) reset.addEventListener('click', () => {
			editor.setSnapConfig({ translate: SNAP_OPTS.translate.def, rotateDeg: SNAP_OPTS.rotate.def, scale: SNAP_OPTS.scale.def });
			refreshSnapActive();
		});
		refreshSnapActive();
	}
	function toggleSnapPanel(show) {
		if (!snapPanel) return;
		const next = show === undefined ? snapPanel.hasAttribute('hidden') : show;
		if (next) { toggleLightPanel(false); toggleRenderPanel(false); buildSnapPanel(); snapPanel.removeAttribute('hidden'); }
		else snapPanel.setAttribute('hidden', '');
	}
	if (btnSnap) btnSnap.addEventListener('click', (e) => { e.stopPropagation(); toggleSnapPanel(); });
	root.addEventListener('click', (e) => {
		if (!snapPanel || snapPanel.hasAttribute('hidden')) return;
		if (snapPanel.contains(e.target) || btnSnap?.contains(e.target)) return;
		toggleSnapPanel(false);
	});

	// ---- lighting panel (intensity / color / key-light position sliders) ----
	// Each control reads/writes through the editor's getLights()/setLight() API so
	// changes apply live without rebuilding the model.
	const LIGHT_CONTROLS = [
		{ group: '全局' },
		{ key: 'exposure', label: '曝光 Exposure', min: 0, max: 3, step: 0.01 },
		{ key: 'hemiIntensity', label: '半球光 Hemisphere', min: 0, max: 3, step: 0.01 },
		{ key: 'ambientIntensity', label: '环境光 Ambient', min: 0, max: 2, step: 0.01 },
		{ group: '主光 Key' },
		{ key: 'keyIntensity', label: '强度 Intensity', min: 0, max: 5, step: 0.01 },
		{ key: 'keyColor', label: '颜色 Color', color: true },
		{ key: 'keyX', label: '位置 X', min: -20, max: 20, step: 0.1 },
		{ key: 'keyY', label: '位置 Y', min: 0, max: 25, step: 0.1 },
		{ key: 'keyZ', label: '位置 Z', min: -20, max: 20, step: 0.1 },
		{ group: '补光 Fill' },
		{ key: 'fillIntensity', label: '强度 Intensity', min: 0, max: 5, step: 0.01 },
		{ key: 'fillColor', label: '颜色 Color', color: true },
	];
	const fmtLight = (v) => Number.isInteger(v) ? String(v) : String(+(+v).toFixed(2));
	function buildLightPanel() {
		if (!lightPanel) return;
		const L = editor.getLights();
		const rows = LIGHT_CONTROLS.map(c => {
			if (c.group) return `<div class="lp-group">${escapeHtml(c.group)}</div>`;
			if (c.color) {
				return `<div class="lp-row lp-color" data-key="${c.key}"><span>${escapeHtml(c.label)}</span><input type="color" value="${escapeHtml(L[c.key])}"></div>`;
			}
			return `<div class="lp-row" data-key="${c.key}">
				<div class="lp-label"><span>${escapeHtml(c.label)}</span><span class="lv">${fmtLight(L[c.key])}</span></div>
				<input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${L[c.key]}">
			</div>`;
		}).join('');
		lightPanel.innerHTML = `<div class="lp-head"><b>💡 灯光</b><button type="button" class="lp-reset" data-tmd="lightReset">↺ 默认</button></div>${rows}`;
		lightPanel.querySelectorAll('.lp-row').forEach(row => {
			const key = row.getAttribute('data-key');
			const input = row.querySelector('input');
			const lv = row.querySelector('.lv');
			input.addEventListener('input', () => {
				editor.setLight(key, input.value);
				if (lv) lv.textContent = fmtLight(input.type === 'range' ? +input.value : input.value);
			});
		});
		const reset = lightPanel.querySelector('[data-tmd="lightReset"]');
		if (reset) reset.addEventListener('click', () => { editor.resetLights(); buildLightPanel(); });
	}
	function toggleLightPanel(show) {
		if (!lightPanel) return;
		const next = show === undefined ? lightPanel.hasAttribute('hidden') : show;
		if (next) { toggleRenderPanel(false); toggleSnapPanel(false); buildLightPanel(); lightPanel.removeAttribute('hidden'); }
		else lightPanel.setAttribute('hidden', '');
		if (btnLight) btnLight.classList.toggle('active', next);
	}
	if (btnLight) btnLight.addEventListener('click', (e) => { e.stopPropagation(); toggleLightPanel(); });
	// click outside the panel (and not on the toggle button) closes it.
	root.addEventListener('click', (e) => {
		if (!lightPanel || lightPanel.hasAttribute('hidden')) return;
		if (lightPanel.contains(e.target) || btnLight?.contains(e.target)) return;
		toggleLightPanel(false);
	});

	// ---- render / display panel (triangle count · 精度 LOD · wireframe · shadow · ground) ----
	function buildRenderPanel() {
		if (!renderPanel) return;
		const ro = editor.getRenderOptions();
		const q2 = editor.getPolyQuality();
		const toggle = (key, label, on, hint) =>
			`<label class="lp-toggle" data-key="${key}" title="${escapeHtml(hint)}"><span>${escapeHtml(label)}</span><input type="checkbox" ${on ? 'checked' : ''}></label>`;
		renderPanel.innerHTML = `
			<div class="lp-head"><b>🔺 显示</b><span class="lp-tris" data-tmd="trisPanel">${fmtTris(lastTris)}</span></div>
			<div class="lp-group">几何精度</div>
			<div class="lp-row" data-tmd="lodRow">
				<div class="lp-label"><span>精度 Quality</span><span class="lv" data-tmd="lodVal">${(+q2).toFixed(2)}×</span></div>
				<input type="range" data-tmd="lod" min="0.2" max="1" step="0.05" value="${q2}">
				<div class="lp-hint">缩放球 / 圆柱 / 圆锥 / 圆环等内置曲面形状的分段数。调低 → 三角形更少。</div>
			</div>
			<div class="lp-group">渲染</div>
			${toggle('wireframe', '线框 Wireframe', ro.wireframe, '以线框显示模型（关闭则为着色实体）。')}
			${toggle('shadow', '阴影 Shadow', ro.shadow, '开启主光投影 + 地面接收阴影。')}
			${toggle('ground', '地面 Ground', ro.ground, '显示/隐藏地面平面（阴影承接面）。')}
			${toggle('grid', '网格 Grid', ro.grid, '显示/隐藏地面测量网格（1 单位 = 1 米，按物体大小自动切换 米 / 厘米）。')}
			<div class="lp-hint" style="margin-top:-4px;">每格 = <b style="color:var(--amber)" data-tmd="gridInfo">${escapeHtml(fmtGrid(lastGrid))}</b>（1 单位 = 1 米，随物体大小自动切换 米 / 厘米）</div>`;
		const lod = renderPanel.querySelector('[data-tmd="lod"]');
		const lodVal = renderPanel.querySelector('[data-tmd="lodVal"]');
		if (lod) lod.addEventListener('input', () => {
			if (lodVal) lodVal.textContent = parseFloat(lod.value).toFixed(2) + '×';
			editor.setPolyQuality(parseFloat(lod.value));   // rebuilds + emits stats → tris readout refreshes
		});
		renderPanel.querySelectorAll('.lp-toggle').forEach(row => {
			const key = row.getAttribute('data-key');
			const input = row.querySelector('input[type=checkbox]');
			input.addEventListener('change', () => {
				if (key === 'wireframe') editor.setWireframe(input.checked);
				else if (key === 'shadow') editor.setShadow(input.checked);
				else if (key === 'ground') editor.setGround(input.checked);
				else if (key === 'grid') editor.setGrid(input.checked);
			});
		});
	}
	function toggleRenderPanel(show) {
		if (!renderPanel) return;
		const next = show === undefined ? renderPanel.hasAttribute('hidden') : show;
		if (next) { toggleLightPanel(false); toggleSnapPanel(false); buildRenderPanel(); renderPanel.removeAttribute('hidden'); }
		else renderPanel.setAttribute('hidden', '');
		if (btnRender) btnRender.classList.toggle('active', next);
	}
	if (btnRender) btnRender.addEventListener('click', (e) => { e.stopPropagation(); toggleRenderPanel(); });
	// the tris badge is a shortcut into the same 显示 panel
	if (trisBadge) trisBadge.addEventListener('click', (e) => { e.stopPropagation(); toggleRenderPanel(); });
	root.addEventListener('click', (e) => {
		if (!renderPanel || renderPanel.hasAttribute('hidden')) return;
		if (renderPanel.contains(e.target) || btnRender?.contains(e.target) || trisBadge?.contains(e.target)) return;
		toggleRenderPanel(false);
	});

	// undo / redo drive CodeMirror's built-in history; the change handler then
	// reruns the model + refreshes button state.
	if (btnUndo) btnUndo.addEventListener('click', () => { if (cm) { cm.undo(); cm.focus(); updateHistoryButtons(); } });
	if (btnRedo) btnRedo.addEventListener('click', () => { if (cm) { cm.redo(); cm.focus(); updateHistoryButtons(); } });

	if (btnReset) btnReset.addEventListener('click', () => { if (editor.resetParams()) { setCodeValue(editor.getCurrentSource()); renderParams(); } });
	if (btnSave) btnSave.addEventListener('click', () => {
		editor.commitParams();
		// Slider edits don't touch undo history; clicking Save folds the net change
		// (since the last save / snippet load) into a single undoable history entry.
		commitHistoryFromBaseline();
		renderParams();
		const t = btnSave.textContent; btnSave.textContent = '✓ 已写回'; setTimeout(() => { btnSave.textContent = t; }, 1200);
	});

	// ---- public API ----
	return {
		root,
		editor,
		getCurrentSource: () => editor.getCurrentSource(),
		// 当前在 3D 视图里选中的部件 → 它的源码块（标签 + 1-based 行号区间 + 代码文本）。
		// 用于把「选中的部件 / 代码行」作为上下文附加到 AI 对话里（类比编辑器附加选区）。
		// 没有选中部件时返回 null。
		getSelection() {
			if (!picked || !lastRange) return null;
			const [a, b] = lastRange;
			const srcLines = editor.getCurrentSource().split('\n');
			return {
				label: picked.displayLabel || '',
				line: picked.line || a,
				range: [a, b],
				code: srcLines.slice(a - 1, b).join('\n'),
			};
		},
		setSource(src, o = {}) {
			picked = null;
			clearTimeout(editTimer);
			editor.setSource(src);
			if (o.filename && q('file')) q('file').textContent = o.filename;
			const e2 = editor.getError();
			foot.innerHTML = e2
				? `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>${escapeHtml(e2.message)}</span></div>`
				: '<div class="row1"><span class="pick">picking</span><span>点击 3D 部件 → 定位代码 + 抓取相关参数。</span></div>';
			setCodeValue(editor.getCurrentSource());
			// loading a new snippet starts a fresh edit history (no undo across snippets)
			savedBaseline = editor.getCurrentSource();
			if (cm) { cm.clearHistory(); updateHistoryButtons(); }
			clearHighlight();
			renderParams();
		},
		setFilename(name) { if (q('file')) q('file').textContent = name; },
		resize: () => { editor.resize(); if (cm) cm.refresh(); },
		destroy() {
			clearTimeout(editTimer);
			try { editor.destroy(); } catch (_) {}
			cm = null;
			root.remove();
		},
	};
}
