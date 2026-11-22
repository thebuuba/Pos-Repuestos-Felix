# Validación de Caja

La pantalla conserva la composición de Polymet y conecta apertura, entradas, salidas y cierre con la confirmación transaccional. Los formularios bloquean cambios, Escape y cierre mientras el resultado es incierto; el reintento conserva la operación original. Las ventas identifican el turno y el medio de pago confirmado. Los métodos de pago históricos desconocidos no se completan con suposiciones.

## Funcionamiento comprobado

`pnpm exec node --test tests/cash-ui.test.js tests/operational-sales.test.js tests/operational-sale-browser.test.js` aprobó **10 de 10 pruebas**, sin fallos ni omisiones, después de la última corrección de los diálogos.

La prueba de navegador utiliza PostgreSQL desechable y la API real: abre caja, registra ventas con tarjeta, pierde una respuesta después del guardado, recupera exactamente la misma operación sin duplicarla, registra entrada/salida, recarga y cierra. Verifica fondo RD$0.00, esperado RD$75.01, contado RD$75.00 y ventas RD$55.01 en la base temporal. La diferencia de RD$0.01 se presenta como faltante. El recorrido final cierra desde un viewport de **320 × 600**, con el diálogo dentro de la pantalla y desplazamiento interno.

Las pruebas de interfaz comprueban ausencia de éxito anticipado, bloqueo durante confirmación, reintento, conservación de datos tras rechazo definitivo, conteo de denominaciones enteras y selector de medios de pago. El atributo `closeDisabled` de `DialogContent2` es opcional y mantiene el comportamiento anterior para los demás diálogos.

## Comparación visual y corrección móvil

Se verificó el SHA-256 `e3336f21633d743825d9f4bb1d42fc11ec4796fc11f6d830b7476dfc7a9404a5` del JavaScript aprobado archivado. Se sirvió junto a su CSS en memoria, empaquetando sus imports de React con la versión instalada. La vista pública actual tiene otra huella y no sustituyó la referencia aprobada. No se leyeron perfiles personales.

La comparación usa los mismos datos de demostración, fecha fija, idioma, zona horaria, fuente cargada y viewport en ambos lados. Estos datos permanecen en el montaje de diseño aislado; no se cargaron en una base del negocio.

Antes del ajuste final de altura se compararon **18 pares**: página de Caja, diálogo de movimiento y diálogo de conteo, en 390 × 844, 768 × 1024 y 1440 × 1000, claro y oscuro. Coincidieron textos y geometría en los 18 casos. La mayor diferencia de píxeles por umbral fue **0.2468 %**; no se observó desbordamiento horizontal. Se inspeccionaron capturas de escritorio y diálogos móviles. [Informe completo](caja-comparison-2026-11-22.json), [Caja de referencia](reference/caja-1440-light-reference.png) y [Caja local](reference/caja-1440-light-local.png).

La comparación reveló que el conteo original mide **862 px** de alto en un viewport móvil de 844 px. Se corrigió con `maxHeight: calc(100dvh - 2rem)` y desplazamiento interno en los dos diálogos de Caja. La revisión final del conteo a 390 × 844, en ambos temas, conserva el texto y limita su altura a **812 px**. Esta diferencia visual es intencional para mantener accesibles los controles en pantallas bajas. [Informe móvil final](caja-mobile-comparison-2026-11-22.json), [conteo original](reference/caja-conteo-390-dark-reference.png) y [conteo corregido](reference/caja-conteo-390-dark-local.png).

Las capturas completas permanecen en `dist/cash-comparison-2026-11-22` y `dist/cash-comparison-2026-11-22-mobile`. El script reproducible es `scripts/compare-cash.mjs` y acepta el archivo archivado como tercer argumento. La última captura móvil se ejecutó con `pnpm exec node scripts/compare-cash.mjs 2026-11-22-mobile supabase/.temp/polymet/reference.js 390 count`.

Esta comparación visual usa la entrada de referencia recuperada y sus datos de demostración; no demuestra equivalencia visual completa del proveedor operativo, identidad del cajero, barra lateral operativa o estados de error. La persistencia se verifica separadamente con la prueba de navegador descrita arriba. No demuestra funcionamiento offline, instalación PWA, instalador Windows ni publicación.
