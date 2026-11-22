# Inventario y Excel del negocio

Solicitud vigente: retirar los datos de demostración y concentrar el trabajo en Inventario. El usuario enviará el Excel. Las nuevas pantallas de clientes/configuración y el resto del plan anterior quedan pendientes.

## Entrada sin demostración

- `pnpm build` y `pnpm build:design` generan `dist/operational/` desde el proveedor de la API real. Abrir `/` conduce a `/inventario`.
- El servicio Node conserva `public/` durante esta preparación. Activar la nueva compilación exige preparar el esquema y resolver la caché de la PWA anterior; no se cambia la interfaz de los clientes existentes de forma automática.
- `pnpm preview` y `pnpm preview:design` sirven la misma interfaz como vista estática. Una API ausente muestra el estado de conexión pendiente, sin sustituir datos por ejemplos ni presentar cero como una lectura confirmada.
- La referencia con muestras permanece aislada para las pruebas visuales y requiere el comando explícito `preview:reference`. No se publica como POS ni se carga en PostgreSQL.

La lectura del servicio conectado el 21 de noviembre de 2026 devolvió **cero artículos**. No se borraron datos del negocio ni se ejecutaron migraciones o escrituras de prueba en su base. Los productos que mostraba la vista de Polymet procedían de la demostración en memoria.

El servicio existente no se reinició contra el esquema nuevo. Las migraciones de esta rama siguen pendientes de aplicación controlada en el negocio; cambiar la entrada de interfaz no acredita esa activación ni un despliegue.

Los demás módulos siguen pendientes. El enlace «Panel» actúa como acceso de inicio a Inventario en esta etapa; no presenta un panel con estadísticas de muestra.

## Archivo pendiente

Todavía no se recibió el Excel. El mapeo se preparará con sus hojas y encabezados reales, conservando códigos y ceros iniciales, y revisando existencias, costos, precios, duplicados y celdas calculadas. Los datos opcionales y cualquier convención tributaria ambigua se resolverán a partir del archivo antes de escribir.

La importación debe presentar el resultado de la revisión antes de modificar datos del negocio, conservar históricos y registrar los movimientos de inventario que correspondan. No implica vaciar tablas ni convertir el archivo en ventas o compras ficticias. El archivo y los datos del negocio no se incluirán en Git ni en recursos públicos.

La implementación de inventario ya usa operaciones transaccionales con versiones, idempotencia y confirmación explícita del servidor. La solicitud incierta mantiene su UUID/cuerpo original tras recargar o cambiar de pestaña. Esto no equivale a una importación de Excel implementada ni al modo Windows offline.

## Verificación

Las pruebas de navegador usan la compilación operativa junto con la API y PostgreSQL desechable: verifican entrada en Inventario, cero artículos iniciales y persistencia tras recargar, además de edición/baja, conflictos y reintentos. La prueba sin API comprueba que la raíz también lleva a Inventario y conserva el estado de conexión pendiente, sin una lectura ficticia de cero existencias. El comando de pruebas limita la concurrencia a cuatro archivos para las bases y navegadores temporales. La compilación Worker se realiza en seco, sin publicar.

Validación final: `pnpm test`, **160 aprobadas, cero fallidas y cero omitidas**; `pnpm build`, compilación operativa aprobada. La referencia visual permanece separada mediante sus comandos explícitos.
