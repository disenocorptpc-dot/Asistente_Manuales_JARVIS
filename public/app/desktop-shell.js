/* Fallback sin cámara: visor orbital sobre fondo neutro. No es un error,
   es la experiencia menos el AR — y es como se desarrolla el core sin
   teléfono. El core no distingue: recibe el mismo grafo. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function iniciarDesktop({ visor, hud, debug, contenido }) {
  const lienzo = document.getElementById('lienzo');
  const renderer = new THREE.WebGLRenderer({
    canvas: lienzo, antialias: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, contenido.render?.pixel_ratio_techo ?? 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const escena = new THREE.Scene();
  escena.background = new THREE.Color('#101820');
  escena.add(new THREE.HemisphereLight(0xEDECE4, 0x254D6E, 1.1));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(3, 6, 4);
  escena.add(sol);

  const camara = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

  /* En desktop no hay marcador: metros del GLB = unidades de escena. */
  visor.escala.desdeEstimacion();
  visor.grafo.ancla.visible = true;
  escena.add(visor.grafo.ancla);

  // Encuadre inicial contra el bbox real del modelo, no números mágicos.
  const caja = new THREE.Box3().setFromObject(visor.grafo.ancla);
  const alto = Math.max(caja.getSize(new THREE.Vector3()).length(), 0.5);
  camara.position.set(alto * 0.9, alto * 0.7, alto * 1.2);

  const controles = new OrbitControls(camara, lienzo);
  controles.target.set(0, caja.getCenter(new THREE.Vector3()).y, 0);
  controles.enableDamping = true;

  // Retícula de piso en bronce: ancla visual, comunica "esto está medido".
  const reticula = new THREE.GridHelper(4, 40, 0xB88F69, 0x25404F);
  reticula.material.transparent = true;
  reticula.material.opacity = 0.4;
  escena.add(reticula);

  function medir() {
    renderer.setSize(innerWidth, innerHeight, false);
    camara.aspect = innerWidth / innerHeight;
    camara.updateProjectionMatrix();
  }
  addEventListener('resize', medir);
  medir();

  lienzo.addEventListener('pointerdown', (ev) => {
    const x = (ev.clientX / innerWidth) * 2 - 1;
    const y = -(ev.clientY / innerHeight) * 2 + 1;
    hud.mostrarFicha(visor.picker.tocar(x, y, camara));
  });

  const reloj = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(reloj.getDelta(), 0.1);
    controles.update();
    visor.grafo.update(dt);
    hud.update(dt, camara);
    debug.tick(dt);
    renderer.render(escena, camara);
  });

  document.body.classList.add('desktop');
  hud.modoSinMarcador();
  return { nombre: 'desktop', camara, renderer, escena };
}
