import { createOperationsApiRequest } from './dashboard_api.js';
import { formatMetricCount, formatMetricPercent, formatMetricRatio, metricExportValue } from './dashboard_display.js';
import { normalizeDashboardPayload } from './dashboard_metrics.js';

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
let currentMetrics = null;

function notify(message) {
    elements.notice.textContent = message;
    elements.notice.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { elements.notice.hidden = true; }, 3200);
}

function render(metrics, sourceLabel) {
    currentMetrics = metrics;
    elements.emptyState.hidden = true;
    elements.dashboard.hidden = false;
    elements.exportCsvButton.disabled = false;
    elements.exportJsonButton.disabled = false;
    elements.dataStatus.textContent = `${sourceLabel} · ${Number(metrics.eventCount || 0).toLocaleString()} 条事件`;
    elements.visitorCount.textContent = formatMetricCount(metrics.visitorCount);
    elements.sessionCount.textContent = formatMetricCount(metrics.sessionCount);
    elements.d1Rate.textContent = formatMetricPercent(metrics.d1?.rate);
    elements.d1Detail.textContent = formatMetricRatio(metrics.d1?.retainedVisitors, metrics.d1?.eligibleVisitors, '可观察访客');
    elements.expeditionRate.textContent = formatMetricPercent(metrics.expedition?.completionRate);
    elements.expeditionDetail.textContent = formatMetricRatio(metrics.expedition?.finishedVisitors, metrics.expedition?.startedVisitors, '访客');
    elements.missionViews.textContent = formatMetricCount(metrics.mission?.viewedVisitors);
    elements.missionClickRate.textContent = formatMetricPercent(metrics.mission?.clickRate);
    elements.missionCompletionRate.textContent = formatMetricPercent(metrics.mission?.completionRate);

    const maximum = Math.max(1, ...(metrics.funnel || []).map(step => Number(step.visitors) || 0));
    elements.funnel.innerHTML = (metrics.funnel || []).map(step => `<div class="funnel-row"><span>${escapeHtml(step.label)}</span><div class="funnel-track"><div class="funnel-bar" style="width:${Math.max(1, (step.visitors / maximum) * 100)}%"></div></div><strong>${formatMetricCount(step.visitors)}</strong><small>${formatMetricPercent(step.conversionRate)}</small></div>`).join('');
    const devices = Object.entries(metrics.devices || {});
    const deviceMaximum = Math.max(1, ...devices.map(([, count]) => Number(count) || 0));
    elements.devices.innerHTML = devices.length
        ? devices.map(([name, count]) => `<div class="device"><span>${escapeHtml(name)}</span><i><b style="width:${(count / deviceMaximum) * 100}%"></b></i><strong>${count}</strong></div>`).join('')
        : '<small>暂无设备数据</small>';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function filterEventsByDate(payload) {
    const events = Array.isArray(payload) ? payload : payload?.events;
    if (!Array.isArray(events)) return payload;
    const start = elements.startDate.value ? new Date(`${elements.startDate.value}T00:00:00`).getTime() : -Infinity;
    const end = elements.endDate.value ? new Date(`${elements.endDate.value}T23:59:59.999`).getTime() : Infinity;
    return { events: events.filter(event => Number(event?.timestamp) >= start && Number(event?.timestamp) <= end) };
}

async function loadApi() {
    const endpoint = elements.apiEndpoint.value.trim();
    if (!endpoint) return notify('请先填写聚合 API 地址');
    elements.loadApiButton.disabled = true;
    try {
        const { url, headers } = createOperationsApiRequest(endpoint, {
            startDate: elements.startDate.value,
            endDate: elements.endDate.value,
            apiKey: elements.apiKey.value,
        });
        const response = await fetch(url, { headers, credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        render(normalizeDashboardPayload(await response.json()), '聚合 API');
        notify('数据已更新');
    } catch (error) {
        notify(`读取失败：${error?.message || error}`);
    } finally {
        elements.loadApiButton.disabled = false;
    }
}

function download(name, content, type) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function metricsCsv(metrics) {
    const rows = [
        ['metric', 'value'],
        ['visitor_count', metricExportValue(metrics.visitorCount)],
        ['session_count', metricExportValue(metrics.sessionCount)],
        ['d1_rate', metricExportValue(metrics.d1?.rate)],
        ['mission_click_rate', metricExportValue(metrics.mission?.clickRate)],
        ['mission_completion_rate', metricExportValue(metrics.mission?.completionRate)],
        ['expedition_completion_rate', metricExportValue(metrics.expedition?.completionRate)],
        ...(metrics.funnel || []).map(step => [`funnel_${step.event}`, metricExportValue(step.visitors)]),
    ];
    return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

elements.importButton.onclick = () => elements.fileInput.click();
elements.fileInput.onchange = async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) return;
    try {
        const payload = filterEventsByDate(JSON.parse(await file.text()));
        render(normalizeDashboardPayload(payload), file.name);
        notify('本地数据已载入');
    } catch (error) {
        notify(`导入失败：${error?.message || error}`);
    } finally {
        elements.fileInput.value = '';
    }
};
elements.loadApiButton.onclick = loadApi;
elements.exportJsonButton.onclick = () => currentMetrics && download('haqi-operations-metrics.json', JSON.stringify({ metrics: currentMetrics }, null, 2), 'application/json');
elements.exportCsvButton.onclick = () => currentMetrics && download('haqi-operations-metrics.csv', `\ufeff${metricsCsv(currentMetrics)}`, 'text/csv;charset=utf-8');