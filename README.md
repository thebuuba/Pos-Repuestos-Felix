# POS Repuestos Félix

PWA instalable para teléfono y computadora, con ventas, inventario, compras, clientes, suplidores, resumen de caja y respaldos JSON. Se conserva JavaScript nativo, CSS y HTML, con una API Node.js y **PostgreSQL local o Supabase**. Las contraseñas permanecen en el servidor.

## Instalar en Android o iPhone

Abre la dirección **HTTPS** del sistema e inicia sesión. En Android pulsa **Instalar app** o usa el menú del navegador. En iPhone abre la página en Safari y elige **Compartir → Añadir a pantalla de inicio**. La app también funciona directamente en el navegador. La disponibilidad del aviso automático depende del navegador; el botón incluye instrucciones alternativas.

Los controles se adaptan a pantallas pequeñas, los menús se abren al tocar y las tablas se desplazan dentro de su propio recuadro. La interfaz conserva el mismo servidor y base de datos que la versión de escritorio.

**Sin conexión:** una vez preparada la caché, se puede abrir la interfaz. No se guardan clientes, inventario, facturas ni contraseñas en la caché del service worker. Las operaciones requieren conexión y confirmación del servidor. Si hay un carrito pendiente, conserva esa pantalla: cerrar la app no guarda borradores. No hay sincronización de ventas sin conexión.

**Actualizaciones:** el service worker instala una versión completa de los archivos estáticos y espera a que se cierren las pestañas/instancias anteriores. Para publicar cambios en la interfaz, incrementa `CACHE` en `sw.js` en el mismo despliegue. No se fuerza una actualización en medio de una venta.

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
   ```

3. Inicia:

   ```powershell
   pnpm start:local
   ```

4. Abre **http://127.0.0.1:3000**. El servidor crea su esquema y tabla al iniciar. Una base nueva contiene los dos productos de ejemplo y los contactos del HTML original.

## Usar Supabase

El CLI se configura de forma independiente del gestor de paquetes del proyecto. Para cambiar su cuenta usa `supabase logout` y después `supabase login --name "Repuestos Felix"`; completa el acceso en el navegador con la cuenta correcta. Comprueba los proyectos disponibles con `supabase projects list` y vincula el proyecto elegido con `supabase link --project-ref ID_DEL_PROYECTO`. La carpeta `supabase/.temp` es local y está excluida de Git. El vínculo del CLI no configura automáticamente `DATABASE_URL` del servidor.

### Crear la estructura de la base

La migración `supabase/migrations/20261121150000_inicializar_pos.sql` crea el esquema privado `pos_privado` y la tabla `estado`, compatibles con la API actual. En una base nueva registra la empresa, ITBIS del 18 % y Cliente Contado; productos, suplidores, ventas y compras comienzan vacíos. Una base que ya tenga datos conserva su estado.

Con el CLI vinculado al proyecto correcto:

```powershell
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Ejecuta estos comandos de forma secuencial. Si el CLI solicita la contraseña de la base, usa la del proyecto correspondiente. La tabla tiene RLS activado y no concede acceso a `anon` ni `authenticated`; se utiliza a través del servidor Node.js con la conexión PostgreSQL. Los respaldos JSON mantienen el formato anterior. No hay tablas separadas por entidad en esta versión.

### Configurar la conexión del servidor

1. En tu proyecto Supabase abre **Connect** y copia la conexión PostgreSQL. Para este servidor persistente usa **Session pooler**, compatible con redes IPv4, o conexión directa si tu red permite el acceso a su dirección IPv6.
2. Prepara el archivo:

   ```powershell
   Copy-Item .env.supabase.example .env.supabase
   ```

3. Completa `DATABASE_URL` con la cadena real, incluida la contraseña de la **base de datos**. Una clave `anon`, `publishable` o `service_role` no sustituye esta contraseña. Codifica caracteres especiales de usuario/contraseña para URL, por ejemplo `@` como `%40` y `#` como `%23`.
4. Deja `DATABASE_SSL=true`. Se verifica el certificado del servidor. Si la conexión requiere la CA de Supabase, descárgala de la configuración SSL del proyecto, guárdala en `certs/` y configura `DATABASE_CA_FILE=./certs/prod-supabase.cer`. No se desactiva la validación del certificado.
5. Evita parámetros adicionales en la URL: el servidor gestiona SSL y la CA mediante estas variables. Los parámetros `ssl` y `sslmode` se retiran para que no reemplacen esa configuración; los demás se rechazan para evitar que cambien el destino o su seguridad.
6. Ejecuta:

   ```powershell
   pnpm start:supabase
   ```

Abre la misma dirección local. El indicador superior muestra qué destino está activo. La tabla se crea en el esquema privado `pos_privado`, fuera de `public`, y el navegador accede únicamente a la API Node.js.

La configuración sigue la [guía de conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) y las [indicaciones SSL de node-postgres](https://node-postgres.com/features/ssl).

## Cambiar de base y trasladar datos

Detén el servidor con `Ctrl+C` e inicia el otro comando. **Local y Supabase mantienen datos independientes; no hay sincronización ni cambio automático ante fallos.** Puedes usar ambas configuraciones, una por ejecución.

Para copiar datos entre ellas: exporta desde **Configuración → Copia de seguridad**, cambia el destino del servidor y usa **Restaurar copia**. La restauración pide confirmación y reemplaza los datos de la base seleccionada. También acepta el JSON exportado desde el HTML original con Firebase. La migración no consulta ni modifica Firebase automáticamente.

`pnpm start` permite usar un archivo `.env` en lugar de los dos perfiles anteriores. Las variables ya presentes en el entorno tienen prioridad sobre el archivo seleccionado; evita dejar `DATABASE_URL` de otro destino definida en la terminal.

## Guardado y alcance

- Los datos se almacenan como un documento JSONB en `pos_privado.estado`. Se conserva el formato del sistema original; esta versión no crea tablas relacionales por entidad.
- Cada guardado es atómico y comprueba la revisión. Si otra sesión modificó los datos, se rechaza la escritura y se actualizan los datos disponibles para que revises la operación. Los carritos y formularios pendientes se conservan.
- Cada ejecución del servidor tiene un identificador propio. Una pestaña que quedó abierta al cambiar entre local y Supabase debe actualizar los datos antes de volver a guardar; no puede sobrescribir la otra base con su copia anterior.
- No se vacían formularios, descuentan existencias confirmadas ni imprime la factura hasta recibir la confirmación del servidor.
- Si se pierde la conexión durante el guardado, el resultado puede ser incierto. Pulsa **Actualizar datos** y revisa facturas/compras antes de repetirlo. No se guarda automáticamente sin conexión.
- Las compras quedan registradas con suplidor y número. Se rechaza registrar de nuevo el mismo número para el mismo suplidor.
- El respaldo admite hasta 10 MB. El documento completo se envía en cada guardado. Para más volumen o trabajo intensivo con varias cajas, conviene migrar a tablas por entidad y operaciones específicas en el servidor.
- Por defecto el servidor escucha únicamente en `127.0.0.1`. El modo público requiere origen HTTPS explícito, usuario y contraseña de acceso; consulta la siguiente sección. No se han configurado credenciales reales ni publicado un servicio.
- El resumen de caja y el listado de facturas mantienen las funciones que tenía el HTML. No se ha añadido cierre contable, anulación ni exportación fiscal 607.

## Preparar el acceso por internet

El código está preparado para una sola instancia Node.js persistente o compatible con Docker y una base Supabase. **GitHub guarda el código; GitHub Pages no ejecuta esta API ni conecta el navegador directamente a PostgreSQL.** La publicación y los archivos `.env` reales quedan para cuando se configuren el alojamiento y sus credenciales.

En el panel de variables privadas del alojamiento configura:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión real de PostgreSQL/Supabase |
| `DATABASE_SSL` | `true` para Supabase |
| `DATABASE_LABEL` | `Supabase` o nombre del destino |
| `DATABASE_CA_FILE` | Ruta al certificado CA montado como archivo secreto, si tu proyecto lo necesita |
| `HOST` | `0.0.0.0` dentro del servicio alojado |
| `PORT` | Puerto indicado por el proveedor; por defecto `3000` |
| `PUBLIC_ORIGIN` | Dirección exacta, por ejemplo `https://pos.tu-dominio.com`, sin rutas ni parámetros |
| `APP_USERNAME` | Usuario de acceso, por ejemplo `admin` |
| `APP_PASSWORD` | Contraseña larga y única, de al menos 16 caracteres |

Instalación del servicio: `pnpm install --prod --frozen-lockfile`. Inicio: `node server.js`. Usa pnpm 10.8.0 en el alojamiento. También se incluye un `Dockerfile` que prepara esta versión; los `.env` y certificados locales se excluyen del contexto de construcción. Monta los certificados como secretos en ejecución cuando sean necesarios.

El proveedor debe terminar HTTPS, redirigir HTTP a HTTPS y **sobrescribir** `X-Forwarded-Proto` con el protocolo real. Mantén el puerto de Node privado, accesible solo desde ese proxy: no basta con enviar una cabecera para asegurar el transporte. El servidor rechaza nombres de host ajenos, tráfico sin indicación HTTPS en modo público y escrituras de otros orígenes. `GET /health` es un indicador público de que el proceso está activo y no expone datos del negocio.

El navegador pide usuario y contraseña mediante autenticación HTTP Basic sobre HTTPS. Esta versión utiliza una cuenta compartida del negocio; no incorpora perfiles ni permisos individuales. Si necesitas volver a autenticar una PWA abierta, el enlace **Volver a iniciar sesión** abre `/login` en otra pestaña y conserva el carrito original. Vuelve después y pulsa **Actualizar datos**. Para cambiar la contraseña modifica el secreto del alojamiento y reinicia el servicio.

Los archivos estáticos de la interfaz, manifiesto e iconos son públicos; el acceso a los datos de PostgreSQL exige autenticación en modo público. No introduzcas datos reales del negocio ni credenciales en `state.js` o los demás archivos estáticos.

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
