# Corrección de sincronización — 22 de noviembre de 2026

## Alcance

Corrección autorizada después de la auditoría de Windows, PWA, autenticación y servidor. Se conservan la rama `feat/sistema-unificado-offline`, la interfaz compartida y los cambios previos. No se modifican credenciales del negocio ni se ejecutan migraciones o ventas de prueba en producción.

## Comportamiento

- Windows espera la red fuera del turno serial de operaciones locales. La preparación de sobres y la confirmación de recibos siguen protegidas; una descarga que encuentra nuevas operaciones locales no las reemplaza. Las generaciones de autenticación se comprueban también al regresar de las esperas.
- Una venta offline puede convivir con ventas PWA del mismo turno abierto. Se comprueban existencias actuales, configuración, importes exactos y efecto completo del documento dentro de la transacción. El sobre original no cambia. Precios incompatibles, crédito insuficiente, turnos cerrados, aperturas y cierres divergentes mantienen sus rechazos.
- Los conflictos permanentes dejan de repetirse en cada sondeo. El reintento explícito vuelve a comprobarlos. La revisión permite archivar el lote únicamente tras un acuse del servidor que retira su flujo: los envíos tardíos de ese flujo quedan impedidos. Si un pendiente ya se confirmó en la base actual, primero se debe recuperar su recibo. Se conservan los originales, sobres, estado local y acuse, se rota el identificador del flujo y se carga el servidor. Una respuesta perdida conserva la intención de revisión para reanudarla, incluso tras reiniciar.
- La PWA permite revisar y archivar una solicitud de una generación anterior. IndexedDB conserva el original y elimina el pendiente en una sola transacción; el archivo también impide que una pestaña antigua lo reactive. No se reenvía automáticamente a otra base. El historial sigue disponible para descargar.
- Una lectura fallida o un 401 antiguo no reemplaza una confirmación posterior. La renovación automática rechazada no envía un borrado de cookie que pudiera destruir otra sesión recién emitida. La revocación vigente sigue denegando acceso.
- Windows selecciona exclusivamente la cookie propia, interpreta su expiración y evita persistir una credencial después de haberla invalidado. La vigencia offline se renueva con una identidad remota comprobada; el uso local por sí solo no concede una renovación remota.
- Las respuestas de escritura entregan ETag. El estado local y el bootstrap remoto admiten 304. Los envíos de Windows piden recibos compactos y el servidor comprueba sólo las filas afectadas en vez de exportar todo el respaldo por operación. La descarga completa se conserva cuando se necesita un nuevo estado.
- Una validación ya revertida no reconstruye PGlite. Al adoptar datos confirmados se reutiliza el motor ya migrado: la proyección completa, las identidades, las secuencias y la configuración se actualizan en una transacción. Si falla, el motor queda inaccesible y se reconstruye desde SQLite. Un fallo de confirmación durable en SQLite también descarta el estado de memoria. La descarga completa y su importación siguen siendo necesarias cuando cambian los datos; esta corrección no introduce sincronización incremental por filas.
- La secuencia por dispositivo utiliza un cursor durable bajo la clave primaria ya existente. Las operaciones consecutivas propias usan esa búsqueda indexada. Si cambia la revisión por una escritura intercalada, se reconcilia contra el historial para detectar también servidores antiguos que no actualizaban el cursor. No requiere una migración en Supabase.

## Evidencia y límites

Las pruebas nuevas se ejecutan con PostgreSQL y SQLite desechables, respuestas simuladas e IndexedDB de navegador. Se observaron regresiones fallando antes de las correcciones. Las capturas de revisión en 320, 390, 768 y 1440 px, claro y oscuro, están en `dist/verification/pwa-journal-review/` y `dist/verification/sync-recovery-desktop/`.

La simulación WebKit no sustituye una prueba en el iPhone físico. Los tiempos de respuesta y la disponibilidad de internet no pueden garantizarse. Los archivos de revisión conservan evidencia y no equivalen a contabilizar o anular una venta en el servidor.

La primera suite completa ejecutó 405 pruebas: 399 correctas y 6 fallidas. Cinco fallaron durante el arranque de PostgreSQL desechable al superar su límite de 30 segundos, antes de ejecutar el caso; coincidieron varias pruebas adicionales y un uso alto de memoria. El sexto caso fue una lectura HID simulada durante un diálogo de cámara. Pasó aislado y se añadió una regresión que enfoca explícitamente el botón de cierre, verifica que el Enter del lector no lo active y conserva el Enter manual. No se aumentaron los límites del lector ni los tiempos de espera para ocultar estos fallos. La repetición completa se ejecuta con concurrencia 2 y sin otros grupos en paralelo.

La repetición completa (`sync-recovery-full-final.log`) terminó con **407 pruebas: 406 correctas y una aserción de tema fallida**. La prueba comparaba el `body` aún transparente, antes de recibir CSS, con su fondo final. Se corrigió para comparar el color inicial de `html`, que ya pinta la pantalla desde el estilo inline, con el fondo final. Los **8 casos de arranque y tema** pasaron después en Chromium y WebKit (`sync-recovery-startup-final.log`), sin cambiar el código del producto ni ampliar esperas. Los seis fallos de la primera ejecución no reaparecieron.

La PWA pasó también sus **22 casos de revisión y archivo** después de retirar identificadores técnicos de la interfaz. El JSON descargado conserva los identificadores originales. Las pruebas incluyen transacciones IndexedDB abortadas, bloqueos entre pestañas, recuperación tras restaurar una base desechable y navegación posterior al archivo.

La última optimización de Windows se verificó después de la suite general: **16/16 pruebas correctas** de motor, gateway, memoria y recuperación (`windows-projection-regression.log`). Las dos regresiones nuevas fallaron antes del cambio y pasaron después: reutilización del ejecutor conservando identidades y proyección autoritativa, y recuperación desde SQLite ante fallos de restauración, metadatos o pérdida de respuesta al commit. Una revisión independiente del código no encontró defectos P1/P2 en esta actualización.

## Orden de publicación

Publicar primero el Worker completo y después activar los recursos Windows. El servidor debe reconocer el retiro de flujos antes de que Windows permita archivar pendientes. Después del primer retiro no se debe volver a una versión antigua del servidor que ignore esos marcadores: podría aceptar sobres tardíos que ya fueron archivados. Una corrección posterior debe conservar la barrera de retiro.

La actualización de los archivos instalados no reinicia una caja abierta. El nuevo servidor local se carga al cerrar y volver a abrir Félix POS. Se mantienen separados los archivos de programa y los datos de `%LOCALAPPDATA%\RepuestosFelix\POS`.

## Publicación web/PWA

- Compilación y empaquetado de Worker con `pnpm build:worker`: código 0.
- Publicación con `pnpm deploy:worker`: código 0. Worker `repuestos-felix-pos`, versión `62590965-6fd9-4422-874d-2a26d7ca7658`.
- Origen: `https://repuestos-felix-pos.repuestosfelix1994.workers.dev`.
- Verificados por SHA-256 los **55 recursos activos** de la entrega, incluyendo el service worker y la página de acceso con su atributo de cuentas. `/health` respondió 200 y `/api/state` sin sesión respondió 401. Evidencia: `dist/verification/sync-recovery-live.json`.
- No se ejecutaron ventas de prueba ni migraciones en la base real. Las reglas de negocio del servidor se validaron con PostgreSQL desechable.

## Archivos instalados en Windows

Se preparó y verificó un payload de **556 archivos, 141,1 MiB**. La instalación de esta computadora recibió **48 archivos nuevos o modificados**, incluyendo el servidor local. Los 556 recursos coinciden por SHA-256 con el manifiesto (`dist/verification/sync-recovery-installed.json`). El lanzador nativo instalado no cambió y no se reinició la aplicación; el nuevo código del servidor se activa al volver a abrirla. No se modificó la carpeta de datos del negocio.

El instalador NSIS terminó con código 0 usando el lanzador nativo ya compilado (sin cambios en Rust). Se verificó de nuevo el payload después del empaquetado y la copia final por SHA-256. No se ejecutó de nuevo el instalador sobre esta computadora.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: **331.214.154 bytes**.
- SHA-256: `bcb67ee5d6971d82a7cfbd53a899a7a483da2dde12d15662ca86303149b755e0`.
- Evidencia: `dist/verification/sync-recovery-windows-bundle.log`, `sync-recovery-installer.json` y `dist/releases/SHA256.txt`.
