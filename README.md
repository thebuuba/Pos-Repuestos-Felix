# POS Repuestos Félix

Para coordinar tareas de desarrollo entre Codex y Gemini/Antigravity, consulta [el flujo de agentes](docs/agentes/README.md). `pnpm agentes estado` comprueba los CLI y `pnpm agentes ejecutar <tarea.json>` prepara una entrega aislada para revisión.

El POS de Repuestos Félix abre el **Panel** con el diseño de Polymet. Punto de venta, Inventario, Compras, Clientes, Suplidores, Configuración y Reportes usan la API del negocio. La importación de NetPOS cargó 7.681 artículos en Supabase. Consulta [dónde encontrar usuarios, inventario, clientes, suplidores e históricos](docs/donde-esta-cada-dato.md).

La API se comparte entre **Cloudflare Workers y Node.js local**, con **PostgreSQL local o Supabase**. Caja registra turnos, movimientos y cierres. Abonos, conciliación de cuentas, PWA y Windows mantienen trabajo pendiente; su estado está en [estado del sistema](docs/estado-sistema-unificado.md). Supabase Auth gestiona las cuentas de acceso.

El **esquema está en [supabase/schema.sql](supabase/schema.sql)**; los cambios incrementales están en [supabase/migrations](supabase/migrations). La [revisión de la base](docs/revision-base-datos-2026-11-22.md) explica qué tablas se usan y cuáles son históricas.

## Organización del proyecto

```text
frontend/                Interfaz compartida de Polymet
  operational.jsx        Doce rutas con datos reales y disponibilidad explícita
  reference.jsx          Referencia de diseño aislada para pruebas
dist/operational/        Compilación principal generada con pnpm build
public/                  Recursos estáticos compartidos (marca, iconos y PWA)
  assets/brand/          Imagen original de Repuestos Félix
  icons/                 Iconos de instalación de la PWA
src/
  worker.js              Frontend y API en Cloudflare Workers
  server.js              Adaptador HTTP y arranque Node local
  http/app.js            Rutas y protección compartidas Request/Response
  hosting.js             Acceso, origen permitido y HTTPS
  db/config.js           Conexión PostgreSQL y verificación SSL
  db/migrations.js       Migraciones administrativas explícitas
  pos/store.js           Operaciones, transacciones y respaldos
  pos/legacy-state.js    Validación del formato de respaldo anterior
supabase/
  migrations/            Historial SQL aplicado en orden
  schema.sql             Estructura actual de referencia
scripts/                 Comandos administrativos
tests/                   Pruebas y datos ficticios en fixtures/
docs/                    Decisiones y planes de trabajo
```

Node y los comandos de Cloudflare sirven la compilación Polymet de `dist/operational/`. Genera los recursos con `pnpm build` antes de iniciar Node. Usa un origen nuevo y configura `PORT` con un puerto libre distinto de 3000. La activación requiere detener primero el servicio heredado verificado para evitar escrituras sobre el catálogo nuevo desde sesiones antiguas. `public/` conserva únicamente los recursos estáticos compartidos (imagen de marca, iconos, `manifest.webmanifest` y `sw.js`). La compilación incorpora la imagen original y las fuentes locales.

El diseño conserva los componentes, la navegación lateral, los temas y las medidas de Polymet. La imagen original del negocio se conserva como recurso; no sustituye la composición aprobada.

El contenido respeta el ancho máximo de 1480 px y los puntos de corte de la referencia. En teléfonos conserva los controles adaptables y el desplazamiento interno de las tablas.

## Instalación como PWA

La instalación y la sincronización offline de la interfaz Polymet siguen pendientes. La PWA anterior puede conservar una copia del HTML en el origen donde se instaló su service worker. Abre el POS nuevo en su propio origen HTTPS o en otro puerto local.

## Diseño compartido de Polymet (rama de trabajo)

La referencia visual aprobada, reglas y procedencia están en [la documentación del diseño](docs/design/recuperacion-polymet.md). `pnpm build` y `pnpm build:design` compilan la entrada operativa, sin datos de demostración. `pnpm preview` o `pnpm preview:design` sirven esa interfaz en `http://127.0.0.1:3001`: es una vista estática y muestra la falta de conexión si no hay API. El servicio real se inicia con el perfil de PostgreSQL correspondiente. La transición de la PWA anterior sigue pendiente.

La demostración original se conserva únicamente para comparación y pruebas mediante `pnpm build:reference` y `pnpm preview:reference`; no se utiliza como entrada del negocio. `pnpm test:design` comprueba esa referencia aislada con Edge. El trabajo del Excel está documentado en [inventario e importación](docs/inventario-excel.md).

## Instalar

Necesitas Node.js 24.15 o posterior dentro de la rama 24 (recomendado), Node.js 22.22.2 o posterior dentro de la rama 22, o Node.js 26 o posterior; además de PostgreSQL local o un proyecto Supabase. Se verificó con Node.js 24.16 y PostgreSQL 17.

```powershell
pnpm install --frozen-lockfile
```

El proyecto usa **pnpm 10.8.0**, fijado en `packageManager`, y `pnpm-lock.yaml` para reproducir las versiones instaladas. Si tu equipo tiene Corepack pero no el comando `pnpm`, puedes ejecutar `corepack pnpm` en lugar de `pnpm`.

## Usar PostgreSQL local

1. Con PostgreSQL iniciado, crea la base (te pedirá tu contraseña):

   ```powershell
   psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE pos_repuestos_felix;"
   ```

2. Copia la configuración y edita `.env.local` con tu usuario, contraseña, puerto y nombre de base:

   ```powershell
   Copy-Item .env.example .env.local
   Copy-Item .env.migrations.example .env.local.migrations
   ```

   En `.env.local.migrations` configura `MIGRATION_DATABASE_URL` con el usuario administrador local; en `.env.local`, la conexión de `pos_app`.

3. Aplica las migraciones:

   ```powershell
   pnpm db:migrate:local
   ```

4. La primera vez, abre `psql -h 127.0.0.1 -U postgres -d pos_repuestos_felix`, ejecuta `ALTER ROLE pos_app LOGIN;` y después `\password pos_app`. Escribe una contraseña exclusiva y completa esa misma contraseña, codificada para URL, en `.env.local`. La contraseña administrativa permanece en el archivo de migraciones.

5. Ejecuta `pnpm build` y `pnpm start:local`. Abre el puerto configurado en el perfil, por ejemplo **http://127.0.0.1:3001**. Una base nueva contiene la configuración y Cliente Contado, sin mercancía ni ventas de ejemplo. El servidor comprueba la estructura al arrancar; las migraciones se ejecutan explícitamente con una cuenta administrativa.

## Usar Supabase

El CLI se configura de forma independiente del gestor de paquetes del proyecto. Para Repuestos Félix se usa el perfil `repuestos-felix`: inicia con `supabase login --profile repuestos-felix --name "Repuestos Felix"` y completa el acceso en el navegador con la cuenta del negocio. Comprueba el acceso con `supabase --profile repuestos-felix projects list`; usa ese mismo perfil en los comandos administrativos. `pnpm usuarios:crear` ya lo selecciona por defecto. La carpeta `supabase/.temp` es local y está excluida de Git. El vínculo del CLI no configura automáticamente `DATABASE_URL` del servidor ni inicia sesión en el POS.

### Crear la estructura de la base

La migración `supabase/migrations/20261121190000_normalizar_pos.sql` convierte el formato anterior en tablas relacionadas de `public`: `configuracion`, `clientes`, `suplidores`, `productos`, `ventas`, `venta_detalles`, `compras`, `compra_detalles` y `movimientos_inventario`. Se pueden inspeccionar sus relaciones en **Database → Schema Visualizer → public**. La migración anterior permanece en el historial.

Con la conexión administrativa correcta en `MIGRATION_DATABASE_URL` (o `DATABASE_URL` para la inicialización):

```powershell
pnpm db:migrate:supabase
```

El migrador serializa las ejecuciones, aplica cada archivo pendiente en una transacción y registra su versión en `supabase_migrations.schema_migrations`, compatible con el CLI. El vínculo del CLI y la conexión de PostgreSQL son configuraciones independientes: verifica el destino antes de migrar. Haz un respaldo antes de actualizar una base con datos.

La conversión conserva productos, contactos, saldos y documentos. Archiva el JSON original y crea movimientos de apertura con el inventario al momento del cambio. Si encuentra referencias ambiguas o importes inconsistentes, aborta sin aplicar una conversión parcial. El archivo `supabase/schema.sql` describe la estructura actual.

Copia `.env.migrations.example` a `.env.migrations` para Supabase, o a `.env.local.migrations` para el perfil local, y configura allí la conexión administrativa. Los comandos de migración cargan ese archivo separado; los comandos `start` solo cargan la conexión de aplicación. Estos archivos reales están excluidos de Git.

Todas las tablas tienen RLS. El navegador utiliza la API Node.js; `anon` y `authenticated` no reciben acceso a los datos. La migración crea `pos_app` sin inicio de sesión y con permisos de datos, sin DDL. Un administrador debe asignarle una contraseña exclusiva para usarlo como usuario de `DATABASE_URL`; mantén la conexión administrativa en `MIGRATION_DATABASE_URL` solo en el entorno de migraciones. En el pooler de Supabase el usuario personalizado tiene formato `pos_app.REFERENCIA`, según la [documentación de conexiones](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Configurar la conexión del servidor

1. En tu proyecto Supabase abre **Connect** y copia la conexión PostgreSQL. Para este servidor persistente usa **Session pooler**, compatible con redes IPv4, o conexión directa si tu red permite el acceso a su dirección IPv6.
2. Prepara el archivo:

   ```powershell
   Copy-Item .env.supabase.example .env.supabase
   Copy-Item .env.migrations.example .env.migrations
   ```

3. Completa `MIGRATION_DATABASE_URL` en `.env.migrations` con la conexión administrativa de la **base de datos**. En `.env.supabase` utiliza la conexión del rol `pos_app` para `DATABASE_URL`. Una clave `anon`, `publishable` o `service_role` no sustituye estas contraseñas. Codifica caracteres especiales para URL, por ejemplo `@` como `%40` y `#` como `%23`.
4. Deja `DATABASE_SSL=true`. Se verifica el certificado del servidor. Si la conexión requiere la CA de Supabase, descárgala de la configuración SSL del proyecto, guárdala en `certs/` y configura `DATABASE_CA_FILE=./certs/prod-supabase.cer`. No se desactiva la validación del certificado.
5. Evita parámetros adicionales en la URL: el servidor gestiona SSL y la CA mediante estas variables. Los parámetros `ssl` y `sslmode` se retiran para que no reemplacen esa configuración; los demás se rechazan para evitar que cambien el destino o su seguridad.
6. Aplica las migraciones con la cuenta administrativa:

   ```powershell
   pnpm db:migrate:supabase
   ```

7. En una instalación nueva, habilita `pos_app` y asígnale su contraseña desde una conexión administrativa. Puedes abrir `psql` con el host/puerto del pooler y el usuario `postgres.REFERENCIA`, ejecutar `ALTER ROLE pos_app LOGIN;` y después `\password pos_app`. Completa la contraseña de aplicación en `.env.supabase` e inicia con `pnpm start:supabase`. Este paso se hace una vez; no rota la contraseña al reiniciar el servidor.

Abre la misma dirección local. El indicador superior muestra qué destino está activo. Las tablas del negocio están en `public`; `pos_privado` contiene únicamente el control de revisiones, solicitudes idempotentes, respaldos automáticos y el archivo anterior.

La configuración sigue la [guía de conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) y las [indicaciones SSL de node-postgres](https://node-postgres.com/features/ssl).

## Cambiar de base y trasladar datos

Detén el servidor con `Ctrl+C` e inicia el otro comando. **Local y Supabase mantienen datos independientes; no hay sincronización ni cambio automático ante fallos.** Puedes usar ambas configuraciones, una por ejecución.

La API administrativa admite respaldos operativos v6 mediante `GET /api/backup` y restauraciones transaccionales mediante `POST /api/restore`, con revisión, generación y clave de idempotencia. La restauración conserva un respaldo automático y admite los formatos anteriores. El archivo histórico de NetPOS requiere un respaldo administrativo de PostgreSQL.

`pnpm start` permite usar un archivo `.env` en lugar de los dos perfiles anteriores. Las variables ya presentes en el entorno tienen prioridad sobre el archivo seleccionado; evita dejar `DATABASE_URL` de otro destino definida en la terminal.

## Guardado y alcance

- Las entidades tienen claves foráneas y restricciones de integridad. Los importes de documentos tienen dos decimales, las tarifas/costos unitarios cuatro y las cantidades dos. El historial conserva nombres y precios aunque cambie el catálogo. Dar de baja un artículo conserva su historial.
- Ventas y compras se guardan mediante operaciones específicas. El servidor bloquea las filas necesarias, calcula los importes en centavos exactos y guarda documento, detalles y movimientos en una transacción. Dos cajas no pueden vender simultáneamente la última unidad.
- La edición de productos/configuración comprueba su versión para evitar sobrescribir cambios de otra caja. Clientes y suplidores se seleccionan por ID.
- Cada base tiene un identificador persistente que se renueva al restaurar un respaldo. Las pestañas antiguas deben actualizar sus datos. Reiniciar Node.js conserva ese identificador.
- No se vacían formularios, descuentan existencias confirmadas ni imprime la factura hasta recibir la confirmación del servidor.
- Antes de enviar un guardado, IndexedDB conserva su cuerpo y su clave idempotente. Si se pierde la respuesta, el formulario se bloquea y ofrece reintentar la misma solicitud. Al recargar o abrir otra pestaña, **Reintentar solicitud** recupera la operación pendiente sin duplicarla. Un borrador que aún no se ha enviado no persiste al cerrar la pantalla.
- La previsualización y el servidor comparten el cálculo exacto con ITBIS incluido en el precio. La venta comprueba las versiones de artículos/configuración y las existencias. Las ventas a crédito requieren un cliente con límite configurado; el servidor serializa el control del saldo disponible.
- Las compras quedan registradas con suplidor y número. Se rechaza registrar de nuevo el mismo número para el mismo suplidor.
- La restauración admite hasta 10 MB y rechaza una revisión obsoleta. No se permite reemplazar el estado completo mediante `PUT /api/state`.
- Por defecto el servidor escucha únicamente en `127.0.0.1`. El modo público requiere origen HTTPS explícito, usuario y contraseña de acceso; consulta la siguiente sección. La publicación requiere configurar un alojamiento.
- Las ventas nuevas reciben un número interno y no generan NCF autorizados. Los NCF históricos se conservan. Antes de utilizar comprobantes fiscales se necesita implementar la emisión y secuencias autorizadas correspondientes.
- Las doce rutas muestran sus pantallas de Polymet. Caja registra apertura, entradas/salidas y cierre con persistencia transaccional. Los abonos permanecen deshabilitados hasta contar con persistencia y conciliación. Cuentas por cobrar muestra las ventas a crédito nuevas; Clientes conserva también los saldos de apertura. Cuentas por pagar indica que falta conciliar los históricos. No se ha añadido anulación ni exportación fiscal 607.

## Preparar el acceso por internet

La [guía de publicación en Cloudflare](docs/publicar-pos.md) prepara el frontend y el backend del POS con inicio de sesión, assets y Supabase mediante Hyperdrive. El código del Worker se empaqueta con `pnpm build:worker`. Para publicarlo se necesita autenticar la cuenta, configurar Hyperdrive y el origen HTTPS real, y ejecutar `pnpm deploy:worker`.

Cloudflare ejecuta el mismo manejador y las mismas transacciones que el servidor local. Hyperdrive mantiene las conexiones a Supabase, con verificación TLS y caché SQL desactivada al configurar el recurso. **GitHub guarda el código; GitHub Pages no ejecuta esta API ni conecta el navegador directamente a PostgreSQL.**

Para Cloudflare utiliza la guía anterior. Para el servidor Node.js o Docker, configura estas variables:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión de PostgreSQL/Supabase con el rol `pos_app` |
| `DATABASE_SSL` | `true` para Supabase |
| `DATABASE_LABEL` | `Supabase` o nombre del destino |
| `DATABASE_CA_FILE` | Ruta al certificado CA montado como archivo secreto, si tu proyecto lo necesita |
| `DATABASE_CA` | Alternativa a `DATABASE_CA_FILE`: contenido PEM de la CA en una variable privada del alojamiento |
| `HOST` | `0.0.0.0` dentro del servicio alojado |
| `PORT` | Obligatorio. Elige un puerto libre distinto de 3000. |
| `PUBLIC_ORIGIN` | Dirección exacta, por ejemplo `https://pos.tu-dominio.com`, sin rutas ni parámetros |
| `SUPABASE_URL` | URL del proyecto de Auth que corresponde al negocio |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable de ese proyecto |
| `POS_SESSION_SECRET` | Secreto aleatorio privado del servidor para cifrar y autenticar cookies |

Instala con `pnpm install --frozen-lockfile` y compila los recursos con `pnpm build`. Aplica migraciones desde un entorno administrativo antes del despliegue; no configures `MIGRATION_DATABASE_URL` en el proceso web. Inicio: `node src/server.js`. Usa pnpm 10.8.0 en el alojamiento. El `Dockerfile` prepara esta versión; los `.env` y certificados locales se excluyen del contexto de construcción. Monta los certificados como secretos en ejecución cuando sean necesarios.

El proveedor debe terminar HTTPS, redirigir HTTP a HTTPS y **sobrescribir** `X-Forwarded-Proto` con el protocolo real. Mantén el puerto de Node privado, accesible solo desde ese proxy: no basta con enviar una cabecera para asegurar el transporte. El servidor rechaza nombres de host ajenos, tráfico sin indicación HTTPS en modo público y escrituras de otros orígenes. `GET /health` es un indicador público de que el proceso está activo y no expone datos del negocio.

En `/login` cada empleado introduce su nombre de usuario y contraseña. Supabase Auth verifica su identidad y el servidor comprueba el permiso de acceso al negocio. «Mantener sesión en este dispositivo» permite hasta 30 días. Si queda desmarcado, la cookie dura la sesión del navegador con un límite de ocho horas. «Cerrar sesión» cierra el acceso de ese dispositivo.

La cookie de Supabase cifra los tokens con AES-256-GCM y queda vinculada al origen del POS y al proyecto. Usa `HttpOnly` y `SameSite=Strict`. En internet también usa `Secure` y el prefijo `__Host-`. Al salir se ocultan los datos en las pestañas del mismo origen. El diario conserva las solicitudes pendientes para su recuperación después de iniciar sesión. [Configuración de cookies de sesión](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies).

En localhost con la base de Supabase se usa el mismo login. Configura `HOST=127.0.0.1`, un `PORT` distinto de 3000 y deja `PUBLIC_ORIGIN` vacío. El servidor comprime texto y JSON cuando el navegador admite gzip. El HTML privado y las respuestas con datos llevan `Cache-Control: no-store`. El modo de desarrollo con PostgreSQL en loopback también admite credenciales locales.

Los recursos compilados de Polymet se sirven desde `dist/operational/` y el acceso a los datos de PostgreSQL exige autenticación en modo público. No introduzcas datos reales del negocio ni credenciales en los archivos estáticos.

## Pruebas

```powershell
pnpm test
```

Las pruebas crean un clúster PostgreSQL temporal, comprueban la API con conexiones reales y los flujos de la interfaz mediante un DOM con jsdom, y luego eliminan su clúster. Nunca usan `.env.local` ni `.env.supabase`. Necesitas `psql`, `initdb` y `pg_ctl` en el mismo directorio; si `psql` no está en PATH, indica su carpeta:

```powershell
$env:PG_BIN = 'C:/Program Files/PostgreSQL/17/bin'
pnpm test
```

La conexión real de Supabase se comprueba al iniciar con tus credenciales; las pruebas automáticas no necesitan una cuenta remota. Cubren navegación, formularios, instalación, aislamiento de la caché, autenticación pública y los flujos existentes del POS. La instalación y autenticación en dispositivos Android/iPhone reales deben comprobarse con la dirección HTTPS definitiva.

## Caja y cuenta

La migración `20261122030000_caja.sql` agrega `public.turnos_caja`, `public.movimientos_caja` y el turno/método de pago a ventas. Las ventas anteriores conservan estos campos vacíos: no se les atribuye efectivo ni un turno inventado. Las ventas nuevas requieren caja abierta y medio de pago. Apertura, entradas/salidas y cierre usan importes exactos, versiones e idempotencia; las compras y abonos no producen movimientos de efectivo automáticos.

La pantalla conserva los formularios de Polymet. El cierre cuenta efectivo y guarda esperado, contado, ventas y responsable; una diferencia de un centavo sigue siendo una diferencia. Los respaldos v6 incluyen la caja y admiten restaurar v2–v5 sin fabricar turnos históricos. Las pruebas usan PostgreSQL temporal. La migración se aplicó a Supabase el 22 de noviembre de 2026 con autorización expresa del usuario, sin operaciones de prueba en la base real.

En **Configuración → Mi cuenta** se puede cambiar la contraseña con la clave actual. Cambiar el nombre de acceso conserva el UUID y requiere `SUPABASE_SECRET_KEY` únicamente en el servidor, ya que los usuarios actuales usan direcciones sintéticas que no reciben correos de confirmación. Sin esa configuración se indica que el cambio de nombre no está habilitado. Consulta la [configuración segura](docs/publicar-pos.md). Ninguna credencial pasa por el diario de operaciones.

Ambos cambios están habilitados y comprobados en local y web. El [informe de activación](docs/activacion-caja-cuenta-2026-11-22.md) registra la versión publicada, las 220 pruebas aprobadas y la verificación de producción sin operaciones de prueba.
