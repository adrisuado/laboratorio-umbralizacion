"""
Genera versiones de un solo archivo del laboratorio (sin carpetas css/ ni js/).
Uso:
  python herramientas/empaquetar.py            -> dist/laboratorio_umbralizacion.html
  python herramientas/empaquetar.py --fragmento -> dist/laboratorio_fragmento.html
     (sin <!doctype>, <head> ni <body>: para plataformas que envuelven la página)
"""
import pathlib
import re
import sys

raiz = pathlib.Path(__file__).resolve().parent.parent
html = (raiz / 'index.html').read_text(encoding='utf-8')


def estilo(m):
    return '<style>\n' + (raiz / m.group(1)).read_text(encoding='utf-8') + '\n</style>'


html = re.sub(r'<link rel="stylesheet" href="(css/[a-z-]+\.css)">', estilo, html)


def incrustar(m):
    codigo = (raiz / m.group(1)).read_text(encoding='utf-8')
    assert '</script' not in codigo.lower(), m.group(1)
    return '<script>\n' + codigo + '\n</script>'


html = re.sub(r'<script src="(js/[a-z/.]+\.js)"></script>', incrustar, html)
destino = raiz / 'dist'
destino.mkdir(exist_ok=True)
if '--fragmento' in sys.argv:
    cabeza = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    cabeza = re.sub(r'<meta charset[^>]*>\s*', '', cabeza)
    cabeza = re.sub(r'<meta name="viewport"[^>]*>\s*', '', cabeza)
    cuerpo = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    salida = cabeza.strip() + '\n' + cuerpo.strip() + '\n'
    archivo = destino / 'laboratorio_fragmento.html'
else:
    salida = html
    archivo = destino / 'laboratorio_umbralizacion.html'
archivo.write_text(salida, encoding='utf-8')
print('Escrito', archivo.relative_to(raiz), '·', round(len(salida.encode('utf-8')) / 1024), 'KB')
