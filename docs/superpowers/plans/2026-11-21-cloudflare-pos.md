# Frontend y backend del POS en Cloudflare

**Objetivo autorizado:** publicar el mismo POS con inicio de sesión en Cloudflare Workers, conservar Supabase y el funcionamiento local; Vercel queda fuera de este cambio. Mantener el ajuste de ancho completo y la imagen original.

## Contrato

- `src/http/app.js` exporta `handleRequest(request, {pool, hosting, databaseLabel='PostgreSQL', readAsset})` y devuelve una `Response` estándar. Reutiliza las operaciones de `src/pos/store.js`. Mantiene las rutas, lista de archivos públicos, Basic auth, Host, HTTPS, origen, límite de 10 MB y códigos HTTP. `readAsset(path)` recibe una ruta relativa segura de la lista (por ejemplo `index.html`) y devuelve una Response o bytes. El manejador conserva streaming cuando recibe una Response de assets. No importa filesystem, HTTP server, configuración de PostgreSQL ni hace DDL.
- `src/server.js` conserva `createApp(pool, options)` y su arranque local. Adapta HTTP Node a Request/Response usando streams y un lector de archivos restringido a `public/`. Conserva pruebas existentes. El manejador HTTP Node fija el transporte recibido mediante `x-forwarded-proto`, como antes; el Worker reemplaza esa cabecera con el protocolo real del Request.
- `src/hosting.js` mantiene `hostingConfig`/`authorized`, sin integración Render. `PUBLIC_ORIGIN` explícito y contraseña >=16 caracteres son obligatorios en Worker. Se permite adaptar `authorized` para aceptar Headers estándar además del objeto Node si ayuda.
- `src/worker.js` exporta `{fetch(request, env, ctx)}`. Usa el manejador compartido, hosting explícito y `env.ASSETS.fetch` para contenido. Crea perezosamente un pool `pg` de máximo 1 conexión por solicitud, usando `env.HYPERDRIVE.connectionString`. No comparte sockets entre solicitudes. Cierra el pool con `ctx.waitUntil` después de terminar cada operación. No crea pool para assets, errores de acceso ni health.
- `wrangler.jsonc`: Worker `repuestos-felix-pos`, fecha 2026-11-21, compatibilidad Node, assets `public/`, binding `ASSETS`, `run_worker_first: true`, HTML handling none, 404 sin fallback SPA, logs/traces habilitados. Hyperdrive se configura con ID real después de autenticar, caché SQL desactivada y TLS `verify-full` con CA Supabase para conservar verificación de identidad.
- Secrets: usuario y contraseña de acceso del negocio; credencial PostgreSQL solo en Hyperdrive con rol `pos_app`. Nunca exponer `.env`, fuente privada, datos ni credenciales en assets, configuración pública o Git. La URL final se fija como `PUBLIC_ORIGIN` real.
- Migraciones administrativas siguen en Node; no se aplican desde Worker. No se migran datos a D1.

## Trabajo

- [x] Extraer manejador Fetch compartido y adaptar Node; ejecutar pruebas de regresión y streaming/HEAD.
- [x] Implementar Worker y pruebas con PostgreSQL temporal, aislamiento por petición, assets y autenticación.
- [x] Configurar Wrangler, validar empaquetado y ejecutar comprobación en runtime Workers.
- [ ] Autenticar cuenta, provisionar CA/Hyperdrive con verificación TLS, secretos y Worker; comprobar acceso publicado.
- [x] Documentar, revisar de forma independiente y sincronizar GitHub.

La autorización de Cloudflare requiere que el usuario complete OAuth en su navegador. No se controla la PC ni se abre un navegador automáticamente. No se declaran recursos ni publicación exitosos antes de verificarlos.

Wrangler del proyecto quedó fijado mediante pnpm a 4.166.0, compatible con la fecha actual del Worker. Pruebas del runtime Workers: assets reales, autenticación y transacciones/reintentos con Hyperdrive local y PostgreSQL desechable aprobados. Compilación de producción en seco aprobada; paquete comprimido aproximado 51 KB, además de los assets.

El usuario indicó que todavía no puede iniciar sesión en Cloudflare. No se vuelve a solicitar OAuth durante esta ejecución. Por eso no se han creado CA/Hyperdrive remotos ni Worker publicado; account_id, binding y origen finales quedan pendientes de la cuenta real. El comando de publicación rechaza una configuración incompleta antes de cargar secretos.

Validación de cierre: `pnpm test` 65/65 aprobadas; `pnpm build:worker` correcto. La prueba de runtime también verifica dos ventas concurrentes sobre la última unidad, cálculo de ITBIS y saldo a crédito. Revisión independiente sin fallos materiales; documentación de Render retirada. Servidor Node local reiniciado y lectura real de Supabase HTTP 200, empresa Repuestos Félix y revisión 1 conservada. No se hicieron escrituras de negocio en la base real durante esta adaptación.
