/* Modo A — marcador impreso (PRIMARIO, HANDOFF §3).
   El marcador da pose inicial y escala exacta; el SLAM sostiene la pose cuando
   sale del cuadro (extended tracking). En imagelost NO se oculta nada: ese es
   el superpoder que permite el protocolo "engancha de cerca, retrocede" para
   piezas grandes.

   El marcador NO da identidad. La pieza se carga a mano (botón del HUD), así
   que un mismo marcador sirve para cualquier GLB y varias hojas de manual
   pueden anclar en el mismo visor. Lo único que el marcador aporta además de
   la pose es su ancho físico declarado, que es de donde sale el 1:1. */
import * as THREE from 'three';

export function conectarMarcador({ visor, hud, targets, contenido }) {
  /* Todos los targets entran juntos: el motor los procesa en la misma sesión
     (VERIFICACIONES §4) y engancha con el que vea. */
  XR8.XrController.configure({ imageTargetData: targets.map((t) => t.json) });

  /* name → ancho impreso en cm. El detail del evento trae el nombre del target,
     así que la medida física se resuelve por marcador y no se asume global:
     dos hojas de distinto tamaño no pueden confundir la escala. */
  const anchoPorNombre = new Map(targets.map((t) => [t.json.name, t.anchoCm]));

  const { ancla } = visor.grafo;
  const estado = {
    visible: false, anclado: false, primerLock: null,
    arranque: performance.now(), marcador: null,
  };
  const coachingGrados = contenido.tracking?.coaching_angulo_grados ?? 40;

  hud.modoMarcador(targets.length);

  const alActualizar = ({ detail }) => {
    ancla.visible = true;
    ancla.position.copy(detail.position);
    ancla.quaternion.copy(detail.rotation);
    /* Escala 1:1 por construcción — fórmula corregida en core/scale.js:
       ancho de mundo = scale × scaledWidth / max(scaledWidth, scaledHeight). */
    const anchoCm = anchoPorNombre.get(detail.name);
    if (anchoCm) visor.escala.desdeMarcador(detail, anchoCm);
  };

  const alEncontrar = ({ detail }) => {
    estado.visible = true;
    estado.anclado = true;
    estado.marcador = detail.name;
    if (estado.primerLock === null)
      estado.primerLock = Math.round(performance.now() - estado.arranque);
    alActualizar({ detail });
    /* Enganchar sin pieza cargada es el callejón silencioso del modo manual:
       el ancla existe, la escala ya es real y no se ve nada. Hay que decirlo. */
    hud.trackingEnganchado();
  };

  const alPerder = () => {
    estado.visible = false;
    /* NO ocultar el modelo (Playbook §2): el SLAM sostiene la pose. */
    hud.coaching(false);
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
