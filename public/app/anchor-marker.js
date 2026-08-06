/* Modo A — marcador impreso (PRIMARIO, HANDOFF §3).
   El marcador da pose inicial, escala exacta e identidad; el SLAM sostiene
   la pose cuando sale del cuadro (extended tracking). En imagelost NO se
   oculta nada: ese es el superpoder que permite el protocolo
   "engancha de cerca, retrocede" para piezas grandes. */
import * as THREE from 'three';

export function conectarMarcador({ visor, hud, targetJson, anchoCm, contenido }) {
  XR8.XrController.configure({ imageTargetData: [targetJson] });

  const { ancla } = visor.grafo;
  const estado = { visible: false, anclado: false, primerLock: null, arranque: performance.now() };
  const coachingGrados = contenido.tracking?.coaching_angulo_grados ?? 40;

  const alActualizar = ({ detail }) => {
    ancla.visible = true;
    ancla.position.copy(detail.position);
    ancla.quaternion.copy(detail.rotation);
    /* Escala 1:1 por construcción — fórmula corregida en core/scale.js:
       ancho de mundo = detail.scale × detail.scaledWidth. */
    visor.escala.desdeMarcador(detail, anchoCm);
  };

  const alEncontrar = ({ detail }) => {
    estado.visible = true;
    estado.anclado = true;
    if (estado.primerLock === null)
      estado.primerLock = Math.round(performance.now() - estado.arranque);
    hud.trackingEnganchado();
    alActualizar({ detail });
  };

  const alPerder = () => {
    estado.visible = false;
    /* NO ocultar el modelo (Playbook §2): el SLAM sostiene la pose. */
    hud.trackingExtendido();
  };

  /* Coaching de inclinación (Playbook §6): pasando N° entre la normal del
     marcador y la línea de vista, avisar. Sólo aplica con marcador visible. */
  const _normal = new THREE.Vector3();
  const _aCamara = new THREE.Vector3();
  function onUpdate(dt, camara) {
    if (!estado.visible || !camara) return;
    _normal.set(0, 1, 0).applyQuaternion(ancla.quaternion); // +Y sale de la imagen
    _aCamara.copy(camara.position).sub(ancla.position).normalize();
    const grados = THREE.MathUtils.radToDeg(_normal.angleTo(_aCamara));
    hud.coaching(grados > coachingGrados);
  }

  return {
    nombre: 'marcador',
    estado,
    onUpdate,
    listeners: [
      { event: 'reality.imagefound', process: alEncontrar },
      { event: 'reality.imageupdated', process: alActualizar },
      { event: 'reality.imagelost', process: alPerder },
    ],
  };
}
