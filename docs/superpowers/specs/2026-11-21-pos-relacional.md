# POS relacional: contrato de implementación

## Objetivo y alcance

Sustituir la tabla JSONB operativa por tablas relacionales reales, con integridad, transacciones y cálculos del servidor. Conservar la PWA y sus flujos: catálogo, clientes, suplidores, ventas contado/crédito, compras, reportes, configuración, exportación/restauración. No añadir en este cambio un módulo fiscal, pagos, multiempresa o publicación web. No inventar NCF autorizados: las ventas nuevas reciben número interno y `ncf=null`; los históricos conservan su referencia.

## Tablas y columnas acordadas

Tablas del negocio en `public`, todas con RLS, sin permisos a PUBLIC/anon/authenticated. Rol de servidor `pos_app` con políticas específicas y permisos de datos, sin DDL. Importes NUMERIC(14,2), existencias/cantidades INTEGER, claves BIGINT identity BY DEFAULT, fechas TIMESTAMPTZ salvo fecha documental DATE. Dinero no negativo; cantidades positivas; stock nunca negativo. Identificadores retornados a JS como enteros seguros.

- `configuracion`: id=1, empresa TEXT NOT NULL, tasa_itbis NUMERIC(7,6) CHECK 0..1, version BIGINT DEFAULT 1, actualizado_en.
- `clientes`: id, nombre, rnc TEXT DEFAULT '', tel TEXT DEFAULT '', saldo_apertura NUMERIC(14,2) DEFAULT 0 (firmado para conservar saldos históricos), activo BOOLEAN DEFAULT true, version BIGINT DEFAULT 1, creado_en, actualizado_en.
- `suplidores`: id, nombre, rnc, tel, activo, version, creado_en, actualizado_en.
- `productos`: id, codigo, nombre, costo, precio1, precio2, precio3 (NUMERIC), stock INTEGER >=0 DEFAULT 0, activo, version, creado_en, actualizado_en. Código único sin distinguir mayúsculas (`lower(codigo)`).
- `ventas`: id (número interno), cliente_id FK clientes RESTRICT, cliente_nombre TEXT, cliente_rnc TEXT, fecha DATE DEFAULT fecha de Santo Domingo, creado_en, tipo_comprobante TEXT DEFAULT 'B02', ncf TEXT nullable UNIQUE, condicion TEXT CHECK ('Contado','Credito'), base NUMERIC, itbis NUMERIC, total NUMERIC; CHECK base+itbis=total. No borrado de documentos desde la API ordinaria.
- `venta_detalles`: id, venta_id FK ventas RESTRICT, producto_id FK productos RESTRICT, codigo TEXT, nombre TEXT (instantáneas), cantidad INTEGER >0, nivel_precio TEXT CHECK ('precio1','precio2','precio3'), precio NUMERIC, base NUMERIC, itbis NUMERIC, total NUMERIC; CHECK base+itbis=total AND total=precio*cantidad.
- `compras`: id, suplidor_id FK suplidores RESTRICT, suplidor_nombre TEXT, numero TEXT, fecha DATE, creado_en, total NUMERIC >=0. Índice único `(suplidor_id, lower(numero))`.
- `compra_detalles`: id, compra_id FK compras RESTRICT, producto_id FK productos RESTRICT, codigo, nombre, cantidad INTEGER>0, costo, precio1, precio2, precio3, total NUMERIC; CHECK total=costo*cantidad.
- `movimientos_inventario`: id, producto_id FK productos RESTRICT, venta_detalle_id FK venta_detalles nullable, compra_detalle_id FK compra_detalles nullable, tipo CHECK ('apertura','venta','compra','ajuste'), cantidad INTEGER (delta firmado, distinto de cero), existencia_posterior INTEGER>=0, motivo TEXT, creado_en. Venta/compra refieren a su detalle; apertura/ajuste sin detalle. Índices para claves foráneas y consultas.

Infraestructura privada:
- `pos_privado.sistema`: id=1, database_id UUID DEFAULT gen_random_uuid(), revision BIGINT DEFAULT 0. UUID persistente distingue las bases, no el proceso Node.
- `pos_privado.solicitudes`: clave UUID PK, tipo TEXT, huella TEXT, resultado JSONB (solo metadatos de respuesta/idempotencia), creado_en.
- `pos_privado.respaldos`: id UUID PK DEFAULT gen_random_uuid(), motivo TEXT, datos JSONB (archivo, no fuente de operación), creado_en.
- `pos_privado.estado` queda únicamente como archivo de migración, con trigger que impide INSERT/UPDATE/DELETE una vez migrada; nunca volver a escribirla desde el servidor.

## Migración y ejecución

Migración nueva `supabase/migrations/20261121190000_normalizar_pos.sql`, transaccional, conserva migración anterior inmutable. `schema.sql` describe la estructura relacional actual. La migración archiva JSON original, transforma clientes/productos/suplidores/documentos/detalles y conserva sus IDs documentales, importes y saldos. Genera productos/contactos históricos inactivos si un detalle hace referencia a uno eliminado. Ante ambigüedad de nombres o datos inconsistentes, abortar sin modificar datos. Reconstruir saldo_apertura = deuda anterior - total ventas a crédito importadas. Movimientos de apertura reflejan stock al corte: no inventar movimientos históricos. Ajustar secuencias tras importar IDs. Base limpia: empresa/18%/Cliente Contado, sin stock de ejemplo.

`database.js` exporta `migrateDatabase(pool)`: aplica archivos pendientes de `supabase/migrations` y registra en `supabase_migrations.schema_migrations` usando el formato del CLI. Serializar con advisory lock. Solo se ejecuta explícitamente (`pnpm db:migrate`), nunca desde `createApp`. Tests llaman este helper antes de crear servidor. Runtime no ejecuta DDL.

## API HTTP acordada

Se mantienen Basic auth, origen permitido, HTTPS remoto, protección de archivos y PWA. GET `/api/state` solo es lectura. PUT `/api/state` responde 410: queda prohibido guardar la base completa.

Lectura responde `{state, databaseId, revision, databaseLabel}`. `state` mantiene nombres de la interfaz anterior: empresa,itbisRate,productos,clientes,suplidores,facturas,compras; añade configuracionVersion y movimientos. Productos tienen id/version/activo; clientes/suplidores id/version; clientes.deuda es calculada de saldo_apertura + ventas crédito. Facturas tienen id,clienteId,cliente,ncf(nullable),tipoComprobante,fecha(es-DO),fechaISO,condicion,items,total,base,itbis; items id,productoId,codigo,nombre,cant,precio,itbis,subtotal. Compras id,suplidorId,suplidor,numero,fecha,items,total; items productoId,codigo,nombre,cant,costo,p1,p2,p3,subtotal. Precio JSON numérico para compatibilidad visual; cálculo real exacto en centavos/BigInt y NUMERIC.

Cada escritura recibe body `databaseId` y header `Idempotency-Key` UUID. Una transacción toma lock compartido de mantenimiento, lock de solicitud, comprueba databaseId y huella canónica, ejecuta todo y registra resultado. Repetir misma clave/payload devuelve la operación previa; reutilizar clave con otro payload da 409. Una restauración toma lock exclusivo, valida revisión y conserva respaldo automático antes de modificar. Respuesta de escritura `{state,databaseId,revision,databaseLabel,result:{id}}`; ventas imprimen `state.facturas.find(f=>f.id===result.id)`.

| Método / ruta | Body específico |
| --- | --- |
| POST /api/clientes | nombre,rnc,tel |
| POST /api/suplidores | nombre,rnc,tel |
| POST /api/productos | codigo,nombre,costo,stock,precio1,precio2,precio3 |
| PUT /api/productos/:id | mismos campos + version esperada |
| DELETE /api/productos/:id | version; baja lógica, conserva referencias |
| PUT /api/configuracion | empresa,itbisPorcentaje,version |
| POST /api/ventas | clienteId,condicion,tipoComprobante,items:[{productoId,cantidad,nivelPrecio}] |
| POST /api/compras | suplidorId,numero,items:[{codigo,nombre,cantidad,costo,precio1,precio2,precio3}] |
| GET /api/backup | exporta formato v2, tablas normalizadas completas incluidas filas inactivas y movimientos; excluye credenciales y solicitudes internas |
| POST /api/restore | backup,revision; acepta v2 y JSON antiguo, todo atómico, respaldo automático, rota databaseId después de restaurar |

Compra: bloqueo de códigos en orden; crea/reactiva productos y aumenta stock, actualiza precios, inserta cabecera/detalles/movimientos en una transacción. Rechazar factura duplicada por suplidor. Venta: bloqueo de productos ordenado, sumar cantidad por producto, comprobar stock y activo, usar precios/ITBIS del servidor e ignorar/rechazar totales del navegador; descontar e insertar todos los registros en una transacción. Cálculos exactos, precios con hasta 2 decimales; base/ITBIS se redondean por línea en centavos y cuadran con el total. Stock o importes inválidos no dejan filas parciales. Otras cajas pueden operar sin sobrescribir datos ajenos.

## Cliente y verificaciones

El cliente manda operaciones, no muta copias completas. Selects usan IDs. Captura versión al comenzar edición. Conserva carrito/formulario y clave idempotente al perder confirmación; permite reintentar la misma operación sin duplicarla. Limpia solo después de éxito. El servidor es la autoridad monetaria y de existencias. Quitar el reinicio de datos de ejemplo del menú de producción. Manifiesto/PWA se mantienen; incrementar caché y orientar a cerrar/reabrir pestañas antiguas.

Pruebas requeridas: migración poblada e inválida; claves foráneas/únicos/CHECK/RLS; rol pos_app; ventas concurrentes con última unidad; mismo ID repetido concurrentemente; compras completas/duplicadas; precio manipulado; crédito; rollback; edición obsoleta; exportar/restaurar con datos completos y sin escrituras concurrentes; DOM con IDs y reintentos; regresión autenticación/PWA. Respaldar y verificar Supabase real antes/después; no pedir nuevo login del CLI: usar la conexión administrativa existente y verificada de `.env` para esta migración.
