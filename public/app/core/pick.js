/* Picking: toque en pantalla → raycast → pieza → ficha de producción.
   El shell entrega coordenadas normalizadas (-1..1) y la cámara; el core
   no escucha eventos de DOM. */
import * as THREE from 'three';

const CAMPOS_FICHA = [
  'pieza_nombre', 'pieza_id', 'capa', 'material', 'proceso',
  'acabado', 'cantidad', 'orden_ensamble', 'nota_taller',
];

export function crearPicker(pieza) {
  const rayo = new THREE.Raycaster();
  const punto = new THREE.Vector2();

  return {
    /* x,y en NDC (-1..1). Devuelve la ficha o null. */
    tocar(x, y, camara) {
      punto.set(x, y);
      rayo.setFromCamera(punto, camara);
      const hits = rayo.intersectObject(pieza.modelo, true);
      for (const hit of hits) {
        if (!hit.object.visible) continue;
        const dueno = buscarPieza(hit.object);
        if (dueno) return { objeto: dueno, ficha: extraerFicha(dueno) };
      }
      return null;
    },
  };

  function buscarPieza(obj) {
    // El hit cae en el mesh; la pieza puede ser un ancestro (nodo con pieza_id).
    for (let o = obj; o && o !== pieza.modelo; o = o.parent)
      if (o.userData?.pieza_id) return o;
    return null;
  }
}

function extraerFicha(obj) {
  const ficha = {};
  for (const campo of CAMPOS_FICHA)
    if (obj.userData[campo] !== undefined) ficha[campo] = obj.userData[campo];
  return ficha;
}
