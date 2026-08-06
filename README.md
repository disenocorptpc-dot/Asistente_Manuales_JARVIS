# JARVIS — Visor 3D AR de piezas de producción

Web app AR para previsualizar piezas de diseño industrial (señalización,
mobiliario expositor, esculturas Massivit) sobre el mundo real, a escala 1:1,
con despiece y metadata de producción.
**Coordinación de Diseño Industrial y 3D — The Palace Company.**

Dos usuarios, dos momentos: los **dueños** autorizan viendo la pieza a tamaño
real en su lugar; el **taller** consulta despiece, materiales y orden de
ensamble en el banco. Mismo visor, distinto modo.

## Documentos rectores (leer en este orden)

1. [PLAYBOOK-WebAR.md](PLAYBOOK-WebAR.md) — destilado empírico de Pipo/Wonderwoods.
2. [HANDOFF-Visor3D-AR.md](HANDOFF-Visor3D-AR.md) — el brief y las decisiones cerradas.
3. [VERIFICACIONES.md](VERIFICACIONES.md) — las 10 verificaciones del binario y
   del compilador de targets, con evidencia.
   ⚠️ Incluye dos **correcciones al handoff §4**: `scaledWidth` es proporción de
   aspecto, y el ancho de mundo es
   `scale × scaledWidth / max(scaledWidth, scaledHeight)` — la versión sin
   normalizar sobreestima 33% en un marcador horizontal.
   ⚠️ Y una **corrección al §6**: el marcador mide **15.0 × 20.0 cm**, no el A5
   de 14.8 del ejemplo — el compilador fuerza 3:4 y exige mínimo 480×640 px.
4. [AGENTS.md](AGENTS.md) — contexto condensado para retomar el proyecto
   (humano o agente de IA) sin re-descubrir nada.

## Correr en local

```bash
python -m http.server 8317 --directory public
```

Abrir `http://localhost:8317/?modo=desktop&debug=1` y cargar un GLB con el
botón **⬆ Cargar GLB** del HUD.

- GLB **con contrato** (extras `palace_schema` del pipeline): capas reales,
  fichas de producción completas, overrides de explotado.
- GLB **sin contrato**: modo inspección — cada mesh es pieza por su nombre,
  se asume 1 unidad = 1 m, con aviso visible.

La pieza **se carga a mano**: el visor no trae ninguna precargada. El marcador,
en cambio, se carga siempre — da pose y escala, nunca identidad, así que la
misma hoja impresa sirve para cualquier GLB.

El indicador de escala distingue **`1:1`** (derivado del ancho impreso del
marcador, exacto por construcción) de **`≈ 1:1`** con borde punteado (estimado
por el motor, sin referencia física). No se autoriza sobre el segundo.

Parámetros de URL: `?pieza=<pieza_id>` (deep link, si está registrada en
`contenido.json`) · `?modo=desktop` fuerza el fallback sin cámara ·
`?debug=1` panel de diagnóstico (motor · ancla · fps, expandible).

El AR de verdad exige **HTTPS y teléfono real** — el escritorio sólo valida el
core, nunca el tracking.

## Estructura

```
public/                  ← lo ÚNICO que se sirve
  index.html             ← entry único, importmap, sin build step
  contenido.json         ← parámetros medidos, con su porqué
  app/
    boot.js              ← arranque: precarga paralela, selección de shell
    ar-shell.js          ← XR8: permisos, canvas, pipeline
    anchor-marker.js     ← modo A: marcador → pose + escala 1:1 (nunca identidad)
    anchor-hittest.js    ← modo B: superficie sin marcador (tabletop)
    desktop-shell.js     ← fallback orbital sin cámara
    core/                ← CERO imports de XR8, CERO DOM
    ui/                  ← HUD paleta Palace (F0 funcional; look completo = F3)
    debug.js             ← ?debug=1
  models/
  image-targets/         ← target compilado + luminancia (480×640)
herramientas/            ← FUERA de public
  generar-marcador.py        ← arte del marcador: generativo y determinista
  evaluar-marcador.py        ← validador de arte de marcadores (de Pipo)
  generar-glb-sintetico.py   ← GLB de prueba multi-pieza (Blender headless)
  BRIEF-marcador.md          ← brief para diseño del arte del target
  test-extras.py             ← experimento: extras de escena en export glTF
  marcadores/                ← arte generado: 300 dpi, 32 px/cm y hoja A4
wrangler.jsonc           ← Cloudflare Worker de assets estáticos
```

## El marcador

15.0 × 20.0 cm **vertical**, generado por script y validado antes de imprimir:

```bash
python herramientas/generar-marcador.py --semilla 23
python herramientas/evaluar-marcador.py herramientas/marcadores/JARVIS-M23-target-300dpi.png 15.0
```

El arte es generativo porque lo que el tracker quiere es lo contrario de lo que
se ve elegante a mano: contraste duro, detalle irregular parejo, cero
repetición, cero simetría, cero áreas planas. Y siendo determinista por semilla,
no es un binario huérfano — se regenera y se itera contra números.

Las medidas tampoco son de gusto: el compilador fuerza el crop plano a 3:4 y
exige mínimo 480×640 px, y ocupar ≥30% del cuadro a 35 cm pide ≥12.1 cm de
ancho. Las tres condiciones convergen en 15 × 20 cm — y a `px = cm × 32` eso da
exactamente 480×640, el tamaño nativo de la luminancia. Ver
[VERIFICACIONES §9](VERIFICACIONES.md).

Imprimir `herramientas/marcadores/JARVIS-M23-hoja-A4-300dpi.png` **al 100%**, en
mate. La hoja trae la regla de 10 cm para atrapar una impresora que escale, y el
protocolo de enganche impreso al lado.

## Estado de fases (HANDOFF §12)

- **F0 ✅** — verificaciones §11, shell AR, core completo (carga dinámica de
  GLB, escala, explotado, capas, picking, fichas), verificado en navegador.
- **F1 ✅ en código y desplegado** — arte del marcador validado, target
  compilado, marcador desacoplado de la pieza, fórmula de escala normalizada,
  protocolo de enganche en la UI y distinción entre 1:1 medido y `≈ 1:1`
  estimado. **⏳ Falta el teléfono:** imprimir la hoja al 100% y medir el 1:1
  contra un objeto de dimensión conocida. El escritorio no valida tracking.
- F2 — addon de Blender (metadata + linter) · F3 — HUD hi-tech completo ·
  F4 — captura/deep links · F5 — voz · F6 — SharePoint · F7 — gestos.

## Deploy

> ⚠️ **Un push a `main` es un deploy a producción.** El repo está conectado a
> **Cloudflare Workers Builds** (la CI de Cloudflare, no GitHub Actions — no hay
> `.github/`), así que cada push se construye y publica solo en
> <https://asistente-manuales-jarvis.disenocorptpc.workers.dev>. El token
> `asistente-manuales-jarvis build token` de la cuenta lo creó Cloudflare al
> conectar el repo; no se usa a mano. No hace falta `wrangler deploy` para
> publicar, y `wrangler` no tiene por qué estar instalado.

Cloudflare Worker con static assets. El `wrangler.jsonc` ya trae las dos trampas
resueltas (`not_found_handling: "none"`, `observability: enabled`);
`public/_headers` pone `noindex` global y cachés inmutables para modelos y
targets.

Para probar en teléfono no hace falta túnel: se pushea y se abre la URL. Lo que
sí exige HTTPS y teléfono real es el AR — `getUserMedia` no funciona en HTTP ni
pasando el HTML por WhatsApp.
