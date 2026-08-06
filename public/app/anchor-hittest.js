/* Modo B — hitTest sin marcador (FALLBACK, HANDOFF §3).
   Sin referencia física de tamaño conocido la escala la estima el motor;
   suficiente para tabletop y "ver rápido", no para autorizar 1:1.

   Firma verificada en el binario (VERIFICACIONES.md §2):
   XR8.XrController.hitTest(x, y, includedTypes=[]) con x,y normalizados;
   devuelve [] mientras el motor no esté listo. */
export function conectarHitTest({ visor, hud }) {
  const { ancla } = visor.grafo;
  const estado = { colocado: false };

  visor.escala.desdeEstimacion();
  hud.modoSinMarcador();

  /* Tap para colocar / recolocar en el centro de la pantalla. */
  function colocar() {
    const hits = XR8.XrController.hitTest(0.5, 0.5, ['ESTIMATED_SURFACE', 'DETECTED_SURFACE', 'FEATURE_POINT']);
    if (!hits.length) return false; // motor aún convergiendo: no es error
    const h = hits[0];
    ancla.position.set(h.position.x, h.position.y, h.position.z);
    ancla.visible = true;
    estado.colocado = true;
    hud.trackingEnganchado();
    return true;
  }

  function onUpdate() {
    if (!estado.colocado) colocar(); // insistir hasta que el SLAM converja
  }

  return { nombre: 'hittest', estado, onUpdate, colocar, listeners: [] };
}
