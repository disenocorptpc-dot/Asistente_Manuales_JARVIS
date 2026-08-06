/* Grafo de escena del visor. REGLA DURA (HANDOFF §7): este módulo no importa
   nada de XR8 y no toca el DOM. Recibe el grafo del shell y NUNCA escribe
   camera.position — en AR la cámara la mueve el SLAM en cada frame.

   Jerarquía:
     ancla        ← recibe la POSE (marcador o hitTest); el shell la escribe
       orientado  ← compensación de montaje (plano / de_pie), la escribe el HUD
         escalado ← factor de escala de mundo (1:1 / 1:2 / 1:10), scale.js
           modelo ← raíz del GLB, pivote ya recentrado por loader.js
*/
import * as THREE from 'three';

/* Los modos nombran DÓNDE ESTÁ EL MARCADOR, que es lo que se compensa:
   - mesa: marcador horizontal; el modelo Y-up se para solo sobre él. Sin giro.
   - pared: marcador vertical; sin compensar, la pieza se ve acostada
     (se asienta sobre el plano de la imagen). Se gira +90° sobre X.
   El signo del giro es EMPÍRICO, corregido en campo (2026-08-06, ronda #2):
   con -90° la pieza quedaba mirando hacia abajo → el tope de la imagen es +Z
   en el espacio del target de 8th Wall, no -Z como asume la convención de
   ARKit. Si en pared la pieza queda de pie pero dando la ESPALDA, falta un
   rotation.y = Math.PI en la entrada 'pared' — siguiente cosa a verificar. */
const ORIENTACIONES = { mesa: 0, pared: Math.PI / 2 };

export function crearGrafo(configOrientacion = {}) {
  const ancla = new THREE.Group();
  ancla.name = 'ancla';
  const orientado = new THREE.Group();
  orientado.name = 'orientado';
  const escalado = new THREE.Group();
  escalado.name = 'escalado';
  ancla.add(orientado);
  orientado.add(escalado);
  ancla.visible = false;

  let orientacion = 'mesa';
  const actualizables = [];

  const grafo = {
    ancla,
    escalado,

    get orientacion() { return orientacion; },
    orientar(modo) {
      if (!(modo in ORIENTACIONES)) return orientacion;
      orientacion = modo;
      orientado.rotation.x = ORIENTACIONES[modo];
      return orientacion;
    },

    montarModelo(modelo) {
      // Un modelo a la vez: el visor no es un catálogo.
      for (const previo of [...escalado.children]) escalado.remove(previo);
      escalado.add(modelo);
    },

    /* El shell llama update(dt) desde su onUpdate; el core nunca posee el
       requestAnimationFrame (en AR lo maneja XR8.run). */
    registrarActualizable(fn) { actualizables.push(fn); },
    update(dt) { for (const fn of actualizables) fn(dt); },
  };

  grafo.orientar(configOrientacion?.default ?? 'mesa');
  return grafo;
}
