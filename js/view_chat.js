// 聊天视图：文字 + 付费实时语音（KeepworkSDK DigitalHuman RTC）
import { $, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { chatWithPet, summarizeAndAppendMemory } from './api.js';
import { appendChatLog } from './storage.js';
import { displayPetName } from './dna.js';
import { petArtHtml, setPetMotion } from './pet.js';

// 语音会话在模块级持有，便于离开视图时清理（onClick 创建，destroy on leave）
let dhInstance = null;
let voiceActive = false;

export function renderChat(panel, { pet }, { onBack } = {}) {
    if (!pet) return;
    const isPaid = !!state.isPaid;
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(displayPetName(pet))}</span>
            <button class="btn-secondary" id="mhVoiceBtn" style="padding:4px 10px;font-size:12px">${escapeHtml(t('voiceChat'))}</button>
        </div>
        <div id="mhChatDialog" class="absolute" style="top:52px;left:0;right:0;bottom:64px;overflow:hidden">
            <div id="mhChatPetArt" aria-hidden="true" style="position:absolute;left:50%;bottom:0;width:min(74%,280px);height:min(52vh,280px);transform:translateX(-50%);opacity:1;filter:saturate(1.04) drop-shadow(0 18px 24px rgba(30,64,175,0.22));pointer-events:none;z-index:0;transition:transform .25s ease,filter .25s ease">
                ${petArtHtml(pet, { alt: '', motion: 'idle' })}
            </div>
            <div id="mhChatScroll" class="absolute" style="inset:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;position:absolute;z-index:1">
                <div class="chat-bubble pet">${escapeHtml(t('petGreeting', { name: displayPetName(pet) }))}</div>
            </div>
        </div>
        <div id="mhInputBar" style="position:absolute;left:0;right:0;bottom:0;padding:8px;display:flex;gap:6px;background:var(--topbar-bg);border-top:1px solid var(--border)">
            <input id="mhChatInput" class="modal-input" placeholder="${escapeHtml(t('chatPlaceholder'))}" style="flex:1">
            <button id="mhSendBtn" class="btn-primary" style="padding:8px 18px">${escapeHtml(t('send'))}</button>
        </div>
        <div id="mhVoiceBar" style="display:none;position:absolute;left:0;right:0;bottom:0;padding:8px 12px;align-items:center;gap:10px;background:var(--topbar-bg);border-top:1px solid var(--border)">
            <span id="mhVoiceDot" style="width:10px;height:10px;border-radius:50%;background:var(--accent);flex:0 0 auto;box-shadow:0 0 0 0 rgba(245,158,11,0.6)"></span>
            <span id="mhVoiceStatus" style="flex:1;min-width:0;color:var(--text-primary);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            <button id="mhVoiceEnd" class="btn-secondary" style="padding:6px 14px;font-size:13px">${escapeHtml(t('voiceEnd'))}</button>
        </div>
        <div id="mhDhContainer" style="display:none"></div>`;

    const scroll = $('mhChatScroll');
    function pushBubble(role, text) {
        const div = document.createElement('div');
        div.className = `chat-bubble ${role}`;
        div.textContent = text;
        scroll.appendChild(div);
        scroll.scrollTop = scroll.scrollHeight;
        return div;
    }

    // 实时字幕按 roundId+角色去重，流式更新同一个气泡
    const subtitleBubbles = new Map();
    function upsertSubtitle(key, role, text) {
        let el = subtitleBubbles.get(key);
        if (!el) {
            el = pushBubble(role, text);
            subtitleBubbles.set(key, el);
        } else {
            el.textContent = text;
            scroll.scrollTop = scroll.scrollHeight;
        }
        return el;
    }

    if ($('mhBack')) $('mhBack').onclick = () => {
        teardownVoice();
        onBack?.();
    };

    let busy = false;
    async function send() {
        const input = $('mhChatInput');
        const text = (input.value || '').trim();
        if (!text || busy) return;
        busy = true;
        input.value = '';
        pushBubble('user', text);
        const replyEl = pushBubble('pet', t('petThinking'));
        replyEl.style.opacity = '0.7';
        let full = '';
        try {
            full = await chatWithPet(pet, text, (delta) => {
                if (replyEl.textContent === t('petThinking')) replyEl.textContent = '';
                replyEl.textContent += delta;
                replyEl.style.opacity = '1';
                scroll.scrollTop = scroll.scrollHeight;
            });
            if (!full) {
                replyEl.textContent = t('petConfused');
                full = t('petSilent');
            } else if (replyEl.textContent === t('petThinking')) {
                replyEl.textContent = full;
            }
            replyEl.style.opacity = '1';
            // 异步写入 log + memory，不阻塞 UI
            appendChatLog(pet.id, t('chatSenderOwner'), text).catch(()=>{});
            appendChatLog(pet.id, pet.name, full).catch(()=>{});
            summarizeAndAppendMemory(pet, text, full).catch(()=>{});
        } catch (e) {
            replyEl.textContent = t('chatError', { error: (e?.message || e) });
            replyEl.style.opacity = '1';
        } finally {
            busy = false;
        }
    }

    if ($('mhSendBtn')) $('mhSendBtn').onclick = send;
    if ($('mhChatInput')) $('mhChatInput').onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    // ── 语音控制 UI ──
    function setVoiceStatus(text) {
        const el = $('mhVoiceStatus');
        if (el) el.textContent = text;
    }
    function showVoiceBar(on) {
        if ($('mhInputBar')) $('mhInputBar').style.display = on ? 'none' : 'flex';
        if ($('mhVoiceBar')) $('mhVoiceBar').style.display = on ? 'flex' : 'none';
    }
    // 数字人“说话”时让宠物精灵 squash/stretch 弹跳 + 微微放大发光，停下回到呼吸态
    function setPetSpeaking(on) {
        setPetMotion(pet.id, on ? 'walk' : 'idle');
        const art = $('mhChatPetArt');
        if (art) {
            art.style.transform = on ? 'translateX(-50%) scale(1.06)' : 'translateX(-50%)';
            art.style.filter = on
                ? 'saturate(1.12) brightness(1.06) drop-shadow(0 18px 28px rgba(245,158,11,0.35))'
                : 'saturate(1.04) drop-shadow(0 18px 24px rgba(30,64,175,0.22))';
        }
    }

    // 把一轮定稿对话写入 log + memory，复用文字聊天的记忆管线
    let lastUserUtterance = '';
    function persistVoiceTurn(role, text) {
        const clean = (text || '').trim();
        if (!clean) return;
        if (role === 'user') {
            lastUserUtterance = clean;
            appendChatLog(pet.id, t('chatSenderOwner'), clean).catch(()=>{});
        } else {
            appendChatLog(pet.id, pet.name, clean).catch(()=>{});
            if (lastUserUtterance) {
                summarizeAndAppendMemory(pet, lastUserUtterance, clean).catch(()=>{});
                lastUserUtterance = '';
            }
        }
    }

    async function launchVoice() {
        if (typeof window.DigitalHuman !== 'function') {
            showToast(t('digitalHumanMissing'), 'error');
            return;
        }
        if (!state.sdk?.token) {
            showToast(t('voiceVip'), 'error');
            return;
        }
        teardownVoice();
        voiceActive = true;
        subtitleBubbles.clear();
        showVoiceBar(true);
        setVoiceStatus(t('voiceConnecting'));
        const dot = $('mhVoiceDot');
        if (dot) dot.style.animation = 'mhPulse 1.4s ease-in-out infinite';

        try {
            const { buildPetSystemPrompt } = await import('./api.js');
            const { loadPetMemory } = await import('./storage.js');
            const memoryText = await loadPetMemory(pet.id);
            const systemPrompt = buildPetSystemPrompt(pet, memoryText);

            const dh = new window.DigitalHuman({
                sdk: state.sdk,
                container: $('mhDhContainer'),
            });
            dhInstance = dh;

            // 实时字幕（用户 ASR + 宠物回复）→ 聊天气泡；paragraph=该段定稿
            dh.on('subtitle', ({ text, isUser, roundId, paragraph }) => {
                if (!text) return;
                const key = `${roundId}_${isUser ? 'user' : 'pet'}`;
                upsertSubtitle(key, isUser ? 'user' : 'pet', text);
                if (paragraph) {
                    subtitleBubbles.delete(key);
                    persistVoiceTurn(isUser ? 'user' : 'pet', text);
                }
            });
            // 会话状态 → 状态条 + 宠物“说话”动画
            dh.on('voiceChatState', ({ code, label }) => {
                if (code === 3) { setVoiceStatus(t('voiceSpeaking')); setPetSpeaking(true); }
                else if (code === 2) { setVoiceStatus(t('voiceThinking')); setPetSpeaking(false); }
                else if (code === 1) { setVoiceStatus(t('voiceListening')); setPetSpeaking(false); }
                else { setVoiceStatus(label || t('voiceListening')); setPetSpeaking(false); }
            });
            dh.on('welcome', ({ message }) => { if (message) pushBubble('pet', message); });
            dh.on('autoplayFailed', () => showToast(t('voiceAutoplayBlocked'), 'info'));
            dh.on('error', ({ error }) => {
                showToast(t('voiceStartFailed', { error: (error?.message || error) }), 'error');
            });

            // 不渲染 SDK 自带形象：videoActions 不给 url，跳过 initAvatar；仅用其 LLM+RTC 大脑
            await dh.initFromConfig({
                character: { name: pet.name },
                system_prompt: systemPrompt,
                llm_model: 'keepwork-flash',
                videoActions: { '待机': {} },
            });
            if (!voiceActive) { teardownVoice(); return; }  // 期间已退出

            await dh.startVoiceChat({ system_prompt: systemPrompt });
            if (!voiceActive) { teardownVoice(); return; }

            setVoiceStatus(t('voiceListening'));
            showToast(t('voiceStarted'), 'success');
        } catch (e) {
            showToast(t('voiceStartFailed', { error: (e?.message || e) }), 'error');
            teardownVoice();
        }
    }

    if ($('mhVoiceBtn')) $('mhVoiceBtn').onclick = async () => {
        if (!isPaid) { showToast(t('voiceVip'), 'error'); return; }
        await launchVoice();
    };
    if ($('mhVoiceEnd')) $('mhVoiceEnd').onclick = () => {
        teardownVoice();
        showToast(t('voiceEnded'), 'info');
    };
}

// 模块级清理：可被任意渲染后的 onBack / 结束按钮调用
function teardownVoice() {
    voiceActive = false;
    if (dhInstance) {
        const dh = dhInstance;
        dhInstance = null;
        try { dh.stopVoiceChat?.(); } catch (_) {}
        try { dh.destroy?.(); } catch (_) {}
    }
    const bar = document.getElementById('mhVoiceBar');
    const inputBar = document.getElementById('mhInputBar');
    if (bar) bar.style.display = 'none';
    if (inputBar) inputBar.style.display = 'flex';
    const dot = document.getElementById('mhVoiceDot');
    if (dot) dot.style.animation = '';
    const art = document.getElementById('mhChatPetArt');
    if (art) {
        art.style.transform = 'translateX(-50%)';
        art.style.filter = 'saturate(1.04) drop-shadow(0 18px 24px rgba(30,64,175,0.22))';
        const host = art.querySelector('[data-mh-pet]');
        if (host) setPetMotion(host, 'idle');
    }
    const cont = document.getElementById('mhDhContainer');
    if (cont) cont.innerHTML = '';
}
