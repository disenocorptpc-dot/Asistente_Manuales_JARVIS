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
3. **[VERIFICACIONES.md](VERIFICACIONES.md)** — las 7 verificaciones del
   binario con evidencia. No las repitas: ya están hechas.
4. Este archivo.

## La corrección más importante (no está en el handoff)

`detail.scaledWidth` de los eventos `imagefound/imageupdated` **NO** es el
ancho del marcador en unidades de mundo — es **proporción de aspecto
normalizada**. Los metros viven en `detail.scale`. El ancho real es
`detail.scale × detail.scaledWidth`. Ya está implementado en
[public/app/core/scale.js](public/app/core/scale.js); si tocas escala, no
"corrijas" de vuelta a lo que dice el handoff §4.

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
- **F1 ⏳ (siguiente)** — arte del marcador (brief en
  `herramientas/BRIEF-marcador.md`, validador en
  `herramientas/evaluar-marcador.py`), compilar target con
  `npx @8thwall/image-target-cli` a `px = cm × 32`, registrar la pieza en
  `contenido.json`, deploy y prueba de escala 1:1 en teléfono real.
- F2 — addon de Blender (metadata + linter). F3 — HUD hi-tech completo.
  F4 — captura + deep links. F5–F7 — ver HANDOFF §12.

## Decisiones del usuario que NO se renegocian

- 8th Wall open source + Three.js + Worker de Cloudflare (no Pages). Cerrado.
- El tema de verificar la escala de impresión del marcador **no le interesa
  al usuario** — no volver a plantearlo; dejar lo que el handoff ya pide.
- Pendiente de decisión: pieza piloto (recomendación vigente: señalización).

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
