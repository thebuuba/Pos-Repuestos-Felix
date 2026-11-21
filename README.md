# POS Repuestos Félix

PWA instalable para teléfono y computadora, con ventas, inventario, compras, clientes, suplidores, resumen de caja y respaldos JSON. Se conserva JavaScript nativo, CSS y HTML, con una API Node.js y **PostgreSQL local o Supabase**. Las contraseñas permanecen en el servidor.

## Organización del proyecto

```text
public/                  Interfaz que recibe el navegador
  assets/brand/          Imagen original de Repuestos Félix
  icons/                 Iconos de instalación de la PWA
src/
  server.js              Servidor HTTP y arranque
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

El servidor entrega únicamente los archivos públicos incluidos en su lista permitida. Las carpetas `src/`, `scripts/`, `supabase/`, las credenciales y los respaldos no se publican. Las rutas de la interfaz siguen siendo `/app.js`, `/styles.css`, `/sw.js`, etc.; `public/` es su ubicación en disco, no un prefijo de la dirección web. Los datos de ejemplo se usan únicamente en pruebas.

La cabecera utiliza la imagen proporcionada por el negocio, con su proporción original, y una paleta roja, negra y blanca. La imagen también forma parte de la caché estática de la PWA.

## Instalar en Android o iPhone

Abre la dirección **HTTPS** del sistema e inicia sesión. En Android pulsa **Instalar app** o usa el menú del navegador. En iPhone abre la página en Safari y elige **Compartir → Añadir a pantalla de inicio**. La app también funciona directamente en el navegador. La disponibilidad del aviso automático depende del navegador; el botón incluye instrucciones alternativas.

Los controles se adaptan a pantallas pequeñas, los menús se abren al tocar y las tablas se desplazan dentro de su propio recuadro. La interfaz conserva el mismo servidor y base de datos que la versión de escritorio.

**Sin conexión:** una vez preparada la caché, se puede abrir la interfaz. No se guardan clientes, inventario, facturas ni contraseñas en la caché del service worker. Las operaciones requieren conexión y confirmación del servidor. Si hay un carrito pendiente, conserva esa pantalla: cerrar la app no guarda borradores. No hay sincronización de ventas sin conexión.

**Actualizaciones:** el service worker instala una versión completa de los archivos estáticos y espera a que se cierren las pestañas/instancias anteriores. Para publicar cambios en la interfaz, incrementa `CACHE` en `public/sw.js` en el mismo despliegue. No se fuerza una actualización en medio de una venta.

El manifiesto, los iconos y la implementación siguen las [guías de instalación de PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) y de [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). En desarrollo, `http://127.0.0.1` también permite probar la PWA; abrir `index.html` directamente no ejecuta el servidor.

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

5. Ejecuta `pnpm start:local` y abre **http://127.0.0.1:3000**. Una base nueva contiene la configuración y Cliente Contado, sin mercancía ni ventas de ejemplo. El servidor comprueba la estructura al arrancar; las migraciones se ejecutan explícitamente con una cuenta administrativa.

## Usar Supabase

El CLI se configura de forma independiente del gestor de paquetes del proyecto. Para cambiar su cuenta usa `supabase logout` y después `supabase login --name "Repuestos Felix"`; completa el acceso en el navegador con la cuenta correcta. Comprueba los proyectos disponibles con `supabase projects list` y vincula el proyecto elegido con `supabase link --project-ref ID_DEL_PROYECTO`. La carpeta `supabase/.temp` es local y está excluida de Git. El vínculo del CLI no configura automáticamente `DATABASE_URL` del servidor.

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

Para copiar datos entre ellas: exporta desde **Configuración → Copia de seguridad**, cambia el destino del servidor y usa **Restaurar copia**. El respaldo v2 incluye tablas, filas inactivas y movimientos. La restauración pide confirmación, conserva un respaldo automático y reemplaza los datos de la base seleccionada en una transacción. También acepta el JSON anterior del HTML con Firebase y lo convierte al modelo relacional. No consulta ni modifica Firebase.

`pnpm start` permite usar un archivo `.env` en lugar de los dos perfiles anteriores. Las variables ya presentes en el entorno tienen prioridad sobre el archivo seleccionado; evita dejar `DATABASE_URL` de otro destino definida en la terminal.

## Guardado y alcance

- Las entidades tienen claves foráneas, importes `NUMERIC` de dos decimales y restricciones de integridad. El historial conserva los nombres y precios del documento aunque cambie el catálogo. Dar de baja un artículo conserva su historial.
- Ventas y compras se guardan mediante operaciones específicas. El servidor bloquea las filas necesarias, calcula los importes en centavos exactos y guarda documento, detalles y movimientos en una transacción. Dos cajas no pueden vender simultáneamente la última unidad.
- La edición de productos/configuración comprueba su versión para evitar sobrescribir cambios de otra caja. Clientes y suplidores se seleccionan por ID.
- Cada base tiene un identificador persistente que se renueva al restaurar un respaldo. Las pestañas antiguas deben actualizar sus datos. Reiniciar Node.js conserva ese identificador.
- No se vacían formularios, descuentan existencias confirmadas ni imprime la factura hasta recibir la confirmación del servidor.
- Si se pierde la respuesta de un guardado, se conservan su cuerpo y su clave idempotente en la pantalla abierta. Los formularios se bloquean y aparece **Reintentar operación pendiente**. Ese botón repite la misma solicitud y recupera su resultado sin duplicarla. Mantén la pantalla abierta hasta confirmar; los borradores no persisten al cerrarla.
- Las compras quedan registradas con suplidor y número. Se rechaza registrar de nuevo el mismo número para el mismo suplidor.
- La restauración admite hasta 10 MB y rechaza una revisión obsoleta. No se permite reemplazar el estado completo mediante `PUT /api/state`.
- Por defecto el servidor escucha únicamente en `127.0.0.1`. El modo público requiere origen HTTPS explícito, usuario y contraseña de acceso; consulta la siguiente sección. La publicación requiere configurar un alojamiento.
- Las ventas nuevas reciben un número interno y no generan NCF autorizados. Los NCF históricos se conservan. Antes de utilizar comprobantes fiscales se necesita implementar la emisión y secuencias autorizadas correspondientes.
- El resumen de caja y el listado de facturas mantienen las funciones que tenía el HTML. No se ha añadido cierre contable, anulación ni exportación fiscal 607.

## Preparar el acceso por internet

El código está preparado para Node.js persistente o Docker y una base Supabase. **GitHub guarda el código; GitHub Pages no ejecuta esta API ni conecta el navegador directamente a PostgreSQL.** Configura el alojamiento y sus secretos para publicar.

En el panel de variables privadas del alojamiento configura:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión de PostgreSQL/Supabase con el rol `pos_app` |
| `DATABASE_SSL` | `true` para Supabase |
| `DATABASE_LABEL` | `Supabase` o nombre del destino |
| `DATABASE_CA_FILE` | Ruta al certificado CA montado como archivo secreto, si tu proyecto lo necesita |
| `HOST` | `0.0.0.0` dentro del servicio alojado |
| `PORT` | Puerto indicado por el proveedor; por defecto `3000` |
| `PUBLIC_ORIGIN` | Dirección exacta, por ejemplo `https://pos.tu-dominio.com`, sin rutas ni parámetros |
| `APP_USERNAME` | Usuario de acceso, por ejemplo `admin` |
| `APP_PASSWORD` | Contraseña larga y única, de al menos 16 caracteres |

Instalación del servicio: `pnpm install --prod --frozen-lockfile`. Aplica migraciones desde un entorno administrativo antes del despliegue; no configures `MIGRATION_DATABASE_URL` en el proceso web. Inicio: `node src/server.js`. Usa pnpm 10.8.0 en el alojamiento. El `Dockerfile` prepara esta versión; los `.env` y certificados locales se excluyen del contexto de construcción. Monta los certificados como secretos en ejecución cuando sean necesarios.

El proveedor debe terminar HTTPS, redirigir HTTP a HTTPS y **sobrescribir** `X-Forwarded-Proto` con el protocolo real. Mantén el puerto de Node privado, accesible solo desde ese proxy: no basta con enviar una cabecera para asegurar el transporte. El servidor rechaza nombres de host ajenos, tráfico sin indicación HTTPS en modo público y escrituras de otros orígenes. `GET /health` es un indicador público de que el proceso está activo y no expone datos del negocio.

El navegador pide usuario y contraseña mediante autenticación HTTP Basic sobre HTTPS. Esta versión utiliza una cuenta compartida del negocio; no incorpora perfiles ni permisos individuales. Si necesitas volver a autenticar una PWA abierta, el enlace **Volver a iniciar sesión** abre `/login` en otra pestaña y conserva el carrito original. Vuelve después y pulsa **Actualizar datos**. Para cambiar la contraseña modifica el secreto del alojamiento y reinicia el servicio.

Los archivos de `public/`, el manifiesto y los iconos son públicos; el acceso a los datos de PostgreSQL exige autenticación en modo público. No introduzcas datos reales del negocio ni credenciales en los archivos estáticos.

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
