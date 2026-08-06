/* Grafo de escena del visor. REGLA DURA (HANDOFF §7): este módulo no importa
   nada de XR8 y no toca el DOM. Recibe el grafo del shell y NUNCA escribe
   camera.position — en AR la cámara la mueve el SLAM en cada frame.

   Jerarquía:
     ancla      ← recibe la POSE (marcador o hitTest); el shell la escribe
       escalado ← factor de escala de mundo (1:1 / 1:10), lo escribe scale.js
         modelo ← raíz del GLB, pivote ya recentrado por loader.js
*/
import * as THREE from 'three';

export function crearGrafo() {
  const ancla = new THREE.Group();
  ancla.name = 'ancla';
  const escalado = new THREE.Group();
  escalado.name = 'escalado';
  ancla.add(escalado);
  ancla.visible = false;

  const actualizables = [];

  return {
    ancla,
    escalado,

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
}
