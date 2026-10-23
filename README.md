# Laboratorio de umbralización · U3B

Laboratorio web interactivo de métodos de umbralización y validación para el curso **Teledetección y Procesamiento de Imágenes** (UNMSM), Unidad 3 · U3B. Complementa la presentación `U3B_Umbralizacion_estadistica_R_v2.pptx` y las fichas de método: el estudiante elige un contexto geográfico, cambia el método y sus parámetros, delimita la población de cálculo, genera o dibuja referencias y valida la clasificación, todo en el navegador.

> **Datos simulados.** Ninguna escena, valor ni referencia es una observación satelital. Son rásteres sintéticos con semilla reproducible que imitan el comportamiento estadístico y espacial de los casos del curso (Huaytapallana, Pisco, Paucartambo), no sus mediciones.

---

## 1. Cómo abrirlo

| Uso | Qué hacer |
|---|---|
| **En clase o en casa (sin instalar nada)** | Abrir `index.html` con doble clic en Chrome, Edge o Firefox. Funciona sin servidor y sin internet. |
| **Compartir un solo archivo** | Enviar `dist/laboratorio_umbralizacion.html` (≈ 275 KB, todo incluido). |
| **Servidor local (opcional)** | En la carpeta: `python -m http.server 8000` y abrir `http://localhost:8000`. |

Sin conexión, las fuentes tipográficas se reemplazan por las del sistema; todo lo demás funciona igual.

## 2. Publicarlo temporalmente

**Netlify Drop (lo más rápido).** Entrar a <https://app.netlify.com/drop> y arrastrar la carpeta `laboratorio_umbralizacion`. Netlify devuelve un enlace público en segundos. Para retirarlo, se borra el sitio desde el panel.

**GitHub Pages.**
1. Crear un repositorio (por ejemplo `laboratorio-umbralizacion`) y subir el contenido de la carpeta (que `index.html` quede en la raíz).
2. *Settings → Pages → Build and deployment → Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. En uno o dos minutos queda en `https://<usuario>.github.io/laboratorio-umbralizacion/`. Para retirarlo, se desactiva Pages o se archiva el repositorio.

No hay backend, base de datos, autenticación ni llamadas a APIs: es un sitio estático.

## 3. Estructura del proyecto

```
laboratorio_umbralizacion/
├── index.html                 interfaz (tres paneles)
├── css/laboratorio.css        estilos y temas (oscuro por defecto, claro para proyector)
├── css/temml-local.css        estilos de las fórmulas (Temml, MIT)
├── js/
│   ├── nucleo.js              azar con semilla, ruido espacial, utilidades, formato, rampas de color
│   ├── escenas.js             generador de los escenarios A–D y su referencia sintética
│   ├── estadistica.js         resumen descriptivo, histograma, cajas por clase, densidad kernel
│   ├── metodos.js             Otsu, percentiles, k-means, GMM, multi-Otsu, ROC/Youden, F1/Fβ, logística, calibración lineal
│   ├── validacion.js          clasificación, matriz de confusión, métricas, curva área–umbral
│   ├── graficos.js            gráficos SVG (histograma, densidad, violín + caja, líneas, cajas, mapa de calor)
│   ├── visor.js               visor ráster: zoom, desplazamiento, consulta, dibujo y edición de geometrías
│   ├── didactica.js           fichas de método y mensajes interpretativos
│   ├── app.js                 estado, ciclo de cálculo y paneles
│   └── vendor/temml.min.js    Temml 0.13.5 (LaTeX → MathML, sin conexión; licencia MIT en TEMML-LICENSE.txt)
├── pruebas/
│   ├── verificar_algoritmos.js   48 pruebas de los algoritmos (Node.js)
│   ├── prueba_interfaz.py        55 comprobaciones de interacción en Chromium (Playwright)
│   └── resultado_pruebas.txt     salida de la última ejecución
├── herramientas/empaquetar.py    genera la versión de un solo archivo en dist/
└── dist/laboratorio_umbralizacion.html
```

Scripts clásicos (no módulos ES) bajo el espacio de nombres `UL`, para que el archivo abra con doble clic. Para editar un texto didáctico, ir a `js/didactica.js`; para cambiar un escenario, a `js/escenas.js`. Después de editar, `python herramientas/empaquetar.py` regenera la versión de un solo archivo.

## 4. Escenarios

Malla de 256 × 192 celdas de 30 m (7,7 × 5,8 km; celda = 0,0009 km²). Cada escena se construye con **fracciones de cobertura por píxel** (mezclas en los bordes), valores de extremo por clase que varían en el espacio, textura y ruido. La **referencia** sale de esas fracciones (clase objetivo si la fracción Z ≥ 0,5; en D, FVC ≥ 0,4), nunca del umbral.

| | Escenario | Índice | Objetivo | Dificultad principal | Control propio |
|---|---|---|---|---|---|
| A | Nieve y hielo en alta montaña | NDSI y NDWI (bandas verde y NIR simuladas) | Nieve y hielo · lagunas glaciares | Las lagunas también dan NDSI alto (el agua clara casi como la nieve); en el NDWI la nieve queda apenas sobre 0 y las lagunas son < 1 % | Número de lagunas · tamaño de las lagunas (× 0,5 a × 1,8) |
| B | Valle agrícola y río | MNDWI y NDVI | Agua · superficie agrícola | Agua ≈ 2 % sin pico propio; fondo con dos suelos; barbecho agrícola con NDVI de suelo; ribera verde no agrícola | Semiancho del río · parcelas en barbecho (0–80 %) · cultivo joven de lo sembrado (0–100 %) · orilla y vegetación ribereña (× 0 a × 2; en 0 desaparecen) |
| C | Zona seca e incendio | dNBR y NBR posterior | Superficie quemada | El secado estacional de la puna también sube el dNBR; en NBR posterior la clase está en valores bajos (I ≤ t) | Secado de la puna |
| D | Cobertura vegetal heterogénea | NDVI, SAVI (L ajustable) y EVI de Landsat, desde bandas azul, roja y NIR simuladas | 4 clases ordinales de FVC; binario FVC ≥ 40 % | El NDVI se satura y cambia con el brillo del suelo; SAVI amortigua el suelo y EVI conserva más sensibilidad en dosel denso | Brillo del suelo · saturación del dosel |

Fórmulas usadas (notación de U3A): NDSI = (G − S1)/(G + S1); NDWI = (G − N)/(G + N) (McFeeters, 1996); MNDWI = (G − S1)/(G + S1); NDVI = (N − R)/(N + R); SAVI = (1 + L)(N − R)/(N + R + L) (Huete, 1988); EVI = 2,5(N − R)/(N + 6R − 7,5B + 1) (Huete et al., 2002); NBR = (N − S2)/(N + S2). En D las reflectancias siguen un modelo de dosel ρ = ρ_suelo·(1 − FVC)^(2k) + ρ_dosel·[1 − (1 − FVC)^(2k)], con el rojo saturándose antes que el NIR.

Controles comunes: semilla, proporción de la cobertura objetivo, ruido del sensor (σ), contraste entre clases (acerca las medias de las clases a la del fondo) y heterogeneidad espacial (amplitud de los campos de baja frecuencia). **Reiniciar escenario** restaura la semilla 2026 y los valores iniciales.

## 5. Métodos implementados

Todos se calculan en el navegador con la población, los parámetros y las muestras actuales; no hay resultados precalculados.

| Enfoque | Método | Parámetros | Representación del fundamento |
|---|---|---|---|
| I · No supervisado | **Otsu** | clases del histograma (64–512); población | σ²B(t), η, ω₀ ω₁ μ₀ μ₁ |
| | **Percentiles** | p (barra o valor escrito en %) | ECDF con p y t; fracción fijada |
| | **k-means 1D** (Lloyd) | k (2–5), arranques | trayectoria de los centros; SSE por arranque |
| | **GMM** (EM) | K (2–4) | componentes sobre el histograma, P(k \| I), BIC para K = 1…5, capa de probabilidad |
| | **Multi-Otsu** (exhaustivo, 64 clases) | k (3–5), corte objetivo | mapa de σ²B(t₁, t₂) con k = 3 |
| II · Supervisado | **ROC y Youden** | muestras de calibración | curva ROC, AUC, J(t), F1(t) |
| | **F1 / Fβ** | β | precisión, sensibilidad y Fβ según t |
| | **Regresión logística binaria** (IRLS) | nivel p, corrección del intercepto por prevalencia | curva P(Y = 1 \| I) sobre las muestras, t(p) = [logit(p) − β₀]/β₁, β con EE, razón de odds, desvianza, R² de McFadden, curva de fiabilidad e índice de Brier, capa de probabilidad |
| | **Regresión logística multinomial** (escenario A) | predictores: NDSI o NDSI + NDWI; píxeles por clase | resto, glaciar y laguna; coeficientes por clase, plano de decisión NDSI–NDWI o P(k \| NDSI), matrices 3 × 3 con muestra de prueba y censo |
| | **Umbral manual** | t (arrastrable en el histograma o escrito), cortes de la literatura | J(t) y F1(t) si hay muestras; curva área–umbral |
| III · Biofísico | **Calibración lineal** Z = β₀ + β₁·I, t = (z₀ − β₀)/β₁ | z₀, fuente de los pares, n | dispersión (I, Z), recta MCO, media de Z por tramo, residuos, IC bootstrap (B = 200), tabla de los **tres orígenes del umbral** (estadístico, supervisado y físico) |

En el escenario A, la **regla compuesta** (NDSI ≥ t y NIR > 0,11, Hall et al., 1995) se puede activar con cualquier método.

## 6. Interfaz y controles

**Encabezado.** Botones de escenario con el color de su contexto (hielo, río, fuego, vegetación). Debajo, un desplegable con el contexto, el objetivo y la dificultad del escenario (se cierra al hacer clic fuera).

**Panel izquierdo.** *Índice espectral*: experimentos sugeridos (plegados), botones de índice y un cuadro con solo la fórmula, escrita en LaTeX, y el umbral bibliográfico (en SAVI, además, el factor L). *Simulación*: controles y tres desplegables que explican el ruido, el contraste y la heterogeneidad. *Método de umbralización*: bloque destacado con los tres enfoques (I, II, III) como tarjetas, los algoritmos del enfoque como tarjetas con una línea que dice qué hace cada uno, y una caja de parámetros con el nombre del método elegido. Después vienen *Población y muestras* y *Comparar*.

**Visor (centro).** Al abrir se muestra la capa Índice del NDSI (escenario A); al cambiar de escenario se vuelve a la capa Índice. Capas (botones centrados sobre el mapa): índice, clasificación, referencia, aciertos y errores (VP, FP de comisión, FN de omisión, VN), fracción Z, probabilidad (GMM o logística) y diferencia A–B. Las casillas «Relieve» y «Geometrías y muestras» están junto a la leyenda. Rueda = zoom; arrastrar con *Mover*, clic derecho o Mayús = desplazar; pasar el cursor = consulta del píxel (coordenadas locales, valores de los índices, altitud simulada, clase de referencia, Z, clase del mapa y tipo de acierto); clic con *Mover* = fijar la consulta.

**Herramientas de geometría** (riel izquierdo) con tres roles:

| Rol | Para qué | Estilo |
|---|---|---|
| Población | píxeles con los que se calcula el umbral (enfoques I y III) | contorno dorado discontinuo |
| Calibración | muestras etiquetadas para Youden, F1 o la calibración | verde |
| Validación | muestras independientes para las métricas | rosa |

Rectángulo (arrastrar), polígono (clic por vértice; doble clic, Intro o clic en el primer vértice para cerrar; Retroceso quita el último; Esc cancela), selección libre (lazo), punto (un píxel), editar (arrastrar vértices o mover la geometría completa, con recálculo en vivo) y borrar. Las regiones aportan todos sus píxeles: se seleccionan zonas continuas, no solo píxeles aislados.

**Borrar la población.** Cada geometría de población lleva una insignia ✕ en su esquina (clic = borrar); con el cursor encima de una geometría, la tecla Supr también la borra. Mientras haya población aparece el botón «✕ Borrar población» junto a los roles, y en el panel izquierdo cada geometría se lista con su número de píxeles y su propio ✕ (al pasar el cursor por la lista se resalta en el mapa), más «Borrar toda la población».

**Muestras.** Al abrir el laboratorio o cambiar de escenario no hay muestras: se crean con *Generar muestras* (la primera vez en cada escenario, siempre la misma muestra; cada clic siguiente, otra). Si ya existen y cambia la simulación, se regeneran con la nueva referencia. Diseños aleatorio simple, estratificado 50/50 y *por conveniencia* (solo zonas claras, lejos de bordes y sin confusores, para mostrar el sesgo). Las etiquetas salen de la referencia sintética; calibración y validación no comparten píxeles. Si una región dibujada de validación se superpone con la calibración, el laboratorio avisa de **fuga de información**.

**Panel analítico (derecha).** Resumen del umbral, área, F1 e IoU; mensajes interpretativos; pestañas *Estadística* (población frente a escena, ECDF, cajas por clase de referencia), *Método* (ficha con definición, fórmulas en LaTeX, parámetros, lectura y supuestos, más el gráfico del fundamento) y *Validación* (matrices de confusión grandes, con muestras y con la referencia completa, que muestran VP, FP, FN y VN con su porcentaje y los totales con precisión, sensibilidad, especificidad, VPN y exactitud; métricas, superficie, matriz por clase en D, ROC del índice y curva área–umbral).

**Distribución (bajo el mapa).** Tres vistas: *Histograma* (número de clases ajustable con − / + o escrito, de 5 a 512; 120 por defecto), *Densidad* (kernel gaussiano con ancho de Silverman, por clase de referencia o total) y *Violín + caja* (población de cálculo y cada clase de referencia: densidad, caja p25–p75, mediana y bigotes p5–p95). El umbral, los cortes de la literatura y el umbral de B se dibujan en las tres; el manual se arrastra en histograma y densidad. Histograma: barras coloreadas con la misma paleta que la clasificación (ámbar = clase baja, cian = clase alta), escena completa reescalada, histogramas por clase de referencia, componentes de la GMM, centros de k-means, cortes de la literatura y umbral de B.

**Comparación A/B.** *Fijar actual como B* congela la clasificación; al cambiar método, parámetros o población, se comparan ambas en la capa Diferencia A–B, el histograma y las columnas B de la validación. B se descarta si cambia la escena o la variable.

### Reglas de validez de las métricas
Las métricas de una muestra no se informan si hay menos de 20 casos o menos de 5 de alguna clase; la precisión no se informa si el mapa no marca ningún caso objetivo. Las métricas de **muestra** y de **censo** (referencia completa) se muestran en columnas separadas.

### Mensajes interpretativos
Cada mensaje sale de una condición que se calcula en la simulación, por ejemplo:
- *El corte separa el fondo*: método no supervisado, prevalencia de la población < 15 % y área clasificada > 3 veces la referencia.
- *La población cambió el umbral*: el mismo método con la escena completa da un corte distinto (> 2,5 % del rango).
- *Más precisión, menos sensibilidad*: entre el estado previo y el actual, la precisión sube ≥ 0,03 y la sensibilidad baja ≥ 0,03 (o al revés).
- *Muestra poco representativa*: las muestras de calibración tienen menos del 40 % de la proporción de bordes y píxeles mixtos de la escena, o cubren menos del 12 % de su extensión.
- *A y B dan áreas muy diferentes*: razón de áreas ≥ 1,5.
- Otros: η < 0,6, exactitud global engañosa, prevalencia de la muestra distinta de la de la escena, lagunas que pasan como nieve, falsos positivos en la puna seca, omisiones en barbecho, extrapolación de la recta de calibración, fuga de información.

## 7. Comprobación funcional

```
node pruebas/verificar_algoritmos.js     # 48 pruebas, ≈ 4 s
python pruebas/prueba_interfaz.py        # 55 comprobaciones (requiere: pip install playwright && playwright install chromium)
```

`verificar_algoritmos.js` compara cada algoritmo con un cálculo independiente: Otsu y multi-Otsu frente a búsqueda exhaustiva, k-means frente al punto fijo de Isodata, recuperación de parámetros de una mezcla de gaussianas y cruce π₁f₁ = π₂f₂, Youden y F1 frente a fuerza bruta, AUC frente a Mann–Whitney, recuperación de β₀ y β₁, conteos de la matriz de confusión y reglas de validez. También verifica comportamientos de las escenas: reproducibilidad por semilla; Otsu divide el fondo en B y se corrige con la población; la GMM encuentra la minoría; el percentil fija el área; los falsos positivos de Otsu en C caen en la puna. La versión 2 agrega: logística (recuperación de β, t(p), corrección del intercepto con una muestra 50/50, separación perfecta, Brier), multinomial (NDSI + NDWI mejora las lagunas de 78 % a 99 %), NDWI (glaciar ≈ 0,03 y lagunas ≈ 0,45, como en la U3B), tamaño de lagunas acotado, SAVI con L = 0 igual al NDVI, EVI del píxel didáctico de U3A (0,580) y menor saturación del EVI en dosel denso.

`prueba_interfaz.py` usa el ratón real sobre el mapa: dibuja un polígono de población alrededor del río y verifica que el umbral y el área cambian; arrastra un vértice; dibuja un lazo de validación; agrega y borra un punto; comprueba el error de Youden sin muestras, la ocultación de métricas con 8 muestras, la comparación A/B, la calibración y la tabla de tres orígenes, la matriz ordinal de D, el arrastre del umbral manual, la reproducibilidad por semilla, los desplegables plegados al inicio, las capas en una fila, la fórmula del NDWI, el tamaño de las lagunas, el percentil escrito, la logística binaria y multinomial, NDVI/SAVI/EVI con cambio de L; en la versión 3, el borrado de población con la insignia del mapa, el ✕ de la lista y la tecla Supr, las tarjetas de método, el cambio de clases del histograma (− / + y escrito), la densidad y el violín, las fórmulas en MathML y el tamaño de la matriz; desde la versión 3.1, que al abrir se ve la capa Índice del NDSI en A sin muestras, que cambiar de escenario no crea muestras y que volver a un número de lagunas ya usado reutiliza la escena; desde la 3.2, los controles de cultivos y ribera del escenario B y la vuelta a la capa Índice al cambiar de escenario; y la ausencia de desplazamiento horizontal a 400 px. El resultado de la última ejecución está en `pruebas/resultado_pruebas.txt`.

Rendimiento medido (Chromium, escritorio): un ciclo completo de cálculo y dibujo tarda 25–45 ms con cualquier método, también con la GMM. En una prueba de 450 cambios seguidos (número y tamaño de lagunas, k, K, ruido) la respuesta media es de unos 40 ms (≈ 400 ms en la versión 3), sin crecer con el uso y con memoria estable (≈ 22 MB). Con la CPU frenada 4 veces (equipo lento), arrastrar el tamaño de las lagunas de punta a punta tres veces ocupa el procesador 9,6 s en vez de 30 s. Lo que lo permite: el relieve, los campos de ruido y las secuencias aleatorias de cada semilla se calculan una vez y se reutilizan; las últimas 6 escenas y 40 resultados de métodos no supervisados se recuerdan (volver a 4 lagunas o a K = 2 es inmediato); al arrastrar, la escena se regenera como mucho una vez por cuadro con al menos 80 ms libres entre regeneraciones, y los gráficos del panel derecho se redibujan al detenerse; los bucles por píxel no crean objetos (menos pausas de recolección de memoria); la ordenación usa un algoritmo por base (radix); la GMM ajusta el EM sobre el histograma fino de la población.

## 8. Simplificaciones y límites

- **Escenas**: una sola fecha por escenario (C simula el antes y el después a partir de la diferencia); sin nubes, máscaras QA ni geometría de iluminación real; el relieve es un campo sintético usado para sombrear y para modular algunos valores.
- **GMM**: EM con 3 arranques sobre el histograma fino de toda la población (512 clases ponderadas por su conteo; equivale a usar todos los píxeles con una discretización de ≈ 0,004 unidades del índice); el corte entre componentes vecinas se busca por bisección.
- **Multi-Otsu**: búsqueda exhaustiva sobre 64 clases del histograma (como en la U3B); k ≤ 5.
- **Logística**: errores estándar con píxeles tratados como independientes (subestimados con autocorrelación espacial). La corrección del intercepto usa la prevalencia de la referencia sintética, que en un caso real vendría de una fuente independiente. La multinomial solo está en el escenario A, con su propia muestra equilibrada por clase.
- **Calibración biofísica**: solo el modelo lineal. Saturante, GAM y segmentada quedan como ampliación. El IC bootstrap remuestrea pares independientes; no hay bootstrap por bloques.
- **Métricas**: la validación con muestras no pondera por estratos (no hay área ajustada de Olofsson); el contraste muestra–censo se muestra precisamente para discutir ese efecto.
- **Coordenadas**: locales en metros desde la esquina inferior izquierda de la escena; no hay CRS ni georreferenciación.
- **Dirección del índice**: los métodos no supervisados ordenan las clases por valor; el *corte objetivo* decide qué lado es la cobertura (automático: el superior; en NBR posterior, el inferior; en D, t₂).

## 9. Ampliaciones posibles

1. Triángulo, Isodata, Kapur, Kittler–Illingworth y mediana + k·MAD (ya están en las fichas; el histograma y la población del laboratorio las admiten sin cambios de arquitectura).
2. Umbrales locales (Sauvola, Niblack, Otsu por bloques) y Edge Otsu con regla preliminar, gradiente de Sobel y franja.
3. Costes asimétricos y logística ordinal (clases de severidad o de cobertura).
4. Calibración saturante, GAM y segmentada con comparación de los cuatro umbrales.
5. Bootstrap del umbral (simple y por bloques), validación cruzada por bloques y área ajustada por error (Olofsson et al., 2014).
6. Escenario bitemporal (cambio neto y bruto con umbral común o por fecha) y escenario SAR en dB con dirección I ≤ t.
7. Postproceso: área mínima de parche y vecindad 4/8.
8. Exportar la configuración y los resultados (JSON o CSV) para adjuntarlos a un informe.

## 10. Referencias de los métodos

Otsu (1979); Liao et al. (2001); Ridler y Calvard (1978); Hall et al. (1995); Xu (2006); Key y Benson (2006); Youden (1950); Lipton et al. (2014); McFeeters (1996); Huete (1988); Huete et al. (2002); Salomonson y Appel (2004); Olofsson et al. (2014); Roberts et al. (2017); Chuvieco (2020). Referencias completas en la presentación U3B y en las fichas de método.

Material del curso de Adrian Alonzo Colan Montes · FIGMMG, UNMSM.
