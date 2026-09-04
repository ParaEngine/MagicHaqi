import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatMetricCount,
    formatMetricPercent,
    formatMetricRatio,
    metricExportValue,
} from '../analytics/dashboard_display.js';

test('dashboard distinguishes missing metrics from explicit zero values', () => {
    assert.equal(formatMetricCount(undefined), '尚未采集');
    assert.equal(formatMetricPercent(null), '尚未采集');
    assert.equal(formatMetricRatio(undefined, undefined, '访客'), '尚未采集');
    assert.equal(metricExportValue(undefined), 'not_collected');

    assert.equal(formatMetricCount(0), '0');
    assert.equal(formatMetricPercent(0), '0%');
    assert.equal(formatMetricRatio(0, 0, '访客'), '0 / 0 访客');
    assert.equal(metricExportValue(0), 0);
});

test('dashboard formats collected metric values consistently', () => {
    assert.equal(formatMetricCount(1234), '1,234');
    assert.equal(formatMetricPercent(24.25), '24.3%');
    assert.equal(formatMetricRatio(15, 62, '可观察访客'), '15 / 62 可观察访客');
});