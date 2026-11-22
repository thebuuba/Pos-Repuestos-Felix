# Escáner global de ventas — 22 de noviembre de 2026

## Alcance entregado

El lector USB que funciona como teclado y termina con Enter agrega una unidad a la venta desde cualquier módulo, sin seleccionar el buscador. Conserva el precio seleccionado, cliente, pago y borrador al navegar. El botón «Escáner de ventas» en la cabecera permite desactivarlo. El pitido y el aviso aparecen después de aceptar el agregado; fuera de Ventas se ofrece «Ver venta». No se cobra automáticamente.

Los formularios conservan su entrada normal. Los diálogos, el cobro, las solicitudes pendientes y una ventana inactiva pausan el agregado global. Se mantiene el buscador para lectores lentos/códigos cortos y la cámara continua existente. El cálculo nuevo de precios quedó pospuesto por el usuario y no se modificó.

El estado compartido incluye el envío y el reintento original. Cambiar de base reinicia sólo la venta, sin desmontar formularios abiertos de otros módulos; una respuesta de la base anterior no altera ni desbloquea una venta de la nueva. La pérdida de sesión desmonta el contexto. El borrador no se conserva tras recargar/cerrar; el diario durable de operaciones enviadas permanece intacto.

## Pruebas y revisión

- Primera suite completa: 295 pruebas, 291 aprobadas, tres fallidas y una cancelada por tiempo. Detectó el desmontaje de formularios por cambio de base; además requirió adaptar el montaje aislado de venta al nuevo contexto y la expectativa móvil que antes asumía perder el carrito al navegar. Registro: `dist/verification/global-scanner-suite.log`.
- Después de corregir esas causas se ejecutaron completos los siete archivos afectados: escáner/cámara, detector, caja, formularios de catálogo, catálogo con PostgreSQL, venta móvil y venta con reintento. **52/52 aprobadas**, cero fallos/cancelaciones, 89,9 segundos. Registro: `dist/verification/global-scanner-regressions.log`.
- La prueba transaccional confirma una sola venta y la misma clave/cuerpo de reintento después de navegar durante una respuesta perdida. Las ventas móviles conservan tres unidades y registran RD$30.38, con existencias finales exactas, en Chromium y WebKit.
- La revisión independiente encontró y verificó la corrección del caso Space: códigos con espacios iniciales, internos o finales no pueden pulsar un botón de cobro. Una pulsación humana aislada de Space conserva su activación, diferida 100 ms para distinguir la ráfaga. Se probaron también intervalos iniciales de 60 ms, sin solicitudes de escritura.
- El revisor comprobó en un montaje aislado que una respuesta antigua exitosa o fallida no modifica el borrador, error o envío de la base nueva. Sin hallazgos importantes pendientes en el alcance revisado.
- Compilación operativa y `git diff --check` aprobados. No se agregaron dependencias ni migraciones ni se ejecutaron ventas/pruebas de escritura en producción.

## Interfaz

Se reutilizan el botón, icono, acento y notificaciones del diseño aprobado. La cabecera sustituye las notificaciones deshabilitadas por el lector. Capturas claro/oscuro en 320, 390, 768 y 1440 px y aviso desde Inventario: `dist/verification/global-scanner/`. Se comprobaron límites de cabecera y ausencia de desbordamiento horizontal. Las capturas del fixture muestran un aviso de caché porque sus service workers se bloquean deliberadamente; ese fixture no valida instalación offline. La suite general sí ejecutó las pruebas separadas del service worker.

## Publicación y Windows

Web/PWA publicada en https://repuestos-felix-pos.repuestosfelix1994.workers.dev con versión Cloudflare `e71b2d43-340d-43f4-96b0-b0e59b59889b`. Los **54 recursos activos** publicados y los del servidor local `127.0.0.1:3001` coinciden byte por byte con la compilación: `dist/verification/global-scanner-live.json`.

La instalación Windows recibió 74 recursos de interfaz actualizados y se cotejaron **516 archivos** contra el manifiesto. El ejecutable y el servidor permanecieron iguales; no se modificó la carpeta de datos del negocio. SHA-256 del ejecutable instalado: `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b`. Evidencia: `dist/verification/global-scanner-installed.json`. La ventana ya abierta toma la interfaz nueva al volver a abrirla.

NSIS terminó con código 0 y el payload volvió a verificar sus 516 archivos. Instalador final: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`, 331.162.968 bytes, SHA-256 `e5bf9857ee8c7ffd0bbec62db8cb12ab0604033237fac1318404dadf1c78ca4e`. Registro: `dist/verification/global-scanner-windows-final.log`. Se reutilizó el lanzador nativo verificado; no se ejecutó otra instalación. El empaquetado y la actualización de recursos no equivalen a comprobar el lector físico.

## Límites comprobables

El detector reconoce 4–256 caracteres con intervalos de hasta 80 ms y promedio de hasta 50 ms, finalizados con Enter. Es una aproximación por velocidad, no identificación de hardware. La marca, modo USB, sufijo y funcionamiento del lector del negocio todavía necesitan una prueba física. Tampoco se hizo una nueva prueba en un iPhone físico o en Windows 10. La app debe estar activa; no captura lecturas dirigidas a otro programa.
