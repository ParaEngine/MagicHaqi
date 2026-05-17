// 聊天视图：文字 + 付费语音
import { $, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { chatWithPet, summarizeAndAppendMemory } from './api.js';
import { appendChatLog } from './storage.js';
import { displayPetName } from './dna.js';
import { petArtHtml } from './pet.js';

let dhInstance = null;

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
            <div aria-hidden="true" style="position:absolute;left:50%;bottom:0;width:min(74%,280px);height:min(52vh,280px);transform:translateX(-50%);opacity:1;filter:saturate(1.04) drop-shadow(0 18px 24px rgba(30,64,175,0.22));pointer-events:none;z-index:0">
                ${petArtHtml(pet, { alt: '', motion: 'idle' })}
            </div>
            <div id="mhChatScroll" class="absolute" style="inset:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;position:absolute;z-index:1">
                <div class="chat-bubble pet">${escapeHtml(displayPetName(pet))} 摇着尾巴跑过来啦 ✨</div>
            </div>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:8px;display:flex;gap:6px;background:var(--topbar-bg);border-top:1px solid var(--border)">
            <input id="mhChatInput" class="modal-input" placeholder="${escapeHtml(t('chatPlaceholder'))}" style="flex:1">
            <button id="mhSendBtn" class="btn-primary" style="padding:8px 18px">${escapeHtml(t('send'))}</button>
        </div>
        <div id="mhDhContainer" style="display:none"></div>`;

    if ($('mhBack')) $('mhBack').onclick = () => {
        teardownVoice();
        onBack?.();
    };

    const scroll = $('mhChatScroll');
    function pushBubble(role, text) {
        const div = document.createElement('div');
        div.className = `chat-bubble ${role}`;
        div.textContent = text;
        scroll.appendChild(div);
        scroll.scrollTop = scroll.scrollHeight;
        return div;
    }

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
                replyEl.textContent = '（喵？我有点没听清~）';
                full = '（沉默）';
            } else if (replyEl.textContent === t('petThinking')) {
                replyEl.textContent = full;
            }
            replyEl.style.opacity = '1';
            // 异步写入 log + memory，不阻塞 UI
            appendChatLog(pet.id, '主人', text).catch(()=>{});
            appendChatLog(pet.id, pet.name, full).catch(()=>{});
            summarizeAndAppendMemory(pet, text, full).catch(()=>{});
        } catch (e) {
            replyEl.textContent = '（出错了：' + (e?.message || e) + '）';
            replyEl.style.opacity = '1';
        } finally {
            busy = false;
        }
    }

    if ($('mhSendBtn')) $('mhSendBtn').onclick = send;
    if ($('mhChatInput')) $('mhChatInput').onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    if ($('mhVoiceBtn')) $('mhVoiceBtn').onclick = async () => {
        if (!isPaid) {
            showToast(t('voiceVip'), 'error');
            return;
        }
        await launchVoice(pet);
    };
}

async function launchVoice(pet) {
    if (typeof window.DigitalHuman !== 'function') {
        showToast('数字人模块未加载', 'error');
        return;
    }
    teardownVoice();
    const cont = $('mhDhContainer');
    cont.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#000;display:flex;align-items:center;justify-content:center';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.style.cssText = 'position:absolute;top:14px;right:14px;z-index:9001';
    closeBtn.textContent = '✕';
    closeBtn.onclick = teardownVoice;
    cont.appendChild(closeBtn);
    const inner = document.createElement('div');
    inner.style.cssText = 'width:100%;height:100%';
    cont.appendChild(inner);

    try {
        const { buildPetSystemPrompt } = await import('./api.js');
        const { loadPetMemory } = await import('./storage.js');
        const memoryText = await loadPetMemory(pet.id);
        dhInstance = new window.DigitalHuman({
            sdk: state.sdk,
            container: inner,
            config: {
                characterName: pet.name,
                avatarUrl: pet.imageUrl || null,
                systemPrompt: buildPetSystemPrompt(pet, memoryText),
            },
        });
        if (typeof dhInstance.start === 'function') {
            await dhInstance.start();
        } else if (typeof dhInstance.setActive === 'function') {
            await dhInstance.setActive(true);
        }
        showToast('语音对话已开启', 'success');
    } catch (e) {
        showToast('启动语音失败：' + (e?.message || e), 'error');
        teardownVoice();
    }
}

function teardownVoice() {
    const cont = document.getElementById('mhDhContainer');
    if (dhInstance) {
        try { dhInstance.destroy?.(); dhInstance.stop?.(); dhInstance.setActive?.(false); } catch (_) {}
        dhInstance = null;
    }
    if (cont) {
        cont.style.cssText = 'display:none';
        cont.innerHTML = '';
    }
}
