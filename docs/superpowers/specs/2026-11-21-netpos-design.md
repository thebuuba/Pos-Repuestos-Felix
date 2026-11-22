# Migración de NetPOS al inventario con diseño Polymet

Solicitud: retirar las muestras y cargar los archivos del negocio en el sistema nuevo con el diseño aprobado. El origen se localizó en la carpeta `NetPOS-migracion-20261121-205136` de Descargas. El supuesto CSV de productos es realmente un archivo `.csv.xlsx`; no existe otro original disponible.

## Resultado y límites

Preparar y verificar una carga administrativa repetible: 7.681 artículos, maestros de clientes/suplidores y los 50 archivos originales, con 968.972 filas CSV históricas. Revisarla con PostgreSQL aislado y la misma interfaz operativa de Polymet. Ningún dato privado se incluye en Git ni en la compilación pública. La importación no implementa por sí sola ventas históricas editables, cobranza, caja, Windows offline o despliegue.

La base real queda intacta durante las pruebas. Aplicar allí las migraciones exige resolver la prohibición expresa de AGENTS.md después de preparar SQL, revisión e informe concretos. No modificar `main`, la cuenta global de Supabase ni la preparación ajena de Cloudflare.

## Inventario y precisión

- Conservar cantidades y mínimos con dos decimales y costos/precios unitarios con cuatro. La preparación confirmó once precios de la segunda tarifa con tres decimales genuinos; no redondearlos a centavos. Aceptar cero donde la fuente lo contiene. Aritmética de operaciones mediante enteros escalados; redondeo comercial por línea al importe final de dos decimales. Las compras y ventas continúan siendo transaccionales e idempotentes.
- Los códigos son texto sensible a mayúsculas. No transformar a mayúsculas ni deduplicar por minúsculas. Eliminar únicamente el relleno ASCII al final al relacionar claves históricas; el archivo original permanece íntegro.
- Excel convirtió identificadores en números y una fecha. Recuperar únicamente candidatos existentes en los históricos que sean únicos después de contrastar el orden ordinal del catálogo, sin violaciones entre anclas. La identidad de claves textuales se mantiene literal.
- Cuando solo el orden sugiere añadir ceros y no hay evidencia histórica, conservar el valor observado y registrar la sugerencia pendiente de revisión. Nunca inventar un código histórico para completar un enlace. Los grupos que sigan siendo ambiguos detienen la preparación.
- Decimales XML de Excel: normalizar la representación a sus 15 dígitos significativos, rechazando cantidades/precios/costos que aún excedan la escala admitida. Archivar el XML original; no redondear valores genuinos silenciosamente.
- Una apertura por artículo con existencia no nula. No reproducir KARDEX, ventas o compras antiguas sobre la existencia del Excel. Conservar gravabilidad y avisos de mínimo; EMPRESA establece impuestos incluidos e ITBIS 18 %.

## Conservación del origen

Cada importación tiene huella determinista de nombres y hashes. Una carga completa idéntica devuelve el resultado existente; otra huella no sobrescribe inventario. Verificar todos los hashes antes y después de preparar, y verificar de nuevo los archivos preparados antes de importar.

Guardar los originales comprimidos en tablas privadas junto con tamaño, hash, encabezados y conteos. Cargar cada CSV en una tabla histórica privada de texto que conserva todos sus campos, incluidos identificadores, fechas anómalas y valores inválidos para reglas actuales. Nunca exponer números de tarjeta, vencimientos, cuentas bancarias o autorizaciones en una respuesta de inventario. Los históricos no entran en el snapshot público ni en las operaciones nuevas.

La cuenta administrativa de Supabase no tiene permiso para cambiar los parámetros de logs. La carga no puede depender de esos privilegios. Transportar los campos mediante COPY binario a staging de texto; PostgreSQL no imprime el contenido de filas binarias en su contexto de COPY. Convertir a los tipos operativos después de las validaciones de fuente, conservando SQL sin literales de datos. TLS remoto exige verify-full y no acepta degradación silenciosa. Verificar con un rol dueño sin superusuario y un fallo binario controlado que una marca sintética no aparece en salida ni log. Referencias primarias: [formato COPY de PostgreSQL 17](https://www.postgresql.org/docs/17/sql-copy.html) y [CopyFromErrorCallback](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/copyfrom.c).

Guardar la relación fila del Excel/código original/código adoptado/producto y su evidencia. Importar los maestros reales con identidad de origen separada; preservar clientes ya existentes y no adivinar que son el mismo por nombre. Los contactos importados tienen saldo operativo de apertura cero: CXC/CXP quedan íntegros y sujetos a revisión histórica, sin duplicarlos como facturación nueva ni fabricar deudas.

La auditoría financiera comprobó las ecuaciones de CXC y CXP. Existen referencias a maestros ausentes, saldos ligados a facturas nulas, fechas anómalas, pagos ambiguos y NCF repetidos. Se conservan y señalan; no se convierten en operaciones autorizadas o cobros pendientes nuevos.

## Interfaz y activación de revisión

Mantener componentes, distribución, tokens y temas de Polymet. Paginar la tabla en bloques de 50 después de buscar/filtrar; la búsqueda abarca todos los artículos. Categorías reales del proveedor conectado, sin muestras. Respetar el código exacto y la precisión en editar/guardar/reabrir. Los importes resumidos son informativos y se presentan con formato `es-DO`.

La revisión local usa una instancia PostgreSQL separada con autenticación SCRAM, escuchando solo en 127.0.0.1. Sus credenciales y datos quedan fuera del repositorio. Servir `dist/operational` con la API real en un origen de revisión sin el service worker antiguo. No reiniciar el servicio del negocio ni alterar las pestañas personales.

Preparar la activación posterior: Polymet es la única interfaz operativa admitida, con los recursos compilados y puerto/origen nuevo. Se retira la entrada HTML heredada del CLI y de los valores por defecto del servidor; conservar sus recursos y la versión de main no exige mantener otra interfaz escribible. Node sin argumentos o con `--operational` usa la compilación nueva, exige PORT explícito distinto de 3000 y nunca selecciona public/. Los comandos de empaquetado y publicación Cloudflare seleccionan explícitamente dist/operational, conservando la configuración ajena de wrangler sin cambios. Metadatos de catálogo incluyen `importada` booleano ligado a la generación. La activación real exige detener primero el servicio heredado verificado; no dejar sus endpoints escribibles sobre los nuevos datos. No reutilizar automáticamente el origen con service worker antiguo. Cloudflare y la PWA completa siguen requiriendo su validación propia.

Validar la sintaxis decimal ASCII de todos los importes textuales, incluidos límites CSV e ITBIS. La normalización a quince cifras se reserva a celdas numéricas XLSX. Editar únicamente precios no cambia nombres, marcas ni ubicación sin editar. Las cantidades y valoraciones agregadas del inventario se suman con enteros escalados y se formatean desde texto decimal exacto.

## Evidencia

Pruebas sintéticas de recuperación, decimales, rollback, idempotencia y permisos; operaciones con cantidades fraccionadas y costos de cuatro decimales, copias de seguridad actuales/anteriores; importación real solo en la instancia aislada. Comparar inventario y edición en móvil/escritorio, claro/oscuro. Medir tamaño PostgreSQL y snapshot para evaluar capacidad antes de cualquier carga remota. Reportar por separado carga local, preparación Supabase, compilación, verificación visual y despliegue.
