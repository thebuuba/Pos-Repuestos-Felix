# Inventario y Excel del negocio

Solicitud vigente: retirar los datos de demostración y concentrar el trabajo en Inventario. Se recibió la exportación NetPOS con el libro de productos y los históricos CSV. Las nuevas pantallas de clientes/configuración y el resto del plan anterior quedan pendientes.

## Entrada sin demostración

- `pnpm build` y `pnpm build:design` generan `dist/operational/` desde el proveedor de la API real. Abrir `/` conduce a `/inventario`.
- `pnpm start:operational` sirve `dist/operational/` con la API en el mismo origen. Usa la configuración de conexión de la sesión, un `PORT` explícito distinto de `3000` y un origen que nunca haya alojado el service worker anterior. Ejecuta `pnpm build` antes de iniciar el servicio.
- Todos los comandos de inicio Node usan la misma interfaz Polymet. Los perfiles local y Supabase cambian la conexión a PostgreSQL.
- `pnpm preview` y `pnpm preview:design` sirven la misma interfaz como vista estática. Una API ausente muestra el estado de conexión pendiente, sin sustituir datos por ejemplos ni presentar cero como una lectura confirmada.
- La referencia con muestras permanece aislada para las pruebas visuales y requiere el comando explícito `preview:reference`. No se publica como POS ni se carga en PostgreSQL.

Antes de la importación autorizada del 21 de noviembre de 2026, la base del negocio tenía **cero artículos**. Los productos que mostraba la referencia de Polymet procedían de la demostración en memoria. El inventario publicado ahora usa exclusivamente los productos importados de NetPOS.

Con autorización expresa del usuario se detuvo la entrada antigua, se aplicaron las cinco migraciones revisadas y se cargó el paquete validado. La entrada moderna quedó conectada a Supabase y publicada en Cloudflare. La evidencia de esa activación se detalla al final de este documento.

Para revisar contra una base aislada, abre una sesión con `DATABASE_URL` configurada desde almacenamiento privado. Elige un puerto libre para un origen nuevo y ejecuta los comandos desde la raíz del proyecto.

```powershell
pnpm build
$env:PORT = '3001'
pnpm start:operational
```

También puedes cargar un archivo privado de configuración con `node --env-file="C:\RutaPrivada\revision.env" src/server.js --operational`. Antes de aplicar la importación al negocio, detén la instancia heredada verificada y conserva el origen nuevo para la interfaz operativa.

Los demás módulos siguen pendientes. El enlace «Panel» actúa como acceso de inicio a Inventario en esta etapa; no presenta un panel con estadísticas de muestra.

Inventario busca y filtra el catálogo completo antes de mostrar 50 artículos por página. Una búsqueda por código encuentra coincidencias aunque cambien las mayúsculas. Cada ficha conserva su código exacto y sus importes unitarios. «Bajo inventario» muestra hasta diez artículos con el aviso activado y enlaza al filtro completo de reposición. «Agotados» cuenta todos los artículos con existencia cero.

## Preparación privada de NetPOS

El preparador usa Python 3.11 o posterior y la biblioteca estándar. La entrada es una carpeta de exportación con los CSV UTF-8 de NetPOS y un único libro XLSX. El archivo de productos recibido tiene extensión doble `.csv.xlsx`. El destino debe ser una carpeta **nueva**, en una ubicación privada de acceso restringido fuera del repositorio, del origen y de los directorios públicos.

```powershell
python scripts/netpos/prepare.py --source "C:\RutaPrivada\Exportacion" --output "C:\RutaPrivada\Paquete"
```

El preparador verifica nombres, SHA-256 y estabilidad de los archivos. El manifiesto enumera los originales y la huella de cada artefacto. El paquete contiene SQL de carga, archivos binarios de transporte, los originales gzip en base64, un CSV de artículos para revisión y la revisión de claves en `key-review.json`. Debe conservarse completo en almacenamiento privado. La huella detecta cambios respecto al manifiesto. El administrador debe conocer la procedencia del paquete y controlar el acceso de escritura a su carpeta.

Las identidades textuales mantienen mayúsculas y espacios. Para recuperar los códigos transformados por Excel se contrastan todos los CSV con columna ARTICULO y el orden ordinal del catálogo. Si el relleno de un número solo se deduce del orden, el código observado queda en el producto y la sugerencia en la revisión. Una ambigüedad impide completar el paquete. Las cantidades y mínimos admiten dos decimales. Costos y tarifas unitarias admiten cuatro tras interpretar las quince cifras significativas de Excel. Los totales de cada línea operativa se redondean a centavos.

## Carga administrativa en una base aislada

Usar un destino PostgreSQL con el esquema actualizado de esta rama, incluido el archivo histórico y la migración de precisión de precios. La carga requiere acceso administrativo y `psql` versión 15 o posterior en el PATH o en la carpeta indicada por `PG_BIN`. En la sesión del administrador, proporcionar `NETPOS_DATABASE_URL` desde almacenamiento privado con la conexión completa de ese destino, autenticación y parámetros TLS que correspondan. El comando lee esa variable directamente y omite los archivos de entorno del proyecto. Para un host remoto exige TLS con verificación del certificado y del nombre del servidor (`sslmode=verify-full`). Puede indicarse la CA del servicio mediante `sslrootcert`. En loopback se admite `sslmode=disable` para la revisión local.

```powershell
node scripts/netpos/import.mjs --package "C:\RutaPrivada\Paquete"
```

También están disponibles `pnpm netpos:prepare` y `pnpm netpos:import` con los mismos argumentos. La carga verifica los artefactos antes de iniciar psql. Transfiere los valores por COPY binario, que en PostgreSQL 17 identifica la columna y la fila del error sin imprimir el campo. Las conversiones y restricciones posteriores se ejecutan en bloques que conservan el SQLSTATE y sustituyen el detalle por un mensaje fijo. La prueba integrada verifica el transporte con un propietario de esquema sin superusuario y con el registro de sentencias DDL habilitado. [Formato binario de COPY](https://www.postgresql.org/docs/17/sql-copy.html#SQL-COPY-FILE-FORMATS-BINARY) y [manejo de errores de COPY en PostgreSQL 17](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/copyfrom.c#L113-L124).

Un único bloqueo de mantenimiento coordina la carga con la API. La misma huella confirmada en la misma generación permite reintentar. Otra huella, una generación restaurada o un catálogo/documentos preexistentes impiden la carga inicial. Se conservan los contactos existentes. Los nuevos clientes y suplidores mantienen su identidad NetPOS por separado, con saldos operativos iniciales en cero. Se crea una apertura por artículo con existencia distinta de cero. CXC, CXP, KARDEX y documentos previos quedan íntegros como históricos privados. La configuración requiere ITBIS del 18 % incluido.

`netpos_historico` conserva por separado cada registro CSV y sus campos de texto. Las tablas administrativas de `pos_privado` conservan los originales comprimidos, conteos, procedencia y correspondencias. El snapshot expone por `state.catalogo` los nombres de categorías, marcas, ubicaciones y unidades, junto con el indicador booleano `importada`. Este indicador solo es verdadero cuando la generación vigente tiene una carga confirmada. Tras una restauración operativa las correspondencias históricas siguen ligadas a la generación anterior. Para respaldar el archivo privado completo se necesita un respaldo administrativo de PostgreSQL que incluya ambos esquemas privados. El respaldo de la API contiene los datos operativos.

Las pruebas y cargas de revisión se realizan en bases desechables o aisladas. La aplicación en la base del negocio requiere una decisión independiente acorde con AGENTS.md.

## Verificación

Las pruebas de navegador usan la compilación operativa junto con la API y PostgreSQL desechable. Verifican entrada en Inventario, cero artículos iniciales, primera categoría, paginación de 50 artículos, filtros sobre el catálogo completo, alertas de reposición acotadas, valores exactos y persistencia tras recargar. También cubren edición, baja, conflictos y reintentos. Las pruebas de arranque levantan procesos propios con puertos libres y comprueban ambas invocaciones operativas y la restauración idempotente de un respaldo v5 con códigos literales. La prueba sin API comprueba que la raíz también lleva a Inventario y conserva el estado de conexión pendiente. El comando de pruebas limita la concurrencia a cuatro archivos para las bases y navegadores temporales. La compilación Worker se realiza en seco, sin publicar.

La prueba del preparador se ejecuta con `python tests/netpos-prepare.py`. La prueba de importación usa `node --test tests/netpos-import.test.js` con PostgreSQL temporal y archivos sintéticos. Comprueba integridad de originales, reversión, reintentos, restauración y permisos.

## Resultado de la revisión local del 21 de noviembre de 2026

Se importaron en PostgreSQL **local aislado** 7.681 artículos, 560 clientes y 43 suplidores de NetPOS. El cliente inicial se conserva por separado. Los 50 originales y las 968.972 filas CSV quedaron conservados en los esquemas privados. Repetir el paquete mantuvo un solo lote, 5.534 aperturas y la misma revisión, sin duplicar registros.

Se contrastaron por SHA-256 los 50 originales descomprimidos y las 49 tablas históricas completas; se compararon 145.939 campos de la proyección de productos, sin diferencias. Siete sugerencias de ceros iniciales siguen sin aplicarse por falta de evidencia histórica. La revisión usó `http://127.0.0.1:3001` con API y almacenamiento locales. Tras la activación autorizada, ese origen pasó a leer la base real de Supabase; la copia aislada se conserva en almacenamiento privado.

Los datos reales se verificaron a 320, 390, 768 y 1440 px, en ambos temas: 50 filas visibles, búsqueda, navegación y editor con importes exactos, sin desbordamiento del documento ni errores de página. Las comprobaciones de lectura no modificaron los datos cargados. La suite final aprobó 173 pruebas Node y ocho pruebas Python. La compilación operativa y el empaquetado Worker en seco pasaron. Docker no se ejecutó por falta del motor; instalador Windows, PWA completa y sincronización conservan su validación pendiente.

## Activación autorizada del 21 de noviembre de 2026

El usuario aprobó expresamente «Sí, migrar y activar», incluidas las cinco migraciones revisadas, el paquete y la conservación de los siete códigos pendientes. Esta decisión autoriza esa carga real pese a la prohibición general de `AGENTS.md`; no autoriza escrituras de prueba en la base del negocio.

Se conservó un respaldo administrativo previo, verificado fuera de Git y de los recursos públicos. Se detuvo el proceso antiguo comprobando su comando y su puerto. En el proyecto Supabase de Repuestos Félix en Virginia se aplicaron catálogo Polymet, contactos/configuración, precisión de inventario, precisión de precios y archivo NetPOS. El paquete se confirmó en una sola transacción.

Resultado leído en Supabase: **7.681 productos, 561 clientes y 44 suplidores**, incluidos los contactos que ya existían; **5.534 aperturas, un lote y revisión 2**. Permanecen **cero ventas y cero compras operativas**. Los 50 originales y las 968.972 filas de las 49 tablas históricas están conservados como archivo administrativo. Los documentos y saldos históricos no se presentan como operaciones nuevas ni como cuentas cobrables ya conciliadas.

La verificación de producción fue de solo lectura: hashes de los 50 originales y de las 49 tablas completas, comparación de todos los productos contra la revisión aprobada y comprobación de contactos y aperturas sin diferencias. El rol del sistema puede leer el catálogo operativo y no tiene acceso al archivo privado original. Los siete códigos conservan los valores observados en el Excel.

Acceso web activo: **https://repuestos-felix-pos.repuestosfelix1994.workers.dev/inventario**. Cloudflare sirve la misma compilación operativa y usa Hyperdrive con el rol limitado hacia Supabase. Se verificaron HTTPS, rechazo sin credenciales (401), página y API autenticadas (200), lectura condicional (304), los seis recursos publicados y coincidencia completa con la API local conectada a Supabase. Las credenciales se conservan en configuración privada; no forman parte del repositorio.

El sitio publicado se revisó a 320, 390, 768 y 1440 px, en claro y oscuro: paginación de 50 artículos, búsqueda, navegación y editor con importes exactos. No hubo desbordamiento del documento, errores de página ni solicitudes de escritura durante esa revisión. Las capturas y los informes quedan en almacenamiento privado.

La publicación acredita Inventario conectado. El resto de los módulos, instalador Windows, funcionamiento sin conexión y sincronización siguen pendientes. `main` se conserva y el trabajo permanece en `feat/sistema-unificado-offline`.
