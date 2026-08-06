"""Publica un GLB al visor (R2 vía el Worker). El rail por el que correrá el
botón "Exportar y publicar" del addon de Blender (F2); mientras, se usa a mano:

    python herramientas/publicar-modelo.py public/models/SIG-DEMO-01.glb --como SIG-DEMO-01-R1.glb

El token vive en herramientas/.publicar.token (gitignored por *.token) o en la
variable de entorno JARVIS_PUBLICAR_TOKEN. Se generó al configurar el Worker;
si se pierde o se filtra: generar otro y `wrangler secret put PUBLICAR_TOKEN`.

Reglas que este script hace cumplir ANTES de gastar red:
- Sólo .glb, nombre limpio (letras/números/._-), porque el nombre es la URL.
- Los publicados son INMUTABLES: revisión nueva = nombre nuevo (-R1, -R2…).
  El Worker rechaza duplicados con 409; --sobrescribir es para el error honesto.
- Presupuesto HANDOFF §10: aviso a partir de 15 MB, error duro en 25 MB.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

WORKER = 'https://asistente-manuales-jarvis.disenocorptpc.workers.dev'
NOMBRE_VALIDO = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.glb$')
MB = 1024 * 1024


def token():
    t = os.environ.get('JARVIS_PUBLICAR_TOKEN', '').strip()
    if t:
        return t
    archivo = Path(__file__).parent / '.publicar.token'
    if archivo.exists():
        return archivo.read_text(encoding='utf-8').strip()
    sys.exit('sin token: define JARVIS_PUBLICAR_TOKEN o crea herramientas/.publicar.token')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('glb', help='ruta del GLB a publicar')
    p.add_argument('--como', default=None,
                   help='nombre con el que se publica (default: el del archivo). Versiónalo: PIEZA-R1.glb')
    p.add_argument('--sobrescribir', action='store_true',
                   help='reemplaza un publicado existente (para corregir un error, no para versionar)')
    p.add_argument('--worker', default=WORKER)
    a = p.parse_args()

    ruta = Path(a.glb)
    if not ruta.exists():
        sys.exit(f'no existe: {ruta}')
    nombre = a.como or ruta.name
    if not NOMBRE_VALIDO.match(nombre):
        sys.exit(f'nombre inválido: "{nombre}" — letras/números/._- y extensión .glb')

    datos = ruta.read_bytes()
    if len(datos) > 25 * MB:
        sys.exit(f'{len(datos)/MB:.1f} MB: el techo duro es 25 MB. Decimado + meshopt no es opcional (HANDOFF §10).')
    if len(datos) > 15 * MB:
        print(f'⚠ {len(datos)/MB:.1f} MB — excede el presupuesto de 15 MB (§10). En 4G son ~30 s de espera.')

    if not nombre.lower().endswith(('.glb',)) or '-r' not in nombre.lower():
        print(f'⚠ "{nombre}" no trae sufijo de revisión (-R1, -R2…). El cache es de un año: versionar el nombre es lo que permite corregir.')

    url = f'{a.worker}/api/publicar?archivo={nombre}' + ('&sobrescribir=1' if a.sobrescribir else '')
    peticion = urllib.request.Request(url, data=datos, method='PUT', headers={
        'x-publicar-token': token(),
        'Content-Type': 'model/gltf-binary',
    })
    try:
        with urllib.request.urlopen(peticion, timeout=120) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            detalle = json.loads(e.read()).get('error', '')
        except Exception:
            detalle = ''
        sys.exit(f'HTTP {e.code}: {detalle or e.reason}')

    print(f'✔ publicado: {resp["url"]}  ({resp["bytes"]/MB:.1f} MB)')
    print(f'  siguiente paso → {resp["registrar"]}')


if __name__ == '__main__':
    main()
