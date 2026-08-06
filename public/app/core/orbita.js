/* Turntable: rota la pieza sobre su propio eje vertical. Core puro (regla
   HANDOFF §7): sin XR8, sin DOM, el shell llama update(dt).

   El giro va en `escalado`: su Y local ES el eje vertical del modelo, antes
   de la compensación de montaje de `orientado` — así la órbita se ve igual
   con el marcador en mesa que en pared. */
export function crearOrbita(grafo, opciones = {}) {
  const vuelta = opciones.vuelta_segundos ?? 12;
  let activa = false;

  grafo.registrarActualizable((dt) => {
    if (activa) grafo.escalado.rotation.y += ((Math.PI * 2) / vuelta) * dt;
  });

  return {
    get activa() { return activa; },
    iniciar() { activa = true; },
    detener() { activa = false; },
    alternar() { activa = !activa; return activa; },
    reiniciar() { activa = false; grafo.escalado.rotation.y = 0; },
  };
}
