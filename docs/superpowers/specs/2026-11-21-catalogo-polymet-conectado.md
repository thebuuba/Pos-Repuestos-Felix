# Catálogo persistente para los componentes de Polymet

Esta es la siguiente entrega del [sistema unificado](2026-11-21-sistema-unificado-polymet.md). No sustituye el alcance completo: después siguen contactos/configuración, ventas/caja/cuentas, almacenamiento local, sincronización, PWA, Windows y despliegue. La referencia visual permanece aislada.

## Problema concreto

El formulario de Inventario pide marca, categoría, ubicación, existencia mínima y gravabilidad, pero la API actual solo guarda código, nombre, costos, tres precios y stock. No se puede conectar «Guardar» descartando parte del formulario. También se necesitan versiones/IDs reales y esperar el COMMIT antes de cerrar la hoja o mostrar éxito.

## Contrato de datos

Añadir mediante una migración nueva cinco columnas a `public.productos`: `marca text`, `categoria text`, `ubicacion text`, `stock_minimo integer`, `gravado boolean`. Texto de hasta 2000 caracteres, mínimo entero no negativo dentro de int32, gravabilidad booleana obligatoria. Defaults de históricos: textos vacíos (sin inventar una clasificación), mínimo 0, gravado true, conservando los importes y cálculo anterior.

`POST /api/productos` y `PUT /api/productos/:id` conservan sus campos actuales y aceptan `marca`, `categoria`, `ubicacion`, `stockMinimo`, `gravado`. Al editar, omitir un atributo nuevo conserva su valor anterior para que un cliente anterior no lo borre. Un valor explícito inválido no se interpreta como omisión. La operación conserva los mismos bloqueos, ajuste de inventario, versión e idempotencia. El snapshot expone los valores confirmados y la versión.

El campo `gravado` debe tener efecto real en el cálculo de ventas. Los precios existentes siguen incluyendo ITBIS: precio 118, tasa 18%, gravado true produce base 100 e ITBIS 18; gravado false produce base 118 e ITBIS 0. El total sigue siendo 118. No modificar documentos históricos ni asignar NCF. El cálculo, validaciones de centavos y límites permanecen en el servidor.

## Respaldos y esquema

Exportar un formato relacional v3 que incluya los cinco atributos. No llamar v2 a una estructura incompatible. Importar v3 de forma estricta; conservar la importación v2 convirtiendo sus productos a los defaults anteriores antes de insertar. Conservar importación legacy, archivo previo a restauración, rotación de `databaseId`, revisión, restricciones, movimientos y rollback. No aceptar una tabla o columna desconocida como SQL.

Actualizar `schema.sql` como referencia completa para instalaciones nuevas y añadir una migración en orden posterior a las ya aplicadas. No editar archivos de migraciones existentes. Probar tanto instalación nueva como actualización de un esquema anterior con datos en PostgreSQL desechable, con el rol `pos_app` para operaciones. No aplicar cambios ni pruebas al Supabase del negocio en esta entrega.

## Integración de la interfaz

Separar el contexto/hook de datos y las rutas compartidas de las semillas. La entrada de referencia continúa con sus fixtures; la entrada operativa nunca importa `PRODUCTS`, `SEED_*`, un cajero ficticio ni estadísticas de muestra como fallback de un error.

El adaptador transforma producto confirmado a `{id,version,code,name,brand,category,location,minStock,taxable,cost,stock,prices:{p1,p2,p3}}`, sin fabricar IDs de servidor. La hoja conserva la versión y `databaseId` del comienzo de edición, no los reemplaza silenciosamente con una revisión nueva mientras el usuario escribe. Un producto nuevo recibe su ID del servidor; la solicitud recibe un UUID idempotente creado una sola vez.

Crear/editar/desactivar devuelven promesas y solo muestran éxito/cierre después de confirmar. Errores conservan hoja, valores y carrito; mientras se envía, impedir doble envío. Una respuesta perdida conserva exactamente ruta, cuerpo y clave para reintentar, y no genera otra clave al actualizar la pantalla. No permitir ventas o caja en memoria desde la entrada operativa durante la integración.

## Evidencia de aceptación

- Crear/editar todos los atributos, recargar y comprobar valores reales. Eliminar lógicamente conserva detalles históricos.
- Dos ediciones de la misma versión: una confirma y la otra devuelve conflicto sin sobrescribir la primera ni vaciar el borrador.
- Un reintento concurrente/tras perder respuesta con la misma clave produce una sola fila y un solo movimiento. Reutilizarla con otro cuerpo se rechaza.
- Valores booleanos incorrectos, mínimo fraccionario/negativo/fuera de rango, textos excesivos y campos de dinero inválidos se rechazan atómicamente.
- Productos gravados/exentos calculan exactamente el total indicado arriba, sin confiar en impuestos o totales enviados por el cliente.
- Respaldo v3 hace roundtrip con atributos, filas inactivas e historial; v2/legacy siguen importando; restauración inválida hace rollback íntegro y no cambia generación.
- Un cambio de `databaseId` impide guardar un borrador de otra generación. No se cambia el identificador de una solicitud incierta para intentar forzarla.
- Comparar el Inventario integrado con la misma referencia/datos/viewport. Conservar los componentes, colores y distribución; el cambio es de persistencia y estados reales, no un rediseño.

La finalización de esta entrega no prueba ventas equivalentes a Polymet, trabajo offline, sincronización ni instalador Windows. Esas obligaciones siguen abiertas en la especificación general.
