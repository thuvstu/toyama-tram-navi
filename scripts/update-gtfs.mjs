#!/usr/bin/env node
/**
 * GTFS静的データ取得 → stops.json 生成
 * 使い方: node scripts/update-gtfs.mjs
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { inflateRawSync } from 'zlib';

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
        console.warn('⚠️ 全ソース失敗。既存 data/stops.json を維持します。');
        // 定期実行を赤にしないため exit 0 (データ更新なしで正常終了扱い)
        process.exit(0);
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
    // v2 API (2026年確認): https://api.gtfs-data.jp/v2/organizations/chitetsu/feeds/chitetsushinaidensha/files/feed.zip
    const zipUrl = 'https://api.gtfs-data.jp/v2/organizations/chitetsu/feeds/chitetsushinaidensha/files/feed.zip?rid=current';
    console.log(`   DL: ${zipUrl}`);

    const resp = await fetch(zipUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'toyama-tram-navi-updater/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const buf = Buffer.from(await resp.arrayBuffer());
    assertZip(buf, resp.headers.get('content-type'));

    const zipPath = join(GTFS_DIR, 'gtfs.zip');
    writeFileSync(zipPath, buf);

    return parseStopsTxt(extractFromZip(zipPath, 'stops.txt'));
}

// ─── 富山県オープンデータ ─────────────────────────────────
async function fetchFromToyamaOpenData() {
    const zipUrl = 'https://opendata.pref.toyama.jp/files/gtfs/chitetsu_tram/gtfs.zip';
    console.log(`   DL: ${zipUrl}`);

    const resp = await fetch(zipUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const buf = Buffer.from(await resp.arrayBuffer());
    assertZip(buf, resp.headers.get('content-type'));

    const zipPath = join(GTFS_DIR, 'gtfs_toyama.zip');
    writeFileSync(zipPath, buf);

    return parseStopsTxt(extractFromZip(zipPath, 'stops.txt'));
}

// ─── zipから1ファイル取り出し (pure JS, unzipバイナリ不要) ──
function extractFromZip(zipPath, wantName) {
    const buf = readFileSync(zipPath);
    // EOCD検索
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('EOCD not found (not a zip?)');
    const cdCount = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < cdCount; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken central directory');
        const method = buf.readUInt16LE(p + 10);
        const cSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const lhOff = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf-8');
        p += 46 + nameLen + extraLen + commentLen;
        if (name !== wantName) continue;
        if (buf.readUInt32LE(lhOff) !== 0x04034b50) throw new Error('broken local header');
        const lhNameLen = buf.readUInt16LE(lhOff + 26);
        const lhExtraLen = buf.readUInt16LE(lhOff + 28);
        const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
        const data = buf.slice(dataStart, dataStart + cSize);
        if (method === 0) return data.toString('utf-8');
        if (method === 8) return inflateRawSync(data).toString('utf-8');
        throw new Error(`unsupported method ${method}`);
    }
    throw new Error(`${wantName} not found in zip`);
}

// ─── stops.txt → JSON ───────────────────────────────────
function parseStopsTxt(raw) {
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

// ─── DL内容がzipか検証 (HTMLエラーページ誤爆を早期検出) ──
function assertZip(buf, contentType) {
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // PK..
    if (!isZip) {
        const head = buf.slice(0, 120).toString('utf-8').replace(/\s+/g, ' ');
        throw new Error(`not a zip (content-type: ${contentType}, head: ${head})`);
    }
}

// ─── 差分チェック ─────────────────────────────────────────
function checkDiff(newStops, outPath) {
    if (!existsSync(outPath)) {
        console.log('   (初回実行: 差分なし)');
        return;
    }

    let old;
    try {
        old = JSON.parse(readFileSync(outPath, 'utf-8'));
    } catch {
        console.log('   (既存stops.jsonが空/破損: 差分スキップ)');
        return;
    }
    if (!old.stops) {
        console.log('   (既存stops.jsonにstopsなし: 差分スキップ)');
        return;
    }
    const oldIds = new Set(old.stops.map(s => s.id));
    const newIds = new Set(newStops.map(s => s.id));

    const added = newStops.filter(s => !oldIds.has(s.id));
    const removed = old.stops.filter(s => !newIds.has(s.id));

    if (added.length) console.log(`   🆕 追加: ${added.map(s => s.name).join(', ')}`);
    if (removed.length) console.log(`   🗑️  削除: ${removed.map(s => s.name).join(', ')}`);
    if (!added.length && !removed.length) console.log('   差分なし (停留所変更なし)');
}

main().catch(e => { console.error(e); process.exit(1); });