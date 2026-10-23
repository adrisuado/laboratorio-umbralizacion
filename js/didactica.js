/* =====================================================================
   didactica.js — fichas de método y mensajes interpretativos.
   Cada mensaje se dispara por una condición verificable de la
   simulación (conteos, áreas, métricas), nunca por un texto fijo.
   ===================================================================== */
(function (UL) {
  'use strict';
  const f = UL.fmt, pct = UL.fmtPct, km = UL.fmtKm2;

  UL.FICHAS = {
    otsu: {
      nombre: 'Otsu', enfoque: 'I · No supervisado',
      linea: 'Prueba todos los cortes del histograma y elige el que forma dos grupos más distintos entre sí y más compactos por dentro.',
      formula: 'σ²<sub>B</sub>(t) = ω₀ ω₁ (μ₀ − μ₁)² &nbsp;·&nbsp; t* = argmax σ²<sub>B</sub>(t) &nbsp;·&nbsp; η = σ²<sub>B</sub>(t*) / σ²<sub>T</sub>',
      params: [['Clases del histograma', 'Ancho de las barras donde se buscan los cortes. Con 256 o más el corte se estabiliza.'], ['Población', 'Píxeles con los que se calcula el histograma (escena o geometrías de población).']],
      lectura: 'η cerca de 1 indica dos grupos bien separados. Un η bajo (< 0,6) es la señal de que el máximo existe pero la frontera no es la buscada.',
      supuestos: ['Dos grupos en la población, cada uno con al menos 5–10 % de los píxeles.', 'Si el objeto es una minoría sin pico propio, ω₀·ω₁ hace que el máximo divida el fondo.']
    },
    percentil: {
      nombre: 'Percentiles', enfoque: 'I · No supervisado',
      linea: 'Ordena los valores y toma el que deja la proporción p por debajo. El área sobre el corte queda fijada antes de mirar el fenómeno.',
      formula: 't = Q<sub>p</sub>(I) &nbsp;·&nbsp; #{ I ≥ t } / n = 1 − p',
      params: [['p', 'Proporción de píxeles bajo el corte. p = 0,95 deja siempre el 5 % superior.']],
      lectura: 'Útil para «el 5 % más extremo» (prioridad, anomalía). El área es consecuencia de p, no una medición.',
      supuestos: ['La fracción del objeto se conoce o se quiere fijar a propósito.', 'Recalculado por fecha o por población, «lo alto» ocupa siempre la misma fracción: no puede mostrar cambio.']
    },
    kmeans: {
      nombre: 'k-means (1D)', enfoque: 'I · No supervisado',
      linea: 'Agrupa los valores alrededor de k centros; en una variable, cada corte queda a medio camino entre dos centros vecinos.',
      formula: 'min Σ<sub>i</sub> (I<sub>i</sub> − μ<sub>c(i)</sub>)² &nbsp;·&nbsp; t<sub>j</sub> = (μ<sub>j</sub> + μ<sub>j+1</sub>) / 2',
      params: [['k', 'Número de grupos; lo decide la pregunta, no el algoritmo.'], ['Arranques', 'Inicios distintos de Lloyd; se conserva el de menor suma de cuadrados.']],
      lectura: 'Con k = 2 coincide con Isodata y casi siempre con Otsu. Al cambiar k cambian todos los cortes.',
      supuestos: ['Grupos compactos con dispersión parecida.', 'Sin pesos ni varianzas propias: una clase pequeña y dispersa queda absorbida por la vecina.']
    },
    gmm: {
      nombre: 'Mezcla de gaussianas (GMM)', enfoque: 'I · No supervisado',
      linea: 'Describe el histograma como suma de campanas normales (EM) y corta donde dos campanas ponderadas pesan lo mismo.',
      formula: 'f(I) = Σ<sub>k</sub> π<sub>k</sub> 𝒩(I | μ<sub>k</sub>, σ²<sub>k</sub>) &nbsp;·&nbsp; π₁f₁(t) = π₂f₂(t) &nbsp;·&nbsp; P(k | I) = π<sub>k</sub>f<sub>k</sub>(I) / f(I)',
      params: [['K', 'Número de componentes. El BIC orienta, pero la decisión es temática.']],
      lectura: 'Una clase pequeña y ancha puede tener su propia componente. La capa Probabilidad muestra P(objetivo | I) por píxel.',
      supuestos: ['Cada clase se parece a una normal; una clase asimétrica se reparte en dos componentes.', 'Componente ≠ cobertura: puede separar dos tipos de fondo. EM depende del inicio (óptimos locales).']
    },
    multiotsu: {
      nombre: 'Multi-Otsu', enfoque: 'I · No supervisado',
      linea: 'Generaliza Otsu a k clases: busca los k − 1 cortes que maximizan la varianza entre clases (búsqueda exhaustiva sobre 64 clases del histograma).',
      formula: '{t₁ < … < t<sub>k−1</sub>} = argmax Σ<sub>j</sub> ω<sub>j</sub> (μ<sub>j</sub> − μ)²',
      params: [['k', 'Número de clases (3 a 5). Con k = 3 se dibuja σ²<sub>B</sub> para cada par (t₁, t₂).'], ['Corte objetivo', 'Qué corte separa la clase que se evalúa contra la referencia binaria.']],
      lectura: 'Las clases son grupos de valores («clase 3» = valores altos), no categorías físicas hasta verificarlas.',
      supuestos: ['k decidido por la pregunta.', 'Depende de la población: otra máscara u otra fecha dan otros cortes.']
    },
    youden: {
      nombre: 'ROC e índice de Youden', enfoque: 'II · Supervisado',
      linea: 'Recorre los cortes con muestras etiquetadas y elige el que maximiza a la vez la detección del objeto y el rechazo del fondo.',
      formula: 'J(t) = TPR(t) − FPR(t) &nbsp;·&nbsp; t* = argmax J(t) &nbsp;·&nbsp; AUC = P(I<sub>+</sub> > I<sub>−</sub>)',
      params: [['Muestras de calibración', 'Píxeles con etiqueta de la referencia sintética (generadas o dibujadas). No se usan para validar.']],
      lectura: 'Usa tasas dentro de cada clase: casi no depende de la prevalencia de la muestra. Un AUC alto mide discriminación, no la calidad del corte.',
      supuestos: ['Referencia independiente y muestra representativa (bordes, sombras, confusores).', 'Omitir y confundir pesan lo mismo; con clases raras acepta muchos falsos positivos.']
    },
    f1: {
      nombre: 'F1 y Fβ máximos', enfoque: 'II · Supervisado',
      linea: 'Elige el corte que mejor equilibra no inventar objeto (precisión) y no omitirlo (sensibilidad), sin mirar los verdaderos negativos.',
      formula: 'P = VP/(VP+FP) &nbsp;·&nbsp; R = VP/(VP+FN) &nbsp;·&nbsp; F<sub>β</sub> = (1+β²)PR / (β²P + R)',
      params: [['β', 'β > 1 da más peso a la sensibilidad (alerta); β < 1, a la precisión (inventario).']],
      lectura: 'La precisión depende de cuántos negativos hay en la muestra: el óptimo de F1 cambia con la prevalencia de la muestra.',
      supuestos: ['La prevalencia de la muestra es la de la población (muestra aleatoria simple).', 'Con pocos positivos F1(t) es escalonada y su máximo salta.']
    },
    logistica: {
      nombre: 'Regresión logística', enfoque: 'II · Supervisado',
      linea: 'Modela la probabilidad de la clase en función del índice; el umbral es el índice donde esa probabilidad alcanza un nivel elegido. La versión multinomial (escenario A) separa resto, glaciar y laguna con uno o dos índices.',
      formula: 'P(Y = 1 | I) = 1 / [1 + e<sup>−(β₀ + β₁I)</sup>] &nbsp;·&nbsp; t(p) = [ln(p/(1 − p)) − β₀] / β₁ &nbsp;·&nbsp; β₀<sup>pob</sup> = β₀ + ln[π/(1 − π)] − ln[ȳ/(1 − ȳ)] &nbsp;·&nbsp; Brier = media (p̂ − y)²',
      params: [['Nivel p', 'Probabilidad a partir de la cual el píxel es de la clase (0,5 por defecto; 0,9 si se quiere un mapa conservador).'], ['Corrección del intercepto', 'Con una muestra 50/50 la pendiente es válida, pero el intercepto refleja la prevalencia de la muestra (ȳ). Se corrige con la prevalencia de la población (π).'], ['Multinomial', 'Un logit por clase frente a la de referencia (resto) y softmax; con NDSI + NDWI la frontera deja de ser un intervalo de un índice.']],
      lectura: 'β₁ indica qué tan rápido sube la probabilidad: cada aumento de 0,1 del índice multiplica los odds por e^(0,1·β₁). La curva de fiabilidad y el índice de Brier dicen si una probabilidad de 0,7 acierta el 70 % de las veces.',
      supuestos: ['El logit es lineal en el índice y las observaciones son independientes (los píxeles vecinos no lo son: los errores estándar quedan cortos).', 'Si un corte separa perfectamente las muestras, β₁ crece sin límite y el ajuste no converge; las probabilidades de una muestra estratificada solo valen para la población tras corregir el intercepto.']
    },
    manual: {
      nombre: 'Umbral fijado manualmente', enfoque: 'II · Comparación',
      linea: 'Un corte escrito a mano o tomado de la literatura. Arrastra la línea del histograma o usa los valores publicados.',
      formula: 'C(x, y) = 1{ I(x, y) ≥ t }  (o ≤ t si la clase está en valores bajos)',
      params: [['t', 'Valor del corte. Los botones cargan cortes de la literatura usados en el curso.']],
      lectura: 'Sirve de referencia para comparar: si hay muestras de calibración se muestran J(t) y F1(t) para ver qué tan lejos está del óptimo.',
      supuestos: ['El corte publicado viene de otra región, sensor o preprocesamiento: hay que verificarlo aquí.', 'Un corte fijo es comparable entre fechas, pero no se adapta a la escena.']
    },
    calib: {
      nombre: 'Calibración biofísica lineal', enfoque: 'III · Biofísico',
      linea: 'Ajusta la relación entre el índice y una magnitud medida (fracción Z de cobertura) y busca el índice donde Z alcanza un valor físico z₀.',
      formula: 'Z = β₀ + β₁ I + ε &nbsp;·&nbsp; t = (z₀ − β₀) / β₁ &nbsp;·&nbsp; IC por bootstrap de los pares',
      params: [['z₀', 'Criterio físico: 0,5 = la mitad de la celda es de la clase. Se fija antes del análisis.'], ['Pares (I, Z)', 'Estratificados por tramos de Z en la población, o las muestras de calibración.']],
      lectura: 'La frontera estadística sale del histograma, la supervisada de etiquetas y esta de una magnitud física: pueden caer en lugares distintos.',
      supuestos: ['Relación lineal en el rango observado; si se satura, la recta corta z₀ desplazada (mira los residuos).', 'No se extrapola: el umbral debe caer dentro del 2–98 % de I.']
    }
  };

  /* Fórmulas de cada método en LaTeX (una ecuación por línea) */
  const TEX = {
    otsu: ['\\sigma_B^2(t)=\\omega_0\\,\\omega_1\\,(\\mu_0-\\mu_1)^2', 't^{*}=\\arg\\max_{t}\\;\\sigma_B^2(t)', '\\eta=\\dfrac{\\sigma_B^2(t^{*})}{\\sigma_T^2}'],
    percentil: ['t=Q_p(I)', '\\dfrac{\\#\\{\\,I_i\\ge t\\,\\}}{n}=1-p'],
    kmeans: ['\\min\\;\\sum_{i}\\left(I_i-\\mu_{c(i)}\\right)^2', 't_j=\\dfrac{\\mu_j+\\mu_{j+1}}{2}'],
    gmm: ['f(I)=\\sum_{k=1}^{K}\\pi_k\\,\\mathcal{N}\\!\\left(I\\mid\\mu_k,\\sigma_k^2\\right)', '\\pi_1 f_1(t)=\\pi_2 f_2(t)', 'P(k\\mid I)=\\dfrac{\\pi_k\\,f_k(I)}{f(I)}'],
    multiotsu: ['\\{t_1<\\dots<t_{k-1}\\}=\\arg\\max\\;\\sum_{j=1}^{k}\\omega_j\\,(\\mu_j-\\mu)^2'],
    youden: ['J(t)=\\mathrm{TPR}(t)-\\mathrm{FPR}(t)', 't^{*}=\\arg\\max_{t}\\;J(t)', '\\mathrm{AUC}=P\\left(I_{+}>I_{-}\\right)'],
    f1: ['P=\\dfrac{\\mathrm{VP}}{\\mathrm{VP}+\\mathrm{FP}}\\qquad R=\\dfrac{\\mathrm{VP}}{\\mathrm{VP}+\\mathrm{FN}}', 'F_{\\beta}=\\dfrac{(1+\\beta^2)\\,P\\,R}{\\beta^2P+R}'],
    logistica: ['P(Y=1\\mid I)=\\dfrac{1}{1+e^{-(\\beta_0+\\beta_1 I)}}', 't(p)=\\dfrac{\\ln\\frac{p}{1-p}-\\beta_0}{\\beta_1}', '\\beta_0^{\\text{pob}}=\\beta_0+\\ln\\dfrac{\\pi}{1-\\pi}-\\ln\\dfrac{\\bar y}{1-\\bar y}', '\\text{Brier}=\\frac{1}{n}\\sum_{i}\\left(\\hat p_i-y_i\\right)^2'],
    manual: ['C(x,y)=\\mathbf{1}\\{\\,I(x,y)\\ge t\\,\\}'],
    calib: ['Z=\\beta_0+\\beta_1 I+\\varepsilon', 't=\\dfrac{z_0-\\beta_0}{\\beta_1}']
  };
  for (const k in TEX) UL.FICHAS[k].tex = TEX[k];
  UL.TEX_MULTINOMIAL = '\\ln\\dfrac{P(Y=k)}{P(Y=\\text{resto})}=\\beta_{k0}+\\sum_{j}\\beta_{kj}X_j';

  /* ------------------------------------------------------------------
     Mensajes interpretativos (orden: alertas primero)
     ------------------------------------------------------------------ */
  UL.generarMensajes = function (c) {
    const m = [];
    const v = c.v, met = c.censo, sup = c.metodo === 'youden' || c.metodo === 'f1' || (c.metodo === 'logistica' && !c.multi);
    const noSup = c.metodo === 'otsu' || c.metodo === 'percentil' || c.metodo === 'kmeans' || c.metodo === 'gmm' || c.metodo === 'multiotsu';

    if (c.error) m.push({ n: 'alerta', t: 'No se puede calcular', x: c.error });

    /* 1 · el algoritmo separa el fondo */
    if (!c.error && noSup && c.metodo !== 'percentil' && c.prevPob < 0.15 && c.area > 3 * v.areaRef && v.areaRef > 0) {
      m.push({ n: 'alerta', t: 'El corte separa el fondo, no la cobertura minoritaria',
        x: 'El mapa marca ' + km(c.area) + ' como «' + v.objetivo.toLowerCase() + '» frente a ' + km(v.areaRef) + ' en la referencia (' + f(c.area / v.areaRef, 1) + ' veces). La clase objetivo es ' + pct(c.prevPob) + ' de la población: no forma un grupo con peso propio. Delimita una población alrededor del objeto o prueba una GMM.' });
    }
    /* 2 · η bajo */
    if (!c.error && c.metodo === 'otsu' && c.res.eta < 0.6) {
      m.push({ n: 'aviso', t: 'Separabilidad baja: η = ' + f(c.res.eta, 2), x: 'Otsu siempre devuelve un corte, aun cuando los dos grupos casi no se separan. Con η < 0,6 la frontera probablemente no es la que buscas.' });
    }
    /* 3 · efecto de la población */
    if (!c.error && c.tCompleta !== null && isFinite(c.tCompleta)) {
      const d = Math.abs(c.tObj - c.tCompleta), rango = v.rangoVis[1] - v.rangoVis[0];
      if (d > 0.025 * rango) {
        m.push({ n: 'info', t: 'La población cambió el umbral', x: 'Con la escena completa t = ' + f(c.tCompleta, 3) + ' (' + km(c.areaCompleta) + '); con la población dibujada (' + UL.fmtEntero(c.nPob) + ' px) t = ' + f(c.tObj, 3) + ' (' + km(c.area) + '). Mismo algoritmo, otros píxeles: la población es parte del método y se justifica antes de mirar el resultado.' });
      }
    }
    /* 4 · fuga de información */
    if (c.solape > 0) m.push({ n: 'alerta', t: 'Fuga de información', x: UL.fmtEntero(c.solape) + ' píxeles están a la vez en calibración y en validación. Un umbral evaluado con los mismos datos con que se eligió tiene un desempeño inflado.' });
    /* 5 · confusores del escenario */
    if (!c.error && c.confusion) for (const q of c.confusion) m.push(q);
    /* 6 · representatividad de la muestra de calibración */
    if (c.calInfo && c.calInfo.n >= 10 && (sup || (c.metodo === 'calib' && c.fuente === 'cal'))) {
      const ci = c.calInfo;
      if (ci.bordeEsc > 0.04 && ci.borde < 0.4 * ci.bordeEsc) m.push({ n: 'aviso', t: 'Muestra poco representativa', x: 'Solo ' + pct(ci.borde) + ' de las muestras de calibración está en bordes o píxeles mixtos, frente a ' + pct(ci.bordeEsc) + ' en la escena. Una muestra «donde se ve claro» da un umbral y un desempeño optimistas.' });
      if (ci.extension < 0.12) m.push({ n: 'aviso', t: 'Muestras concentradas', x: 'Las muestras de calibración ocupan ' + pct(ci.extension, 0) + ' de la extensión de la escena: el umbral puede no transferirse a otras zonas.' });
      if (c.metodo === 'f1' && ci.prev > 0 && (ci.prev / c.prevEsc > 2 || ci.prev / c.prevEsc < 0.5)) m.push({ n: 'info', t: 'F1 depende de la prevalencia de la muestra', x: 'La muestra tiene ' + pct(ci.prev) + ' de casos objetivo; la escena, ' + pct(c.prevEsc) + '. Con otra composición cambia el óptimo de F1; el de Youden casi no.' });
    }
    /* logística */
    if (!c.error && c.metodo === 'logistica' && !c.multi) {
      const a = c.res.ajuste;
      if (a.separacion) m.push({ n: 'aviso', t: 'Separación casi perfecta', x: 'Un corte del índice separa casi todas las muestras de calibración: β₁ = ' + f(a.b1, 1) + ' es muy grande y su error estándar no es confiable. El umbral está bien definido, pero las probabilidades saltan de 0 a 1. Prueba una muestra aleatoria o con bordes.' });
      const r = a.prevMuestra / c.prevEsc;
      if (!c.res.corregido && (r > 2 || r < 0.5)) m.push({ n: 'info', t: 'Probabilidades con la prevalencia de la muestra', x: 'La muestra tiene ' + pct(a.prevMuestra) + ' de clase objetivo y la escena ' + pct(c.prevEsc) + '. Sin corregir el intercepto, P = 0,5 corresponde a otra frecuencia en el paisaje. Activa la corrección y mira cómo se mueve t(p) y la curva de fiabilidad.' });
      else if (c.res.corregido) m.push({ n: 'info', t: 'Intercepto corregido por prevalencia', x: 'β₀ pasó de ' + f(a.b0, 2) + ' a ' + f(c.res.b0u, 2) + ' con π = ' + pct(c.prevEsc) + ': la pendiente no cambia, pero el corte para p = ' + f(c.res.pNivel, 2) + ' se desplaza.' });
    }
    if (!c.error && c.multi) {
      const Mc = c.multi.Mc.M, rec = Mc[2][2] / Math.max(1, Mc[2][0] + Mc[2][1] + Mc[2][2]), gl = Mc[1][2];
      if (c.multi.predictores.length === 1) m.push({ n: rec < 0.9 || gl > 100 ? 'aviso' : 'info', t: 'Un solo índice para tres clases', x: 'Con solo NDSI se clasifica bien el ' + pct(rec, 0) + ' de las lagunas y ' + UL.fmtEntero(gl) + ' píxeles de glaciar pasan a laguna: agua clara y nieve tienen NDSI alto. Agrega el NDWI (verde y NIR) y compara la matriz por clase.' });
      else m.push({ n: 'ok', t: 'Dos índices separan agua y nieve', x: 'Con NDSI + NDWI se clasifica bien el ' + pct(rec, 0) + ' de las lagunas (exactitud en 3 clases: ' + f(c.multi.Mc.exactitud, 3) + '). La frontera es una recta en el plano de los dos índices, no un corte de uno solo.' });
    }
    if ((sup || (c.metodo === 'logistica' && !c.multi)) && !c.error && c.valInfo.n === 0) m.push({ n: 'info', t: 'Falta una validación independiente', x: 'El umbral se eligió con las muestras de calibración. Genera o dibuja muestras de validación para evaluarlo con datos no usados.' });
    /* 7 · precisión frente a sensibilidad */
    if (!c.error && c.anterior && met.valida && c.anterior.valida) {
      const dP = met.precision - c.anterior.precision, dS = met.sensibilidad - c.anterior.sensibilidad;
      if (dP >= 0.03 && dS <= -0.03) m.push({ n: 'info', t: 'Más precisión, menos sensibilidad', x: 'La precisión subió de ' + f(c.anterior.precision, 2) + ' a ' + f(met.precision, 2) + ' y la sensibilidad bajó de ' + f(c.anterior.sensibilidad, 2) + ' a ' + f(met.sensibilidad, 2) + ': el corte es más estricto; inventa menos objeto a cambio de omitir más.' });
      else if (dS >= 0.03 && dP <= -0.03) m.push({ n: 'info', t: 'Más sensibilidad, menos precisión', x: 'La sensibilidad subió de ' + f(c.anterior.sensibilidad, 2) + ' a ' + f(met.sensibilidad, 2) + ' y la precisión bajó de ' + f(c.anterior.precision, 2) + ' a ' + f(met.precision, 2) + ': el corte es más permisivo; omite menos a cambio de más comisión.' });
    }
    /* 8 · dos configuraciones con áreas muy distintas */
    if (c.B && c.B.area > 0 && c.area > 0) {
      const r = Math.max(c.area, c.B.area) / Math.min(c.area, c.B.area);
      if (r >= 1.5) m.push({ n: 'info', t: 'A y B dan áreas muy diferentes', x: 'A: ' + km(c.area) + ' · B: ' + km(c.B.area) + ' (×' + f(r, 1) + '). Cada criterio es razonable para su propia función objetivo; la capa «Diferencia A–B» muestra dónde discrepan (' + UL.fmtEntero(c.B.difPx) + ' píxeles).' });
    }
    /* 9 · percentil fija el área */
    if (!c.error && c.metodo === 'percentil') m.push({ n: 'info', t: 'El área la fija p, no el fenómeno', x: 'Con p = ' + f(c.res.p, 3) + ', el ' + pct(v.dir > 0 ? 1 - c.res.p : c.res.p) + ' de la población queda del lado objetivo por construcción. Cambia la proporción de cobertura en la simulación: el área casi no se mueve.' });
    /* 10 · exactitud global engañosa */
    if (!c.error && met.valida && met.exactitud > 0.9 && met.f1 < 0.6 && met.prevalencia < 0.15) m.push({ n: 'aviso', t: 'Exactitud global engañosa', x: 'Exactitud ' + f(met.exactitud, 3) + ' con F1 = ' + f(met.f1, 2) + ': con ' + pct(met.prevalencia) + ' de clase objetivo, acertar el fondo infla la exactitud. Mira F1, IoU y la exactitud balanceada.' });
    /* 11 · calibración */
    if (!c.error && c.metodo === 'calib') {
      if (c.res.extrapola) m.push({ n: 'alerta', t: 'Umbral fuera del rango de los datos', x: 't = ' + f(c.res.cortes[0], 3) + ' cae fuera del 2–98 % del índice en los pares (' + f(c.res.rango[0], 2) + ' a ' + f(c.res.rango[1], 2) + '): la recta se está extrapolando.' });
      if (c.res.ajuste.r2 < 0.5) m.push({ n: 'info', t: 'Relación débil o no lineal', x: 'R² = ' + f(c.res.ajuste.r2, 2) + '. Revisa los residuos: si forman una curva, la relación se satura y la recta desplaza el umbral.' });
      if (c.res.dirModelo !== v.dir) m.push({ n: 'aviso', t: 'Pendiente con signo inesperado', x: 'La fracción Z disminuye cuando el índice aumenta en estos pares; el umbral se aplica en esa dirección.' });
    }
    /* 12 · GMM sin cruce */
    if (!c.error && c.metodo === 'gmm' && c.res.sinCruce) m.push({ n: 'aviso', t: 'Componentes sin cruce', x: 'Dos componentes no se cruzan entre sus medias; el corte se puso en el punto medio. Prueba otro K.' });
    /* 13 · banda de incertidumbre */
    if (!c.error && c.banda && c.area > 0 && c.banda / c.area > 0.5) m.push({ n: 'info', t: 'Muchos píxeles cerca del corte', x: km(c.banda) + ' tienen un índice a menos de 0,05 del umbral, frente a ' + km(c.area) + ' clasificados: un cambio pequeño de t mueve mucho el área. Mira la curva área–umbral en Validación.' });
    /* 14 · muestra frente a censo */
    if (!c.error && c.muestra && c.muestra.valida && met.valida && Math.abs(c.muestra.f1 - met.f1) > 0.1) {
      const pv = c.valInfo.prev, pe = c.prevEsc;
      if (pv && pe && (pv / pe > 2 || pv / pe < 0.5)) m.push({ n: 'info', t: 'La muestra de validación no tiene la prevalencia de la escena', x: 'La muestra tiene ' + pct(pv) + ' de clase objetivo y la escena ' + pct(pe) + '. Sensibilidad y especificidad se trasladan, pero la precisión y el F1 de la muestra (' + f(c.muestra.f1, 2) + ') no estiman los del mapa (' + f(met.f1, 2) + ' en el censo). Usa una muestra aleatoria o pondera por estrato.' });
      else m.push({ n: 'info', t: 'La muestra de validación se aleja del censo', x: 'F1 con ' + UL.fmtEntero(c.muestra.n) + ' muestras: ' + f(c.muestra.f1, 2) + '; con la referencia completa: ' + f(met.f1, 2) + '. Con pocas muestras o un diseño sesgado la estimación no es confiable.' });
    }

    if (!m.length && !c.error) m.push({ n: 'ok', t: 'Sin alertas en esta configuración', x: 'Cambia la población, el método o la simulación y observa qué variable explica cada cambio del umbral, del área y de las métricas.' });
    const orden = { alerta: 0, aviso: 1, info: 2, ok: 3 };
    m.sort(function (a, b) { return orden[a.n] - orden[b.n]; });
    return m.slice(0, 4);
  };
})(globalThis.UL = globalThis.UL || {});
