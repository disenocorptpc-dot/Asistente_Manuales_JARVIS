/* HUD funcional de F0: cargar GLB, indicador de escala permanente, slider de
   explotado, panel de capas, ficha de pieza y avisos de tracking. El look
   hi-tech completo (leader lines, cotas 3D, retículas) es F3 — HANDOFF §8.
   Regla de rendimiento heredada: sin backdrop-filter, sin mix-blend-mode;
   sólo se animan opacity y transform. */

export function crearHUD(visor, sonido = null, catalogoUrl = null) {
  const $ = (id) => document.getElementById(id);
  const el = {
    modoVista: $('hud-modo-vista'),
    catalogo: $('hud-catalogo'),
    lista: $('hud-lista'),
    escala: $('hud-escala'),
    estado: $('estado'),
    slider: $('hud-explode'),
    capas: $('hud-capas'),
    ficha: $('hud-ficha'),
    coaching: $('hud-coaching'),
    titulo: $('hud-titulo'),
    cargar: $('hud-cargar'),
    archivo: $('hud-archivo'),
    abajo: $('hud-abajo'),
    orienta: $('hud-orienta'),
    sonido: $('hud-sonido'),
  };

  // ── Conmutador de modos de vista (Normal / Wireframe / Random Colors)
  if (el.modoVista) {
    const MODOS = [
      { id: 'normal', label: '🎨 Normal' },
      { id: 'wireframe', label: '🕸️ Malla' },
      { id: 'random', label: '🌈 Colores' },
    ];
    let idxModo = 0;
    el.modoVista.addEventListener('click', () => {
      idxModo = (idxModo + 1) % MODOS.length;
      const m = MODOS[idxModo];
      el.modoVista.textContent = m.label;
      visor.setModoVista(m.id);
      sonido?.tick();
    });
  }

  // ── Silencio persistente. Sin Web Audio (o sin módulo), el botón sobra.
  if (sonido) {
    const pintarSonido = () => {
      el.sonido.textContent = sonido.activo ? '🔊' : '🔇';
      el.sonido.classList.toggle('mudo', !sonido.activo);
    };
    el.sonido.addEventListener('click', () => { sonido.alternar(); pintarSonido(); });
    pintarSonido();
  } else {
    el.sonido.remove();
  }

  // ── Catálogo de piezas publicadas (queja de campo #1: el deep link por
  //    pieza no sirve como UX primaria — la app lista lo publicado y de ahí
  //    se carga). Sigue siendo ADITIVO: sin catálogo configurado el botón
  //    desaparece, y si no responde, se avisa y la carga manual sigue viva.
  if (catalogoUrl) {
    el.catalogo.addEventListener('click', () => {
      if (el.lista.classList.contains('visible')) {
        el.lista.classList.remove('visible');
        return;
      }
      sonido?.tick();
      abrirCatalogo();
    });
  } else {
    el.catalogo.remove();
  }

  async function abrirCatalogo() {
    el.lista.textContent = 'Cargando catálogo…';
    el.lista.classList.add('visible');
    let piezas;
    const base = new URL(catalogoUrl);
    try {
      const r = await fetch(new URL('piezas.json', base), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      piezas = (await r.json()).piezas ?? [];
    } catch (e) {
      el.lista.textContent = `El catálogo no respondió (${e.message}). Usa ⬆ para cargar del dispositivo.`;
      sonido?.error();
      return;
    }
    el.lista.textContent = '';
    if (!piezas.length) {
      el.lista.textContent = 'Catálogo vacío — aún no se publica ninguna pieza.';
      return;
    }
    // Lo más reciente arriba: es lo que se vino a enseñar.
    piezas.sort((a, b) => (b.publicado ?? '').localeCompare(a.publicado ?? ''));
    for (const p of piezas) {
      const contenedor = document.createElement('div');
      contenedor.className = 'lista-pieza-fila';

      const b = document.createElement('button');
      b.className = 'lista-pieza';
      const titulo = document.createElement('b');
      titulo.textContent = p.nombre ?? p.pieza_id;
      const detalle = document.createElement('span');
      detalle.textContent = [p.pieza_id, p.revision, p.publicado].filter(Boolean).join(' · ');
      b.append(titulo, detalle);
      b.addEventListener('click', async () => {
        el.lista.classList.remove('visible');
        estado(`Cargando ${p.nombre ?? p.pieza_id}…`);
        try {
          await visor.cargar(new URL(p.modelo, base).href, p.nombre ?? p.pieza_id);
        } catch (e) {
          estado(`No se pudo cargar: ${e.message}`);
          sonido?.error();
        }
      });

      const btnBorrar = document.createElement('button');
      btnBorrar.className = 'btn-borrar-pieza';
      btnBorrar.title = `Eliminar ${p.nombre || p.pieza_id} del catálogo`;
      btnBorrar.textContent = '🗑️';
      btnBorrar.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conf = confirm(`¿Eliminar "${p.nombre || p.pieza_id}" del catálogo permanentemente?`);
        if (!conf) return;

        btnBorrar.disabled = true;
        btnBorrar.textContent = '⏳';
        estado(`Eliminando ${p.nombre || p.pieza_id}…`);
        const tokenVal = localStorage.getItem('jarvis_publicar_token') || '4c43f5eb410a963ec0f0ce8bef429888bd9e75a636333199aca382ea2990947a';
        try {
          const res = await fetch(`/api/publicar?pieza_id=${encodeURIComponent(p.pieza_id)}&token=${encodeURIComponent(tokenVal)}`, {
            method: 'DELETE',
          });
          const resJson = await res.json();
          if (!res.ok) throw new Error(resJson.error || 'Error al eliminar');

          contenedor.remove();
          estado(`✓ ${resJson.mensaje || 'Modelo eliminado de catálogo'}`);
          sonido?.tick();
        } catch (err) {
          btnBorrar.disabled = false;
          btnBorrar.textContent = '🗑️';
          estado(`Error al eliminar: ${err.message}`);
          sonido?.error();
        }
      });

      contenedor.append(b, btnBorrar);
      el.lista.appendChild(contenedor);
    }
  }

  // ── Cargar GLB del dispositivo: el plan B eterno — funciona sin red,
  //    sin catálogo y sin publicar.
  el.cargar.addEventListener('click', () => el.archivo.click());
  el.archivo.addEventListener('change', async () => {
    const f = el.archivo.files?.[0];
    if (!f) return;
    estado(`Cargando ${f.name}…`);
    const url = URL.createObjectURL(f);
    try {
      await visor.cargar(url, f.name);
    } catch (e) {
      estado(`No se pudo cargar: ${e.message}`);
      console.error(e);
    } finally {
      URL.revokeObjectURL(url);
      el.archivo.value = ''; // permitir recargar el mismo archivo
    }
  });

  // Al cargar (de donde sea): título, capas, slider a cero, avisos.
  visor.onCargar((pieza) => {
    el.titulo.textContent = pieza.nombre;
    el.slider.valueAsNumber = 0;
    reconstruirCapas();
    mostrarFicha(null);
    el.abajo.classList.add('visible');
    estado(pieza.avisos.length ? `⚠ ${pieza.avisos.join(' · ')}` : `${pieza.piezas.size} piezas`);
    sonido?.carga();
  });

  // ── Escala: visible SIEMPRE. Autorizar en tabletop creyendo ver 1:1
  //    es el peor error posible del proyecto (HANDOFF §4).
  //
  //    Y por el mismo argumento hay que distinguir DE DÓNDE sale el 1:1: del
  //    marcador es exacto por construcción; del motor es una estimación de la
  //    altura de la cámara sobre el piso y arrastra error. Un "1:1" idéntico
  //    en los dos casos invita a autorizar sobre una medida estimada, que es
  //    la misma trampa que el toggle de tabletop existe para evitar.
  let fuente = null; // 'marcador' | 'estimada' | null
  function pintarEscala() {
    const modo = visor.escala.modo;
    const estimada = fuente === 'estimada';
    el.escala.textContent = estimada ? `≈ ${modo}` : modo;
    el.escala.classList.toggle('tabletop', modo !== '1:1');
    el.escala.classList.toggle('estimada', estimada);
    el.escala.title = estimada
      ? 'Escala ESTIMADA por el motor, no medida. No autorices con esto: usa el marcador impreso.'
      : fuente === 'marcador'
        ? 'Escala derivada del ancho impreso del marcador: exacta por construcción.'
        : 'Escala aún sin referencia.';
  }
  el.escala.addEventListener('click', () => {
    // Cicla los modos en el orden de contenido.json: 1:1 → 1:2 → 1:10 → 1:1.
    const modos = visor.escala.modos;
    const i = modos.indexOf(visor.escala.modo);
    visor.escala.cambiarModo(modos[(i + 1) % modos.length]);
    pintarEscala();
    sonido?.tick();
  });
  pintarEscala();

  // ── Orientación: el botón dice DÓNDE ESTÁ EL MARCADOR, que es lo que se
  //    compensa. En mesa la pieza se para sola; en pared, sin compensar, se
  //    ve acostada. Nombres y signo corregidos en campo (2026-08-06 ronda #2).
  const ORIENTA = { mesa: '▤ Mesa', pared: '▯ Pared' };
  function pintarOrienta() {
    el.orienta.textContent = ORIENTA[visor.grafo.orientacion];
    el.orienta.classList.toggle('activa', visor.grafo.orientacion === 'pared');
  }
  el.orienta.addEventListener('click', () => {
    visor.grafo.orientar(visor.grafo.orientacion === 'mesa' ? 'pared' : 'mesa');
    pintarOrienta();
    sonido?.tick();
  });
  pintarOrienta();

  // ── Explotado: slider físico y grande, tercio inferior, para el pulgar.
  //    Todo pasa por visor.explotar: un arrastre manual cancela el tween de
  //    la voz, y cuando la voz anima, el slider se mueve solo (onExplotar).
  el.slider.addEventListener('input', () => {
    visor.explotar(el.slider.valueAsNumber / 100);
  });
  visor.onExplotar((v) => { el.slider.valueAsNumber = Math.round(v * 100); });

  // ── Capas
  function reconstruirCapas() {
    el.capas.textContent = '';
    if (!visor.capas) return;
    for (const nombre of visor.capas.nombres()) {
      const b = document.createElement('button');
      b.textContent = nombre;
      b.className = 'capa activa';
      b.addEventListener('click', () => {
        const visible = visor.capas.alternar(nombre);
        b.classList.toggle('activa', visible);
        sonido?.tick();
      });
      el.capas.appendChild(b);
    }
  }

  // ── Ficha de pieza
  const ETIQUETAS = {
    pieza_id: 'ID', capa: 'Capa', material: 'Material', proceso: 'Proceso',
    acabado: 'Acabado', cantidad: 'Cantidad', orden_ensamble: 'Orden de ensamble',
    nota_taller: 'Nota de taller',
  };
  function mostrarFicha(hit) {
    if (!hit) { el.ficha.classList.remove('visible'); return; }
    sonido?.blip();
    const f = hit.ficha;
    el.ficha.innerHTML =
      `<h2>${f.pieza_nombre ?? f.pieza_id}</h2>` +
      Object.entries(ETIQUETAS)
        .filter(([campo]) => f[campo] !== undefined)
        .map(([campo, etiqueta]) => `<div class="dato"><span>${etiqueta}</span><b>${f[campo]}</b></div>`)
        .join('');
    el.ficha.classList.add('visible');
  }

  function estado(texto) { el.estado.textContent = texto; }

  return {
    mostrarFicha,
    estado,

    /* Fachada para la voz (ui/voz.js): la voz no pinta nada por su cuenta —
       pasa por aquí para que botones e indicadores queden consistentes. */
    escalaA(modo) { const m = visor.escala.cambiarModo(modo); pintarEscala(); return m; },
    orientaA(modo) { const m = visor.grafo.orientar(modo); pintarOrienta(); return m; },
    alternarCapa(nombre) {
      const b = [...el.capas.children]
        .find((x) => x.textContent.toLowerCase() === nombre.toLowerCase());
      if (!b) return false;
      b.click(); // el botón ya sabe alternar la capa y pintarse
      return true;
    },

    /* El protocolo de enganche va en la UI, no sólo en el impreso (HANDOFF §3):
       sin esto el usuario intenta encuadrar marcador y pieza a la vez, falla, y
       concluye que el tracking es malo. */
    modoMarcador(n) {
      fuente = null;
      pintarEscala();
      estado(n > 1
        ? `Apunta a un marcador (${n} registrados) y acércate a ~35 cm`
        : 'Apunta al marcador y acércate a ~35 cm. Luego retrocede: la pieza se queda.');
    },

    trackingEnganchado() {
      fuente = 'marcador';
      pintarEscala();
      estado(visor.cargado
        ? 'Anclado · escala 1:1 real. Ya puedes retroceder.'
        : 'Anclado al marcador · carga un GLB con ⬆ para verlo aquí');
      sonido?.lock();
    },

    trackingExtendido() {
      estado('Sostenido por SLAM — reacércate al marcador si se desvía');
      sonido?.perdida();
    },

    modoSinMarcador() {
      fuente = 'estimada';
      pintarEscala();
      estado(visor.cargado
        ? 'Sin marcador: escala estimada, no sirve para autorizar 1:1'
        : 'Sin marcador: escala estimada · carga un GLB con ⬆');
    },

    coaching: (mal) => el.coaching.classList.toggle('visible', mal),
    update() {},
  };
}
