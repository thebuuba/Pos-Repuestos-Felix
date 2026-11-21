# Adaptación a PostgreSQL

**Objetivo:** sustituir Firebase por una API Node.js que permita elegir PostgreSQL local o Supabase al iniciar.

**Diseño:** conservar la interfaz y el formato JSON de los respaldos. Una tabla privada `pos_privado.estado` almacena el estado en JSONB y una revisión. Cada escritura usa una actualización condicional atómica: una sesión desactualizada recibe HTTP 409 y conserva su carrito. La conexión y el certificado SSL viven en variables del servidor. Local y Supabase son bases independientes; no se sincronizan automáticamente.

**Límites:** servidor accesible únicamente por localhost, sin publicación ni autenticación nueva. Esta primera adaptación guarda un documento completo; tablas relacionales por entidad y sincronización quedan fuera del cambio.

## 1. Persistencia y API

- [x] Crear pruebas de integración que arranquen PostgreSQL temporal y comprueben persistencia tras reconexión, escritura concurrente, rechazo de datos inválidos y protección de archivos privados.
- [x] Ejecutarlas y observar el fallo antes de implementar.
- [x] Añadir `state.js` para valores iniciales y validación, `schema.sql` para la tabla privada y `server.js` para GET/PUT `/api/state` y archivos públicos permitidos.
- [x] Usar `pg`, consultas parametrizadas, límite de 10 MB y SSL con validación de certificado para conexiones remotas.

## 2. Interfaz y respaldos

- [x] Extraer el JavaScript a `app.js` y reemplazar Firebase por fetch.
- [x] Esperar confirmación al guardar antes de vaciar formularios/carritos o imprimir. Ante fallo, recuperar el último estado confirmado y conservar los datos pendientes para reintentar.
- [x] Corregir referencias a clientes/facturas, eliminación de líneas y lectura del archivo de respaldo; registrar compras con suplidor y número.
- [x] Validar cantidades y stock acumulado; representar textos guardados sin interpretarlos como HTML.

## 3. Configuración y comprobación

- [x] Añadir scripts de inicio para local y Supabase, archivos de ejemplo sin secretos y README en español con instalación, cambio de destino y migración por respaldo.
- [x] Ejecutar pruebas contra PostgreSQL real y comprobar los flujos de la interfaz.
- [x] Informar qué queda pendiente de las credenciales reales de cada base.

## Resultado verificado

20 pruebas pasan con PostgreSQL temporal real y DOM de interfaz. La revisi?n adicional cerr? cambios de base desde pesta?as antiguas y par?metros de conexi?n que pod?an alterar SSL. No se probaron credenciales reales locales ni Supabase. La comprobaci?n visual en Chrome fue bloqueada por la herramienta al no poder verificar su URL.
