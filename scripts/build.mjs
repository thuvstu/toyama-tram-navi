#!/usr/bin/env node
/**
 * stops.json → index.html に注入
 * 
 * 使い方: node scripts/build.mjs
 * 
 * index.html 内の STOPS_DATA マーカーを置換する
*/

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const stopsData = JSON.parse(readFileSync(join(ROOT, 'data/stops.json'), 'utf-8'));
let html = readFileSync(join(ROOT, 'index.html'), 'utf-8');

// STOPS配列を生成
const stopsJs = stopsData.stops.map((s, i) =>
    `{id:"${s.id}",n:"${s.name}",la:${s.lat},lo:${s.lon},ln:${guessLine(s, i)}}`
).join(',\n');

// 置換
const marker = '/*__STOPS_DATA__*/';
if (!html.includes(marker)) {
    console.error('❌ index.html に /*__STOPS_DATA__*/ マーカーが見つからない');
    process.exit(1);
}

html = html.replace(
    /const STOPS=\[[\s\S]*?\];\s*\/\*__STOPS_DATA__\*\//,
    `const STOPS=[\n${stopsJs}\n]; /*__STOPS_DATA__*/`
);

// バージョン情報埋め込み
html = html.replace(
    /const DATA_VERSION=".*?"/,
    `const DATA_VERSION="${stopsData.updatedAt}"`
);

writeFileSync(join(ROOT, 'index.html'), html, 'utf-8');
console.log(`✅ index.html 更新完了 (${stopsData.stops.length} 停留所, ${stopsData.updatedAt})`);

// 路線番号推定 (stop_idパターン or 座標範囲)
function guessLine(stop, index) {
    // 1: 南富山〜富山駅 (本線)
    // 2: 富山駅〜富山大学前 (安野屋支線)
    // 3: 環状線 (国際会議場〜グランドプラザ)
    // 4: 富山駅〜岩瀬浜 (富山港線)
    const { lat, lon, id } = stop;
    if (id.includes('C01') || id.includes('C02') || lat < 36.695 && lon > 137.212) return 1;
    if (lon < 137.212 && lat > 36.69) return 2;
    if (id.includes('C23') || id.includes('C24') || id.includes('C25')) return 3;
    if (lat > 36.70 && lon > 137.212) return 4;
    return 1;
}