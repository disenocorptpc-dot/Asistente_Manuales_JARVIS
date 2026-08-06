/* Publicación del equipo (F6 completo): el Worker convierte un PUT de un GLB
   en un COMMIT ATÓMICO en el repo JARVIS-Modelos vía la API de GitHub.

     PUT /api/publicar?archivo=X.glb&pieza_id=..&nombre=..&rev=..&autor=..
         header x-publicar-token: <token del equipo>

   Por qué así: los compañeros modelan, no gitean. El addon manda el GLB por
   HTTPS con el token del equipo; este Worker — con un fine-grained PAT de
   SOLO ese repo guardado como secret — arma el commit (GLB + piezas.json
   JUNTOS: nunca hay registro sin modelo) y la CI de Cloudflare despliega.
   GitHub sigue siendo la fuente de verdad; el Worker no almacena nada.

   Dos llaves, dos portadores:
   - PUBLICAR_TOKEN (secret): lo que traen los addons del equipo. Sólo sirve
     aquí, sólo publica GLBs, se rota en un minuto si se filtra.
   - GITHUB_PAT_MODELOS (secret): sólo Contents de JARVIS-Modelos. Nunca sale
     del Worker.

   (El rail anterior de publicación a R2 vive en la historia de git de este
   archivo — se retiró porque R2 exige tarjeta y este camino no.) */

const REPO = 'disenocorptpc-dot/JARVIS-Modelos';
const RAMA = 'main';
const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.glb$/;
const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const REV_VALIDA = /^R[0-9]{1,3}$/;
const BYTES_MAX = 25 * 1024 * 1024; // techo duro; el presupuesto §10 es 15

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/publicar') return publicar(req, env, url);
    return new Response('no existe', { status: 404 });
  },
};

async function publicar(req, env, url) {
  if (req.method !== 'PUT') return json(405, { error: 'método no permitido' });
  if (!env.PUBLICAR_TOKEN || !env.GITHUB_PAT_MODELOS)
    return json(503, { error: 'publicación sin configurar: faltan secrets en el Worker' });
  if (!tokenValido(req.headers.get('x-publicar-token'), env.PUBLICAR_TOKEN))
    return json(401, { error: 'token de publicación inválido' });

  const p = Object.fromEntries(url.searchParams);
  if (!NOMBRE_VALIDO.test(p.archivo ?? ''))
    return json(400, { error: `archivo inválido: "${p.archivo}" (letras/números/._- y .glb)` });
  if (!ID_VALIDO.test(p.pieza_id ?? ''))
    return json(400, { error: `pieza_id inválido: "${p.pieza_id}"` });
  if (!REV_VALIDA.test(p.rev ?? ''))
    return json(400, { error: `revisión inválida: "${p.rev}" (R1, R2…)` });
  if (!p.nombre)
    return json(400, { error: 'falta nombre' });

  const cuerpo = await req.arrayBuffer();
  if (!cuerpo.byteLength) return json(400, { error: 'GLB vacío' });
  if (cuerpo.byteLength > BYTES_MAX)
    return json(413, { error: `${(cuerpo.byteLength / 1048576).toFixed(1)} MB: el techo duro es 25 MB` });

  const rutaGlb = `public/modelos/${p.archivo}`;

  // Inmutabilidad: mismo nombre dos veces es casi siempre error de revisión.
  if (!('sobrescribir' in p)) {
    const existe = await fetch(`https://api.github.com/repos/${REPO}/contents/${rutaGlb}?ref=${RAMA}`,
      { headers: cabeceras(env) });
    if (existe.ok)
      return json(409, {
        error: `${p.archivo} ya está publicado. Revisión nueva = nombre nuevo ` +
               `(¿--rev R${Number(p.rev.slice(1)) + 1}?); si es corrección honesta, sobrescribir=1.`,
      });
  }

  /* Commit atómico con la Git Data API. Reintento una vez si la rama se movió
     entre leer el ref y escribirlo (dos publicaciones simultáneas). */
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return json(200, await commitAtomico(env, p, cuerpo, rutaGlb));
    } catch (e) {
      ultimo = e;
      if (!String(e).includes('422')) break; // sólo el ref movido se reintenta
    }
  }
  return json(502, { error: `GitHub no cooperó: ${ultimo}` });
}

async function commitAtomico(env, p, cuerpo, rutaGlb) {
  // 1. Dónde está la rama
  const ref = await gh(env, `/git/ref/heads/${RAMA}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(env, `/git/commits/${baseSha}`);

  // 2. El catálogo actual → entrada nueva/reemplazada del mismo pieza_id
  const catRaw = await gh(env, `/contents/public/piezas.json?ref=${baseSha}`);
  const catalogo = JSON.parse(deB64(catRaw.content));
  const entrada = {
    pieza_id: p.pieza_id,
    nombre: p.nombre,
    modelo: `modelos/${p.archivo}`,
    revision: p.rev,
    publicado: new Date().toISOString().slice(0, 10),
  };
  if (p.autor) entrada.autor = p.autor;
  catalogo.piezas = [
    ...(catalogo.piezas ?? []).filter((q) => q.pieza_id !== p.pieza_id),
    entrada,
  ].sort((a, b) => a.pieza_id.localeCompare(b.pieza_id));

  // 3. Blobs → árbol → commit → mover la rama
  const blobGlb = await gh(env, '/git/blobs', {
    content: aB64(cuerpo), encoding: 'base64',
  });
  const blobCat = await gh(env, '/git/blobs', {
    content: JSON.stringify(catalogo, null, 2) + '\n', encoding: 'utf-8',
  });
  const arbol = await gh(env, '/git/trees', {
    base_tree: baseCommit.tree.sha,
    tree: [
      { path: rutaGlb, mode: '100644', type: 'blob', sha: blobGlb.sha },
      { path: 'public/piezas.json', mode: '100644', type: 'blob', sha: blobCat.sha },
    ],
  });
  const mb = (cuerpo.byteLength / 1048576).toFixed(1);
  const commit = await gh(env, '/git/commits', {
    message: `publica ${p.archivo}: ${p.nombre} (${mb} MB)` +
             (p.autor ? `\n\nPublicado por: ${p.autor} (vía Worker)` : '\n\n(vía Worker)'),
    tree: arbol.sha,
    parents: [baseSha],
  });
  await gh(env, `/git/refs/heads/${RAMA}`, { sha: commit.sha }, 'PATCH');

  return {
    ok: true,
    archivo: p.archivo,
    bytes: cuerpo.byteLength,
    commit: commit.sha.slice(0, 7),
    url: `https://jarvis-modelos.disenocorptpc.workers.dev/modelos/${p.archivo}`,
    deep_link: `https://asistente-manuales-jarvis.disenocorptpc.workers.dev/?pieza=${p.pieza_id}`,
    nota: 'la CI despliega en ~40 s; aparecerá en el 📚 Catálogo',
  };
}

/* ── GitHub API ──────────────────────────────────────────────────── */

function cabeceras(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_PAT_MODELOS}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'jarvis-publicador',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(env, ruta, cuerpo = null, metodo = null) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${ruta}`, {
    method: metodo ?? (cuerpo ? 'POST' : 'GET'),
    headers: { ...cabeceras(env), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok)
    throw new Error(`${r.status} en ${ruta}: ${(await r.text()).slice(0, 180)}`);
  return r.json();
}

/* base64 de un ArrayBuffer por bloques — un GLB de 25 MB no cabe en un
   String.fromCharCode(...todo) de un jalón. */
function aB64(buf) {
  const bytes = new Uint8Array(buf);
  const paso = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += paso)
    s += String.fromCharCode(...bytes.subarray(i, i + paso));
  return btoa(s);
}

/* El content de la API viene en base64 con saltos de línea, y trae UTF-8:
   atob a bytes y TextDecoder — atob directo destroza los acentos. */
function deB64(contenido) {
  const bin = atob(contenido.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function tokenValido(recibido, esperado) {
  if (!recibido || recibido.length !== esperado.length) return false;
  try {
    const cod = (s) => new TextEncoder().encode(s);
    return crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(cod(recibido), cod(esperado))
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
