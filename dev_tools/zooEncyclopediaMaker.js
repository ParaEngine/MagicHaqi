// Zoo Encyclopedia Maker — 动物园图鉴制作端（给动物园工作人员用）
// 数据文件：famous-planets/<zooId>_encyclopedia.json
// 保存：MagicHaqi workspace（PersonalPageStore），回退本地 JSON 只读 + 下载导出。
const WORKSPACE = 'MagicHaqi';
const PLANET_DIR = 'famous-planets';
const CDN_FOLDER = 'maisi/magichaqi/zoo';
const SAVED_CDN_CONFIG_STORAGE_KEY = 'keepwork_upload_cdn_config';
const CDN_DEFAULT_BUCKET = 'haqi';
const CDN_DEFAULT_DOMAIN = 'https://cdn.keepwork.com';
const CDN_DEFAULT_UPLOAD_HOST = 'https://up-z2.qiniup.com';
const SETTINGS_STORAGE_KEY = 'MagicHaqi.ZooEncyclopediaMaker.settings';

const $ = (id) => document.getElementById(id);
const state = {
    sdk: null,
    zooId: 'shenzhen_zoo',
    data: { version: 1, zoo: defaultZoo(), animals: [] },
    selectedId: '',
    lastChatModel: '',
    workspaceViewer: null,
};

function defaultZoo() {
    return {
        id: 'shenzhen_zoo',
        name: { zh: '深圳动物园', en: 'Shenzhen Zoo' },
        logoUrl: '',
        guide: { name: { zh: '胖虎导游', en: 'Guide Tiger' }, emoji: '🐯', avatarUrl: '', welcome: { zh: '', en: '' } },
    };
}

function defaultAnimal(id = 'new_animal') {
    return {
        id,
        name: { zh: '新动物', en: 'New Animal' },
        emoji: '🐾',
        photos: [],
        soundUrl: '',
        videoUrl: '',
        facts: {
            habitat: { zh: '', en: '' }, diet: { zh: '', en: '' }, lifespan: { zh: '', en: '' },
            size: { zh: '', en: '' }, protection: { zh: '', en: '' },
        },
        funFacts: [],
        intro: { kid: { zh: '', en: '' }, junior: { zh: '', en: '' } },
        quiz: [],
        guideTask: { zh: '', en: '' },
        famousPetId: '',
        locked: false,
    };
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function safeId(value, fallback = '') {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || fallback;
}

function setStatus(el, text, kind = '') {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', kind === 'ok');
    el.classList.toggle('error', kind === 'error');
}

function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
    await navigator.clipboard.writeText(text);
}

// ---------- SDK 加载（与 FamousPlanetGenerator 同模式） ----------
const SDK_CDN_URL = 'https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=20260619a';
const sdkLoadTimeoutMs = 8000;

function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        let timer = null;
        const finish = (callback, value) => { clearTimeout(timer); callback(value); };
        const existing = [...document.scripts].find(script => script.src === src);
        if (existing) {
            timer = setTimeout(() => reject(new Error(`SDK script timed out: ${src}`)), sdkLoadTimeoutMs);
            existing.addEventListener('load', () => finish(resolve), { once: true });
            existing.addEventListener('error', () => finish(reject, new Error(`SDK script failed: ${src}`)), { once: true });
            if (window.keepwork || window.KeepworkSDK) finish(resolve);
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => finish(resolve);
        script.onerror = () => finish(reject, new Error(`SDK script failed: ${src}`));
        timer = setTimeout(() => { script.remove(); reject(new Error(`SDK script timed out: ${src}`)); }, sdkLoadTimeoutMs);
        document.head.appendChild(script);
    });
}

function importRuntimeModule(src) {
    return new Function('src', 'return import(src)')(src);
}

function shouldLoadSdkAsModule(src) {
    return /(^|\/)index\.(?:ts|mjs|js)(?:[?#].*)?$/.test(src);
}

function normalizeKeepworkSdk() {
    if (!window.keepwork && window.KeepworkSDK) window.keepwork = new window.KeepworkSDK();
    return window.keepwork || null;
}

function getSdkCandidates() {
    const params = new URLSearchParams(window.location.search);
    const explicitSdk = params.get('sdk');
    const hostname = window.location.hostname;
    const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const localCandidates = ['http://127.0.0.1:5001/index.ts'];
    const deployedCandidates = [SDK_CDN_URL];
    return [explicitSdk, ...(isLocalHost || window.location.protocol === 'file:' ? localCandidates : []), ...deployedCandidates, ...(isLocalHost || window.location.protocol === 'file:' ? [] : localCandidates)].filter(Boolean);
}

async function ensureKeepworkSDK() {
    const existingSdk = normalizeKeepworkSdk();
    if (existingSdk) return existingSdk;
    let lastError = null;
    for (const url of getSdkCandidates()) {
        try {
            if (shouldLoadSdkAsModule(url)) await withTimeout(importRuntimeModule(url), sdkLoadTimeoutMs, `SDK module ${url}`);
            else await loadScript(url);
            const sdk = normalizeKeepworkSdk();
            if (sdk) return sdk;
        } catch (e) { lastError = e; }
    }
    if (lastError) throw lastError;
    return null;
}

// ---------- Workspace IO ----------
function getWorkspaceStore() {
    const sdk = state.sdk || window.keepwork;
    if (!sdk?.personalPageStore) throw new Error('PersonalPageStore 不可用');
    return typeof sdk.personalPageStore.withWorkspace === 'function'
        ? sdk.personalPageStore.withWorkspace(WORKSPACE)
        : sdk.personalPageStore;
}

async function readWorkspaceFile(path) {
    const store = getWorkspaceStore();
    try { return await store.readFile(path, 1, 99999) || ''; }
    catch (_) { return await store.readFile(path) || ''; }
}

async function writeWorkspaceFile(path, content) {
    await getWorkspaceStore().createFile(path, content == null ? '' : String(content));
}

async function readLocalJson(url, fallback) {
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return fallback;
        return await res.json();
    } catch (_) { return fallback; }
}

function encyclopediaPath(zooId = state.zooId) {
    return `${PLANET_DIR}/${safeId(zooId, 'zoo')}_encyclopedia.json`;
}

function readLocalSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}') || {}; }
    catch (_) { return {}; }
}

function saveLocalSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
            lastChatModel: state.lastChatModel || '',
            zooId: state.zooId || '',
            updatedAt: new Date().toISOString(),
        }));
    } catch (_) {}
}

// ---------- CDN 上传（与 ShopItemGenerator 共用 qiniu.yaml 配置） ----------
function parseSimpleYaml(text) {
    const result = {};
    String(text || '').split(/\r?\n/).forEach(line => {
        const clean = line.replace(/#.*$/, '').trim();
        const match = clean.match(/^([\w.-]+)\s*:\s*(.*)$/);
        if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
    });
    return result;
}

function saveCdnConfig(config, sourceLabel) {
    try { localStorage.setItem(SAVED_CDN_CONFIG_STORAGE_KEY, JSON.stringify({ config, configSource: sourceLabel || 'ZooEncyclopediaMaker', savedAt: Date.now() })); }
    catch (_) {}
}

function getCdnConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(SAVED_CDN_CONFIG_STORAGE_KEY) || 'null');
        const source = saved?.config || saved?.qiniu || saved;
        if (!source?.accessKey || !source?.secretKey) return null;
        return {
            accessKey: source.accessKey,
            secretKey: source.secretKey,
            bucketName: source.bucketName || CDN_DEFAULT_BUCKET,
            publicDomain: (source.publicDomain || CDN_DEFAULT_DOMAIN).replace(/\/+$/, ''),
            uploadHost: (source.uploadHost || CDN_DEFAULT_UPLOAD_HOST).replace(/\/+$/, ''),
            sourceLabel: saved?.configSource || 'localStorage',
        };
    } catch (_) { return null; }
}

function updateCdnStatus() {
    const config = getCdnConfig();
    if ($('cdnStatus')) $('cdnStatus').textContent = config
        ? `CDN folder: ${CDN_FOLDER} · ${config.bucketName} · ${config.sourceLabel}`
        : `CDN folder: ${CDN_FOLDER} · 未加载 qiniu.yaml 时使用 Keepwork 临时 CDN`;
}

function applyCdnConfigFromText(text, sourceLabel) {
    const parsed = parseSimpleYaml(text);
    const source = parsed.qiniu || parsed;
    if (!source.accessKey || !source.secretKey) {
        setStatus($('runStatus'), 'CDN 配置缺少 accessKey 或 secretKey。', 'error');
        return false;
    }
    saveCdnConfig({
        accessKey: source.accessKey,
        secretKey: source.secretKey,
        bucketName: source.bucketName || CDN_DEFAULT_BUCKET,
        publicDomain: (source.publicDomain || CDN_DEFAULT_DOMAIN).replace(/\/+$/, ''),
        uploadHost: (source.uploadHost || CDN_DEFAULT_UPLOAD_HOST).replace(/\/+$/, ''),
    }, sourceLabel || 'qiniu.yaml');
    updateCdnStatus();
    setStatus($('runStatus'), `CDN 配置已加载：${sourceLabel || 'qiniu.yaml'}`, 'ok');
    return true;
}

function openCdnConfigDialog() {
    $('cdnConfigOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'cdnConfigOverlay';
    overlay.innerHTML = `<div class="modal-window" role="dialog" aria-modal="true" aria-label="CDN Settings">
        <div class="modal-titlebar"><strong>上传设置</strong><button type="button" id="closeCdnConfig">关闭</button></div>
        <div class="modal-body">
            <div class="hint">选择 qiniu.yaml 文件，或直接粘贴 YAML 内容。配置保存到本浏览器，并和其它生成器共用。</div>
            <div class="hint">当前上传目录：${CDN_FOLDER}</div>
            <div class="toolbar"><button id="btnDialogPickCdnConfig" type="button">选择 qiniu.yaml 文件</button></div>
            <textarea id="cdnConfigText" rows="6" spellcheck="false" placeholder="accessKey: xxx&#10;secretKey: xxx&#10;bucketName: haqi&#10;publicDomain: https://cdn.keepwork.com&#10;uploadHost: https://up-z2.qiniup.com"></textarea>
            <div class="toolbar" style="justify-content:flex-end"><button id="btnCancelCdnConfig" type="button">取消</button><button id="btnApplyCdnConfig" class="primary" type="button">确认</button></div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    $('closeCdnConfig').onclick = () => overlay.remove();
    $('btnCancelCdnConfig').onclick = () => overlay.remove();
    $('btnDialogPickCdnConfig').onclick = () => {
        const input = $('cdnConfigInput');
        input.onchange = async () => {
            try {
                const file = input.files?.[0];
                if (file && applyCdnConfigFromText(await file.text(), file.name)) overlay.remove();
            } catch (error) { setStatus($('runStatus'), `CDN 配置读取失败：${error?.message || error}`, 'error'); }
            finally { input.value = ''; }
        };
        input.click();
    };
    $('btnApplyCdnConfig').onclick = () => {
        const text = $('cdnConfigText').value.trim();
        if (!text) return setStatus($('runStatus'), 'CDN YAML 为空。', 'error');
        if (applyCdnConfigFromText(text, '手动粘贴')) overlay.remove();
    };
    const config = getCdnConfig();
    if (config) {
        $('cdnConfigText').value = [
            `accessKey: ${config.accessKey}`, `secretKey: ${config.secretKey}`,
            `bucketName: ${config.bucketName}`, `publicDomain: ${config.publicDomain}`,
            `uploadHost: ${config.uploadHost}`,
        ].join('\n');
    }
}

function base64UrlSafe(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let binary = '';
    for (const byteValue of bytes) binary += String.fromCharCode(byteValue);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

async function signCdnUploadToken(config, remoteKey) {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const encodedPolicy = btoa(JSON.stringify({ scope: `${config.bucketName}:${remoteKey}`, deadline })).replace(/\+/g, '-').replace(/\//g, '_');
    const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secretKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(encodedPolicy));
    return `${config.accessKey}:${base64UrlSafe(signature)}:${encodedPolicy}`;
}

async function uploadBlobToCdn(blob, fileName) {
    const config = getCdnConfig();
    if (config) {
        const remoteKey = `${CDN_FOLDER}/${fileName}`;
        const token = await signCdnUploadToken(config, remoteKey);
        const form = new FormData();
        form.append('token', token);
        form.append('key', remoteKey);
        form.append('file', blob, fileName);
        const response = await fetch(config.uploadHost, { method: 'POST', body: form });
        if (!response.ok) throw new Error(`CDN 上传失败：${response.status} ${await response.text()}`);
        const result = await response.json().catch(() => ({}));
        return `${config.publicDomain}/${result.key || remoteKey}`;
    }
    // 回退：Keepwork 临时 CDN
    const sdk = state.sdk || window.keepwork;
    if (!sdk?.cloudDrive?.uploadTempFile) throw new Error('未配置 qiniu.yaml，且 Keepwork CloudDrive 临时上传不可用');
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    const result = await sdk.cloudDrive.uploadTempFile(file, { filename: fileName, expire: 180 });
    if (result?.url && !String(result.url).startsWith('data:')) return result.url;
    throw new Error('CloudDrive uploadTempFile 没有返回有效 URL');
}

// 照片压缩成 WebP（最长边 1280）再上传
async function compressImageToWebp(file, maxEdge = 1280, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('图片加载失败'));
            image.src = url;
        });
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('当前浏览器不支持 WebP 导出')), 'image/webp', quality);
        });
    } finally { URL.revokeObjectURL(url); }
}

function cdnFileName(kind, extension) {
    const id = safeId($('animalId')?.value || 'animal', 'animal');
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${safeId(state.zooId, 'zoo')}_${id}_${kind}_${stamp}.${extension}`;
}

// ---------- 数据 normalize ----------
function biText(raw) {
    if (typeof raw === 'string') return { zh: raw, en: '' };
    return { zh: String(raw?.zh || ''), en: String(raw?.en || '') };
}

function normalizeAnimal(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const base = defaultAnimal(safeId(raw.id, `animal_${index + 1}`));
    const facts = raw.facts && typeof raw.facts === 'object' ? raw.facts : {};
    return {
        ...base,
        id: base.id,
        name: biText(raw.name),
        emoji: String(raw.emoji || '🐾'),
        photos: (Array.isArray(raw.photos) ? raw.photos : []).map(p => String(p || '').trim()).filter(Boolean).slice(0, 9),
        soundUrl: String(raw.soundUrl || '').trim(),
        videoUrl: String(raw.videoUrl || '').trim(),
        facts: {
            habitat: biText(facts.habitat), diet: biText(facts.diet), lifespan: biText(facts.lifespan),
            size: biText(facts.size), protection: biText(facts.protection),
        },
        funFacts: (Array.isArray(raw.funFacts) ? raw.funFacts : []).map(biText).filter(f => f.zh || f.en).slice(0, 8),
        intro: { kid: biText(raw.intro?.kid), junior: biText(raw.intro?.junior) },
        quiz: normalizeQuiz(raw.quiz),
        guideTask: biText(raw.guideTask),
        famousPetId: String(raw.famousPetId || '').trim(),
        locked: !!raw.locked,
    };
}

function normalizeQuiz(raw) {
    return (Array.isArray(raw) ? raw : []).map(q => {
        if (!q || typeof q !== 'object') return null;
        const options = (Array.isArray(q.options) ? q.options : []).map(biText).filter(o => o.zh || o.en);
        if (!options.length) return null;
        return { q: biText(q.q), options, answer: Math.max(0, Math.min(options.length - 1, Number(q.answer) || 0)) };
    }).filter(Boolean).slice(0, 10);
}

function normalizeData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const zooRaw = data.zoo && typeof data.zoo === 'object' ? data.zoo : {};
    return {
        version: 1,
        zoo: {
            id: safeId(zooRaw.id || state.zooId, 'zoo'),
            name: biText(zooRaw.name),
            logoUrl: String(zooRaw.logoUrl || ''),
            guide: {
                name: biText(zooRaw.guide?.name),
                emoji: String(zooRaw.guide?.emoji || '🐯'),
                avatarUrl: String(zooRaw.guide?.avatarUrl || ''),
                welcome: biText(zooRaw.guide?.welcome),
            },
        },
        animals: (Array.isArray(data.animals) ? data.animals : []).map(normalizeAnimal).filter(Boolean),
    };
}

// ---------- 列表渲染 ----------
function selectedAnimal() {
    return state.data.animals.find(a => a.id === state.selectedId) || null;
}

function renderRecords() {
    const keyword = String($('recordSearch')?.value || '').trim().toLowerCase();
    const list = $('recordList');
    const records = state.data.animals.filter(animal => {
        if (!keyword) return true;
        return [animal.id, animal.name.zh, animal.name.en].some(text => String(text || '').toLowerCase().includes(keyword));
    });
    $('recordCount').textContent = `${state.data.animals.length} 只动物`;
    list.innerHTML = records.map(animal => {
        const photo = animal.photos[0];
        const visual = photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">` : escapeHtml(animal.emoji || '🐾');
        return `<div class="record-item ${animal.id === state.selectedId ? 'active' : ''}" data-id="${escapeHtml(animal.id)}">
            <span class="record-visual">${visual}</span>
            <button class="record-main" type="button" data-pick="${escapeHtml(animal.id)}">
                <span class="record-title">${escapeHtml(animal.name.zh || animal.id)}</span>
                <span class="record-meta">${escapeHtml(animal.id)} · ${escapeHtml(animal.name.en || '')} · ${animal.quiz.length}题 · ${animal.famousPetId ? '🐾' + escapeHtml(animal.famousPetId) : '未配宠物'}</span>
            </button>
            <span class="record-actions"><button type="button" data-del="${escapeHtml(animal.id)}">删</button></span>
        </div>`;
    }).join('') || '<div class="hint" style="padding:12px">暂无动物，点击「新建动物」开始。</div>';
    list.querySelectorAll('[data-pick]').forEach(btn => {
        btn.onclick = () => { applyFormToSelected(); state.selectedId = btn.dataset.pick; fillForm(); renderRecords(); };
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = () => deleteAnimal(btn.dataset.del);
    });
}

// ---------- 表单 ↔ 数据 ----------
function fillZooForm() {
    const zoo = state.data.zoo;
    $('zooNameZh').value = zoo.name.zh;
    $('zooNameEn').value = zoo.name.en;
    $('guideEmoji').value = zoo.guide.emoji;
    $('guideWelcomeZh').value = zoo.guide.welcome.zh;
    $('guideWelcomeEn').value = zoo.guide.welcome.en;
}

function collectZooForm() {
    const zoo = state.data.zoo;
    zoo.id = safeId(state.zooId, 'zoo');
    zoo.name.zh = $('zooNameZh').value.trim();
    zoo.name.en = $('zooNameEn').value.trim();
    zoo.guide.emoji = $('guideEmoji').value.trim() || '🐯';
    zoo.guide.welcome.zh = $('guideWelcomeZh').value.trim();
    zoo.guide.welcome.en = $('guideWelcomeEn').value.trim();
}

const FACT_KEYS = ['habitat', 'diet', 'lifespan', 'size', 'protection'];
const FACT_IDS = { habitat: 'Habitat', diet: 'Diet', lifespan: 'Lifespan', size: 'Size', protection: 'Protection' };

function fillForm() {
    const animal = selectedAnimal() || defaultAnimal();
    $('editorTitle').textContent = `动物编辑器 · ${animal.name.zh || animal.id}`;
    $('animalId').value = animal.id;
    $('animalEmoji').value = animal.emoji;
    $('animalNameZh').value = animal.name.zh;
    $('animalNameEn').value = animal.name.en;
    $('animalFamousPetId').value = animal.famousPetId;
    $('animalGuideTaskZh').value = animal.guideTask.zh;
    $('animalGuideTaskEn').value = animal.guideTask.en;
    $('animalSoundUrl').value = animal.soundUrl;
    $('animalVideoUrl').value = animal.videoUrl;
    FACT_KEYS.forEach(key => {
        $(`fact${FACT_IDS[key]}Zh`).value = animal.facts[key].zh;
        $(`fact${FACT_IDS[key]}En`).value = animal.facts[key].en;
    });
    $('introKidZh').value = animal.intro.kid.zh;
    $('introKidEn').value = animal.intro.kid.en;
    $('introJuniorZh').value = animal.intro.junior.zh;
    $('introJuniorEn').value = animal.intro.junior.en;
    $('funFactsText').value = animal.funFacts.map(f => `${f.zh} | ${f.en}`).join('\n');
    $('quizJson').value = animal.quiz.length ? JSON.stringify(animal.quiz, null, 2) : '';
    renderPhotoGrid(animal);
    updateJsonOutput();
}

function collectForm() {
    const animal = selectedAnimal();
    if (!animal) return null;
    const newId = safeId($('animalId').value, animal.id);
    animal.id = newId;
    animal.emoji = $('animalEmoji').value.trim() || '🐾';
    animal.name.zh = $('animalNameZh').value.trim();
    animal.name.en = $('animalNameEn').value.trim();
    animal.famousPetId = $('animalFamousPetId').value.trim();
    animal.guideTask.zh = $('animalGuideTaskZh').value.trim();
    animal.guideTask.en = $('animalGuideTaskEn').value.trim();
    animal.soundUrl = $('animalSoundUrl').value.trim();
    animal.videoUrl = $('animalVideoUrl').value.trim();
    FACT_KEYS.forEach(key => {
        animal.facts[key].zh = $(`fact${FACT_IDS[key]}Zh`).value.trim();
        animal.facts[key].en = $(`fact${FACT_IDS[key]}En`).value.trim();
    });
    animal.intro.kid.zh = $('introKidZh').value.trim();
    animal.intro.kid.en = $('introKidEn').value.trim();
    animal.intro.junior.zh = $('introJuniorZh').value.trim();
    animal.intro.junior.en = $('introJuniorEn').value.trim();
    animal.funFacts = $('funFactsText').value.split(/\r?\n/).map(line => {
        const [zh = '', en = ''] = line.split('|').map(part => part.trim());
        return { zh, en };
    }).filter(f => f.zh || f.en).slice(0, 8);
    try {
        const quizText = $('quizJson').value.trim();
        animal.quiz = quizText ? normalizeQuiz(JSON.parse(quizText)) : [];
        $('quizJson').classList.remove('error');
    } catch (e) {
        setStatus($('runStatus'), `quiz JSON 解析失败，保留原值：${e?.message || e}`, 'error');
    }
    state.selectedId = newId;
    return animal;
}

function applyFormToSelected() {
    if (selectedAnimal()) collectForm();
    collectZooForm();
}

// ---------- 照片 / 媒体 ----------
function renderPhotoGrid(animal) {
    const grid = $('photoGrid');
    grid.innerHTML = (animal.photos || []).map((url, index) => `
        <div class="photo-cell">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
            <button type="button" data-photo-del="${index}">删</button>
        </div>`).join('') || '<div class="hint">还没有照片。建议至少上传 1 张真实照片。</div>';
    grid.querySelectorAll('[data-photo-del]').forEach(btn => {
        btn.onclick = () => {
            const animalNow = selectedAnimal();
            if (!animalNow) return;
            animalNow.photos.splice(Number(btn.dataset.photoDel), 1);
            renderPhotoGrid(animalNow);
            updateJsonOutput();
        };
    });
}

async function handlePhotoUpload(files) {
    const animal = selectedAnimal();
    if (!animal) return setStatus($('runStatus'), '请先选择或新建动物。', 'error');
    for (const file of files) {
        try {
            setStatus($('runStatus'), `压缩并上传 ${file.name}...`);
            const blob = await compressImageToWebp(file);
            const url = await uploadBlobToCdn(blob, cdnFileName('photo', 'webp'));
            animal.photos.push(url);
            setStatus($('runStatus'), `照片已上传：${url}`, 'ok');
        } catch (e) {
            setStatus($('runStatus'), `照片上传失败：${e?.message || e}`, 'error');
        }
    }
    renderPhotoGrid(animal);
    renderRecords();
    updateJsonOutput();
}

async function handleMediaUpload(file, kind) {
    try {
        setStatus($('runStatus'), `上传 ${file.name}...`);
        const extension = (file.name.split('.').pop() || (kind === 'sound' ? 'mp3' : 'mp4')).toLowerCase();
        const url = await uploadBlobToCdn(file, cdnFileName(kind, extension));
        $(kind === 'sound' ? 'animalSoundUrl' : 'animalVideoUrl').value = url;
        setStatus($('runStatus'), `${kind === 'sound' ? '叫声' : '视频'}已上传：${url}`, 'ok');
        updateJsonOutput();
    } catch (e) {
        setStatus($('runStatus'), `上传失败：${e?.message || e}`, 'error');
    }
}

// ---------- JSON 输出 / 校验 ----------
function getDataJsonText() {
    return JSON.stringify(normalizeData(state.data), null, 4) + '\n';
}

function validateData(data) {
    const problems = [];
    if (!data.animals.length) problems.push('没有任何动物条目');
    const ids = new Set();
    data.animals.forEach(animal => {
        if (ids.has(animal.id)) problems.push(`动物 id 重复：${animal.id}`);
        ids.add(animal.id);
        if (!animal.name.zh) problems.push(`${animal.id}：缺少中文名`);
        if (!animal.intro.kid.zh && !animal.intro.junior.zh) problems.push(`${animal.id}：缺少分龄介绍`);
        if (!animal.famousPetId) problems.push(`${animal.id}：未配置领养宠物 famousPetId`);
        if (!animal.quiz.length) problems.push(`${animal.id}：没有答题（玩家将直接解锁领养）`);
    });
    return problems;
}

function updateJsonOutput() {
    $('zooJson').value = getDataJsonText();
}

// ---------- 加载 / 保存 ----------
async function loadData() {
    state.zooId = safeId($('zooFileId').value, 'shenzhen_zoo');
    $('zooFileId').value = state.zooId;
    saveLocalSettings();
    const path = encyclopediaPath();
    let payload = null;
    let source = '';
    if ((state.sdk || window.keepwork)?.personalPageStore) {
        try {
            const text = await readWorkspaceFile(path);
            if (text && text.trim()) { payload = JSON.parse(text); source = 'workspace'; }
        } catch (_) {}
    }
    if (!payload) {
        payload = await readLocalJson(`../${path}`, null);
        if (payload) source = '本地 JSON';
    }
    if (!payload) {
        setStatus($('runStatus'), `${path} 不存在，已建立空白图鉴。`, 'ok');
        state.data = { version: 1, zoo: { ...defaultZoo(), id: state.zooId }, animals: [] };
    } else {
        state.data = normalizeData(payload);
        setStatus($('runStatus'), `已加载 ${path}（${source}）：${state.data.animals.length} 只动物。`, 'ok');
    }
    state.selectedId = state.data.animals[0]?.id || '';
    fillZooForm();
    fillForm();
    renderRecords();
}

async function saveData() {
    applyFormToSelected();
    const data = normalizeData(state.data);
    const problems = validateData(data);
    const path = encyclopediaPath();
    const content = JSON.stringify(data, null, 4) + '\n';
    if (!(state.sdk || window.keepwork)?.personalPageStore) {
        downloadText(`${safeId(state.zooId, 'zoo')}_encyclopedia.json`, content);
        setStatus($('runStatus'), 'SDK 不可用，已改为下载 JSON。请手动放到 famous-planets/ 下。', 'error');
        return;
    }
    setStatus($('runStatus'), `保存 ${path}...`);
    await writeWorkspaceFile(path, content);
    const savedText = await readWorkspaceFile(path);
    const saved = JSON.parse(savedText || '{}');
    if (!Array.isArray(saved?.animals)) throw new Error(`${path} 写入后没有读取到 animals 数组`);
    state.data = normalizeData(saved);
    renderRecords();
    updateJsonOutput();
    setStatus($('runStatus'), `已保存 ${path}（${state.data.animals.length} 只动物）。${problems.length ? '\n校验提示：\n- ' + problems.join('\n- ') : ''}`, problems.length ? '' : 'ok');
}

// ---------- 新建 / 删除 ----------
function uniqueAnimalId(base) {
    const used = new Set(state.data.animals.map(a => a.id));
    const cleanBase = safeId(base || `animal_${Date.now()}`, 'animal');
    if (!used.has(cleanBase)) return cleanBase;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${cleanBase}_${index}`;
        if (!used.has(candidate)) return candidate;
    }
    return `${cleanBase}_${Date.now()}`;
}

function newAnimal() {
    applyFormToSelected();
    const animal = defaultAnimal(uniqueAnimalId('new_animal'));
    state.data.animals.push(animal);
    state.selectedId = animal.id;
    fillForm();
    renderRecords();
}

function deleteAnimal(id) {
    const index = state.data.animals.findIndex(a => a.id === id);
    if (index < 0) return;
    if (!window.confirm(`确定删除动物「${state.data.animals[index].name.zh || id}」？保存后生效。`)) return;
    state.data.animals.splice(index, 1);
    if (state.selectedId === id) state.selectedId = state.data.animals[0]?.id || '';
    fillForm();
    renderRecords();
    updateJsonOutput();
}

function newZoo() {
    if (!window.confirm('新建空白图鉴会清空当前编辑内容（不影响已保存文件），继续？')) return;
    state.zooId = safeId($('zooFileId').value, 'new_zoo');
    state.data = { version: 1, zoo: { ...defaultZoo(), id: state.zooId, name: { zh: '', en: '' } }, animals: [] };
    state.selectedId = '';
    fillZooForm();
    fillForm();
    renderRecords();
    setStatus($('runStatus'), `已新建空白图鉴：${encyclopediaPath()}`, 'ok');
}

// ---------- AI：适龄化双语改写 ----------
function extractAssistantText(result) {
    if (typeof result === 'string') return result;
    return result?.result
        || result?.choices?.[0]?.message?.content
        || result?.data?.choices?.[0]?.message?.content
        || result?.text
        || result?.data?.result
        || '';
}

function extractJsonObject(text) {
    const value = String(text || '').trim();
    if (!value) throw new Error('LLM 未返回内容');
    try { return JSON.parse(value); } catch (_) {}
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error('LLM 返回不是 JSON');
}

function setAiStream(text = '', reasoning = '') {
    const preview = $('aiStream');
    preview.style.display = 'block';
    preview.textContent = [reasoning ? `Thinking:\n${reasoning}` : '', text || '等待模型输出...'].filter(Boolean).join('\n\n');
    preview.scrollTop = preview.scrollHeight;
}

async function callChatModel(prompt, onStreamUpdate) {
    const sdk = state.sdk || window.keepwork;
    if (!sdk?.aiGenerators?.chat && !sdk?.aiChat?.chat) throw new Error('当前 SDK 不支持文本模型调用');
    const model = $('chatModel').value;
    if (!model) throw new Error('请先在本地 API Key 设置中配置 Chat 模型');
    const messages = [{ role: 'user', content: prompt }];
    let reasoningText = '';
    const handleMessage = (fullText, payload) => {
        const text = typeof fullText === 'string' ? fullText : extractAssistantText(payload);
        reasoningText = payload?.reasoning_content || payload?.reasoning || reasoningText;
        onStreamUpdate?.({ text, reasoning: reasoningText });
    };
    const handleReasoning = (fullReasoning) => {
        reasoningText = String(fullReasoning || reasoningText || '');
        onStreamUpdate?.({ reasoning: reasoningText });
    };
    if (sdk?.aiGenerators?.chat) {
        try {
            return await sdk.aiGenerators.chat({ model, stream: true, temperature: 0.55, responseFormat: 'json_object', messages, onMessage: handleMessage, onReasoning: handleReasoning });
        } catch (error) {
            if (!/response.?format|json_object/i.test(error?.message || String(error))) throw error;
            return await sdk.aiGenerators.chat({ model, stream: true, temperature: 0.55, messages, onMessage: handleMessage, onReasoning: handleReasoning });
        }
    }
    return await sdk.aiChat.chat({ model, stream: true, temperature: 0.55, messages, onMessage: handleMessage, onReasoning: handleReasoning });
}

function buildRewritePrompt(material, animal) {
    const sample = {
        name: { zh: '华南虎', en: 'South China Tiger' },
        emoji: '🐯',
        facts: {
            habitat: { zh: '...', en: '...' }, diet: { zh: '...', en: '...' }, lifespan: { zh: '...', en: '...' },
            size: { zh: '...', en: '...' }, protection: { zh: '...', en: '...' },
        },
        funFacts: [{ zh: '...', en: '...' }],
        intro: { kid: { zh: '...', en: '...' }, junior: { zh: '...', en: '...' } },
        quiz: [{ q: { zh: '...', en: '...' }, options: [{ zh: 'A', en: 'A' }, { zh: 'B', en: 'B' }, { zh: 'C', en: 'C' }], answer: 0 }],
        guideTask: { zh: '...', en: '...' },
    };
    return [
        '你是儿童动物科普内容编辑。根据下面动物园提供的原始资料，生成 MagicHaqi 动物图鉴 JSON。只返回合法 JSON，不要输出 Markdown。',
        `输出结构示例：${JSON.stringify(sample)}`,
        '要求：',
        '1. 所有字段都是 {zh, en} 双语对象；英文要地道、儿童友好。',
        '2. intro.kid 面向 3-6 岁：短句、口语、拟声、不超过 60 个中文字。',
        '3. intro.junior 面向 7-12 岁：基础科普 + 保护意识，80-120 个中文字。',
        '4. funFacts 提供 3 条有趣冷知识。',
        '5. quiz 提供 3 道单选题，每题 3 个选项，answer 是正确选项下标；题目要能从资料/介绍里找到答案。',
        '6. guideTask 是「胖虎导游」给孩子的现场观察小任务，一句话。',
        '7. 科学事实必须严格来自原始资料；资料里没有的内容不要编造，宁可留空字符串。',
        animal?.name?.zh ? `当前动物：${animal.name.zh}（${animal.name.en || ''}）。` : '',
        '原始资料：',
        material,
    ].filter(Boolean).join('\n');
}

async function runAiRewrite() {
    const material = $('rawMaterial').value.trim();
    if (!material) return setStatus($('runStatus'), '请先粘贴动物园原始资料。', 'error');
    const animal = selectedAnimal();
    if (!animal) return setStatus($('runStatus'), '请先选择或新建动物。', 'error');
    collectForm();
    const btn = $('btnAiRewrite');
    btn.disabled = true;
    try {
        setStatus($('runStatus'), 'AI 正在生成图鉴内容...');
        setAiStream('');
        const result = await callChatModel(buildRewritePrompt(material, animal), ({ text, reasoning }) => setAiStream(text, reasoning));
        const parsed = extractJsonObject(extractAssistantText(result));
        const merged = normalizeAnimal({ ...animal, ...parsed, id: animal.id, photos: animal.photos, soundUrl: animal.soundUrl, videoUrl: animal.videoUrl, famousPetId: animal.famousPetId });
        const index = state.data.animals.findIndex(a => a.id === animal.id);
        if (index >= 0) state.data.animals[index] = merged;
        fillForm();
        renderRecords();
        setStatus($('runStatus'), 'AI 图鉴内容已生成并填入表单，请人工校对后保存。', 'ok');
    } catch (e) {
        setStatus($('runStatus'), `AI 生成失败：${e?.message || e}`, 'error');
    } finally { btn.disabled = false; }
}

// ---------- AI：卡通宠物 Prompt ----------
function buildPetPromptPrompt(animal) {
    return [
        '你是 MagicHaqi 官方宠物设计师。根据这只真实动物，设计一只儿童向卡通宠物，用于 FamousPetGenerator 生成 4x4 sprite sheet。只返回合法 JSON，不要 Markdown。',
        '输出结构：{"wishPrompt": "...", "traits": {"element": "陆地|水系|天空", "species": "...", "color": "...", "eyes": "...", "accessory": "...", "elementalAttribute": "自然|火|冰|生命|暗|雷"}, "suggestedId": "sz_xxx", "suggestedName": "中文昵称"}',
        'wishPrompt 要求：保留真实动物的标志性特征（条纹/斑纹/体型记忆点），但整体软萌圆润、儿童向、透明底、4x4 sprite sheet 角色一致。',
        `真实动物：${animal.name.zh}（${animal.name.en}）。`,
        `档案：${JSON.stringify(animal.facts)}`,
        `介绍：${animal.intro.junior.zh || animal.intro.kid.zh || ''}`,
    ].join('\n');
}

async function runAiPetPrompt() {
    const animal = selectedAnimal();
    if (!animal) return setStatus($('runStatus'), '请先选择动物。', 'error');
    collectForm();
    const btn = $('btnAiPetPrompt');
    btn.disabled = true;
    try {
        setStatus($('runStatus'), 'AI 正在设计卡通宠物...');
        setAiStream('');
        const result = await callChatModel(buildPetPromptPrompt(animal), ({ text, reasoning }) => setAiStream(text, reasoning));
        const parsed = extractJsonObject(extractAssistantText(result));
        $('petPromptOut').value = [
            `# 建议 ID：${parsed.suggestedId || `sz_${animal.id}`}`,
            `# 建议名称：${parsed.suggestedName || animal.name.zh}`,
            `# traits：${JSON.stringify(parsed.traits || {}, null, 2)}`,
            '',
            '# wishPrompt（复制到 FamousPetGenerator）：',
            String(parsed.wishPrompt || ''),
        ].join('\n');
        setStatus($('runStatus'), '宠物 Prompt 已生成。在 FamousPetGenerator 创建宠物后，把宠物 id 填回「领养宠物 ID」。', 'ok');
    } catch (e) {
        setStatus($('runStatus'), `生成失败：${e?.message || e}`, 'error');
    } finally { btn.disabled = false; }
}

// ---------- 登录 / 模型 / Workspace ----------
function getEnabledLocalModels(category) {
    const sdk = state.sdk || window.keepwork;
    return sdk?.localAPIKeySettings?.listModels ? sdk.localAPIKeySettings.listModels(category).filter(model => model.enabled !== false) : [];
}

async function populateChatModelDropdown() {
    const sdk = state.sdk || window.keepwork;
    const select = $('chatModel');
    if (!sdk?.localAPIKeySettings?.listModels) {
        select.innerHTML = '<option value="">等待 SDK 加载...</option>';
        select.disabled = true;
        return;
    }
    await sdk.localAPIKeySettings.load?.();
    const models = getEnabledLocalModels('Chat');
    select.innerHTML = models.length
        ? models.map(model => {
            const value = model.name || model.modelId || '';
            return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
        }).join('')
        : '<option value="">没有本地聊天模型</option>';
    select.disabled = !models.length;
    if (state.lastChatModel && models.some(model => (model.name || model.modelId || '') === state.lastChatModel)) select.value = state.lastChatModel;
    select.onchange = () => { state.lastChatModel = select.value; saveLocalSettings(); };
}

async function refreshLoginState() {
    const sdk = state.sdk || window.keepwork;
    if (!sdk) return;
    let username = sdk.user?.username || sdk.user?.name || '';
    if (sdk.token && !username) {
        try {
            const user = typeof sdk.getUserProfile === 'function' ? await sdk.getUserProfile() : await sdk.getCurrentUser?.();
            username = user?.username || user?.name || '';
        } catch (_) {}
    }
    const loginState = $('loginState');
    loginState.classList.toggle('error', false);
    loginState.classList.toggle('ok', !!sdk.token);
    loginState.innerHTML = sdk.token
        ? `已登录：<button id="btnProfile" class="status-action" type="button">${escapeHtml(username || 'Keepwork 用户')}</button>`
        : '<button id="btnProfile" class="status-action" type="button">未登录</button>。可点击登录。';
    $('btnProfile').onclick = openLoginOrProfile;
}

async function openLoginOrProfile() {
    const sdk = state.sdk || window.keepwork;
    if (!sdk) return;
    if (!sdk.token) {
        if (sdk.loginWindow?.show) sdk.loginWindow.show({ onLogin: refreshLoginState });
        else if (sdk.login) await sdk.login();
        setTimeout(refreshLoginState, 600);
        return;
    }
    if (typeof sdk.showProfileWindow === 'function') {
        const result = await sdk.showProfileWindow();
        if (result?.action === 'logout') await refreshLoginState();
    } else if (sdk.profileWindow?.show) {
        await sdk.profileWindow.show();
    }
    await refreshLoginState();
}

function openWorkspaceViewer() {
    if (typeof window.createWorkspaceViewer !== 'function') {
        return setStatus($('runStatus'), 'WorkspaceViewer 不可用：当前 SDK 未导出 createWorkspaceViewer', 'error');
    }
    try { state.workspaceViewer?.destroy?.(); } catch (_) {}
    $('workspaceOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'workspaceOverlay';
    overlay.innerHTML = `<div class="modal-window" style="width:min(1180px,100%);height:min(780px,calc(100vh - 36px))">
        <div class="modal-titlebar"><strong>WorkspaceViewer · ${WORKSPACE}/${escapeHtml(encyclopediaPath())}</strong><button type="button" id="closeWorkspaceViewer">关闭</button></div>
        <div id="workspaceHost" class="modal-body" style="padding:0"></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    $('closeWorkspaceViewer').onclick = () => overlay.remove();
    state.workspaceViewer = window.createWorkspaceViewer({ container: $('workspaceHost'), sdk: state.sdk || window.keepwork, workspace: WORKSPACE, mountFolder: '', file: encyclopediaPath(), compact: true, hideUserInfo: true });
}

async function initSdk() {
    try {
        state.sdk = await ensureKeepworkSDK();
        if (state.sdk) {
            $('sdkState').textContent = 'SDK ready';
            await refreshLoginState();
            await populateChatModelDropdown();
        } else {
            $('sdkState').textContent = 'local only';
            setStatus($('loginState'), '未加载 SDK，将只读取本地 JSON，保存请用下载导出。', 'error');
        }
    } catch (e) {
        $('sdkState').textContent = 'local only';
        setStatus($('loginState'), `SDK 加载失败：${e?.message || e}\n将只读取本地 JSON，保存请用下载导出。`, 'error');
    }
}

// ---------- 事件绑定 / 启动 ----------
function bindEvents() {
    $('btnReload').onclick = () => loadData().catch(e => setStatus($('runStatus'), `加载失败：${e?.message || e}`, 'error'));
    $('btnNewZoo').onclick = newZoo;
    $('btnNewAnimal').onclick = newAnimal;
    $('recordSearch').addEventListener('input', renderRecords);
    $('btnApplyAnimal').onclick = () => { applyFormToSelected(); fillForm(); renderRecords(); setStatus($('runStatus'), '表单已应用。', 'ok'); };
    $('btnDeleteAnimal').onclick = () => { if (state.selectedId) deleteAnimal(state.selectedId); };
    $('btnSave').onclick = () => saveData().catch(e => setStatus($('runStatus'), `保存失败：${e?.message || e}`, 'error'));
    $('btnSaveTop').onclick = () => saveData().catch(e => setStatus($('runStatus'), `保存失败：${e?.message || e}`, 'error'));
    $('btnCopyJson').onclick = async () => { applyFormToSelected(); updateJsonOutput(); await copyText(getDataJsonText()); setStatus($('runStatus'), '已复制 JSON。', 'ok'); };
    $('btnDownloadJson').onclick = () => { applyFormToSelected(); updateJsonOutput(); downloadText(`${safeId(state.zooId, 'zoo')}_encyclopedia.json`, getDataJsonText()); };
    $('btnAiRewrite').onclick = runAiRewrite;
    $('btnAiPetPrompt').onclick = runAiPetPrompt;
    $('btnCopyPetPrompt').onclick = async () => { await copyText($('petPromptOut').value); setStatus($('runStatus'), '已复制宠物 Prompt。', 'ok'); };
    $('btnCdnConfig').onclick = openCdnConfigDialog;
    $('btnWorkspace').onclick = openWorkspaceViewer;
    $('btnLocalApi').onclick = async () => {
        const settings = (state.sdk || window.keepwork)?.localAPIKeySettings;
        if (!settings?.show) return setStatus($('loginState'), '当前 SDK 不支持本地 API Key 设置。', 'error');
        await settings.load?.();
        settings.show({
            title: '本地 API Key 设置',
            fullscreen: true,
            onSave: async () => { await populateChatModelDropdown(); setStatus($('loginState'), '本地 API Key 设置已保存。', 'ok'); },
        });
    };
    $('btnAddPhoto').onclick = () => {
        const input = $('photoFileInput');
        input.onchange = async () => {
            const files = [...(input.files || [])];
            input.value = '';
            if (files.length) await handlePhotoUpload(files);
        };
        input.click();
    };
    $('btnAddPhotoUrl').onclick = () => {
        const animal = selectedAnimal();
        if (!animal) return setStatus($('runStatus'), '请先选择或新建动物。', 'error');
        const url = window.prompt('粘贴照片 URL（建议 CDN webp）：', '');
        if (!url || !url.trim()) return;
        animal.photos.push(url.trim());
        renderPhotoGrid(animal);
        renderRecords();
        updateJsonOutput();
    };
    $('btnUploadSound').onclick = () => pickMediaFile('audio/*', 'sound');
    $('btnUploadVideo').onclick = () => pickMediaFile('video/*', 'video');
    $('animalId').addEventListener('change', () => { $('animalId').value = safeId($('animalId').value, 'animal'); });
}

function pickMediaFile(accept, kind) {
    const input = $('mediaFileInput');
    input.accept = accept;
    input.onchange = async () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) await handleMediaUpload(file, kind);
    };
    input.click();
}

async function start() {
    const settings = readLocalSettings();
    state.lastChatModel = String(settings.lastChatModel || '').trim();
    if (settings.zooId) { state.zooId = settings.zooId; $('zooFileId').value = settings.zooId; }
    bindEvents();
    updateCdnStatus();
    await initSdk();
    await loadData().catch(e => setStatus($('runStatus'), `加载失败：${e?.message || e}`, 'error'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}
