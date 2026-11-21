# Comparación visual del diseño recuperado

Se compararon las doce rutas de Polymet con la copia local, a 390×844, 768×1024 y 1440×1000, en claro/oscuro: **72 casos**. Se comprobó el hash de la versión publicada antes de comenzar. El [informe de medidas](visual-comparison-2026-11-21.json) conserva todos los resultados, incluidos los que difieren. Las capturas completas están en `dist/design-comparison-final/`, fuera de Git.

- Los textos coinciden en 72/72 casos.
- La geometría de los elementos medidos coincide en 70/72. Compras en 1440 px tiene 3 px adicionales de altura, en ambos temas.
- 53 pares de PNG son idénticos byte por byte. En los pares restantes con dimensiones iguales, los píxeles con diferencia superior a 24 niveles por canal abarcan como máximo 0,36% de la imagen. Esto no equivale a declarar idénticas las pantallas restantes.
- Las diferencias residuales están en tipografía/badges de tablas y resumen fiscal. Se identificó una diferencia de línea de medio píxel al mezclar fuente Inter y monoespaciada entre el modo quirks del original y HTML5. Su corrección final sigue pendiente.
- Panel, Suplidores y Reportes heredan desbordamiento horizontal de la referencia a 390 px. Debe corregirse de forma mínima antes de entregar la versión móvil operativa; conservar una captura equivalente no valida la usabilidad de ese desbordamiento.

Las capturas de página completa muestran la gráfica en un fotograma de reajuste; no se usan como prueba de su distribución en reposo. Se verificó adicionalmente el Panel en un viewport real de 1440×1000, sin reloj simulado: fuente cargada, animación terminada, ancho de barra 44 px y las mismas posiciones de todas las barras en referencia/local. Los PNG de esa comprobación son idénticos. Se conservan en `reference/1440-light-panel-runtime-reference.png` y `reference/1440-light-panel-runtime-local.png`; las muestras con nombre corto del Panel usan estas capturas de viewport.

La fecha de negocio de la matriz es fija, pero se mantiene `Date.now()` real para las animaciones. No usar un reloj que congele por completo los temporizadores para afirmar que una gráfica terminó de animarse. Esta evidencia compara presentación con datos de demostración; no certifica la integración de datos, el guardado, la sincronización ni el ejecutable Windows.

La prueba `pnpm test:design` complementa la comparación: navega las doce rutas, comprueba sus títulos, abre/cierra el menú móvil, cambia el tema, verifica el espaciado medido de la factura y exige ausencia de excepciones/solicitudes externas. Una revisión independiente comprobó también varios formularios y confirmaciones con foco y Escape. Los demás estados secundarios y la interfaz con datos reales seguirán validándose durante la integración.
