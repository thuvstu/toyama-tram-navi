#!/usr/bin/env node
/**
 * GTFS静的データ取得 → stops.json 生成
 * 使い方: node scripts/update-gtfs.mjs
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const GTFS_DIR = join(DATA_DIR, 'gtfs');

// ─── メイン ───────────────────────────────────────────────
async function main() {
    console.log('🚃 富山市電 GTFS更新スクリプト');
    console.log(`   実行日時: ${new Date().toLocaleString('ja-JP')}\n`);

    mkdirSync(GTFS_DIR, { recursive: true });

    let stops = null;

    try {
        stops = await fetchFromGtfsDataJp();
        console.log(`✅ gtfs-data.jp から ${stops.length} 停留所取得`);
    } catch (e) {
        console.warn(`⚠️  gtfs-data.jp 失敗: ${e.message}`);
    }

    if (!stops) {
        try {
            stops = await fetchFromToyamaOpenData();
            console.log(`✅ 富山県オープンデータから ${stops.length} 停留所取得`);
        } catch (e) {
            console.warn(`⚠️  富山県オープンデータ失敗: ${e.message}`);
        }
    }

    if (!stops) {
        console.error('❌ 全ソース失敗。既存 data/stops.json を維持します。');
        process.exit(1);
    }

    const output = {
        updatedAt: new Date().toISOString(),
        source: 'gtfs-data.jp / 富山県オープンデータ',
        feedId: 'chitetsu*chitetsushinaidensha',
        stops,
    };

    const outPath = join(DATA_DIR, 'stops.json');

    // 差分チェック (書き込み前)
    checkDiff(stops, outPath);

    writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\n📝 ${outPath} に書き込み完了 (${stops.length} 停留所)`);
}

// ─── gtfs-data.jp ─────────────────────────────────────────
async function fetchFromGtfsDataJp() {
    const zipUrl = 'https://gtfs-data.jp/api/v1/feeds/chitetsu*chitetsushinaidensha/gtfs.zip';
    console.log(`   DL: ${zipUrl}`);

    const resp = await fetch(zipUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'toyama-tram-navi-updater/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const zipPath = join(GTFS_DIR, 'gtfs.zip');
    writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
    execSync(`unzip -o "${zipPath}" -d "${GTFS_DIR}"`, { stdio: 'pipe' });

    return parseStopsTxt(join(GTFS_DIR, 'stops.txt'));
}

// ─── 富山県オープンデータ ─────────────────────────────────
async function fetchFromToyamaOpenData() {
    const zipUrl = 'https://opendata.pref.toyama.jp/files/gtfs/chitetsu_tram/gtfs.zip';
    console.log(`   DL: ${zipUrl}`);

    const resp = await fetch(zipUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const zipPath = join(GTFS_DIR, 'gtfs_toyama.zip');
    writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
    execSync(`unzip -o "${zipPath}" -d "${GTFS_DIR}"`, { stdio: 'pipe' });

    return parseStopsTxt(join(GTFS_DIR, 'stops.txt'));
}

// ─── stops.txt → JSON ───────────────────────────────────
function parseStopsTxt(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

    const stops = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCsvLine(lines[i]);
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });

        const lat = parseFloat(obj.stop_lat);
        const lon = parseFloat(obj.stop_lon);
        if (isNaN(lat) || isNaN(lon)) continue;

        stops.push({
            id: obj.stop_id,
            name: obj.stop_name,
            lat,
            lon,
        });
    }

    // 市内電車の範囲でフィルタ
    return stops.filter(s =>
        s.lat > 36.66 && s.lat < 36.77 &&
        s.lon > 137.18 && s.lon < 137.24
    );
}

// ─── CSV パース ─────────────────────────────────────────
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
        else current += ch;
    }
    result.push(current.trim());
    return result;
}

// ─── 差分チェック ─────────────────────────────────────────
function checkDiff(newStops, outPath) {
    if (!existsSync(outPath)) {
        console.log('   (初回実行: 差分なし)');
        return;
    }

    const old = JSON.parse(readFileSync(outPath, 'utf-8'));
    const oldIds = new Set(old.stops.map(s => s.id));
    const newIds = new Set(newStops.map(s => s.id));

    const added = newStops.filter(s => !oldIds.has(s.id));
    const removed = old.stops.filter(s => !newIds.has(s.id));

    if (added.length) console.log(`   🆕 追加: ${added.map(s => s.name).join(', ')}`);
    if (removed.length) console.log(`   🗑️  削除: ${removed.map(s => s.name).join(', ')}`);
    if (!added.length && !removed.length) console.log('   差分なし (停留所変更なし)');
}

main().catch(e => { console.error(e); process.exit(1); });