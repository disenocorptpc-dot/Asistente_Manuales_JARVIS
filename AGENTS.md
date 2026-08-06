# AGENTS.md — contexto para agentes de IA que retomen este repo

Si estás leyendo esto desde cero: este archivo te ahorra re-descubrir lo que ya
se pagó. Léelo completo antes de tocar código.

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
  piezas grandes de cerca). Grupo `orientado` en el grafo + botón «De pie»:
  un marcador en pared muestra la pieza acostada porque el modelo se asienta
  sobre el plano de la imagen (el tope de la imagen es -Z local; si en campo
  la pieza cuelga hacia abajo, el signo va al revés en scene.js). Slider de
  explotado con pulgar de 32 px.
- F2 — addon de Blender (metadata + linter). F3 — HUD hi-tech completo.
  F4 — captura + deep links. F5–F7 — ver HANDOFF §12.

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
