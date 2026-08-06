/* Ensambla el core alrededor de un GLB que puede llegar DESPUÉS del arranque
   (botón "Cargar GLB" del HUD, deep link, o SharePoint en F6). Es el único
   punto donde los módulos del core se conocen entre sí. */
import { cargarPieza } from './loader.js';
import { crearGrafo } from './scene.js';
import { crearExplotado } from './explode.js';
import { crearCapas } from './layers.js';
import { crearPicker } from './pick.js';
import { crearEscala } from './scale.js';
import { crearOrbita } from './orbita.js';

export function crearVisor(contenido) {
  const grafo = crearGrafo(contenido.orientacion);
  const escala = crearEscala(grafo, contenido.escala);
  const orbita = crearOrbita(grafo, contenido.orbita);
  const alCargar = [];
  const alExplotar = [];

  let pieza = null;
  let explotado = null;
  let capas = null;
  let picker = null;

  /* Tween del explotado (voz: «explota»/«arma»). Avanza en update(dt) del
     shell — el core nunca posee el requestAnimationFrame (HANDOFF §7). */
  let tween = null;
  const suave = (t) => t * t * (3 - 2 * t); // smoothstep: sin golpe al arrancar ni al llegar
  grafo.registrarActualizable((dt) => {
    if (!tween || !explotado) return;
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const v = tween.desde + (tween.hasta - tween.desde) * suave(tween.t);
    explotado.aplicar(v);
    for (const fn of alExplotar) fn(v);
    if (tween.t >= 1) tween = null;
  });

  return {
    grafo,
    escala,
    orbita,
    get pieza() { return pieza; },
    get explotado() { return explotado; },
    get capas() { return capas; },
    get picker() { return picker; },
    get cargado() { return !!pieza; },

    /* El HUD (y el reencuadre del shell desktop) se enteran aquí. */
    onCargar(fn) { alCargar.push(fn); },

    /* Todo cambio de explotado pasa por aquí: el slider se mueve solo cuando
       la voz anima, y un arrastre manual cancela el tween en curso. */
    onExplotar(fn) { alExplotar.push(fn); },
    explotar(valor, segundos = 0) {
      if (!explotado) return;
      if (segundos <= 0) {
        tween = null;
        explotado.aplicar(valor);
        for (const fn of alExplotar) fn(explotado.factor);
      } else {
        tween = { desde: explotado.factor, hasta: valor, t: 0, dur: segundos };
      }
    },

    /* url puede ser ruta del servidor o un objectURL de un archivo local. */
    async cargar(url, nombreArchivo = '') {
      const nueva = await cargarPieza(url, nombreArchivo);
      pieza = nueva;
      grafo.montarModelo(pieza.modelo);
      explotado = crearExplotado(pieza, contenido.explotado);
      capas = crearCapas(pieza);
      picker = crearPicker(pieza);
      tween = null;
      orbita.reiniciar(); // la pieza nueva entra de frente, no girando
      for (const fn of alCargar) fn(pieza);
      return pieza;
    },
  };
}
