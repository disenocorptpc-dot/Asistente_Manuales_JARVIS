# VERIFICACIONES §11 — evidencia leída del binario, no asumida

**Fechas:** §1–§8 el 2026-08-05 (F0) · §9–§10 el 2026-08-06 (F1).
**Binario:** `@8thwall/engine-binary@1.0.0` (jsdelivr, `xr.js` 1.03 MB + `xr-slam.js` 5.5 MB) ·
**Compilador de targets:** `@8thwall/image-target-cli@1.0.0` · **Blender:** 5.2 headless.
Método: Playbook §10.8 — dumpear y leer el código minificado del vendor.

---

## 1. ✅ Modo de escala absoluta — EXISTE

En `xr.js` el schema de configuración declara:

```
scale: { type: "string", default: "responsive" }
```

Y en `xr-slam.js` el configure lo consume:

```
"[XR] Scale can only be changed before calling XR8.run()"
a = "absolute" === A.scale
```

- Valores: `'responsive'` (default) y `'absolute'`.
- **Sólo puede fijarse ANTES de `XR8.run()`** — lanza error si se intenta después.
- VPS y Area Targets fuerzan `responsive` (con warning). **Image targets NO tienen esa restricción.**

**Consecuencia:** el modo B (hitTest) sí puede intentar 1:1 con `scale: 'absolute'`. Queda pendiente medir en campo qué tan buena es la estimación (F1).

## 2. ✅ Firma de `hitTest`

En `xr-slam.js`, el controller exporta `hitTest` y la implementación es:

```
hitTest = (X, Y, includedTypes = []) => { if (!motorListo) return []; ... }
```

- `(x, y, includedTypes)` — x/y en coordenadas normalizadas de pantalla; `includedTypes` array de strings.
- Tipos: `'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE'` (+ `UNSPECIFIED`).
- **Devuelve `[]` (no lanza) si el motor aún no está listo** — hay que tratar el array vacío como "todavía no", no como "no hay superficie".

## 3. ✅ `loadChunk('slam')` habilita hitTest — NO hay chunk aparte

`hitTest` está exportado del mismo objeto controller que vive en `xr-slam.js`:

```
({ pipelineModule, configure, recenter, hitTest, updateCameraProjectionMatrix, ... })
```

Los únicos chunks referenciados en el loader de `xr.js` son **`xr-slam.js` y `xr-face.js`**. Un solo `loadChunk('slam')` da SLAM + image targets + hitTest.

## 4. ✅ `imageTargetData` y hitTest conviven en la misma sesión

Las detecciones de imagen se procesan dentro del mismo `getXRResponse()` del pipeline que el world tracking (y VPS/wayspots), y `configure`, `hitTest` y los eventos `imagefound/imageupdated/imagelost` salen del MISMO controller. No hay modos excluyentes. El diseño híbrido de HANDOFF §3 es viable tal cual.

## 5. ✅ Hand Tracking NO está en el binario

Los únicos chunks del loader son `xr-slam.js` y `xr-face.js`. No existe `xr-hand.js` ni ningún módulo de hand tracking de cámara (las coincidencias de "hand" en `xr.js` son de WebXR input para visores — `XRHand`, generic-hand GLB profiles — otra cosa).

**Consecuencia:** F7 (gestos) va con MediaPipe Hands sobre el frame del pipeline, como preveía el handoff.

## 6. ✅ Los `extras` de escena SÍ sobreviven al exportador de Blender

Probado headless con Blender 5.2 (`herramientas/test-extras.py` es el script del experimento, adaptado como base del addon):

```
SCENE extras: {"palace_schema": 1, "pieza_id": "TEST-01", "unidad": "m"}
NODE pieza_0: extras={"pieza_nombre": "Pieza 0", "capa": "Estructura", "cantidad": 2, "explode_vector": [0,0,1]}
```

- Custom properties de escena → `scenes[0].extras` ✓ (con `export_extras=True`).
- Custom properties de objeto → `nodes[n].extras` ✓, incluyendo arrays.
- El empty `__PALACE_META__` NO hace falta (también funciona, queda como plan B documentado).
- **Bonus:** Blender 5.2 trae los bridges de **Draco y MeshOptimizer nativos** — el addon puede comprimir sin dependencias externas.

## 7. ⚠️ `scaledWidth` NO es lo que el handoff (y el playbook) decían — CORRECCIÓN A §4

La construcción real del `detail` de `imagefound`/`imageupdated` en `xr-slam.js`:

```js
{
  name, metadata,
  position: {x,y,z},
  rotation: {x,y,z,w},
  scale: Math.max(I.getWidthInMeters(), I.getHeightInMeters()) || 1,   // ← AQUÍ viven los metros
  type, properties: { width, height, ..., isRotated, staticOrientation },
  // geometry aplanada al top level con Object.assign:
  scaledWidth:  isRotated ? 1 : width/height,    // ← proporción de ASPECTO, una dimensión = 1
  scaledHeight: isRotated ? width/height : 1,
}
```

- **`scaledWidth`/`scaledHeight` son proporción de aspecto normalizada, NO unidades de mundo.**
- El tamaño en unidades de mundo vive en **`detail.scale`** = dimensión mayor del marcador en "metros" del motor.
- **Ancho del marcador en mundo = `detail.scale × detail.scaledWidth`.**
- Por qué en Pipo "funcionó" leer `scaledWidth` a secas: en modo `responsive` el motor normaliza el target a ~1 unidad (`scale ≈ 1`) y el producto colapsa a `scaledWidth`. Fue correcto por coincidencia de modo, no por semántica.

**Fórmula corregida (implementada en `public/app/core/scale.js`):**

```js
const anchoMarcadorMundo = detail.scale * detail.scaledWidth;
const unidadesPorCm = anchoMarcadorMundo / anchoMarcadorCm;
```

Nota de diseño de marcadores: usar targets en formato **vertical (portrait)** mantiene la normalización en el caso trivial verificado; el caso landscape sin rotar queda por confirmar en campo (F1).

## 8. ⚠️ Edge (incluido Edge Android) es enviado a WebXR — y cómo se esquiva

Encontrado depurando "XR8: The specified session configuration is not supported"
en un Android con Edge. La selección de sesión en `xr.js`:

```js
og = ["Edge", "Oculus Browser"]; rg = ["Magic Leap 2"];
if ((og.includes(navegador) || rg.includes(modelo))
    && await navigator.xr.isSessionSupported("immersive-ar")) return "immersive-ar";
```

- Cualquier navegador cuyo UA diga "Edge" va por **WebXR** (regla pensada para
  visores). Edge en Android responde `true` al sondeo `isSessionSupported`
  pero **falla al crear la sesión** → el error de arriba.
- `XR8.run` acepta **`sessionInitBehavior: 'fallback'`**: un session manager
  que no inicializa devuelve `{initialized: false}` y el loop **prueba el
  siguiente** (el pipeline de cámara con getUserMedia, el de Pipo), en vez de
  lanzar `"No valid session manager to handle this session."`.
- Existe además el override global `window._XR8MetaversalMode` (se lee antes
  del sondeo), pero sus valores esperados son modos WebXR — no sirve para
  DESACTIVAR la vía; no usarlo.

**Implementado** en `public/app/ar-shell.js` (`XR8.run({..., sessionInitBehavior: 'fallback'})`).

## 9. ⚠️ El compilador de targets impone la proporción 3:4 y un mínimo de 480×640 — F1

Leído en `@8thwall/image-target-cli@1.0.0` (`src/crop.js`, `src/constants.json`,
`src/interactive.js`), no en su README.

```js
// crop.js — getDefaultCrop, rama vertical
const croppedHeight = Math.round((width * 4) / 3)
return {left: 0, top: Math.round((height - croppedHeight) / 2), width, height: croppedHeight, ...}

// interactive.js — crop manual, mismo forzado
const height = Math.round((visualWidth * 4) / 3)
console.log('Computed height based on 3:4 aspect ratio:', height)

// constants.json
{"minimumWidth": 480, "thumbnailHeight": 350, "luminanceHeight": 640, "minimumHeight": 640}
```

- **Un target plano SIEMPRE se recorta a 3:4.** Arte con otra proporción se
  recorta **centrado y en silencio**. Consecuencia directa sobre el 1:1: el área
  trackeada deja de ser el impreso, así que el `ancho_cm` declarado ya no
  corresponde y **la escala miente** — sin ningún error visible.
- **`validateCrop` rechaza crops menores a 480×640 px.** A la resolución
  correcta de compilado del HANDOFF §10 (`px = cm × 32`) eso fija un **mínimo
  físico de 15.0 × 20.0 cm**.
- Los targets planos **no piden medida física** (sólo cilindro y cono la piden),
  y el JSON sale con `metadata: null`. El tamaño físico vive únicamente en
  `contenido.json` — es un dato humano, y si está mal nadie lo detecta.
- La imagen de luminancia que carga el motor se emite a `luminanceHeight` 640 →
  **480×640**.

**Consecuencia: el marcador mide 15.0 × 20.0 cm, vertical.** Tres restricciones
independientes convergen en esa medida — 3:4 exacto (no se recorta nada),
480×640 px a 32 px/cm (el mínimo del compilador, y de paso el tamaño nativo de
la luminancia: cero remuestreo), y ≥12.1 cm para ocupar ≥30% del cuadro a 35 cm.
El A5 de 14.8 cm que el HANDOFF §6 traía de ejemplo **falla dos de las tres**:
proporción 1:1.419 y 474 px de ancho.

Implementado como guardas que abortan en `herramientas/generar-marcador.py`, con
el mensaje que explica cuál de las tres se rompió. Compilado verificado:

```json
"properties": {"left": 0, "top": 0, "width": 480, "height": 640, "isRotated": false,
               "originalWidth": 480, "originalHeight": 640}
```

`left/top` en 0 y el crop igual al original: **no recortó nada**, así que los
15.0 cm declarados son de verdad el ancho del área trackeada.

## 10. ⚠️ `scale × scaledWidth` sólo es correcto en vertical — corrección a §7

§7 dejó abierto el caso horizontal ("queda por confirmar en campo"). Sale de la
propia construcción del `detail`, sin necesidad de campo:

| target | `scale` | `scaledWidth` | `scale × scaledWidth` |
|---|---|---|---|
| vertical (alto > ancho) | alto | ancho/alto | **ancho** ✔ |
| horizontal (ancho > alto) | ancho | ancho/alto | ancho²/alto ✘ |

Un marcador horizontal de 20×15 cm arroja **6.67 u/m donde deberían ser 5.00**:
33% de sobreestimación, y la pieza se ve un tercio más grande de lo real.

**Normalizar entre `max(scaledWidth, scaledHeight)` arregla los dos casos**
(implementado en `public/app/core/scale.js`):

```js
const anchoMundo = detail.scale * detail.scaledWidth
                 / Math.max(detail.scaledWidth, detail.scaledHeight);
```

Verificado ejecutando el módulo del core con los dos `detail`: ambos dan 5 u/m,
y un marcador de 15 cm mide exactamente 0.75 unidades de mundo. El camino
recomendado sigue siendo el vertical —`generar-marcador.py` lo exige— pero un
target horizontal ya no miente en silencio.

---

## Estado

| # | Verificación | Resultado |
|---|---|---|
| 1 | Escala absoluta en configure | ✅ existe, pre-run only |
| 2 | Firma de hitTest | ✅ `(x, y, includedTypes=[])` |
| 3 | Chunk de hitTest | ✅ viene con `slam` |
| 4 | Targets + hitTest misma sesión | ✅ conviven |
| 5 | Hand tracking en binario | ✅ NO está → MediaPipe en F7 |
| 6 | Extras de escena en export | ✅ sobreviven (Blender 5.2) |
| 7 | Semántica de scaledWidth | ⚠️ corregida: `scale × scaledWidth` |
| 8 | Edge → WebXR rompe en Android | ⚠️ esquivado con `sessionInitBehavior: 'fallback'` |
| 9 | Crop del compilador de targets | ⚠️ fuerza 3:4 y mínimo 480×640 → marcador 15×20 cm |
| 10 | scaledWidth en horizontal | ⚠️ §7 sólo valía en vertical; normalizado |
