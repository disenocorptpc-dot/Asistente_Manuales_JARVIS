/* Ensambla el core completo alrededor de un GLB cargado. Es el único punto
   donde los módulos del core se conocen entre sí; los shells hablan con esto. */
import { cargarPieza } from './loader.js';
import { crearGrafo } from './scene.js';
import { crearExplotado } from './explode.js';
import { crearCapas } from './layers.js';
import { crearPicker } from './pick.js';
import { crearEscala } from './scale.js';

export async function crearVisor(urlModelo, contenido) {
  const grafo = crearGrafo();
  const pieza = await cargarPieza(urlModelo);
  grafo.montarModelo(pieza.modelo);

  const explotado = crearExplotado(pieza, contenido.explotado);
  const capas = crearCapas(pieza);
  const picker = crearPicker(pieza);
  const escala = crearEscala(grafo, contenido.escala);

  return { grafo, pieza, explotado, capas, picker, escala };
}
