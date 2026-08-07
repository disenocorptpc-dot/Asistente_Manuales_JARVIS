/* Despiece explotado (HANDOFF §6): default procedural, override opcional.
   - Sin explode_vector en extras: vector del centro del ensamble al centro
     del bbox de la pieza. Funciona con cualquier modelo bien nombrado.
   - Con explode_vector (+ explode_dist_cm): el override manda — control
     artístico exactamente donde el radial se ve mal. */
import * as THREE from 'three';

export function crearExplotado(pieza, opciones = {}) {
  const distDefaultCm = opciones.distancia_default_cm ?? 25;

  const cajaTotal = new THREE.Box3().setFromObject(pieza.modelo);
  const centro = cajaTotal.getCenter(new THREE.Vector3());

  const rutas = new Map(); // pieza_id → {direccion (unitaria, local), distancia (m)}
  const _caja = new THREE.Box3();
  for (const [id, obj] of pieza.piezas) {
    const d = obj.userData;
    let direccion, distancia;

    if (Array.isArray(d.explode_vector) && d.explode_vector.length === 3) {
      const v = d.explode_vector;
      direccion = new THREE.Vector3(v[0] || 0, v[2] || 0, -(v[1] || 0)).normalize();
      distancia = (d.explode_dist_cm ?? distDefaultCm) / 100;
    } else {
      _caja.setFromObject(obj);
      direccion = _caja.getCenter(new THREE.Vector3()).sub(centro);
      // Pieza exactamente en el centro: que suba, no que se quede quieta.
      if (direccion.lengthSq() < 1e-10) direccion.set(0, 1, 0);
      direccion.normalize();
      distancia = distDefaultCm / 100;
    }

    // El desplazamiento se aplica en el espacio LOCAL del padre de la pieza;
    // convertir la dirección de mundo-del-modelo a ese espacio.
    obj.parent.updateWorldMatrix(true, false);
    const aLocal = new THREE.Matrix3().setFromMatrix4(obj.parent.matrixWorld).invert();
    direccion.applyMatrix3(aLocal).normalize();

    const girar = Boolean(d.anim_giro);
    const giros = typeof d.anim_giros_cant === 'number' && d.anim_giros_cant > 0 ? d.anim_giros_cant : 3;

    rutas.set(id, { direccion, distancia, girar, giros });
  }

  const _qGiro = new THREE.Quaternion();

  let factor = 0;
  return {
    get factor() { return factor; },
    /* t en 0–1, del slider del HUD. */
    aplicar(t) {
      factor = THREE.MathUtils.clamp(t, 0, 1);
      for (const [id, obj] of pieza.piezas) {
        const base = pieza.reposo.get(id);
        const baseRot = pieza.reposoRot?.get(id);
        const ruta = rutas.get(id);

        obj.position.copy(base).addScaledVector(ruta.direccion, ruta.distancia * factor);

        if (ruta.girar && baseRot && ruta.direccion.lengthSq() > 0) {
          const angulo = factor * (ruta.giros * Math.PI * 2);
          _qGiro.setFromAxisAngle(ruta.direccion, angulo);
          obj.quaternion.copy(baseRot).premultiply(_qGiro);
        }
      }
    },
  };
}
