/* Ensambla el core alrededor de un GLB que puede llegar DESPUÉS del arranque
   (botón "Cargar GLB" del HUD, deep link, o SharePoint en F6). Es el único
   punto donde los módulos del core se conocen entre sí. */
import { cargarPieza } from './loader.js';
import { crearGrafo } from './scene.js';
import { crearExplotado } from './explode.js';
import { crearCapas } from './layers.js';
import { crearPicker } from './pick.js';
import { crearEscala } from './scale.js';

export function crearVisor(contenido) {
  const grafo = crearGrafo(contenido.orientacion);
  const escala = crearEscala(grafo, contenido.escala);
  const alCargar = [];

  let pieza = null;
  let explotado = null;
  let capas = null;
  let picker = null;

  return {
    grafo,
    escala,
    get pieza() { return pieza; },
    get explotado() { return explotado; },
    get capas() { return capas; },
    get picker() { return picker; },
    get cargado() { return !!pieza; },

    /* El HUD (y el reencuadre del shell desktop) se enteran aquí. */
    onCargar(fn) { alCargar.push(fn); },

    /* url puede ser ruta del servidor o un objectURL de un archivo local. */
    async cargar(url, nombreArchivo = '') {
      const nueva = await cargarPieza(url, nombreArchivo);
      pieza = nueva;
      grafo.montarModelo(pieza.modelo);
      explotado = crearExplotado(pieza, contenido.explotado);
      capas = crearCapas(pieza);
      picker = crearPicker(pieza);
      for (const fn of alCargar) fn(pieza);
      return pieza;
    },
  };
}
