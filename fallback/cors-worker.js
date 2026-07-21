// GTFS-RT CORS Proxy (Cloudflare Worker)
// 使い方: npx wrangler deploy → 出力URLを index.html の CONFIG.corsProxy に設定
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

        // 許可ドメイン固定（滥用防止）
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
            resp.headers.set('Access-Control-Allow-Origin', '*');
            resp.headers.set('Cache-Control', 'public, max-age=30');
            resp.headers.set('Content-Type', 'application/octet-stream');
            await cache.put(cacheKey, resp.clone());
        }
        return resp;
    },
};