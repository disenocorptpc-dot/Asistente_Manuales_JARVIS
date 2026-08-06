"""Publica un GLB al visor — vía el repo de contenido JARVIS-Modelos.

    python herramientas/publicar-modelo.py pieza.glb --id SIG-LOBBY-01 --nombre "Señalización lobby" --rev R1

Qué hace, en orden:
  1. Valida presupuestos ANTES de mover nada (≤15 MB aviso, 25 duro, nombre limpio).
  2. Copia el GLB a JARVIS-Modelos/public/modelos/<ID>-<REV>.glb.
  3. Registra/actualiza la pieza en public/piezas.json — GLB y registro viajan
     en el MISMO commit: nunca hay registro sin modelo ni modelo sin registro.
  4. Commit + PUSH — **el push ES la publicación**: el repo está conectado a
     Workers Builds y la CI de Cloudflare despliega solo (~40 s). GitHub es la
     fuente de verdad, como se acordó.
  5. Con --ya, además corre `wrangler deploy` directo: la pieza queda en línea
     en segundos sin esperar la CI (y sirve de plan B si el push no puede).

El repo de modelos se asume hermano de éste (../JARVIS-Modelos); --repo para
otra ruta. Éste es el rail del botón "Exportar y publicar" del addon (F2).

Reglas que no se negocian:
- Los publicados son INMUTABLES: revisión nueva = nombre nuevo (-R1, -R2…).
  El cache es de un año; reutilizar nombre sirve la versión vieja indefinido.
- Los masters (.blend/FBX/PSD) NO se publican: esto es el entregable, como el
  PDF lo es del .ai.
"""
import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# La consola de Windows (cp1252) no conoce ✔/⚠ y el print final REVENTABA
# después de publicar bien — el peor tipo de error: éxito reportado como
# falla. UTF-8 a fuerza, con reemplazo si aun así algo no cabe.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

MB = 1024 * 1024
ID_VALIDO = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$')
REV_VALIDA = re.compile(r'^R[0-9]{1,3}$')


def correr(args, cwd):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('glb', help='ruta del GLB a publicar')
    p.add_argument('--id', required=True, help='pieza_id del contrato §6, p.ej. SIG-LOBBY-01')
    p.add_argument('--nombre', required=True, help='nombre legible para el catálogo')
    p.add_argument('--rev', required=True, help='revisión: R1, R2, …')
    p.add_argument('--repo', default=None, help='ruta del repo JARVIS-Modelos (default: hermano de éste)')
    p.add_argument('--ya', action='store_true',
                   help='además del push, wrangler deploy directo: en línea en segundos, sin esperar la CI')
    p.add_argument('--sobrescribir', action='store_true',
                   help='reemplaza una revisión ya publicada (corrección honesta, no versionado; '
                        'el cache inmutable puede servir la vieja hasta un año)')
    a = p.parse_args()

    if not ID_VALIDO.match(a.id):
        sys.exit(f'pieza_id inválido: "{a.id}" (letras/números/._-)')
    if not REV_VALIDA.match(a.rev):
        sys.exit(f'revisión inválida: "{a.rev}" (formato R1, R2, …)')

    origen = Path(a.glb)
    if not origen.exists():
        sys.exit(f'no existe: {origen}')
    datos = origen.stat().st_size
    if datos > 25 * MB:
        sys.exit(f'{datos/MB:.1f} MB: techo duro 25 MB. Decimado + meshopt no es opcional (HANDOFF §10).')
    if datos > 15 * MB:
        print(f'⚠ {datos/MB:.1f} MB — excede el presupuesto de 15 MB (§10). En 4G son ~30 s de espera.')

    repo = Path(a.repo) if a.repo else Path(__file__).resolve().parents[2] / 'JARVIS-Modelos'
    catalogo_path = repo / 'public' / 'piezas.json'
    if not catalogo_path.exists():
        sys.exit(f'no encuentro el repo de modelos en {repo} — clónalo o pasa --repo')

    archivo = f'{a.id}-{a.rev}.glb'
    destino = repo / 'public' / 'modelos' / archivo
    if destino.exists() and not a.sobrescribir:
        sys.exit(f'{archivo} ya está publicado. Una revisión nueva lleva nombre nuevo '
                 f'(¿--rev R{int(a.rev[1:])+1}?); para corrección honesta, --sobrescribir.')

    # 1-2. copiar
    shutil.copyfile(origen, destino)

    # 3. registrar (reemplaza la entrada del mismo pieza_id: el deep link
    #    siempre apunta a la última revisión; las viejas siguen servidas por URL)
    catalogo = json.loads(catalogo_path.read_text(encoding='utf-8'))
    entrada = {
        'pieza_id': a.id,
        'nombre': a.nombre,
        'modelo': f'modelos/{archivo}',
        'revision': a.rev,
        'publicado': datetime.date.today().isoformat(),
    }
    piezas = [q for q in catalogo.get('piezas', []) if q.get('pieza_id') != a.id]
    piezas.append(entrada)
    catalogo['piezas'] = sorted(piezas, key=lambda q: q['pieza_id'])
    catalogo_path.write_text(json.dumps(catalogo, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    # 4. commit (+push si se puede)
    correr(['git', 'add', '-A'], repo)
    c, salida = correr(['git', 'commit', '-m', f'publica {archivo}: {a.nombre} ({datos/MB:.1f} MB)'], repo)
    if c != 0:
        sys.exit(f'git commit falló:\n{salida}')
    c, salida = correr(['git', 'push'], repo)
    push_ok = c == 0
    if not push_ok and not a.ya:
        ultima = salida.splitlines()[-1] if salida else ''
        sys.exit('✗ push falló — LA PIEZA NO SE PUBLICÓ (la CI despliega desde GitHub).\n'
                 f'  {ultima}\n'
                 '  El commit quedó local. Arreglos: guarda credenciales para el repo de\n'
                 '  modelos (PAT fine-grained de sólo ese repo), o corre con --ya para\n'
                 '  publicar directo con wrangler mientras tanto.')

    # 5. --ya: en línea en segundos, sin esperar la CI (y plan B sin push)
    if a.ya:
        # En Windows npx es npx.cmd: which lo resuelve; a pelo, subprocess no lo halla.
        npx = shutil.which('npx') or 'npx'
        c, salida = correr([npx, 'wrangler', 'deploy'], repo)
        if c != 0:
            sys.exit(f'wrangler deploy falló:\n{salida[-600:]}')

    print(f'✔ publicado: https://jarvis-modelos.disenocorptpc.workers.dev/modelos/{archivo}  ({datos/MB:.1f} MB)')
    print(f'  deep link:  https://asistente-manuales-jarvis.disenocorptpc.workers.dev/?pieza={a.id}')
    if a.ya:
        print('  en línea YA (wrangler)' + ('' if push_ok else ' · ⚠ el push falló: GitHub quedó atrás, pushea al rato'))
    else:
        print('  la CI de Cloudflare lo despliega en ~40 s')


if __name__ == '__main__':
    main()
