# VERIFICACIONES §11 — evidencia leída del binario, no asumida

**Fecha:** 2026-08-05 · **Binario:** `@8thwall/engine-binary@1.0.0` (jsdelivr, `xr.js` 1.03 MB + `xr-slam.js` 5.5 MB) · **Blender:** 5.2 headless.
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
