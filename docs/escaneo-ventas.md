# Escanear en ventas

El lector usa el campo **Código o nombre del producto** del punto de venta. El código debe existir en Inventario; se conserva como texto, incluidos los ceros iniciales. Escanear agrega una línea al carrito y respeta las existencias, pero no confirma ni cobra la venta.

## Lector USB

1. Conectar el lector y abrir Punto de venta.
2. Hacer clic en **Código o nombre del producto**.
3. Leer la etiqueta. Los lectores que funcionan como teclado y terminan con Enter agregan el artículo automáticamente.

Si el lector escribe el código pero no lo agrega, pulsar Enter y comprobar en su manual la opción de sufijo Enter/CR. Si no escribe caracteres, hace falta identificar su modo de conexión/controlador. No se necesita una marca concreta para el modo teclado USB; la compatibilidad con el equipo físico del negocio todavía debe probarse.

Una lectura desconocida o ambigua muestra un mensaje; no selecciona la primera coincidencia parcial. Para buscar por nombre, seleccionar el resultado con clic o flechas y Enter. El lector sólo actúa en el campo de búsqueda, no captura teclas de los demás formularios.

## Teléfono

Abrir la web HTTPS o su PWA, entrar en Punto de venta y pulsar el icono de cámara del campo de búsqueda. Conceder el permiso del navegador y centrar la etiqueta. Se prefiere la cámara trasera; las imágenes se procesan localmente. Tras una lectura se cierra la cámara para evitar agregar el mismo fotograma varias veces. También se apaga al cerrar el diálogo, cambiar de pantalla o dejar la app en segundo plano.

La PWA se instala desde **Instalar app**: Chrome en Android o Compartir → Añadir a pantalla de inicio en Safari para iPhone. Las ventas de web/PWA requieren conexión al servidor. La versión Windows conserva y sincroniza operaciones offline según la guía de instalación.

## Evidencia

`tests/barcode-lookup.test.js` y `tests/barcode-scanner.test.js` verifican códigos exactos, ambigüedad, ceros, secuencias USB, existencias, una lectura real del decodificador sobre barras sintéticas y liberación de cámara. Las capturas de prueba están en `dist/scanner-2026-11-22`. Estas pruebas no equivalen a probar la cámara del teléfono ni el lector físico del negocio.
