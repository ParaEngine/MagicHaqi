export const NOT_COLLECTED_LABEL = '尚未采集';

export function hasMetricValue(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function formatMetricCount(value) {
    return hasMetricValue(value) ? Number(value).toLocaleString() : NOT_COLLECTED_LABEL;
}

export function formatMetricPercent(value) {
    return hasMetricValue(value)
        ? `${Number(value).toFixed(1).replace('.0', '')}%`
        : NOT_COLLECTED_LABEL;
}

export function formatMetricRatio(numerator, denominator, suffix) {
    if (!hasMetricValue(numerator) || !hasMetricValue(denominator)) return NOT_COLLECTED_LABEL;
    return `${Number(numerator).toLocaleString()} / ${Number(denominator).toLocaleString()}${suffix ? ` ${suffix}` : ''}`;
}

export function metricExportValue(value) {
    return hasMetricValue(value) ? Number(value) : 'not_collected';
}