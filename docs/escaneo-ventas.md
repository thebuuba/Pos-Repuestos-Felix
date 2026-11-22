# Escanear en ventas

El código debe existir en Inventario; se conserva como texto, incluidos los ceros iniciales. Escanear agrega al carrito y respeta las existencias, pero no confirma ni cobra la venta. El pitido y «Agregado a la venta» aparecen sólo cuando se acepta el artículo.

## Lector USB

1. Conectar el lector USB en modo teclado, con sufijo Enter/CR, y mantener Félix POS como ventana activa.
2. El botón **Escáner de ventas** de la cabecera aparece activo. Permite desactivarlo y recuerda esa preferencia en este navegador/equipo.
3. Leer la etiqueta desde cualquier módulo, sin seleccionar un campo. Cada lectura agrega **una unidad** a la venta actual con el nivel de precio seleccionado. Fuera de Ventas, el aviso ofrece **Ver venta**.

Al cambiar de módulo se conservan artículos, cliente, precio, pago y estado de confirmación. El borrador no se conserva al recargar o cerrar la aplicación; una operación ya enviada mantiene su recuperación durable mediante el diario existente. Al perder la sesión o cambiar de base se separan los borradores.

Mientras se escribe en entradas o formularios, el lector se comporta como teclado de ese campo. El modo global pausa los agregados durante diálogos, cobro y confirmaciones pendientes, o si la app no está activa. No trabaja mientras otra aplicación de Windows tiene el foco.

El modo global reconoce ráfagas de 4–256 caracteres terminadas en Enter, con intervalos máximos de 80 ms y promedio máximo de 50 ms. Esto es una aproximación por velocidad: un lector tipo teclado no informa su marca y no se distingue infaliblemente de la escritura humana. Para lectores lentos, códigos cortos o para agregar otra cantidad, enfocar **Código o nombre del producto** en Ventas; ese campo conserva el flujo anterior sin el límite de velocidad.

Si el lector escribe el código pero no lo agrega, pulsar Enter y comprobar en su manual la opción de sufijo Enter/CR. Si no escribe caracteres, hace falta identificar su modo de conexión/controlador. No se necesita una marca concreta para el modo teclado USB; la compatibilidad con el equipo físico del negocio todavía debe probarse.

Una lectura desconocida o ambigua muestra un mensaje y no pita; no selecciona la primera coincidencia parcial. Para buscar por nombre, seleccionar el resultado con clic o flechas y Enter.

## Teléfono

Abrir la web HTTPS o su PWA, entrar en Punto de venta y pulsar el icono de cámara separado del buscador. Conceder el permiso del navegador y centrar la etiqueta entre las guías horizontales. Se prefiere la cámara trasera; las imágenes se procesan localmente. La cámara permanece abierta para seguir escaneando. Un código sostenido se cuenta una vez; para repetirlo, apartarlo al menos 800 ms y volver a enfocarlo. Se apaga al cerrar el diálogo, cambiar de pantalla o dejar la app en segundo plano.

La PWA se instala desde **Instalar app**: Chrome en Android o Compartir → Añadir a pantalla de inicio en Safari para iPhone. Las ventas de web/PWA requieren conexión al servidor. La versión Windows conserva y sincroniza operaciones offline según la guía de instalación.

## Evidencia

`tests/keyboard-scanner.test.js` y `tests/barcode-scanner.test.js` verifican códigos exactos, ambigüedad, ceros, ráfagas USB, navegación, pausas, existencias, una lectura real del decodificador sobre barras sintéticas y liberación de cámara. `tests/operational-sale-browser.test.js` comprueba en PostgreSQL desechable el reintento de una venta al navegar sin duplicar su registro. Las capturas nuevas están en `dist/verification/global-scanner`. Estas pruebas no equivalen a probar la cámara del teléfono ni el lector físico del negocio.
