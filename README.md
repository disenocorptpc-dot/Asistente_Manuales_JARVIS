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
3. [VERIFICACIONES.md](VERIFICACIONES.md) — las 7 verificaciones del binario, con evidencia.
   ⚠️ Incluye una **corrección al handoff §4**: `scaledWidth` es proporción de
   aspecto; el ancho de mundo = `detail.scale × detail.scaledWidth`.
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
    anchor-marker.js     ← modo A: marcador → pose + escala 1:1 + identidad
    anchor-hittest.js    ← modo B: superficie sin marcador (tabletop)
    desktop-shell.js     ← fallback orbital sin cámara
    core/                ← CERO imports de XR8, CERO DOM
    ui/                  ← HUD paleta Palace (F0 funcional; look completo = F3)
    debug.js             ← ?debug=1
  models/  image-targets/
herramientas/            ← FUERA de public
  generar-glb-sintetico.py   ← GLB de prueba multi-pieza (Blender headless)
  evaluar-marcador.py        ← validador de arte de marcadores (de Pipo)
  BRIEF-marcador.md          ← brief para diseño del arte del target
  test-extras.py             ← experimento: extras de escena en export glTF
wrangler.jsonc           ← Cloudflare Worker de assets estáticos
```

## Estado de fases (HANDOFF §12)

- **F0 ✅** — verificaciones §11, shell AR, core completo (carga dinámica de
  GLB, escala, explotado, capas, picking, fichas), verificado en navegador.
- **F1 ⏳ siguiente** — arte del marcador + target compilado + escala 1:1 en
  teléfono real. Pendiente: decidir pieza piloto.
- F2 — addon de Blender (metadata + linter) · F3 — HUD hi-tech completo ·
  F4 — captura/deep links · F5 — voz · F6 — SharePoint · F7 — gestos.

## Deploy

Cloudflare Worker con static assets: `wrangler deploy`. El `wrangler.jsonc`
ya trae las dos trampas resueltas (`not_found_handling: "none"`,
`observability: enabled`); `public/_headers` pone `noindex` global y cachés
inmutables para modelos y targets.
