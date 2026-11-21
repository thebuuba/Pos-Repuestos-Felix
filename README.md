# POS Repuestos Félix

La interfaz conserva ventas, inventario, compras, clientes, suplidores, resumen de caja y respaldos JSON. Node.js se conecta a **PostgreSQL local o a PostgreSQL de Supabase**. Las contraseñas permanecen en el servidor.

## Instalar

Necesitas Node.js 24.15 o posterior dentro de la rama 24 (recomendado), Node.js 22.22.2 o posterior dentro de la rama 22, o Node.js 26 o posterior; además de PostgreSQL local o un proyecto Supabase. Se verificó con Node.js 24.16 y PostgreSQL 17.

```powershell
npm install
```

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
   npm run start:local
   ```

4. Abre **http://127.0.0.1:3000**. El servidor crea su esquema y tabla al iniciar. Una base nueva contiene los dos productos de ejemplo y los contactos del HTML original.

## Usar Supabase

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
   npm run start:supabase
   ```

Abre la misma dirección local. El indicador superior muestra qué destino está activo. La tabla se crea en el esquema privado `pos_privado`, fuera de `public`, y el navegador accede únicamente a la API Node.js.

La configuración sigue la [guía de conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) y las [indicaciones SSL de node-postgres](https://node-postgres.com/features/ssl).

## Cambiar de base y trasladar datos

Detén el servidor con `Ctrl+C` e inicia el otro comando. **Local y Supabase mantienen datos independientes; no hay sincronización ni cambio automático ante fallos.** Puedes usar ambas configuraciones, una por ejecución.

Para copiar datos entre ellas: exporta desde **Configuración → Copia de seguridad**, cambia el destino del servidor y usa **Restaurar copia**. La restauración pide confirmación y reemplaza los datos de la base seleccionada. También acepta el JSON exportado desde el HTML original con Firebase. La migración no consulta ni modifica Firebase automáticamente.

`npm start` permite usar un archivo `.env` en lugar de los dos perfiles anteriores. Las variables ya presentes en el entorno tienen prioridad sobre el archivo seleccionado; evita dejar `DATABASE_URL` de otro destino definida en la terminal.

## Guardado y alcance

- Los datos se almacenan como un documento JSONB en `pos_privado.estado`. Se conserva el formato del sistema original; esta versión no crea tablas relacionales por entidad.
- Cada guardado es atómico y comprueba la revisión. Si otra sesión modificó los datos, se rechaza la escritura y se actualizan los datos disponibles para que revises la operación. Los carritos y formularios pendientes se conservan.
- Cada ejecución del servidor tiene un identificador propio. Una pestaña que quedó abierta al cambiar entre local y Supabase debe actualizar los datos antes de volver a guardar; no puede sobrescribir la otra base con su copia anterior.
- No se vacían formularios, descuentan existencias confirmadas ni imprime la factura hasta recibir la confirmación del servidor.
- Si se pierde la conexión durante el guardado, el resultado puede ser incierto. Pulsa **Actualizar datos** y revisa facturas/compras antes de repetirlo. No se guarda automáticamente sin conexión.
- Las compras quedan registradas con suplidor y número. Se rechaza registrar de nuevo el mismo número para el mismo suplidor.
- El respaldo admite hasta 10 MB. El documento completo se envía en cada guardado. Para más volumen o trabajo intensivo con varias cajas, conviene migrar a tablas por entidad y operaciones específicas en el servidor.
- El servidor escucha únicamente en `127.0.0.1`: se puede usar Supabase desde esta computadora sin publicar la aplicación. El acceso público o desde otras computadoras requiere añadir autenticación y configurar el alojamiento.
- El resumen de caja y el listado de facturas mantienen las funciones que tenía el HTML. No se ha añadido cierre contable, anulación ni exportación fiscal 607.

## Pruebas

```powershell
npm test
```

Las pruebas crean un clúster PostgreSQL temporal, comprueban la API con conexiones reales y los flujos de la interfaz mediante un DOM con jsdom, y luego eliminan su clúster. Nunca usan `.env.local` ni `.env.supabase`. Necesitas `psql`, `initdb` y `pg_ctl` en el mismo directorio; si `psql` no está en PATH, indica su carpeta:

```powershell
$env:PG_BIN = 'C:/Program Files/PostgreSQL/17/bin'
npm test
```

La conexión real de Supabase se comprueba al iniciar con tus credenciales; las pruebas automáticas no necesitan una cuenta remota.
