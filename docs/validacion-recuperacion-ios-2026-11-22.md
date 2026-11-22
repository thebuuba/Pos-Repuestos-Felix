# Recuperación de ventas en iOS — 22 de noviembre de 2026

## Problema y corrección

Una respuesta perdida dejaba la venta en el diario, pero no había recuperación automática ni límite de espera para la escritura. El reintento del aviso general podía confirmar la operación sin resolver el error del borrador. Al reabrir, una lectura fallida del catálogo mostraba la pantalla técnica aportada por el usuario.

La nueva versión limita cada petición y la lectura de su cuerpo a 20 segundos mediante AbortController. Después de una lectura confirmada de la misma base, recupera automáticamente las ventas pendientes con el UUID, ruta, método y cuerpo originales. Hace hasta tres intentos con espera progresiva. Volver al primer plano o recuperar la conexión permite iniciar otro lote, incluso si el último intento anterior todavía estaba terminando. Los rechazos permanentes, la sesión revocada y el cambio de base detienen los reintentos automáticos.

La confirmación resuelve únicamente el borrador vinculado a esa operación y muestra su recibo. Otra pestaña puede recuperar la solicitud sin atribuirse la venta. sessionStorage conserva sólo el UUID de propiedad; se elimina al perder la sesión. El diario durable no se borra por un fallo de red. Si iOS descarta también sessionStorage, se recupera la operación sin asignar su recibo a un borrador ajeno.

La venta muestra un solo aviso de recuperación. La carga inicial distingue los fallos transitorios, anuncia la reconexión y vuelve a intentarlo automáticamente. Los errores permanentes y conflictos reales siguen visibles. El resto de formularios conserva su reintento manual para no confirmar cambios dejando su diálogo bloqueado.

Windows nativo puede recuperar la venta mediante su API local aunque `navigator.onLine` sea falso: la comprobación real del servidor local sigue siendo obligatoria. La web/PWA mantiene la espera hasta recuperar internet. Esta excepción no permite confirmar operaciones remotas sin conexión.

## Servidor y diagnóstico real

Las consultas de diagnóstico a producción fueron de lectura, usando una sesión propia que se cerró después. El catálogo respondió 200 y su revalidación 304: 7.682 productos, revisión 10 y 5.224.840 bytes JSON antes de compresión. El servicio estaba disponible en ese momento; no se pudo determinar el motivo exacto del fallo de red/servidor que aparece en las capturas originales.

Se omiten del catálogo operativo las fechas de auditoría de cada producto y los dos alias duplicados de mínimo/notificación. Se consultan sólo productos activos. Los precios exactos, existencias, documentos y movimientos se conservan. Los respaldos siguen incluyendo todas las columnas y productos inactivos. La versión de representación del ETag cambia de 4 a 5.

## Validación

- Se reprodujeron primero los fallos de respuesta perdida, petición colgada y reintento general sin desbloqueo/recibo; las regresiones nuevas pasan tras la corrección.
- La regresión del cambio de representación y el exceso de metadatos falló primero y pasó después. El grupo de servidor, operaciones y precisión pasó 25/25.
- La revisión independiente comprobó idempotencia, parada tras 403, conservación del diario tras 401 y reintento manual de otros recursos. Corrigió tres hallazgos: propiedad de recibo tras logout, error permanente oculto y alcance automático excesivo.
- WebKit a 390 × 844, con modo standalone y service worker real: venta confirmada cuyo resultado se pierde, reapertura con un 503 inicial y posterior recuperación automática. Dos paquetes idénticos, exactamente una venta adicional, recibo propio y ningún error de JavaScript. Es una simulación con WebKit; no una prueba en el iPhone físico.
- Primera suite completa: 308 pruebas, 305 correctas y tres fallos. Uno esperaba el mensaje de desconexión sustituido por el nuevo estado de reconexión. Dos pruebas del lector agotaron la espera; ambas pasaron al ejecutarse por separado. La prueba del aviso ahora reduce animaciones y lo mantiene visible mientras comprueba el audio. No se cambiaron los tiempos del detector de códigos.
- Suite completa, con el borde adicional de reconexión durante el último intento: **309/309**, cero fallos, cancelaciones u omisiones; 407,1 segundos. Registro: `dist/verification/ios-recovery-final-suite.log`.
- Después del ajuste exclusivo de Windows para alcanzar su API local sin internet, se volvió a ejecutar todo el grupo de recuperación junto con el gateway de Windows: **16/16**, cero fallos, 40 segundos. Incluye WebKit con service worker real, prueba Windows con `navigator.onLine=false` y prueba web que conserva su espera. Registro: `ios-recovery-platform-final.log`.
- Se conservaron los cambios de búsqueda de Suplidores que aparecieron en paralelo durante el trabajo. Su prueba ampliada volvió a pasar: las doce pantallas, ambos temas, cuatro tamaños y persistencia de contactos (`ios-release-concurrent-suppliers.log`). Los paquetes finales incluyen ese cambio concurrente.

## Publicación y comprobación real

Cloudflare publicó la versión final `03466192-e2ee-49e0-b39d-20aac7078176` en [Repuestos Félix POS](https://repuestos-felix-pos.repuestosfelix1994.workers.dev). El despliegue terminó con código 0 y los 54 archivos activos coincidieron por SHA-256 con la compilación, tanto en producción como en el servidor local del puerto 3001. Sustituye a la primera publicación de la corrección (`87cf1139-8c91-49f8-acaf-85c7a940b6c2`).

Una sesión propia de diagnóstico obtuvo 200 al iniciar sesión y al abrir `/ventas`; la entrada de JavaScript coincide con la compilación nueva. El catálogo devolvió 200 con los mismos 7.682 productos y revisión 10; la siguiente lectura condicional devolvió 304 en 144 ms. El JSON completo bajó de 5.224.840 a **4.272.140 bytes antes de compresión**, una reducción del **18,2 %**. La lectura completa medida fue de 1.377 ms; esa muestra aislada no demuestra una mejora estable de latencia. Se cerró únicamente la sesión de diagnóstico.

La instalación Windows existente recibió los recursos de interfaz y las dos modificaciones del servidor compartido (`http/app.js`, `pos/store.js`). Se verificaron sus 521 archivos finales contra el manifiesto. Se mantuvo el ejecutable nativo y no se tocó la carpeta de datos ni se reinició la aplicación abierta. Los módulos de servidor que ya estuvieran en memoria se actualizarán al volver a abrir Windows. Evidencia: `ios-recovery-live.json`, `ios-state-diagnostic.json`, `ios-recovery-installed-first.json` e `ios-recovery-installed.json`.

NSIS terminó con código 0 y se verificó nuevamente el payload final de 521 archivos. El instalador `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe` mide **331.176.729 bytes**; SHA-256 `af8d5ffc81a48a7e49cb6df059ad1f773a512788398d881d1243e963a2e104ae`. Se reutiliza el lanzador Tauri/WebView2 ya existente. No se ejecutó una instalación nueva ni se inspeccionó el archivo binario descomprimido; se validaron las entradas del empaquetado y su terminación.

Evidencia local: `dist/verification/ios-recovery-suite.log`, `ios-scanner-diagnostic.log`, `ios-state-before.json` y capturas `ios-recovery/webkit-pending-sale.png`, `webkit-reconnecting.png`, `webkit-recovered-receipt.png`.

No se realizaron migraciones ni escrituras de negocio de prueba en producción. La PWA continúa necesitando conexión para confirmar operaciones. La recuperación no convierte una solicitud incierta en una venta confirmada ni garantiza que nunca falle la red.
