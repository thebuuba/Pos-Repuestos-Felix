# Inventario y Excel del negocio

Solicitud vigente: retirar los datos de demostración y concentrar el trabajo en Inventario. El usuario enviará el Excel. Las nuevas pantallas de clientes/configuración y el resto del plan anterior quedan pendientes.

## Entrada sin demostración

- `pnpm build` y `pnpm build:design` generan `dist/operational/` desde el proveedor de la API real. Abrir `/` conduce a `/inventario`.
- Node sirve esa compilación al ejecutar los comandos `start`. Requiere compilar primero y tener el esquema/configuración correspondientes; el arranque no aplica migraciones.
- `pnpm preview` y `pnpm preview:design` sirven la misma interfaz como vista estática. Una API ausente muestra el estado de conexión pendiente, sin sustituir datos por ejemplos ni presentar cero como una lectura confirmada.
- La referencia con muestras permanece aislada para las pruebas visuales y requiere el comando explícito `preview:reference`. No se publica como POS ni se carga en PostgreSQL.

La lectura del servicio conectado el 21 de noviembre de 2026 devolvió **cero artículos**. No se borraron datos del negocio ni se ejecutaron migraciones o escrituras de prueba en su base. Los productos que mostraba la vista de Polymet procedían de la demostración en memoria.

El servicio existente no se reinició contra el esquema nuevo. Las migraciones de esta rama siguen pendientes de aplicación controlada en el negocio; cambiar la entrada de interfaz no acredita esa activación ni un despliegue.

## Archivo pendiente

Todavía no se recibió el Excel. El mapeo se preparará con sus hojas y encabezados reales, conservando códigos y ceros iniciales, y revisando existencias, costos, precios, duplicados y celdas calculadas. Los datos opcionales y cualquier convención tributaria ambigua se resolverán a partir del archivo antes de escribir.

La importación debe presentar el resultado de la revisión antes de modificar datos del negocio, conservar históricos y registrar los movimientos de inventario que correspondan. No implica vaciar tablas ni convertir el archivo en ventas o compras ficticias. El archivo y los datos del negocio no se incluirán en Git ni en recursos públicos.

La implementación de inventario ya usa operaciones transaccionales con versiones, idempotencia y confirmación explícita del servidor. La solicitud incierta mantiene su UUID/cuerpo original tras recargar o cambiar de pestaña. Esto no equivale a una importación de Excel implementada ni al modo Windows offline.

## Verificación

`pnpm test`: **159 aprobadas, cero fallidas y cero omitidas**, con concurrencia limitada a cuatro archivos para las bases y navegadores de prueba. `pnpm build` compiló la entrada operativa; la compilación Worker también terminó en seco, sin publicar. Una prueba del arranque real de Node, con PostgreSQL desechable y rol restringido, verificó el inicio en Inventario, cero artículos iniciales y persistencia de un artículo de prueba tras recargar. La prueba se cerró junto con su base temporal.
