# AGENTS.md — contexto para agentes de IA que retomen este repo

Si estás leyendo esto desde cero: este archivo te ahorra re-descubrir lo que ya
se pagó. Léelo completo antes de tocar código.

## TL;DR para una IA que aterriza sin memoria

- Esto es un **visor 3D AR** (8th Wall + Three.js, sin build step) que ancla un
  GLB al mundo real a escala 1:1 usando un marcador impreso. Vive en
  `https://asistente-manuales-jarvis.disenocorptpc.workers.dev`.
- **Hay DOS repos.** Éste es el de CÓDIGO. El de CONTENIDO (los GLB publicados)
  es [JARVIS-Modelos](https://github.com/disenocorptpc-dot/JARVIS-Modelos),
  clonado como carpeta **hermana** en la misma máquina si vas a usar el modo
  local de publicación. Ver [§ Dos repos](#dos-repos-código-y-contenido-f6-decidido-2026-08-06).
- **Un `git push` a `main` de CUALQUIERA de los dos repos despliega solo a
  producción.** No hay staging, no hay `.github/workflows` (la CI es Cloudflare
  Workers Builds). Ver [§ push=deploy](#️-un-push-a-main-es-un-deploy-a-producción).
  Antes de pushear, piensa si lo que vas a subir debe estar público YA.
- El repo tiene **tres secrets/tokens distintos, no los confundas**:
  1. Un PAT clásico de GitHub (`ghp_…`) que el usuario ha ido pegando en el
     chat para pushes puntuales — **rótalo si lo ves en un transcript**, no es
     de uso diario.
  2. Un fine-grained PAT de GitHub guardado en el credential manager de
     Windows, enjaulado a sólo escribir en `JARVIS-Modelos` (modo local).
  3. Dos **secrets del Worker** (`wrangler secret list` desde este repo):
     `PUBLICAR_TOKEN` (el que pegan los compañeros en las preferencias del
     addon de Blender) y `GITHUB_PAT_MODELOS` (fine-grained, sólo Contents de
     JARVIS-Modelos, usado por `src/worker.js` para hacer commits vía API).
     Ninguno de estos dos sale nunca del Worker ni del addon.
- **Antes de tocar el addon de Blender**, sabe que existe en DOS copias que
  deben ser idénticas: `herramientas/blender-addon/jarvis_glb.py` (canónica) y
  `public/addon/jarvis_glb.py` (la que el equipo descarga desde el visor). Edita
  la canónica, copia a `public/addon/` y a
  `%APPDATA%\Blender Foundation\Blender\<version>\scripts\addons\` si vas a
  probar en vivo. `herramientas/blender-addon/probar_addon.py` truena si las
  copias difieren — córrelo después de cualquier edición.
- **Antes de tocar `contenido.json`, `scale.js`, el marcador o el linter del
  addon**, lee VERIFICACIONES.md completo — son correcciones pagadas leyendo
  el binario minificado del motor, no intuidas.

## Orden de lectura obligatorio

1. **[PLAYBOOK-WebAR.md](PLAYBOOK-WebAR.md)** — destilado empírico del proyecto
   Pipo/Wonderwoods. Todo lo verificado en campo vive ahí (secuencia de
   arranque de 8th Wall, trampas no documentadas, ciencia de marcadores,
   presupuestos de rendimiento). §3, §4 y §7 NO aplican aquí (eran del
   personaje en video), pero §2, §5, §6, §9 y §10 son ley.
2. **[HANDOFF-Visor3D-AR.md](HANDOFF-Visor3D-AR.md)** — el brief: qué se
   construye, decisiones CERRADAS (no renegociar sin avisar), contrato de
   datos, fases. Ojo: tiene una corrección conocida, ver abajo.
3. **[VERIFICACIONES.md](VERIFICACIONES.md)** — las 10 verificaciones del
   binario y del compilador, con evidencia. No las repitas: ya están hechas.
4. Este archivo.

## La corrección más importante (no está en el handoff)

`detail.scaledWidth` de los eventos `imagefound/imageupdated` **NO** es el
ancho del marcador en unidades de mundo — es **proporción de aspecto
normalizada**. Los metros viven en `detail.scale`. Y `scale × scaledWidth`
sólo colapsa al ancho real **si el marcador es vertical**; en horizontal
sobreestima (20×15 cm → 6.67 u/m en vez de 5.00, 33% de más). La fórmula
correcta para los dos casos, ya implementada en
[public/app/core/scale.js](public/app/core/scale.js):

```js
anchoMundo = detail.scale * detail.scaledWidth
           / Math.max(detail.scaledWidth, detail.scaledHeight);
```

Si tocas escala, no "corrijas" de vuelta a lo que dice el handoff §4.

## El marcador NO está amarrado a la pieza

Decisión del usuario (2026-08-06): **la pieza se carga a mano y el visor no
trae ninguna precargada.** Por eso los marcadores viven en
`contenido.marcadores` a nivel raíz, no dentro de `piezas[]`, y el shell los
carga TODOS siempre — sin depender de `?pieza=`. El marcador aporta pose,
escala y nada más; nunca identidad.

Antes esto estaba al revés: el modo marcador sólo se activaba con un deep link
que trajera `marcador` registrado, así que sin deep link el visor caía siempre
a hitTest y **nunca daba un 1:1 real**. No lo vuelvas a acoplar.

## El marcador mide 15.0 × 20.0 cm, vertical. No es negociable

Tres restricciones independientes convergen ahí (VERIFICACIONES §9):

1. El compilador fuerza el crop de un target plano a `height = width × 4/3`.
   Otra proporción **se recorta en silencio** y el área trackeada deja de medir
   `ancho_cm` — el 1:1 miente sin dar ningún error.
2. `constants.json` exige mínimo 480×640 px de crop. A `px = cm × 32`
   (HANDOFF §10) eso es exactamente 15 × 20 cm. Bonus: 480×640 es también el
   tamaño nativo de la imagen de luminancia, así que no hay remuestreo.
3. Ocupar ≥30% del cuadro a 35 cm pide ≥12.1 cm de ancho.

El A5 de 14.8 cm del HANDOFF §6 **falla 1 y 2**. `generar-marcador.py` aborta
con las tres guardas explicadas, así que no hay forma de generar un marcador
que compile mal — pero si cambias medidas, entiende por qué antes de tocarlas.

## Mapa de archivos

```
public/                      ← lo ÚNICO que sirve el Worker (assets estáticos)
  index.html                 ← entry único, importmap (three@0.160.0 clavado), sin build step
  contenido.json             ← TODO parámetro medido/decidido, con su _porque
  guia-equipo.pdf            ← manual de una hoja para el equipo (generado con reportlab+segno,
                                ver scratchpad histórico; regenerar si cambia algo de UI/voz)
  favicon.png · apple-touch-icon.png
  addon/jarvis_glb.py        ← COPIA descargable del addon (debe ser idéntica a la canónica)
  image-targets/             ← target compilado (JARVIS-M23.json + luminancia 480×640)
  models/                    ← sólo el GLB sintético de F0; los publicados viven en JARVIS-Modelos
  app/
    boot.js                  ← arranque: precarga XR8, portal, elección de shell, resolverPieza()
    ar-shell.js              ← ÚNICO junto con anchor-* que importa XR8: permisos, pipeline, luces
    anchor-marker.js         ← modo A: marcador(es) → pose + escala 1:1 (nunca identidad)
    anchor-hittest.js        ← modo B: superficie sin marcador (tabletop, escala estimada)
    desktop-shell.js         ← fallback orbital sin cámara; también donde se desarrolla el core
    debug.js                 ← ?debug=1, expone window.jarvis = {visor, hud}
    core/                    ← CERO imports de XR8, CERO DOM (regla dura, ver abajo)
      coordinar.js           ← ensambla el visor; tween de explotado (explotar/onExplotar)
      scene.js               ← grafo ancla→orientado→escalado→modelo; orientar('mesa'|'pared')
      loader.js               ← GLB→piezas; GLTFLoader+DRACOLoader; modo inspección si falta contrato
      scale.js               ← fórmula de escala 1:1 (normalizada, ver corrección abajo)
      explode.js             ← despiece procedural + override por pieza
      layers.js              ← toggles por capa (extras.capa)
      pick.js                ← raycast → ficha de producción
      orbita.js              ← turntable sobre el Y de `escalado`
    ui/
      hud.js  hud.css        ← HUD, catálogo (📚), fachada escalaA/orientaA/alternarCapa
      voz.js                 ← comandos de voz, ver tabla abajo. emparejar() es pura y testeable
      sonido.js               ← efectos sintetizados con Web Audio, ver tabla abajo
src/
  worker.js                  ← ÚNICA ruta de código del Worker: PUT /api/publicar (ver F6 abajo)
herramientas/                ← FUERA de public/, no se sirve
  generar-marcador.py        ← arte del marcador, generativo y determinista por semilla
  evaluar-marcador.py        ← valida un PNG de marcador contra los 4 criterios de campo
  generar-glb-sintetico.py   ← GLB de prueba multi-pieza (Blender headless)
  publicar-modelo.py         ← publicación modo LOCAL (clones + git); ver F6
  .publicar.token            ← (gitignored) el token del equipo, en texto plano, un renglón
  marcadores/                ← arte generado del marcador vigente (300dpi/32ppcm/hoja A4)
  blender-addon/
    jarvis_glb.py            ← el addon CANÓNICO — edita aquí, luego propaga
    probar_addon.py          ← suite headless: linter, contrato en el GLB, sync de copias
wrangler.jsonc                ← config del Worker del visor (comentarios explican R2 estacionado)
.gitattributes                 ← *.pdf/*.glb/*.png/*.webp/*.ico como binarios SIEMPRE
```

## Comandos de voz (`public/app/ui/voz.js`, función `emparejar`)

Vocabulario cerrado, es-MX, sin acentos, por contención de frase — no
transcribe dictado. Push-to-talk: mantener presionado el 🎤, hablar, soltar.

| dices | acción |
|---|---|
| «uno a uno» / «tamaño real» / «escala real» | escala 1:1 |
| «mitad» / «media» / «cincuenta» | escala 1:2 |
| «décimo» / «décima» / «miniatura» / «diez» | escala 1:10 |
| «explota» / «explotado» / «explosión» / «despiece» / «desarma» | abre el despiece (tween 1.2 s) |
| «arma» / «cierra» / «junta» | cierra el despiece |
| «origen» / «reinicia» / «restaura» / «inicio» | órbita detenida y de frente + despiece cerrado + escala inicial |
| «órbita» / «gira» / «rota» | inicia el turntable |
| «alto» / «quieto» / «para» / «detente» / «stop» | detiene el turntable |
| «mesa» | orientación: marcador horizontal, sin giro |
| «pared» | orientación: marcador vertical, +90° sobre X |
| nombre exacto de una capa del GLB cargado | alterna esa capa (vocabulario dinámico, no hardcodeado) |

Orden de evaluación en el código: escalas → explotar → **origen (antes de
órbita, para no chocar con «reinicia»)** → órbita → orientación → capas (al
final, para no tapar los comandos fijos).

## Sonido del HUD (`public/app/ui/sonido.js`)

Sintetizado con Web Audio — CERO archivos de audio. `crearSonido(config)`
devuelve: `activo` (getter) · `alternar()` (toggle, persiste en localStorage
`jarvis_sonido`) · `tick()` (toggles genéricos) · `blip()` (ficha de pieza) ·
`escucha()` (mic abierto) · `exito()` / `error()` · `lock()` (enganche de
marcador — el dramático) · `perdida()` (**vacío a propósito**, ver Ronda #3) ·
`carga()` (GLB listo) · `explota()` / `arma()` · `orbita(encendida)`.
AudioContext se crea/reanuda en el primer `pointerdown` (autoplay).

## Secrets y tokens — mapa completo (no confundir)

| quién | dónde vive | para qué | cómo verificar |
|---|---|---|---|
| PAT clásico `ghp_…` | ninguna parte fija — se pega ad-hoc | pushes puntuales del asistente al repo de código | si aparece en un chat, **rotarlo** |
| PAT fine-grained (modo local) | Windows Credential Manager, `useHttpPath` amarrado a `JARVIS-Modelos.git` | `git push` desde el clon local de JARVIS-Modelos | `git -C ../JARVIS-Modelos push --dry-run` (no debe pedir credenciales) |
| `PUBLICAR_TOKEN` | secret del Worker de este repo + `herramientas/.publicar.token` (gitignored) | lo pega el equipo en las preferencias del addon (modo remoto) | `npx wrangler secret list` |
| `GITHUB_PAT_MODELOS` | secret del Worker de este repo únicamente | `src/worker.js` lo usa para firmar commits vía Git Data API | `npx wrangler secret list`; nunca debería salir de ahí |

Si `PUT /api/publicar` responde 503: los secrets se cayeron (se ha visto que
un deploy de la CI los tira). `wrangler secret list` para confirmar y reponer
— `PUBLICAR_TOKEN` desde `.publicar.token`, `GITHUB_PAT_MODELOS` regenerando
en GitHub si ya no está guardado en ningún lado.

## Preferencias del addon de Blender (`JV_Preferencias`)

- `publicar_via`: `remoto` (default — HTTP al Worker, sin git) / `local`
  (avanzado — corre `publicar-modelo.py`, necesita los dos repos clonados).
- `token_publicacion`: el token del equipo (modo remoto).
- `url_visor`: default la URL de producción; cámbiala sólo para pruebas.
- `repo_codigo`: carpeta LOCAL del clon de este repo (NO url) — sólo modo
  local; la UI valida en vivo que el script y el repo hermano existan.

## Reglas duras de arquitectura

- **`public/app/core/` no importa XR8 ni toca el DOM.** Recibe el grafo del
  shell y expone `update(dt)`. Nunca escribe `camera.position` (en AR la
  cámara la mueve el SLAM). Esta regla es lo que permite desarrollar sin
  teléfono y sobrevivir a un cambio de motor.
- Los únicos archivos que conocen XR8: `ar-shell.js`, `anchor-marker.js`,
  `anchor-hittest.js`.
- **Sin build step.** Un `index.html` con importmap. Versiones de CDN clavadas
  EXACTAS (`three@0.160.0`, `@8thwall/engine-binary@1.0.0`) — un QR impreso no
  puede depender de un rango flotante.
- Todo parámetro medido/decidido vive en `public/contenido.json` con su
  `_porque`, no en el código.
- `public/` es lo único que se sirve. Herramientas y docs viven fuera.
- Rendimiento (Playbook §5, medido como jank real): sin `backdrop-filter`,
  sin `mix-blend-mode`, sin `filter` animado; sólo se animan `opacity` y
  `transform`; `pixelRatio` techo 1.5; `antialias: false`.

## Contrato de datos del GLB (HANDOFF §6)

- Metros, Y-up, extras de escena con `palace_schema: 1` y `unidad: "m"`;
  extras por objeto con `pieza_id`, `capa`, material/proceso/acabado, etc.
- Verificado: los extras de escena y de objeto SÍ sobreviven al exportador
  glTF de Blender 5.2 con `export_extras=True`.
- El loader degrada avisando: GLB sin `palace_schema` entra en **modo
  inspección** (meshes por nombre, 1 unidad = 1 m, aviso en el HUD). Con
  contrato declarado y unidad ≠ "m", el rechazo es fatal a propósito.

## Cómo correr y probar

```bash
python -m http.server 8317 --directory public
```

- Desktop (desarrollo del core): `http://localhost:8317/?modo=desktop&debug=1`
- El GLB se carga con el botón **⬆ Cargar GLB** del HUD.
- El AR real sólo se valida en teléfono con HTTPS (deploy con
  `wrangler deploy` o túnel). El escritorio NO valida tracking.
- GLB sintético de prueba: `herramientas/generar-glb-sintetico.py`
  (Blender headless, instalado en `C:\Program Files\Blender Foundation\Blender 5.2\`):

```bash
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P herramientas/generar-glb-sintetico.py -- public/models/SIG-DEMO-01.glb
```

- Para simular la carga de archivo en un navegador automatizado: fetch del
  GLB → `new File(...)` → `DataTransfer` → asignar a `#hud-archivo` y
  disparar `change` (el diálogo del OS no se puede automatizar).

## Estado actual y qué sigue

- **F0 ✅** — verificaciones, scaffold, core completo (carga dinámica, escala,
  explotado procedural+override, capas, picking, fichas), shells AR/desktop,
  HUD funcional con botón de carga, `?debug=1`. Verificado en navegador.
- **F1 ✅ en código, ⏳ falta el teléfono** — hecho: arte del marcador generado
  por script y validado, target compilado, marcador desacoplado de la pieza,
  fórmula de escala normalizada, protocolo de enganche en el portal y en el
  HUD, e indicador que distingue **1:1 medido de `≈ 1:1` estimado** (autorizar
  sobre una escala estimada es el peor error del proyecto, HANDOFF §4).
  **Pendiente, y sólo se puede hacer con hardware:** imprimir
  `herramientas/marcadores/JARVIS-M23-hoja-A4-300dpi.png` al 100%, `wrangler
  deploy`, y medir el 1:1 en un teléfono real contra un objeto de dimensión
  conocida. El escritorio NO valida tracking.
- **v0.1.0** — tag del primer 1:1 real verificado en teléfono (2026-08-06).
- **Ronda de campo #1** (feedback del teléfono, mismo día): la escena de XR8
  nace VACÍA y el GLB se veía NEGRO — las luces viven en cada shell y el AR no
  tenía; ahora espeja las de desktop. Escalas 1:2 y 1:10 además del 1:1 (ver
  piezas grandes de cerca). Grupo `orientado` en el grafo con botón de
  orientación. Slider de explotado con pulgar de 32 px.
- **Ronda de campo #2** (mismo día): el signo del giro iba al revés — la pieza
  quedaba mirando hacia abajo. **Empírico: el tope de la imagen es +Z en el
  target de 8th Wall, no -Z como en ARKit.** Queda `pared: +Math.PI/2` en
  scene.js. Los modos se renombraron a lo que de verdad compensan — dónde está
  el marcador: «Mesa» (sin giro) / «Pared» (+90°); "Plano/De pie" era ambiguo
  y el usuario los leyó al revés. Pendiente de campo: si en pared la pieza
  queda de pie pero DA LA ESPALDA, falta `rotation.y = Math.PI` en 'pared'.
- **F5 adelantada en parcial** (pedido del usuario, 2026-08-06): voz
  push-to-talk por **Web Speech API** (`ui/voz.js`), es-MX, vocabulario
  cerrado: explota/arma (tween animado en `coordinar.js`), órbita/alto
  (`core/orbita.js`, turntable sobre el Y de `escalado` — así se ve igual en
  mesa y pared), escalas, mesa/pared, y **nombres de capa del GLB cargado**
  (vocabulario dinámico de los extras, cero hardcodeo). El matcher
  `emparejar()` es puro y exportado: se prueba sin micrófono. Sin la API el
  botón 🎤 desaparece solo. Chrome/Android sólido; iOS Safari frágil —
  Whisper por Worker queda como fallback cuando F6 traiga el Worker con
  código. La voz no pinta UI: pasa por la fachada del HUD
  (escalaA/orientaA/alternarCapa) para que los botones queden consistentes.
  Con `?debug=1`, `window.jarvis = {visor, hud}` es el asidero de consola
  para diagnosticar en dispositivo.
- **Sonido del HUD** (`ui/sonido.js`): sintetizado con Web Audio, CERO assets
  — chirps de seno/triángulo y un soplo de ruido filtrado para el despiece;
  el carácter vive en parámetros, no en MP3s. El AudioContext se crea en el
  primer gesto (política de autoplay iOS). Eventos: lock/pérdida del
  marcador, carga de GLB, explota/arma, órbita, mic, éxito/error de voz, y
  tick en cada toggle. Botón 🔇 persistente en localStorage
  (`jarvis_sonido`); volumen master en `contenido.json`.
- **F2 ✅ addon de Blender** (`herramientas/blender-addon/jarvis_glb.py`,
  probado con `probar_addon.py`: 24 checks headless + carga en el visor).
  Paneles de Objeto/Escena con el contrato §6 en claves individuales, LINTER
  QUE BLOQUEA (unidades, ids, capa, presupuestos §10, texturas >2048),
  export Draco automático (el visor ya trae DRACOLoader en `core/loader.js`,
  decoder del mismo three clavado), y botón «Publicar al visor» que corre
  publicar-modelo.py (ruta del repo en las preferencias del addon).
  Arquitectura reciclada de glb_manuales_addon (otro proyecto, otro
  contrato — aquel repo no se toca). Dos trampas aprendidas a golpes:
  (1) el exportador glTF vuelca las system properties a extras, así que la
  PropertyGroup saldría duplicada — se oculta con
  `bl_system_properties_get()` y se restaura del respaldo; (2) leer un
  PropertyGroup cuyo respaldo se borró es puntero colgante y Blender
  REVIENTA (ACCESS_VIOLATION) — todo se lee a escalares ANTES de ocultar.
- **Catálogo en la app** (`ui/hud.js`, pedido de campo tras F6): botón 📚 en
  el HUD que lista `piezas.json` del repo de modelos (más reciente primero) y
  carga al tocar — resuelve que el deep link por pieza no era buena UX
  primaria. Sigue la regla aditiva: sin `contenido.catalogo` el botón
  desaparece; si no responde, avisa y la carga manual con ⬆ sigue viva.
- **Ronda de campo #4** (2026-08-06, primer uso real del addon por un
  compañero): publicar la MISMA revisión dos veces daba un 409 en jerga de
  CLI ("--rev R2?", "sobrescribir=1") que no significaba nada en Blender.
  Ahora el addon traduce el mensaje ("sube la Revisión en el panel de
  Escena…") y el diálogo de export gana un checkbox real **«Reemplazar la
  revisión ya publicada»** (`sobrescribir`) en vez de exigir flags de texto.
  v1.2.1. Lección: cualquier mensaje que cruce del script/Worker al addon
  necesita reescribirse en vocabulario de Blender, nunca pasar el HTTP/CLI
  crudo al usuario.
- F3 — HUD hi-tech completo. F4 — captura + deep links (el deep link ya
  existe; falta QR y captura). F5 — falta Whisper. F7 — gestos.

## Marcadores: cómo generar y compilar uno nuevo

```bash
python herramientas/generar-marcador.py --semilla 23
python herramientas/evaluar-marcador.py herramientas/marcadores/JARVIS-M23-target-300dpi.png 15.0
```

El arte es **generativo y determinista por semilla** — no un binario huérfano:
se regenera, se audita y se itera contra números. Es generativo porque lo que
el tracker quiere es lo contrario de lo que se ve elegante a mano (contraste
duro, detalle irregular parejo, cero repetición, cero simetría, cero áreas
planas): eso es un algoritmo, no un dibujo.

Semilla 23 elegida barriendo 3/7/11/19/23 y escogiendo por **aguante a la
inclinación**, que es el criterio que decide en campo: 3054 puntos repetibles
(mínimo 250), 100% de cobertura, 37% del cuadro a 35 cm, y sobreviven 1815
puntos a 7° donde el menú medido en el BRIEF conservaba 18% de 206.

Compilar (el CLI es interactivo; `normalizePath` quita las comillas, así que
las rutas con espacios pasan entrecomilladas):

```bash
OVERWRITE_FILES=true npx @8thwall/image-target-cli
# respuestas: "<ruta>/JARVIS-M23-target-32ppcm.png" · 1 (flat) · Y · "<ruta>/public/image-targets" · JARVIS-M23
```

Después: registrar `{id, target_json, ancho_cm, alto_cm}` en
`contenido.marcadores`. **`ancho_cm` es el ancho del área trackeada impresa** y
de ahí sale todo el 1:1: si miente, el visor miente. La regla de 10 cm de la
hoja existe para atrapar justo eso — una impresora al 96% mete 4% de error.

Ojo: `herramientas/evaluar-marcador.py` tiene una 4ª prueba (feature points del
compilador de MindAR) que **no corre** — necesita `herramientas/compilar-en-node.mjs`,
que se quedó en el repo de Pipo. Las pruebas 1–3 y el aguante a la inclinación
sí corren, y son las que se usaron para elegir la semilla.

## Decisiones del usuario que NO se renegocian

- 8th Wall open source + Three.js + Worker de Cloudflare (no Pages). Cerrado.
- El tema de verificar la escala de impresión del marcador **no le interesa
  al usuario** — no volver a plantearlo; dejar lo que el handoff ya pide. Está
  cubierto sin fricción: la regla de 10 cm va impresa en la hoja y no hay
  ningún diálogo en la app que lo pregunte.
- **La pieza se carga a mano; el visor no trae ninguna precargada** (decidido
  2026-08-06). `piezas: []` está vacío a propósito. El mecanismo de deep link
  `?pieza=` se queda para F4, pero no se precarga nada por default.

## Dos repos: código y contenido (F6, decidido 2026-08-06)

Los GLB publicados NO viven aquí — viven en
**[JARVIS-Modelos](https://github.com/disenocorptpc-dot/JARVIS-Modelos)**
(privado), servido por el worker `jarvis-modelos...workers.dev` (assets puros,
CORS abierto, cache inmutable). Razones: ese repo engorda sin culpa y es
desechable/reescribible (el visor lo consume por HTTP, no como dependencia);
un PAT fine-grained de sólo ese repo publica modelos sin poder tocar código; y
el GLB + su entrada en `piezas.json` viajan en el mismo commit (atómico).

- **Publicar**: `python herramientas/publicar-modelo.py pieza.glb --id X
  --nombre "…" --rev R1` — valida presupuestos, copia, registra, commitea y
  `wrangler deploy` (ese deploy ES la publicación; el push es respaldo).
  Espera el repo de modelos como hermano de éste (`../JARVIS-Modelos`).
- **REGLA DE DISEÑO (pedida por el usuario): el catálogo es ADITIVO.** El
  visor sólo lo consulta cuando llega `?pieza=` y no está en el registro
  local; si el worker de contenido no responde, arranca normal y la carga
  manual con ⬆ funciona igual. El visor JAMÁS depende del catálogo.
- **El rail de R2 quedó ESTACIONADO**, completo y commiteado en
  `src/worker.js` (PUT /api/publicar con token + candado de 9 GB). No se usa
  porque R2 exige tarjeta. Si el repo de modelos pesa demasiado: activar R2,
  crear bucket, restaurar `main` y `r2_buckets` en wrangler.jsonc (las
  instrucciones están ahí en comentario). El secret PUBLICAR_TOKEN ya está
  montado en el worker del visor y el token local en
  `herramientas/.publicar.token` (gitignored).

## Publicación del equipo por HTTP (F6 completo, 2026-08-06)

Los compañeros NO usan git. El addon (modo "Servidor del equipo", el default)
manda el GLB por HTTPS a `PUT /api/publicar` del worker del visor con el
**token del equipo** (`herramientas/.publicar.token`, secret PUBLICAR_TOKEN);
`src/worker.js` arma un **commit atómico** en JARVIS-Modelos vía la Git Data
API de GitHub (GLB + piezas.json juntos, reintento si la rama se movió) usando
el secret GITHUB_PAT_MODELOS (fine-grained, sólo Contents de ese repo, nunca
sale del worker). La CI despliega y la pieza cae al 📚 Catálogo de la app.

Kit de un compañero nuevo: bajar
`https://asistente-manuales-jarvis.disenocorptpc.workers.dev/addon/jarvis_glb.py`
(Install from Disk) + pegar el token del equipo en las preferencias. Nada
más. La descarga es una COPIA en `public/addon/` — al editar el addon hay
que recopiarla, y `probar_addon.py` truena si difiere del canónico. E2E
verificado: commit 1acc98a hecho por el worker.

El catálogo no crece por revisión: publicar el mismo pieza_id REEMPLAZA su
renglón en piezas.json (el worker y el script lo hacen igual). Los GLB
viejos se quedan en el repo a propósito (historia/rollback/cache). Retirar
una pieza completa = editar piezas.json en el repo de modelos.

Trampas pagadas: (1) el Browser Integrity Check de Cloudflare responde
**403/1010** a un urllib sin User-Agent — el addon manda `jarvis-addon/...`;
(2) se ha visto a los deploys de la CI **tirar los secrets** del worker — si
/api/publicar responde 503, `wrangler secret list` y reponer (el token del
equipo está en `.publicar.token`; el PAT hay que regenerarlo en GitHub).
El modo local (script + clones + credencial enjaulada) sigue vivo como
camino avanzado.

## ⚠️ Un push a `main` es un deploy a producción

El repo está conectado a **Cloudflare Workers Builds** — la CI de Cloudflare, no
GitHub Actions (no hay `.github/`). Cada push a `main` se construye y publica
solo en <https://asistente-manuales-jarvis.disenocorptpc.workers.dev>.

- **No hace falta `wrangler deploy`** para publicar, ni tener `wrangler`
  instalado. El token `asistente-manuales-jarvis build token` de la cuenta lo
  creó Cloudflare al conectar el repo; no se usa a mano y no hay que pedirlo.
- Consecuencia: no existe "commitear y ya", ni rama de staging. Si algo no debe
  estar público todavía, no va a `main`.
- Verificado el 2026-08-06: se pusheó F1 sin tocar Cloudflare y el sitio quedó
  sirviendo el código nuevo en minutos (`.wrangler/` nunca existió en el clon).

## Git y credenciales

- Identidad local del repo: `rsantarosa_palace / rsantarosa@palaceresorts.com`.
- El `gh` CLI de la máquina original está autenticado como
  `talentocontarifa-bot`, que NO tiene acceso a este repo — el push se hace
  con un PAT del dueño (`disenocorptpc-dot`), pasado por header sin
  persistirlo (patrón del Playbook §9):
  `git -c http.extraheader="AUTHORIZATION: Basic <b64(x-access-token:PAT)>" push`
- **Nunca** commitear tokens ni guardarlos en la config de git. `.gitignore`
  ya bloquea `*.token` y `.env`.
- Masters pesados (FBX/PSD/blend) NO van al repo; los patrones del
  `.gitignore` están anclados a la raíz para no matar `public/models/*.glb`.

## Presupuestos (criterios de aceptación, HANDOFF §10)

≤300k triángulos (techo duro 500k) · ≤80 draw calls · ≤15 materiales ·
GLB ≤15 MB · texturas KTX2 ≤2048px · sesión útil 3–4 min.
Regla anti-explosión de draw calls: sólo lo interactivo vive como pieza
separada; tornillería y similares se fusionan con `cantidad` en la ficha.
