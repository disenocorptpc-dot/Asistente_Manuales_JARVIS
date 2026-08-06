/* Escala 1:1 (HANDOFF §4, corregido por VERIFICACIONES.md §7).

   ⚠️ CORRECCIÓN AL HANDOFF, verificada leyendo el binario:
   detail.scaledWidth NO son unidades de mundo — es proporción de aspecto
   normalizada (una dimensión = 1). Los "metros" del motor viven en
   detail.scale = Math.max(widthInMeters, heightInMeters).

     ancho del marcador en mundo = detail.scale × detail.scaledWidth

   En Pipo leer scaledWidth a secas funcionó porque en modo responsive el
   motor normaliza el target a ~1 unidad (scale ≈ 1). Coincidencia de modo,
   no semántica. NUNCA hardcodear un factor de escala.

   Y la corrección de la corrección (F1): scale × scaledWidth sólo da el ancho
   real si el ALTO es la dimensión mayor. Con
     scale        = max(anchoM, altoM)
     scaledWidth  = ancho/alto,  scaledHeight = 1     (sin rotar)
   un target vertical da alto × (ancho/alto) = ancho ✔, pero uno horizontal da
   ancho²/alto ✘ — sobreestima, y el modelo saldría más grande de lo real.
   Dividir entre max(scaledWidth, scaledHeight) normaliza los dos casos:
     vertical  : max = 1      → alto × (ancho/alto) / 1       = ancho ✔
     horizontal: max = a/h    → ancho × (ancho/alto)/(ancho/alto) = ancho ✔
   El camino verificado sigue siendo el vertical (y el generador de marcadores
   lo exige), pero así un target horizontal ya no miente en silencio. */

export function crearEscala(grafo, config) {
  const modos = config?.modos ?? { '1:1': 1.0, '1:10': 0.1 };
  let modo = config?.default ?? '1:1';
  let unidadesPorMetro = 0; // desconocido hasta tener marcador o estimación

  function aplicar() {
    if (!unidadesPorMetro) return;
    grafo.escalado.scale.setScalar(unidadesPorMetro * modos[modo]);
  }

  return {
    get modo() { return modo; },
    get modos() { return Object.keys(modos); }, // en el orden de contenido.json
    get inicial() { return config?.default ?? '1:1'; }, // para el comando «origen»
    get unidadesPorMetro() { return unidadesPorMetro; },
    get lista() { return !!unidadesPorMetro; },

    /* Modo A — derivación exacta desde el marcador, por construcción. */
    desdeMarcador(detail, anchoMarcadorCm) {
      const norma = Math.max(detail.scaledWidth ?? 0, detail.scaledHeight ?? 0);
      if (!norma || !detail.scale || !anchoMarcadorCm) return;
      const anchoMundo = (detail.scale * detail.scaledWidth) / norma;
      if (!(anchoMundo > 0)) return;
      const unidadesPorCm = anchoMundo / anchoMarcadorCm;
      unidadesPorMetro = unidadesPorCm * 100;
      aplicar();
    },

    /* Modo B — con scale:'absolute' el motor entrega unidades ≈ metros.
       Suficiente para tabletop; para autorización 1:1 el marcador manda. */
    desdeEstimacion() {
      unidadesPorMetro = 1;
      aplicar();
    },

    cambiarModo(nuevo) {
      if (!(nuevo in modos)) return modo;
      modo = nuevo;
      aplicar();
      return modo;
    },
  };
}
