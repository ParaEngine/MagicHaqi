import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const planetIndex = JSON.parse(await readFile(new URL('../famous-planets/_planet_index.json', import.meta.url), 'utf8'));
const settlementsSource = await readFile(new URL('../js/view_star_settlements.js', import.meta.url), 'utf8');
const fieldSource = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');

test('哈奇星球使用独立场景且不复用蛋蛋星球背景', () => {
    const haqi = planetIndex.planets.find(planet => planet.id === 'haqi');
    const defaultPlanet = planetIndex.planets.find(planet => planet.id === 'default');

    assert.ok(haqi);
    assert.ok(defaultPlanet);
    assert.equal(haqi.fields.length, 7);
    assert.equal(defaultPlanet.fields.length, 7);
    assert.notEqual(haqi.fields[0].background.imageUrl, defaultPlanet.fields[0].background.imageUrl);
    assert.match(haqi.fields[0].background.imageUrl, /hatchi_island_scene_/);
    assert.match(defaultPlanet.fields[0].background.imageUrl, /blue_sky_rainbow_planet_clouds/);
});

test('官方星球切换布局后再应用目标星球场景', () => {
    const applyStart = settlementsSource.indexOf('async function applyOfficialPlanet');
    const applyEnd = settlementsSource.indexOf('function homePlanetLookupKeys', applyStart);
    const applySource = settlementsSource.slice(applyStart, applyEnd);
    assert.ok(applySource.indexOf('setActiveLayoutsPlanet(planet.id)') < applySource.indexOf('applyPlanetFields(planet)'));

    const restoreStart = settlementsSource.indexOf('export async function applySettledOfficialPlanetFromProfile');
    const restoreEnd = settlementsSource.indexOf('export async function restoreCustomHome', restoreStart);
    const restoreSource = settlementsSource.slice(restoreStart, restoreEnd);
    assert.ok(restoreSource.indexOf('setActiveLayoutsPlanet(planet.id)') < restoreSource.indexOf('applyPlanetFields(planet)'));
});

test('地点按钮美术只应用于哈奇星球', () => {
    const helperStart = fieldSource.indexOf('function isActiveHaqiPlanet');
    const helperEnd = fieldSource.indexOf('// 场景背景已全面改用静态场景图', helperStart);
    const helperSource = fieldSource.slice(helperStart, helperEnd);
    const locationStart = fieldSource.indexOf('function haqiLocationButtonHtml');
    const locationEnd = fieldSource.indexOf('const SHOP_FIELD_TYPES', locationStart);
    const locationSource = fieldSource.slice(locationStart, locationEnd);

    assert.match(helperSource, /settlement\?\.source === 'official'/);
    assert.match(helperSource, /String\(settlement\.planetId \|\| ''\) === 'haqi'/);
    assert.match(helperSource, /searchParams\.get\('home_planet'\)/);
    assert.match(helperSource, /\.trim\(\) === 'haqi'/);
    assert.match(locationSource, /isActiveHaqiPlanet\(\)/);
    assert.match(locationSource, /HAQI_LOCATION_BUTTON_ASSETS\[index\]/);
});

test('操作按钮美术只应用于哈奇星球', () => {
    const actionStart = fieldSource.indexOf('function renderFieldActionTray');
    const actionEnd = fieldSource.indexOf('function dockHtml', actionStart);
    const actionSource = fieldSource.slice(actionStart, actionEnd);

    assert.match(actionSource, /useHaqiActionArt = isActiveHaqiPlanet\(\)/);
    assert.match(actionSource, /haqi-field-action-\$\{asset\}-v1\.webp/);
    assert.match(actionSource, /mh-haqi-field-actions/);
});