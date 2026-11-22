# Frontend y backend en Cloudflare Workers

Cloudflare sirve los archivos compilados de `dist/operational/` y ejecuta la API de `src/worker.js`. El manejador común `src/http/app.js` conserva autenticación, validaciones y operaciones transaccionales. El servidor Node local utiliza el mismo manejador; las migraciones administrativas permanecen separadas.

Supabase sigue almacenando los datos. No se crea una base D1 ni se copian datos del negocio a los archivos del sitio.

## Comprobaciones locales

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build:worker
```

Las pruebas crean PostgreSQL temporal y ejecutan el frontend y las operaciones dentro del runtime Workers con Hyperdrive local. No utilizan la base real. El empaquetado no publica ni crea recursos remotos.

`pnpm start` abre el servidor Node local tras compilar con `pnpm build` y configurar un puerto explícito distinto de 3000 en un origen nuevo. Para desarrollo específico de Workers, copiar `.dev.vars.example` a `.dev.vars` y ejecutar `pnpm dev:worker`. Este entorno usa HTTPS local y necesita configurar el binding Hyperdrive local para consultar datos; los secretos locales nunca se suben automáticamente.

## Configuración y publicación

1. Iniciar sesión sin abrir automáticamente ventanas: `pnpm exec wrangler login --browser=false`. Autorizar el enlace con la cuenta del negocio. Verificar la cuenta con `pnpm exec wrangler whoami` y guardar su `account_id` real en `wrangler.jsonc`.
2. Cargar la CA de Supabase mediante `wrangler cert upload certificate-authority`, utilizando el archivo local ya configurado. Este certificado no contiene la contraseña de la base.
3. Crear Hyperdrive `repuestos-felix-supabase` con la conexión **directa** a Supabase, usuario `pos_app`, contraseña del perfil privado, CA cargada y SSL `verify-full`. Mantener **desactivada la caché de consultas** para inventario, saldos y ventas. Usar el panel de Cloudflare o una petición API con credenciales en memoria; evitar incluir la contraseña en argumentos de terminal o en Git. Añadir el ID real como binding `HYPERDRIVE` en `wrangler.jsonc`.
4. Obtener la dirección asignada a la cuenta para Workers y configurar `PUBLIC_ORIGIN` con la dirección HTTPS exacta del Worker. La configuración inicial tiene este campo vacío y la API rechaza peticiones hasta configurarlo.
5. Ejecutar `pnpm deploy:worker`. El comando comprueba cuenta, Hyperdrive, origen y coincidencia del proyecto de Auth con el CLI vinculado. Compila Polymet y carga `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `POS_SESSION_SECRET` y, cuando está configurada, `SUPABASE_SECRET_KEY` desde el perfil privado. Wrangler recibe esas variables mediante un archivo temporal ignorado que el script elimina al terminar. Las cuentas del personal se administran en [Supabase Auth](donde-esta-cada-dato.md).
6. Comprobar el despliegue remoto: `/health`, acceso anónimo rechazado, acceso autenticado a Supabase, carga de la interfaz Polymet y sus recursos. No se confirma una URL publicada hasta completar esas comprobaciones.

Los archivos estáticos también pasan por el Worker (`run_worker_first`), por lo que no eluden la protección del HTML. El resto de archivos, credenciales y respaldos no están en el directorio de assets. Cada solicitud de base de datos crea su propia conexión a Hyperdrive y la cierra; Hyperdrive mantiene el pool hacia Supabase. Logs y trazas están habilitados sin registrar contraseñas ni cuerpos de solicitudes.

Hyperdrive está disponible con límites en el plan gratuito de Workers. No se contratan planes de pago desde este proyecto. Revisar los [límites y precios vigentes](https://developers.cloudflare.com/hyperdrive/platform/pricing/) antes de adoptar el alojamiento como servicio del negocio.

Referencias: [Supabase con Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [verificación TLS](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [assets en Workers](https://developers.cloudflare.com/workers/static-assets/).

Vercel queda para un trabajo posterior.

## Cambiar los datos de acceso

En **Configuración → Mi cuenta**, cada persona puede cambiar su contraseña indicando la actual. El servidor comprueba de nuevo la contraseña y la identidad de Supabase antes del cambio, y cierra esa sesión al confirmar. El UUID y el permiso administrativo `app_metadata.acceso_pos` se conservan; el formulario no permite editar cuentas ajenas ni permisos. Las credenciales no pasan por el diario de operaciones ni se guardan en el almacenamiento del navegador.

Por solicitud del usuario, el POS acepta contraseñas desde seis caracteres sin exigir combinaciones de mayúsculas, minúsculas, números o símbolos. Conserva espacios y cuenta los caracteres Unicode. El límite superior es de 72 bytes, compatible con Supabase Auth. El formulario de cuenta, el cambio desde el login y el comando de creación de usuarios aplican esa misma regla.

El nombre de usuario se representa con una dirección interna `@usuarios.repuestosfelix.invalid`, que no recibe correo. Para cambiarlo hace falta la API administrativa de Supabase, que aplica el cambio directamente sin confirmaciones de correo. Habilitar **solo en el servidor administrado** una clave `SUPABASE_SECRET_KEY` del mismo proyecto. `pnpm deploy:worker` carga esta clave opcional desde `.env.supabase` como secreto de Cloudflare; también puede configurarse con `pnpm exec wrangler secret put SUPABASE_SECRET_KEY` mediante su prompt protegido. En un servidor Node administrado puede configurarse en su entorno privado. No incluirla en archivos públicos, Git, logs, PWA ni instaladores Windows.

Sin esa clave, la pantalla muestra el cambio de nombre deshabilitado y permite cambiar la contraseña. No hay cambios de credenciales sin conexión: una pérdida de conexión exige comprobar el acceso antes de reintentar. La instalación local que todavía usa credenciales compartidas muestra que necesita cuentas individuales.

Referencias oficiales: [actualización administrativa de usuarios](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) y [uso seguro de claves secretas](https://supabase.com/docs/guides/getting-started/api-keys).
