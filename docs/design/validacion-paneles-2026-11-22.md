# Validación de los paneles conectados

La entrada operativa registra las doce rutas y abre el Panel. Se reutilizan los componentes recuperados de Polymet; el grafo de compilación excluye `pos-store.jsx`, `seed-data.js`, `pos-data.js` y la imagen del cajero de demostración. Las diferencias de disponibilidad se muestran en la propia pantalla.

## Comparación visual

Se utilizó la versión aprobada `99fdb61658b9417c680d007618ae1c23bf135b1e`, archivada durante la recuperación. Los datos de demostración se utilizaron únicamente en la referencia y los montajes temporales de comparación, sin cargar una base del negocio.

- **Punto de venta:** ocho pares, claro/oscuro en 320, 390, 768 y 1440 px. En escritorio coinciden las posiciones y dimensiones de las tarjetas de factura, productos y detalle. El resumen operativo es más corto porque no inventa el efectivo recibido ni un NCF. A 320 px cabe en el ancho disponible, mientras la referencia medía 340 px. [Montaje](reference/ventas-comparacion-2026-11-22.jpg) y [geometría](ventas-geometria-2026-11-22.json).
- **Compras:** seis casos en 390, 768 y 1440 px, ambos temas. Coincide la geometría en los dos tamaños menores. En escritorio permanece una diferencia de tres píxeles de altura en la tabla. [Informe](compras-comparison-2026-11-22.json).
- **Panel, Reportes, Configuración y Ayuda:** 24 casos con los mismos datos, fecha y temas de la referencia. La geometría medida coincide en 22 casos. Panel y Reportes a 390 px se corrigieron para que las tablas se desplacen dentro de sus tarjetas y no ensanchen la página. En los 20 pares de PNG con el mismo tamaño, la diferencia máxima medida por umbral fue del 0,50 %. [Informe](tableros-comparison-2026-11-22.json).

Los JSON conservan geometría y resultados. Las capturas completas de las comparaciones se conservan en `dist/design-comparison-compras-20261122`, `dist/design-comparison-tableros-20261122` y el montaje temporal indicado en el informe del trabajo. La vista pública actual de Polymet no tenía el hash archivado; no se sustituyó la referencia aprobada por esa versión diferente.

## Pruebas de funcionamiento

La ejecución final `pnpm exec node --test --test-concurrency=2 --test-timeout=180000 tests/*.test.js` aprobó **199 de 199 pruebas**, sin fallos ni omisiones. `pnpm build:worker` terminó correctamente como comprobación de empaquetado. El recibo se verificó en Edge bajo medio de impresión para 58 mm, 80 mm y Carta; el PDF de Carta mide 612 × 792 puntos. No se probó una impresora física.

`tests/operational-panels.test.js` recorre las doce rutas a 320, 390, 768 y 1440 px en ambos temas, verifica que no aparezca el antiguo placeholder ni desbordamiento horizontal y guarda/recarga clientes y suplidores en PostgreSQL desechable.

Los casos de ventas y compras utilizan la API real sobre PostgreSQL temporal. Cubren cantidades fraccionarias, tarifas de cuatro decimales, cálculo por línea, una respuesta perdida después de confirmar y recuperación con el mismo cuerpo y clave idempotente. Compras añade conflicto de versiones y dos altas concurrentes del mismo código. Configuración y fórmulas se verifican guardando, recargando, editando y eliminando; Reportes exporta la venta de prueba.

La API conserva el cálculo exacto, verifica stock y crédito en el servidor y nunca confirma una operación solo porque cambió la pantalla. Los controles de Caja y abonos permanecen deshabilitados porque faltan sus transacciones y la conciliación de históricos. NCF, descuentos, medios de pago y anulaciones no se presentan como terminados.

Estas verificaciones no demuestran instalación PWA, funcionamiento offline ni un instalador Windows. Las comprobaciones contra la base del negocio se limitan a autenticación y lectura; no se registran operaciones de prueba ni se aplican migraciones.

El servicio local en el puerto 3001 superó 72 comprobaciones adicionales con el catálogo real: doce rutas, tres tamaños y ambos temas, sin errores de JavaScript ni desbordamientos horizontales. Los suplidores de nombre/contacto largo conservan las tarjetas dentro del ancho disponible. Las capturas del negocio se guardan fuera del repositorio en `%LOCALAPPDATA%/RepuestosFelix/validacion-paneles-20261122/local`; no se incluyen datos reales en los recursos publicados.

## Publicación comprobada

La versión `00e944ec-eb33-474f-ab22-cddd473adcab` quedó publicada en [el POS de Repuestos Félix](https://repuestos-felix-pos.repuestosfelix1994.workers.dev). La misma revisión de 72 casos pasó en esa dirección: login individual, navegación real, doce pantallas, tres tamaños y dos temas, sin errores JavaScript ni desbordamientos. Se consultaron los 7.681 productos en revisión 2; ventas y compras operativas permanecían en cero. La verificación cerró su propia sesión al terminar.

Las capturas y el informe del sitio real se conservan en `%LOCALAPPDATA%/RepuestosFelix/validacion-paneles-20261122/web`, fuera de Git. El código y la documentación permanecen en la rama de trabajo; no se integraron en `main`.
