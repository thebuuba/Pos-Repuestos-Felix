# Instalación Windows

La aplicación usa los mismos componentes del POS web y PWA. El instalador se prepara para Windows 10/11 de 64 bits, con instalación por usuario y asistente en español. Incluye Node 24.16.0 y el instalador offline de Microsoft Edge WebView2; no necesita que el usuario instale Node, PostgreSQL, Rust ni herramientas de desarrollo.

La primera configuración del equipo requiere conexión e inicio de sesión para descargar los datos autorizados del negocio. El paquete no contiene inventario, usuarios, claves, respaldos ni datos de demostración. Después de la configuración, SQLite conserva las tablas operativas, solicitudes y operaciones pendientes; PGlite se usa en memoria para ejecutar las mismas reglas SQL del servidor.

## Uso

1. Ejecutar el archivo `Repuestos-Felix-1.0.0-windows-x64-setup.exe` de la entrega verificada.
2. Abrir **Repuestos Felix** desde Inicio. El servicio local se inicia y se cierra con la aplicación, sin una consola aparte.
3. Conectar el equipo e iniciar sesión para realizar la primera descarga.
4. Antes de desconectar, comprobar la última sincronización. Las operaciones locales pendientes y los conflictos deben permanecer visibles hasta su confirmación o conciliación.

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

## Paquete generado el 22 de noviembre de 2026

- Archivo: `dist/releases/Repuestos-Felix-1.0.0-windows-x64-setup.exe`.
- Tamaño: 330.349.256 bytes (315,05 MiB).
- SHA-256: `c16b6e4c3c8b51ed7d2c0334b7528783e512ab1f888d96af4a9adfdf4dad7a2a`.
- El instalador no está firmado. El redistribuible WebView2 incluido tiene firma válida de Microsoft; Node tiene firma válida de OpenJS Foundation.

La compilación release y NSIS terminaron correctamente. La lista del instalador coincide con los 381 archivos del manifiesto más el propio manifiesto. El runtime copiado abrió `/login`, rechazó una segunda instancia y reabrió después de cerrar; PGlite/WASM ejecutó una operación decimal exacta en memoria desechable. Dos pruebas de Rust verificaron el mensaje de disponibilidad y el arranque desde una ruta canónica de Windows. La ventana nativa del release corregido se observó con el acceso renderizado y se cerró con Alt+F4.

El servicio conserva su puerto en SQLite para mantener el origen de IndexedDB entre reinicios. Se comprobó una respuesta interrumpida, recuperación del identificador pendiente y reintento sin duplicar el turno de caja; también se verificaron reinicio abrupto y rechazo de un puerto ocupado. Estas comprobaciones utilizaron perfiles y bases desechables; no constituyen una prueba de sincronización contra producción.

La entrega final se instaló en Windows 11 Home de 64 bits con código de salida 0. Se cotejaron los 381 recursos instalados y los archivos `main.js` y `server.js` contra el código fuente. El programa instalado respondió `/health` y `/login` con HTTP 200 y sirvió `desktop.js`; después se reabrió con el mismo perfil temporal y conservó el origen `127.0.0.1:60306`. El proceso auxiliar terminó en ambos cierres. El reporte local de esta comprobación está en `supabase/.temp/installed-smoke.json`.

El ejecutable instalado tiene SHA-256 `633cb229aa66bbcf0193a8aabb386cfe8f462d5434463caf1395923276b14cc6`. Tauri añade la marca `NSS` al empaquetarlo y restaura `UNK` en el archivo de compilación: la comparación binaria confirmó únicamente esos tres bytes de diferencia. No se deben comparar sus hashes sin considerar esa marca del empaquetado. La prueba instalada se realizó en Windows 11; Windows 10 no se verificó en una máquina aparte.

La opción `offlineInstaller` incorpora el instalador completo de WebView2, según la [documentación oficial de Tauri](https://v2.tauri.app/distribute/windows-installer/#offline-installer). La instalación técnica silenciosa admite `/S`; si se especifica `/D=`, la ruta absoluta debe ser el último argumento, conforme al [manual de NSIS](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage).
