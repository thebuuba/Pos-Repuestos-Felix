# Inventario y Excel del negocio

Solicitud vigente: retirar los datos de demostración y concentrar el trabajo en Inventario. Se recibió la exportación NetPOS con el libro de productos y los históricos CSV. Las nuevas pantallas de clientes/configuración y el resto del plan anterior quedan pendientes.

## Entrada sin demostración

- `pnpm build` y `pnpm build:design` generan `dist/operational/` desde el proveedor de la API real. Abrir `/` conduce a `/inventario`.
- El servicio Node conserva `public/` durante esta preparación. Activar la nueva compilación exige preparar el esquema y resolver la caché de la PWA anterior; no se cambia la interfaz de los clientes existentes de forma automática.
- `pnpm preview` y `pnpm preview:design` sirven la misma interfaz como vista estática. Una API ausente muestra el estado de conexión pendiente, sin sustituir datos por ejemplos ni presentar cero como una lectura confirmada.
- La referencia con muestras permanece aislada para las pruebas visuales y requiere el comando explícito `preview:reference`. No se publica como POS ni se carga en PostgreSQL.

La lectura del servicio conectado el 21 de noviembre de 2026 devolvió **cero artículos**. No se borraron datos del negocio ni se ejecutaron migraciones o escrituras de prueba en su base. Los productos que mostraba la vista de Polymet procedían de la demostración en memoria.

El servicio existente no se reinició contra el esquema nuevo. Las migraciones de esta rama siguen pendientes de aplicación controlada en el negocio; cambiar la entrada de interfaz no acredita esa activación ni un despliegue.

Los demás módulos siguen pendientes. El enlace «Panel» actúa como acceso de inicio a Inventario en esta etapa; no presenta un panel con estadísticas de muestra.

## Preparación privada de NetPOS

El preparador usa Python 3.11 o posterior y la biblioteca estándar. La entrada es una carpeta de exportación con los CSV UTF-8 de NetPOS y un único libro XLSX. El archivo de productos recibido tiene extensión doble `.csv.xlsx`. El destino debe ser una carpeta **nueva**, en una ubicación privada de acceso restringido fuera del repositorio, del origen y de los directorios públicos.

```powershell
python scripts/netpos/prepare.py --source "C:\RutaPrivada\Exportacion" --output "C:\RutaPrivada\Paquete"
```

El preparador verifica nombres, SHA-256 y estabilidad de los archivos. El manifiesto enumera los originales y la huella de cada artefacto. El paquete contiene SQL de carga, tablas CSV de trabajo, los originales gzip en base64 y la revisión de claves en `key-review.json`. Debe conservarse completo en almacenamiento privado. La huella detecta cambios respecto al manifiesto. El administrador debe conocer la procedencia del paquete y controlar el acceso de escritura a su carpeta.

Las identidades textuales mantienen mayúsculas y espacios. Para recuperar los códigos transformados por Excel se contrastan todos los CSV con columna ARTICULO y el orden ordinal del catálogo. Si el relleno de un número solo se deduce del orden, el código observado queda en el producto y la sugerencia en la revisión. Una ambigüedad impide completar el paquete. Las cantidades y mínimos admiten dos decimales. Costos y tarifas unitarias admiten cuatro tras interpretar las quince cifras significativas de Excel. Los totales de cada línea operativa se redondean a centavos.

## Carga administrativa en una base aislada

Usar un destino PostgreSQL con el esquema actualizado de esta rama, incluido el archivo histórico y la migración de precisión de precios. La carga requiere acceso administrativo y `psql` versión 15 o posterior en el PATH o en la carpeta indicada por `PG_BIN`. En la sesión del administrador, proporcionar `NETPOS_DATABASE_URL` desde almacenamiento privado con la conexión completa de ese destino, autenticación y parámetros TLS que correspondan. El comando lee esa variable directamente y omite los archivos de entorno del proyecto.

```powershell
node scripts/netpos/import.mjs --package "C:\RutaPrivada\Paquete"
```

También están disponibles `pnpm netpos:prepare` y `pnpm netpos:import` con los mismos argumentos. La carga verifica los artefactos antes de iniciar psql y exige `log_error_verbosity=terse`, `log_min_error_statement=panic` y `log_statement=none` para la sesión de carga. Cuando el servidor tiene otros valores, intenta fijarlos dentro de la transacción antes de enviar datos. Un destino administrado requiere comprobar que permita esas condiciones antes de activarlo.

Un único bloqueo de mantenimiento coordina la carga con la API. La misma huella confirmada en la misma generación permite reintentar. Otra huella, una generación restaurada o un catálogo/documentos preexistentes impiden la carga inicial. Se conservan los contactos existentes. Los nuevos clientes y suplidores mantienen su identidad NetPOS por separado, con saldos operativos iniciales en cero. Se crea una apertura por artículo con existencia distinta de cero. CXC, CXP, KARDEX y documentos previos quedan íntegros como históricos privados. La configuración requiere ITBIS del 18 % incluido.

`netpos_historico` conserva por separado cada registro CSV y sus campos de texto. Las tablas administrativas de `pos_privado` conservan los originales comprimidos, conteos, procedencia y correspondencias. El snapshot expone por `state.catalogo` únicamente los nombres de categorías, marcas, ubicaciones y unidades de la generación vigente. Tras una restauración operativa las correspondencias históricas siguen ligadas a la generación anterior. Para respaldar el archivo privado completo se necesita un respaldo administrativo de PostgreSQL que incluya ambos esquemas privados. El respaldo de la API contiene los datos operativos.

Las pruebas y cargas de revisión se realizan en bases desechables o aisladas. La aplicación en la base del negocio requiere una decisión independiente acorde con AGENTS.md.

## Verificación

Las pruebas de navegador usan la compilación operativa junto con la API y PostgreSQL desechable: verifican entrada en Inventario, cero artículos iniciales y persistencia tras recargar, además de edición/baja, conflictos y reintentos. La prueba sin API comprueba que la raíz también lleva a Inventario y conserva el estado de conexión pendiente, sin una lectura ficticia de cero existencias. El comando de pruebas limita la concurrencia a cuatro archivos para las bases y navegadores temporales. La compilación Worker se realiza en seco, sin publicar.

La prueba del preparador se ejecuta con `python tests/netpos-prepare.py`. La prueba de importación usa `node --test tests/netpos-import.test.js` con PostgreSQL temporal y archivos sintéticos. Comprueba integridad de originales, reversión, reintentos, restauración y permisos.
