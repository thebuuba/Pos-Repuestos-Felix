# Instalación Windows

La aplicación usa los mismos componentes del POS web y PWA. El instalador se prepara para Windows 10/11 de 64 bits, con instalación por usuario y asistente en español. Incluye Node 24.16.0 y el instalador offline de Microsoft Edge WebView2; no necesita que el usuario instale Node, PostgreSQL, Rust ni herramientas de desarrollo.

La primera configuración del equipo requiere conexión e inicio de sesión para descargar los datos autorizados del negocio. El paquete no contiene inventario, usuarios, claves, respaldos ni datos de demostración. Después de la configuración, SQLite conserva las tablas operativas, solicitudes y operaciones pendientes; PGlite se usa en memoria para ejecutar las mismas reglas SQL del servidor.

## Uso

1. Ejecutar el archivo `Repuestos-Felix-1.0.0-windows-x64-setup.exe` de la entrega verificada.
2. Abrir **Repuestos Felix** desde Inicio. El servicio local se inicia y se cierra con la aplicación, sin una consola aparte.
3. Conectar el equipo e iniciar sesión para realizar la primera descarga.
4. El botón de sincronización de la cabecera muestra «Al día», «Sin conexión» o «Revisar sincronización», con un contador si hay operaciones pendientes. Al pulsarlo se consultan la última actualización, los detalles y la descarga de operaciones. En ventanas estrechas se conserva el icono y el contador.

El programa y los recursos se instalan en la carpeta de aplicaciones del usuario. Los datos del negocio se conservan aparte, en `%LOCALAPPDATA%\RepuestosFelix\POS`. Esta carpeta no debe colocarse dentro de OneDrive, abrirse simultáneamente desde otro equipo ni borrarse para resolver un conflicto. La desinstalación del programa no incorpora ninguna orden para borrar esta carpeta de datos.

Un conflicto significa que el servidor no aceptó todavía la operación local. No se sustituye su precio ni se descarta su documento automáticamente. El estado local no equivale a información global actualizada mientras el equipo esté desconectado.

## Construcción de la entrega

Requisitos del equipo de compilación: Windows x64, pnpm, Node 24.16.0, Rust/Cargo con destino `x86_64-pc-windows-msvc` y C++ Build Tools de Visual Studio. La primera compilación puede descargar herramientas NSIS y el redistribuible oficial de WebView2. Estas descargas son de construcción; el instalador incluye el runtime de WebView2 para instalarlo sin red.

```powershell
pnpm build:windows
```

El script compila la interfaz, prepara `dist/windows-payload/`, verifica su manifiesto SHA-256 y genera el instalador en `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Copia la entrega a `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe` y escribe su hash en `dist/releases/SHA256.txt`. El proyecto conserva `Cargo.lock` y `pnpm-lock.yaml` para fijar las dependencias de la entrega.

La preparación permite únicamente código JavaScript de `src`, migraciones SQL versionadas, recursos de `dist/operational`, PGlite y el runtime de Node. No copia `.env`, configuraciones administrativas, archivos de datos, certificados, logs, `supabase/.temp`, pruebas ni otros paquetes de `node_modules`.

```powershell
node scripts/build-windows.mjs --verify
```

Esta comprobación rechaza archivos adicionales o modificados dentro del payload. El manifiesto describe archivos del programa; no es un respaldo del negocio.

## Alcance de la validación

Compilar el instalador y comprobar el payload no demuestra que el programa instalado haya superado las pruebas de funcionamiento. La entrega debe registrar por separado la instalación, apertura/cierre, persistencia tras reinicio, operaciones offline, reconexión y conflictos en bases desechables. Las pruebas del motor y las del servidor no sustituyen esas comprobaciones del ejecutable.

Esta configuración no utiliza un certificado comercial de firma de código. La procedencia y el hash del instalador deben acompañar la entrega; no se afirma una firma inexistente.

## Entrega inicial del 22 de noviembre de 2026

Esta primera entrega fue sustituida por la actualización visual documentada al final.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.349.256 bytes (315,05 MiB).
- SHA-256: `c16b6e4c3c8b51ed7d2c0334b7528783e512ab1f888d96af4a9adfdf4dad7a2a`.
- El instalador no está firmado. El redistribuible WebView2 incluido tiene firma válida de Microsoft; Node tiene firma válida de OpenJS Foundation.

La compilación release y NSIS terminaron correctamente. La lista del instalador coincide con los 381 archivos del manifiesto más el propio manifiesto. El runtime copiado abrió `/login`, rechazó una segunda instancia y reabrió después de cerrar; PGlite/WASM ejecutó una operación decimal exacta en memoria desechable. Dos pruebas de Rust verificaron el mensaje de disponibilidad y el arranque desde una ruta canónica de Windows. La ventana nativa del release corregido se observó con el acceso renderizado y se cerró con Alt+F4.

El servicio conserva su puerto en SQLite para mantener el origen de IndexedDB entre reinicios. Se comprobó una respuesta interrumpida, recuperación del identificador pendiente y reintento sin duplicar el turno de caja; también se verificaron reinicio abrupto y rechazo de un puerto ocupado. Estas comprobaciones utilizaron perfiles y bases desechables; no constituyen una prueba de sincronización contra producción.

La entrega final se instaló en Windows 11 Home de 64 bits con código de salida 0. Se cotejaron los 381 recursos instalados y los archivos `main.js` y `server.js` contra el código fuente. El programa instalado respondió `/health` y `/login` con HTTP 200 y sirvió `desktop.js`; después se reabrió con el mismo perfil temporal y conservó el origen `127.0.0.1:60306`. El proceso auxiliar terminó en ambos cierres. El reporte local de esta comprobación está en `supabase/.temp/installed-smoke.json`.

El ejecutable instalado tiene SHA-256 `633cb229aa66bbcf0193a8aabb386cfe8f462d5434463caf1395923276b14cc6`. Tauri añade la marca `NSS` al empaquetarlo y restaura `UNK` en el archivo de compilación: la comparación binaria confirmó únicamente esos tres bytes de diferencia. No se deben comparar sus hashes sin considerar esa marca del empaquetado. La prueba instalada se realizó en Windows 11; Windows 10 no se verificó en una máquina aparte.

La opción `offlineInstaller` incorpora el instalador completo de WebView2, según la [documentación oficial de Tauri](https://v2.tauri.app/distribute/windows-installer/#offline-installer). La instalación técnica silenciosa admite `/S`; si se especifica `/D=`, la ruta absoluta debe ser el último argumento, conforme al [manual de NSIS](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage).

## Actualizaciones visuales del 22 de noviembre de 2026

Se retiró la tarjeta permanente «Este equipo · almacenamiento local». El estado y contador quedan en la cabecera, y los detalles de sincronización se abren a petición. Posteriormente el usuario pidió eliminar también la tarjeta inferior del cajero, su saldo y acción de cierre. La gestión de caja permanece en su página. El instalador conserva el mismo nombre y versión:

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.782.421 bytes.
- SHA-256: `d8a7b9dd3985bf0f12cb994f8da251a4ab716b9d1ea97c9958bdd1b21178c4ae`.
- Payload: 383 archivos verificados. Compilación del lanzador: `dist/build-windows-ui.log`; empaquetado actualizado: `dist/bundle-sidebar.log`.

Las pruebas de interfaz y gateway aprobaron ocho casos, con capturas de caja y diálogo a 320, 390, 768 y 1440 px en claro/oscuro. La actualización de caché publicada para la PWA se validó aparte; Windows no registra ni utiliza el service worker.

El instalador del primer ajuste terminó con código 0. Se verificaron sus 382 recursos contra el manifiesto y su HTML/JavaScript/CSS contra la compilación publicada. Antes de volver a abrir el POS, la comparación de hashes confirmó que el instalador conservó íntegra la carpeta de datos del negocio. El ejecutable instalado tiene SHA-256 `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b`; coincide con el release al normalizar la marca NSIS de Tauri. Reporte local: `supabase/.temp/installed-ui-update.json`.

Se reabrió la aplicación instalada conservando el origen `127.0.0.1:52171` y la sesión existente. La ventana nativa mostró el Panel sin la tarjeta técnica y el control compacto de sincronización en la cabecera. Esta observación fue de lectura; no se registraron operaciones de prueba en el negocio.

Para retirar la tarjeta del cajero se actualizaron únicamente los recursos públicos de la interfaz y el manifiesto instalado, conservando el ejecutable y el servidor. Se verificaron los 383 recursos contra el nuevo payload y se observó la ventana de ventas ya sin la tarjeta inferior, con «Caja» aún accesible en el menú. El gateway volvió a superar su prueba completa en una base desechable. El nuevo instalador se prepara con `pnpm prepare:windows` y `pnpm exec tauri bundle --target x86_64-pc-windows-msvc --bundles nsis`, reutilizando el lanzador nativo verificado; este carga la interfaz desde `app/assets` mediante su servidor local. Reporte de recursos instalados: `dist/verification/sidebar-installed.json`.

## Entrega con correcciones de cámara, navegación y sesiones

Esta entrega sustituye al instalador visual anterior. Comparte las correcciones de la cámara visible, preparación de ventas en varias pestañas y navegación inferior móvil. Windows conserva el ejecutable Tauri/WebView2, Node y SQLite; no se convierte en un acceso PWA.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.804.803 bytes.
- SHA-256: `e5064677082d1ac9783a3649a3dcd1d0afc34c12a82f5cac7bcab1120b09b9e3`.
- Payload: 385 archivos, verificados antes y después del empaquetado. Registro de NSIS: `dist/verification/bundle-pwa-camera.log`.

Se reutiliza el lanzador nativo previamente verificado porque los cambios afectan a la interfaz que sirve `app/assets`. Compilar y verificar este paquete no constituye una nueva ejecución del instalador ni una prueba en una computadora con Windows 10.

La instalación existente recibió los nuevos recursos públicos y se cotejaron sus 385 archivos con el manifiesto (`dist/verification/sidebar-installed.json`). El ejecutable y el servidor conservaron sus hashes; la actualización no reemplazó la base del negocio. Se abrió de nuevo con la sesión existente y el mismo origen `127.0.0.1:52171`; el árbol de accesibilidad mostró el Panel con sus datos y el estado «Sin conexión», sin pendientes. Se cerró al finalizar la comprobación. Esta observación del arranque no equivale a probar ventas reales ni a una captura visual del escáner físico.

## Entrega con visor horizontal y guías de cámara

Esta entrega sustituye a la anterior y añade el visor 16:9, cuatro esquinas y una línea roja central. En teléfonos girados los controles se colocan al lado de la imagen; el cambio de orientación conserva la captura activa.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.816.204 bytes.
- SHA-256: `f888ae99250614e7530a30e235cae72cb98930d335981efb5a275070c97fa46c`.
- Payload: 387 archivos verificados. Registro de NSIS: `dist/verification/bundle-scanner-landscape.log`.

La instalación existente recibió los recursos de la interfaz y se verificaron sus 387 archivos contra el manifiesto (`dist/verification/scanner-landscape-installed.json`), conservando el ejecutable nativo, el servidor y los datos del negocio. El paquete reutiliza el lanzador ya verificado; no se ejecutó de nuevo el instalador.

Las pruebas de escáner, búsqueda, navegación móvil y actualización de PWA aprobaron 17 casos (`dist/verification/scanner-landscape-final.log`). Las capturas usan una cámara simulada y cubren claro/oscuro, móvil vertical, horizontal y escritorio; no sustituyen una comprobación con la cámara física de un iPhone. La interfaz publicada y la del servidor local coinciden con la compilación (`dist/verification/scanner-landscape-live.json`).

## Entrega con pitido y confirmación de escaneo

Esta entrega sustituye a la anterior. Al aceptar una lectura de cámara o lector USB, el POS emite un pitido breve y muestra «Agregado a la venta» con cantidad y nombre. Los rechazos no emiten éxito. Comparte además los ajustes móviles posteriores, conservando la distribución completa de escritorio.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.926.993 bytes.
- SHA-256: `12b15f340f1cfb062be6e22e4f467a09a77c96b90b16061ea92d56ed9f700fec`.
- Payload: 391 archivos, 129,0 MiB, verificados después del empaquetado. Registro: `dist/verification/bundle-scanner-feedback.log`.

La aplicación instalada recibió los recursos públicos de la interfaz y se cotejaron los 391 archivos contra el manifiesto (`dist/verification/scanner-feedback-installed.json`). Ejecutable nativo, servidor y datos del negocio se conservaron. NSIS reutiliza el lanzador previamente verificado; no se ejecutó de nuevo el instalador.

Las pruebas de escaneo, búsqueda, venta móvil, gateway Windows y actualización PWA aprobaron 20 casos (`dist/verification/scanner-feedback-final.log`). Chromium produjo señal Web Audio real y confirmó su finalización; la ausencia o fallo de audio no impidió agregar ni mostrar el aviso. No se ha escuchado el sonido en el lector físico ni en el iPhone del negocio. La publicación y el servidor local coinciden con la compilación (`dist/verification/scanner-feedback-live.json`).

## Entrega con catálogo del taller y ajuste de ancho

Esta entrega sustituye a la anterior. Retira de la venta la fila de filtros de categorías importadas ajenas al taller, muestra ocho productos por página y ajusta tarjetas, búsqueda y tabla al ancho disponible. Conserva el escaneo en directo, el pitido y las confirmaciones. No incorpora escaneo por fotografía.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.909.805 bytes.
- SHA-256: `a3c16254361935e85398a5e058ec08c3bca35aefe96f9b518d17738112c5df2c`.
- Payload: 393 archivos, 130,5 MiB, verificados después del empaquetado. Registro: `dist/verification/bundle-sale-catalog.log`.

La instalación existente recibió los recursos públicos y se verificaron contra el manifiesto (`dist/verification/sale-catalog-installed.json`). El ejecutable nativo conserva SHA-256 `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b`; no se reemplazaron el servidor ni los datos del negocio. NSIS terminó con código 0 reutilizando ese lanzador; no se ejecutó de nuevo el instalador.

La primera comprobación aprobó 23 pruebas; tras los últimos ajustes de búsqueda y subtotal se repitieron las 18 afectadas, todas aprobadas. Capturas y medidas de Chromium/WebKit a 320–1440 px, claro/oscuro: `dist/verification/sale-catalog`. Los recursos del Worker y del servidor local coinciden por hash con la compilación (`sale-catalog-live.json`). No se presenta esta comprobación como una prueba física del teléfono o de Windows 10.

## Entrega con pantalla de carga inicial

Esta entrega sustituye a la anterior. Muestra la marca y un indicador desde el HTML hasta la primera lectura confirmada, elimina el aviso falso de catálogo pendiente y conserva los módulos visibles durante las comprobaciones de datos en segundo plano. Los errores reales permiten reintentar y se conservan los pendientes y conflictos. El escáner sigue usando vídeo en directo.

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.914.614 bytes.
- SHA-256: `d4e734c8e67a1412c7d884002dc49a9906dbcf92fa0c580b7d0464a808b23a0a`.
- Payload: 395 archivos, 132,1 MiB, verificados después del empaquetado. Registro: `dist/verification/bundle-startup.log`.

La instalación existente recibió los recursos públicos y se cotejaron con el manifiesto (`dist/verification/startup-installed.json`). El ejecutable nativo conserva SHA-256 `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b`; no se reemplazaron el servidor ni los datos del negocio. NSIS terminó con código 0 y se verificó la copia del instalador por hash; no se ejecutó de nuevo el instalador.

Las 43 pruebas afectadas pasaron (`dist/verification/startup-final.log`), incluyendo arranque lento, recuperación, navegación, venta móvil, diario de operaciones, PWA, gateway Windows y diseño. Capturas de carga en claro/oscuro a 320–1440 px: `dist/verification/startup`. Los recursos de Worker y servidor local coinciden con la compilación (`startup-live.json`). No se ha verificado físicamente un iPhone ni el equipo del negocio.

## Entrega con cámara separada y detalle antes del catálogo

El Windows instalado comparte el orden confirmado por el usuario: Agregar productos, detalle de factura, datos de cliente/comprobante y catálogo. Se retiraron el título grande y el subtítulo. «Escanear con cámara» es un botón independiente con texto; Nueva venta/Limpiar permanece en el encabezado compacto. Se conservan las funciones de escaneo en directo, pitido, agregado, cobro y catálogo paginado.

Este instalador sustituye al de la entrega anterior:

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.934.151 bytes.
- SHA-256: `d474f28a281c5a916831800e38206cb3e61bac6453223fe3d76ba7998b3ace51`.
- Payload: 397 archivos, 133,7 MiB, verificados después de empaquetar. NSIS terminó con código 0 (`dist/verification/bundle-sale-flow.log`). La copia de entrega coincide por hash; no se ejecutó de nuevo el instalador.

Se verificaron los 397 archivos instalados contra el payload (`dist/verification/sale-flow-installed.json`), manteniendo el ejecutable nativo con SHA-256 `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b` y el servidor sin cambios. Las 26 pruebas afectadas pasaron (`sale-flow-final.log`); capturas y geometría de Chromium/WebKit a 320–1440 px en ambos temas están en `dist/verification/sale-flow`. Worker y servidor local coinciden con los recursos compilados (`sale-flow-live.json`). Estas comprobaciones no equivalen a usar la cámara física de un iPhone ni el equipo del negocio.

## Corrección: icono pequeño y campos compactos

La cámara conserva su icono original de 16 px, sin texto visible, en un botón independiente de 44×44 px a la derecha del buscador. Cantidad, precio y Agregar se alinean debajo; el selector móvil usa etiquetas breves y mantiene sus opciones completas. El detalle permanece antes del catálogo. Esta corrección sustituye la presentación del botón ancho de la entrega anterior.

- Instalador: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.961.611 bytes.
- SHA-256: `01389234540984d26840281f6f7a024a5acd8387f404cf83cbe24de13a214789`.
- Payload: 399 archivos, 135,2 MiB, verificados después de empaquetar. NSIS terminó con código 0 (`dist/verification/bundle-compact-camera.log`); la copia final coincide por hash. No se ejecutó de nuevo el instalador.

Windows instalado recibió los recursos y se cotejaron 399 archivos (`dist/verification/compact-camera-installed.json`). El servidor no cambió. Pasaron las 20 pruebas afectadas (`compact-camera-final.log`), incluyendo escaneo, cámara, pitido, venta móvil, actualización de PWA, gateway Windows y referencia de diseño. Las capturas y medidas están en `dist/verification/compact-camera`; los recursos de Worker y servidor local coinciden con la compilación (`compact-camera-live.json`). No se ha probado la cámara física del iPhone.

## Entrega con escaneo continuo

La cámara permanece abierta después de cada lectura aceptada o rechazada, con confirmación dentro del diálogo y pitido sólo cuando se agrega al carrito. Cambiar de producto no requiere otro permiso. Un código sostenido se cuenta una vez; para repetirlo hay que apartarlo aproximadamente un segundo. El cierre, cambio de pantalla o paso al fondo siguen liberando el vídeo.

Windows instalado recibió los recursos públicos y se cotejaron **401 archivos** (`dist/verification/continuous-scanner-installed.json`). El servidor y el ejecutable nativo conservan su contenido; no se modificaron datos reales. Las **22 pruebas** afectadas pasaron (`continuous-scanner-final.log`); los recursos del Worker y del servidor local coinciden con la compilación (`continuous-scanner-live.json`). Las capturas están en `dist/verification/continuous-scanner`. No se ha probado la cámara física del iPhone.

Este instalador sustituye al anterior:

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.974.641 bytes.
- SHA-256: `7e74ec520c721b6c6a8921f122242e451818662c374c842140494873700e3d82`.
- Payload: 401 archivos, 136,8 MiB, verificados después del empaquetado. NSIS terminó con código 0 (`dist/verification/bundle-continuous-scanner.log`) y la copia final coincide por hash. No se ejecutó de nuevo el instalador.

## Entrega con tema persistente y carga por módulos

La interfaz compartida aplica el tema desde el HTML, conserva la selección y muestra mensajes según la fase y el módulo. El código se divide para descargar inicialmente sólo lo necesario; Windows incluye todos esos recursos localmente. La renovación de la sesión web se publica en el servidor remoto; la política de autenticación offline del gateway nativo se conserva.

- Instalador: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 331.135.948 bytes.
- SHA-256: `6350e26dcc46de805b006d92465608c4e705a759c098d635600b35f3d75c4940`.
- Payload: **447 archivos**, 137,1 MiB, verificados después del empaquetado. NSIS terminó con código 0 (`dist/verification/bundle-session-theme.log`); la copia final coincide por hash. No se ejecutó de nuevo el instalador.

Windows instalado recibió los recursos y se cotejó el manifiesto (`session-theme-installed.json`). Se actualizaron también dos módulos del servidor web empaquetado, comprobando antes con esbuild que el proceso nativo no los importa. El código usado por el servidor nativo y su ejecutable no cambian; el ejecutable mantiene SHA-256 `4580ce755a3a05b3c5e497adca92d938ab9cf0ebdf100ada655681eb6a5bc23b`. No se modificaron datos del negocio. Pruebas, mediciones y límites de verificación: [validacion-sesion-tema-rendimiento-2026-11-22.md](validacion-sesion-tema-rendimiento-2026-11-22.md).
