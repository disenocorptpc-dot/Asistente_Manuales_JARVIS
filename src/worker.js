/* Primera ruta de código del Worker (F6 parcial: espejo a R2).
   Hasta ahora el Worker era puro assets estáticos; esto agrega:

     PUT /api/publicar?archivo=X.glb   ← el addon de Blender (F2) o
                                          herramientas/publicar-modelo.py
     GET /modelos/X.glb                ← el visor jala el GLB publicado
     GET /api/modelos                  ← lista, para el catálogo futuro

   Los assets estáticos siguen igual: cualquier ruta que exista en public/
   se sirve de ahí y NUNCA llega a este código. Sólo lo que no es asset cae
   aquí.

   Decisiones:
   - Publicar exige un token (wrangler secret PUBLICAR_TOKEN) en el header
     x-publicar-token. Si se filtra, se rota con `wrangler secret put` y ya.
   - Los modelos publicados son INMUTABLES: mismo nombre dos veces = 409.
     Cada revisión entra con otro nombre (SIG-LOBBY-01-R3.glb) — es lo que
     permite el cache de un año, y es la disciplina que el área ya tiene
     con los manuales. ?sobrescribir=1 existe para el error honesto.
   - GLB ≤ 25 MB duro (el presupuesto del HANDOFF §10 es 15; el script de
     publicación avisa a partir de ahí). */

const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.glb$/;
const BYTES_MAX = 25 * 1024 * 1024;

/* Candado de facturación: el free tier de R2 son 10 GB/mes y Cloudflare NO
   ofrece tope duro nativo — así que el tope lo pone este Worker, que es lo
   único que puede escribir. 9 GB deja margen para no rozar el límite ni con
   el bucket lleno. Pasarse en lecturas es imposible en la práctica: el edge
   cachea los GET y el egress de R2 es gratis por diseño. */
const BUCKET_MAX_BYTES = 9 * 1024 * 1024 * 1024;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/modelos/')) return servirModelo(req, env, ctx, url);
    if (url.pathname === '/api/publicar') return publicar(req, env, url);
    if (url.pathname === '/api/modelos') return listar(env);

    return new Response('no existe', { status: 404 });
  },
};

/* ── GET /modelos/<archivo> ──────────────────────────────────────────
   Con cache del edge: el mismo GLB escaneado por N teléfonos en una
   presentación sale del cache de Cloudflare, no de R2 cada vez. */
async function servirModelo(req, env, ctx, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return new Response('método no permitido', { status: 405 });

  const archivo = decodeURIComponent(url.pathname.slice('/modelos/'.length));
  if (!NOMBRE_VALIDO.test(archivo)) return new Response('nombre inválido', { status: 400 });

  const cache = caches.default;
  const llaveCache = new Request(url.toString()); // sin headers variables
  const enCache = await cache.match(llaveCache);
  if (enCache) {
    return req.method === 'HEAD'
      ? new Response(null, { headers: enCache.headers })
      : enCache;
  }

  const obj = await env.MODELOS.get(archivo);
  if (!obj) return new Response('modelo no publicado', { status: 404 });

  const headers = new Headers({
    'Content-Type': 'model/gltf-binary',
    'Content-Length': String(obj.size),
    // Inmutable de verdad: una revisión nueva es un nombre nuevo.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': obj.httpEtag,
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });

  if (req.method === 'HEAD') return new Response(null, { headers });

  const resp = new Response(obj.body, { headers });
  ctx.waitUntil(cache.put(llaveCache, resp.clone()));
  return resp;
}

/* ── PUT /api/publicar?archivo=<nombre>.glb ────────────────────────── */
async function publicar(req, env, url) {
  if (req.method !== 'PUT') return new Response('método no permitido', { status: 405 });
  if (!env.PUBLICAR_TOKEN)
    return json(503, { error: 'publicación sin configurar: falta el secret PUBLICAR_TOKEN' });

  if (!tokenValido(req.headers.get('x-publicar-token'), env.PUBLICAR_TOKEN))
    return json(401, { error: 'token inválido' });

  const archivo = url.searchParams.get('archivo') ?? '';
  if (!NOMBRE_VALIDO.test(archivo))
    return json(400, { error: `nombre inválido: "${archivo}" (letras/números/._- y extensión .glb)` });

  const bytes = Number(req.headers.get('content-length') ?? 0);
  if (!bytes) return json(411, { error: 'falta Content-Length' });
  if (bytes > BYTES_MAX)
    return json(413, { error: `${(bytes / 1048576).toFixed(1)} MB: el techo duro es 25 MB (y el presupuesto §10 es 15)` });

  // Inmutabilidad: publicar encima es casi siempre un error de nombre.
  if (!url.searchParams.has('sobrescribir')) {
    const existente = await env.MODELOS.head(archivo);
    if (existente)
      return json(409, {
        error: `${archivo} ya está publicado (${(existente.size / 1048576).toFixed(1)} MB). ` +
               'Una revisión nueva lleva nombre nuevo (-R2, -R3…); si de verdad es corrección, ?sobrescribir=1.',
      });
  }

  // Candado de facturación: si esta publicación rebasa el tope, se rechaza.
  const enUso = await bytesEnBucket(env);
  if (enUso + bytes > BUCKET_MAX_BYTES)
    return json(507, {
      error: `el bucket lleva ${(enUso / 1073741824).toFixed(2)} GB y con este archivo pasaría el tope de 9 GB ` +
             '(candado para no salir del free tier de R2). Despublica revisiones viejas o sube el tope a conciencia.',
    });

  const obj = await env.MODELOS.put(archivo, req.body, {
    httpMetadata: { contentType: 'model/gltf-binary' },
  });

  return json(200, {
    ok: true,
    archivo,
    bytes,
    etag: obj.httpEtag,
    url: `${url.origin}/modelos/${archivo}`,
    registrar: `contenido.json → piezas[]: { "pieza_id": "…", "nombre": "…", "modelo": "modelos/${archivo}" }`,
  });
}

/* ── GET /api/modelos ──────────────────────────────────────────────── */
async function listar(env) {
  const lista = await env.MODELOS.list({ limit: 500 });
  return json(200, {
    modelos: lista.objects.map((o) => ({
      archivo: o.key,
      mb: +(o.size / 1048576).toFixed(2),
      publicado: o.uploaded,
    })),
  });
}

/* Suma el tamaño de todo lo publicado. A la escala del área son decenas de
   objetos; el loop de cursor está por si algún día son miles. */
async function bytesEnBucket(env) {
  let total = 0;
  let cursor;
  do {
    const pagina = await env.MODELOS.list({ limit: 1000, cursor });
    for (const o of pagina.objects) total += o.size;
    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor);
  return total;
}

/* Comparación en tiempo constante cuando la plataforma la da; si no,
   igualdad simple — el token es aleatorio de 32 bytes, no una contraseña. */
function tokenValido(recibido, esperado) {
  if (!recibido || recibido.length !== esperado.length) return false;
  try {
    const codificar = (s) => new TextEncoder().encode(s);
    return crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(codificar(recibido), codificar(esperado))
      : recibido === esperado;
  } catch {
    return recibido === esperado;
  }
}

function json(status, cuerpo) {
  return new Response(JSON.stringify(cuerpo, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
