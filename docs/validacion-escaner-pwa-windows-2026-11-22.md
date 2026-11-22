# Validación de escáner, PWA y Windows

Rama: `feat/sistema-unificado-offline`. Se conserva la referencia Polymet y la misma compilación de interfaz para las tres plataformas. No se aplicaron migraciones nuevas ni operaciones de prueba a la base real durante este trabajo.

## Funcionalidad y pruebas

`pnpm build` y `pnpm build:worker` terminaron correctamente. La suite completa se ejecutó con `node --test --test-concurrency=1 tests/*.test.js`: **262 pruebas aprobadas, cero fallos y cero omitidas**, en 525,4 segundos. El registro local está en `dist/test-scanner-pwa-windows.log`.

Después del ajuste final de puerto persistente se repitieron las cuatro pruebas afectadas de concurrencia y gateway Windows: **4/4 aprobadas**, en 14,5 segundos (`dist/test-desktop-final.log`). Ese ajuste no modifica la web ni el Worker publicado.

La evidencia incluye:

- Lector USB simulado mediante teclado: coincidencia literal, ceros iniciales, lecturas rápidas, artículos ambiguos y existencias.
- Cámara: decodificación de barras sintéticas mediante ZXing, permisos, una sola adición por apertura y cierre de las pistas al navegar o dejar la app en segundo plano.
- PWA: criterios de instalación de Chromium, recursos públicos offline, API/autenticación fuera de caché, reconexión, 401 y actualización sin recarga forzada.
- Windows: SQLite durable tras reinicio y SIGKILL, fallo simulado de disco, reintento de respuesta perdida, IDs locales/remotos diferentes, recuperación de descarga posterior a confirmación y conflictos de caja conservados.
- Gateway Windows: login y DPAPI reales sobre autenticación de prueba, sesión y nuevo login offline, caja local persistida tras reinicio, protección de Host/origen y revocación sin borrar pendientes.
- Concurrencia: una instancia por carpeta mediante named pipe, liberación tras SIGKILL, autenticaciones paralelas separadas y conservación de credenciales al rechazar otro usuario con pendientes.
- Origen persistente: al reiniciar se conserva el puerto, también tras SIGKILL; si está ocupado se rechaza el arranque. Una apertura de caja guardada cuya respuesta se pierde conserva UUID y cuerpo en IndexedDB después de reiniciar. El reintento deja un solo turno y una sola operación pendiente.
- API de sincronización: fechas originales, versiones, importes exactos, secuencia, idempotencia, permisos y rollback de conflictos.

Las bases PostgreSQL, SQLite y los perfiles de navegador de estas pruebas son desechables. Las pruebas de la cámara usan imágenes sintéticas; no acreditan el lector USB ni la cámara física del negocio.

## Evidencia visual

Capturas locales en `dist/scanner-2026-11-22`, `dist/desktop-ui-2026-11-22`, `dist/verification/pwa` y `dist/verification/desktop`. Se comprobaron vistas de 320, 390, 768 y 1440 px en claro/oscuro, según cada suite, y caja del gateway a 390/1440 px. La barra superior nativa distingue «Equipo disponible» del estado del servidor mostrado en el aviso de Windows.

La referencia importada, la vista renderizada y el guardado real se verifican por separado. No se afirma identidad visual absoluta ni instalación física en Android/iPhone.

## Publicación

Cloudflare Workers se actualizó en el origen autorizado:

https://repuestos-felix-pos.repuestosfelix1994.workers.dev

Versión: `d5bf1ec0-9f37-48f8-959f-eda7bd62a1df`.

El servidor local `http://127.0.0.1:3001` también se reinició con el código nuevo. La comprobación posterior, sólo de lectura de datos del negocio, confirmó en ambos orígenes: bootstrap protegido por sesión, descarga autenticada, botón de cámara, permisos de cámara del mismo origen, manifiesto, ayuda de instalación y service worker activo, sin errores del navegador en ese recorrido.

## Instalador

La entrega y su hash se documentan en `docs/windows-instalacion.md` y `dist/releases/SHA256.txt`. Incluye Node, PGlite y WebView2 offline; no incluye claves ni datos del negocio. El destino es Windows 10/11 x64. El equipo de verificación usa Windows 11 Home de 64 bits.

La prueba nativa de regresión ejecuta el Node empaquetado desde una ruta canónica de Windows. El lanzador simplifica esa ruta antes de iniciar Node; las dos pruebas Rust pasaron. El release corregido abrió la ventana nativa de acceso, observada con control de aplicaciones. Al cerrarla con Alt+F4 desaparecieron tanto el programa como su proceso local y el registro de error quedó vacío. Se utilizaron carpetas temporales separadas para SQLite y WebView2.

El instalador final terminó con código 0 en Windows 11. Los 381 recursos extraídos coinciden con su manifiesto y los módulos `main.js`/`server.js` con la fuente final. El ejecutable instalado tiene SHA-256 `633cb229aa66bbcf0193a8aabb386cfe8f462d5434463caf1395923276b14cc6`; frente al release sin empaquetar sólo cambia la marca de tres bytes `NSS`/`UNK` que Tauri usa para identificar NSIS.

El programa instalado inició su host, respondió 200 en `/health` y `/login` y entregó el marcador de interfaz nativa. Al terminar el programa, terminó también el host. Una segunda apertura, con las mismas carpetas temporales, conservó exactamente el origen y volvió a responder 200; el segundo host también terminó al cerrar la prueba. Reporte local: `supabase/.temp/installed-smoke.json`.

SHA-256 del instalador entregado: `c16b6e4c3c8b51ed7d2c0334b7528783e512ab1f888d96af4a9adfdf4dad7a2a`. Tamaño: 330.349.256 bytes. La compilación de NSIS, la extracción, la observación de la ventana y las pruebas operativas del gateway se mantienen como evidencias separadas. No se probó físicamente en Windows 10 ni en la computadora del negocio.
