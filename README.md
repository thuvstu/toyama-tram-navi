# 🚃 富山市電 最速乗車ナビ

> 今どこへ向かえば、一番早い電車に乗れるかを判定する単一HTMLアプリです。
> サーバー不要・ブラウザで開くだけ。
---
> くれぐれも負荷のかけすぎには注意して下さい。責任は負えません！

## 何ができるか

1. **GPSで現在地取得**
2. **目的地（停留所）選択** → 登録も可能
3. **移動モード選択**（歩き / 早歩き / ダッシュ / 全力疾走）
4. **全停留所までの徒歩時間を一括計算**（OSRM Table API）
5. **GTFS-RTのリアルタイム車両位置と照合**
6. **「○○停留所へ走れ！あと△秒で電車が来る」を表示**
7. **地図上に徒歩ルート＋目標停留所をハイライト**

---

## 使い方（30秒）
基本的には方法Aで充分です
### 方法A: そのまま開く
1. `index.html`をダウンロード
2. Androidのダウンロードから開く → Chromeで表示
3. ⋮ → 「ホーム画面に追加」

### 方法B: GitHub Pages
1. このリポジトリをfork
2. Settings → Pages → Source: main / root
3. `https://YOUR_USER.github.io/toyama-tram-navi/` にアクセス

---


## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  Android Chrome (index.html 20KB)               │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ GPS      │  │ 停留所DB │  │ 判定エンジン │  │
│  │ (端末)   │  │ (内蔵)   │  │              │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│        │              │              │           │
│        ▼              ▼              ▼           │
│  ┌─────────────────────────────────────────┐    │
│  │ 通信 (前台時のみ・45秒間隔)              │    │
│  │  • GTFS-RT VehiclePositions (protobuf)  │    │
│  │  • OSRM Table/Route API (徒歩経路)      │    │
│  │  • OSM Tile (地図表示)                  │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
         │
         ▼ (45秒に1回・前台時のみ)
┌─────────────────────────────────────────────────┐
│ GTFS-RT エンドポイント                           │
│ (buscatch.jp / 富山県オープンデータ)             │
└─────────────────────────────────────────────────┘
```

### サーバーが不要な理由

| 通常必要なもの | 本プロジェクトでの代替 |
|---|---|
| バックエンドAPI | GTFS-RTエンドポイントに直接HTTP GET |
| データベース | 停留所データをHTMLに内蔵 (39個・2KB) |
| 経路計算サーバー | OSRM Public API (CORS対応済み) |
| 地図サーバー | OSM Tile (CORS対応済み) |
| CORSプロキシ | corsproxy.io (死亡時→fallback/のCF Worker) |

---

## GTFS静的データの更新

### 自動更新（推奨）

GitHub Actionsが**毎月1日**に自動実行：
1. gtfs-data.jp から最新GTFS ZIPをDL
2. stops.txt をパース → `data/stops.json` 生成
3. `index.html` に注入
4. 差分があれば自動commit

### 手動更新

```bash
node scripts/update-gtfs.mjs   # GTFS取得
node scripts/build.mjs         # index.htmlに注入
git add -A && git commit -m "chore: GTFS更新"
```

### データソース

| ソース | URL | 備考 |
|---|---|---|
| gtfs-data.jp | `api.gtfs-data.jp/v2/feeds/chitetsu*chitetsushinaidensha` | 主 |
| 富山県オープンデータ | `opendata.pref.toyama.jp` | 副 (フォールバック) |

---

## 通信先と負荷

| 通信先 | 用途 | 頻度 | 1日あたり |
|---|---|---|---|
| `gtfs-rt-files.buscatch.jp` | 車両位置 (protobuf 165B) | 45秒/回・前台のみ | ~40回 (通勤利用) |
| `router.project-osrm.org` | 徒歩経路 | 計算ボタン押下時 | 2〜4回 |
| `tile.openstreetmap.org` | 地図タイル | 初回+スクロール | ~20枚 |

**合計: 約50KB/日。サーバー負荷はほぼゼロ。**

### 運行時間外の動作

- 23:10〜6:00 はGTFS-RT取得を完全停止
- 画面OFF → 即停止
- 画面ON → 即1回取得 → 以降45秒間隔

---

## CORSプロキシが死んだら

```bash
cd fallback/
npx wrangler deploy
# 出力URLを index.html の CONFIG.corsProxy に設定
# git commit -m "fix: switch to CF Worker proxy"
```

無料枠: 10万リクエスト/日（個人利用で到達しない）

---

## 移動モードと信号ペナルティ

| モード | 速度 | 用途 |
|---|---|---|
| 歩き | 4.8 km/h | 通常 |
| 早歩き | 6.0 km/h | 急いでる |
| ダッシュ | 11.0 km/h | 走れる |
| 全力疾走 | 14.0 km/h | 30秒が限界 |

### 信号待ち

- 交差点1つあたり **+25秒 × 0.6** のペナルティ
- OSMの `highway=traffic_signals` ノード数で推定
- **リアルタイム信号位相は予測不可**（V2X非公開）
- 実測誤差: ±15秒程度

---

## 法的注意

### 推奨: 富山県オープンデータ

法的にクリーンに使うなら、富山県オープンデータカタログ
(`opendata.pref.toyama.jp`) のGTFS-RTエンドポイントを使用。
利用規約: CC BY 4.0（出典明示で自由利用可）。

---

## 既知の制限

| 項目 | 状況 |
|---|---|
| 信号のリアルタイム位相 | 予測不可（ヒューリスティックのみ） |
| 電車内の混雑 | GTFS-RTに情報なし |
| 複数路線の乗換 | 市内電車のみ（バス・鉄道は非対応） |
| オフライン動作 | 不可（GTFS-RT・OSRMに通信必要） |
| iOS | 未テスト（Chrome iOSで動く可能性あり） |

---

## 開発

```bash
# 構造確認
tree -L 2

# GTFS更新
node scripts/update-gtfs.mjs

# ビルド (stops.json → index.html注入)
node scripts/build.mjs

# ローカルテスト
npx serve .
# → http://localhost:3000

# CF Worker (fallback)
cd fallback && npx wrangler dev
```

---

## ライセンス

- アプリコード: MIT
- 停留所データ: 富山県オープンデータ (CC BY 4.0)
- 地図: © OpenStreetMap contributors (ODbL)
- GTFS-RT: VISH株式会社 / 富山県（利用規約遵守）

---

## 謝辞

- 富山県（オープンデータ・GTFS-RT提供）
- VISH株式会社（BUS CATCH基盤　着想元）
- 富山地方鉄道（運行データ）
- OSRM / OpenStreetMap コミュニティ
```

---

## `.gitignore`

```
node_modules/
.wrangler/
.dev.vars
data/gtfs/
*.zip
.DS_Store
```

---

## 運用フローまとめ

```
普段:
  index.html をChromeで開く → 動く（何もしなくていい）

毎月1日 (自動):
  GitHub Actions → GTFS DL → stops.json更新 → index.html再生成 → push

corsproxy.io死亡時 (手動・3分):
  cd fallback/ && npx wrangler deploy → CONFIG.corsProxy 1行変更

ダイヤ大改正時 (手動):
  node scripts/update-gtfs.mjs && node scripts/build.mjs
  → 差分確認 → commit
```

---

## 2026年データの確認方法

```bash
# 今すぐ最新データで上書き
node scripts/update-gtfs.mjs

# 出力される差分ログで確認:
#   🆕 追加: ○○停留所
#   🗑️  削除: △△停留所
#   差分なし (停留所変更なし)
```

**次回ダイヤ改正（例年3月）の後に1回走らせれば確実。** GitHub Actionsが月1で自動チェックするので、放置しても最大1ヶ月遅れで追従します。
