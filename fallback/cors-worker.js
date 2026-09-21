// GTFS-RT CORS Proxy (Cloudflare Worker)
// 使い方: npx wrangler deploy → 出力URLを index.html の CONFIG.corsProxies 先頭に設定
// 許可する呼び出し元 (自分の公開先のみ。 hotlink・枠消費対策)
const ALLOWED_ORIGINS = [
    'https://thuvstu.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];
export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        const url = new URL(request.url);
        const target = url.searchParams.get('url');
        if (!target) return new Response('?url= required', { status: 400 });

        // 呼び出し元チェック (Referer/Originいずれかが許可リストに一致すること)
        // ※curl直叩きの偽装までは防げないが、他サイトからの横乗りは遮断できる
        const ref = request.headers.get('Referer') || request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.some(o => ref.startsWith(o))) return new Response('forbidden origin', { status: 403 });

        // 許可ドメイン固定（滥用防止）※設定時に利用元を追加
        const allowed = [
            'gtfs-rt-files.buscatch.jp',
            'opendata.pref.toyama.jp',
        ];
        let t;
        try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
        if (!allowed.includes(t.hostname)) return new Response('forbidden', { status: 403 });

        // 30秒キャッシュ（同一URLの連打防止）
        const cache = caches.default;
        const cacheKey = new Request(request.url, { method: 'GET' });
        let resp = await cache.match(cacheKey);
        if (!resp) {
            resp = await fetch(target);
            resp = new Response(resp.body, resp);
            const origin = ALLOWED_ORIGINS.find(o => ref.startsWith(o)) || ALLOWED_ORIGINS[0];
            resp.headers.set('Access-Control-Allow-Origin', origin);
            resp.headers.set('Cache-Control', 'public, max-age=30');
            resp.headers.set('Content-Type', 'application/octet-stream');
            await cache.put(cacheKey, resp.clone());
        }
        return resp;
    },
};