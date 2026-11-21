# Catálogo de Polymet conectado: plan de implementación

> **For agentic workers:** usar subagent-driven-development para las tareas independientes y revisión por tarea. Conservar la rama elegida por el usuario; no crear otro checkout ni modificar `main`.

**Objetivo:** conectar Inventario a PostgreSQL con los componentes aprobados, guardado confirmado, versiones y recuperación durable de solicitudes inciertas. Este plan no reduce el alcance del sistema completo; las otras funciones y plataformas permanecen en la especificación general.

**Especificación:** `docs/superpowers/specs/2026-11-21-catalogo-polymet-conectado.md`.

**Base:** `d12d2ec`. Ya existen la migración de atributos, los respaldos v3 compatibles y 74 pruebas aprobadas. No repetir esos cambios. No aplicar migraciones a Supabase real.

## Restricciones comunes

- Reutilizar diseño, CSS, fuente, componentes y navegación. Mantener `frontend/reference.jsx` como referencia de las doce pantallas con fixtures; jamás usarlos como fallback operativo.
- pnpm y lockfile; ninguna instalación o migración de negocio en esta etapa. Pruebas con PostgreSQL desechable y Edge en perfil aislado.
- Importes de API exactos, ID y versión de servidor, `databaseId` fijado al abrir el borrador. Un error no cierra ni vacía el formulario.
- Una operación incierta conserva UUID/ruta/cuerpo originales incluso tras cerrar/reabrir. Registrar antes de enviar; solo confirmar al recibir resultado válido. No ofrecer operaciones offline confirmadas antes del almacenamiento y reglas locales de Windows.
- La restauración global no pertenece a la cola de operaciones ordinarias.
- Las rutas operativas todavía sin servicio no ejecutan callbacks de demostración ni muestran guardados ficticios. No publicar esta integración parcial como sistema terminado.
- No cambiar ni leer credenciales. No controlar pestañas personales.

### Task 1: lectura condicional y assets del frontend compartido

**Propietario:** implementador HTTP. Solo `src/pos/store.js`, `src/http/app.js`, `src/server.js` y prueba nueva `tests/state-cache.test.js`.

**Interfaz requerida:**
- `GET /api/state` responde con el snapshot actual y `ETag`; acepta `If-None-Match` y responde 304 sin cuerpo cuando coincide. No cambiar el cuerpo JSON de las respuestas 200 existentes.
- Para un 304, ejecutar solo una consulta de versión/identidad, sin descargar las nueve tablas, abrir una transacción ni tomar bloqueos de mantenimiento. Validar acceso/origen/transporte antes de consultar datos. El snapshot 200 sigue siendo coherente y transaccional.
- El tag identifica versión de representación, `databaseId`, `revision` y `databaseLabel`. No incluye credenciales. Una edición, restauración o cambio de etiqueta invalida el tag. Nunca aplicar caché SQL/edge a las escrituras.
- Mantener contrato público `readSnapshot(pool,label,backup=false)`; una ampliación opcional para petición condicional es válida. No duplicar las reglas de snapshot.
- `createApp(pool,{assetsDirectory,...existingOptions})` acepta una URL de carpeta compilada. El valor por defecto sigue siendo `public/`. La lista de assets permitidos sigue siendo cerrada.
- Servir `/inventario` y las otras rutas conocidas de Polymet con `index.html`, con la misma protección que `/`. No convertir rutas desconocidas/privadas en un fallback abierto.
- Añadir únicamente assets públicos conocidos: `/assets/fonts/inter-latin-wght-normal.woff2` (`font/woff2`) y `/assets/Inter-OFL.txt`. Conservar los existentes.

**Verificación:**
- [x] Escribir y ver fallar prueba: GET inicial con tag, 304 sin cuerpo con una consulta, edición devuelve nuevo tag/200 y conserva snapshot; restauración invalida generación/tag.
- [x] Probar auth antes del 304; fonts binarias/HEAD y navegación profunda protegida; rutas privadas permanecen 404.
- [x] Implementar y ejecutar pruebas focalizadas y compatibilidad HTTP/Worker con PostgreSQL temporal. No editar pruebas ajenas.

### Task 2: cliente persistente, contexto y entrada operativa

**Propietario:** implementador de datos. Archivos nuevos bajo `frontend/src/data/`, shell/rutas/entrada y scripts de compilación; refactor de imports en componentes salvo los tres archivos de Task 3. Puede modificar `AppSidebar`, `TopBar`, proveedor de referencia, referencia y `package.json` scripts. No tocar HTTP ni las tres vistas/formularios de Task 3.

**Interfaces a producir:**
- `frontend/src/data/pos-context.jsx`: exportar `PosStoreContext` y `usePosStore()`. Extraer el contexto del store de demostración; ambos proveedores usan la misma instancia. Componentes importan el hook directamente del contexto, sin arrastrar semillas. Extraer usos de `newId` de módulos demo a un helper sin semillas usando `crypto.randomUUID()`.
- `frontend/src/data/pos-client.js`: exportar `createPosClient()`, que produce `getState()` (objeto estable hasta un cambio), `subscribe(listener)`, `reload()`, `writeOperation({method,path,payload,databaseId})`, `retryPending()`, `dispose()`. Estado: `{snapshot,pending,busy,connection,error,lastSync}`. Snapshot contiene la respuesta real, sin datos sintéticos.
- `pending`: null o registro `{id,method,path,body,databaseId,status}`. `body` es el JSON original serializado, `id` la clave UUID; se guarda durablemente en IndexedDB antes de iniciar fetch. Una sola solicitud ordinaria incierta bloquea nuevas operaciones; reintentar exactamente el mismo cuerpo reutiliza el registro. Arbitrar creación entre pestañas mediante transacción IndexedDB. No guardar contraseñas, tokens ni headers de autenticación.
- Enviar solo al mismo origen, con credenciales del navegador; no seguir redirecciones de escrituras. Persistir estado de envío antes del request. Esperar `transaction.complete`, no solo `request.success`, antes de enviar. Fallo de almacenamiento impide la escritura de red.
- Una primera respuesta de error definitiva puede liberar la solicitud; un fallo de red/5xx/respuesta 200 inválida la conserva. Una recuperación tras respuesta perdida no se descarta por un 401 posterior: el intento original pudo confirmar. Una generación distinta conserva/bloquea la solicitud sin reescribir su `databaseId`.
- La recarga aplica snapshots de manera monotónica por revisión dentro de la generación; descarta respuestas tardías de generaciones anteriores. Una escritura antigua no restaura en pantalla una generación reemplazada. Usar tag condicional en recargas, 304 confirma conexión sin borrar estado.
- Proveedor operativo con `runtime` que añade `databaseId`, `revision`, `mode:'online'`, `reload` y `retryPending` al estado del cliente. `saveProduct(p)` y `deleteProduct(p)` devuelven promesas; mapear todos los atributos/ID/version sin perder nada. Métodos reciben producto con `databaseId` del borrador. Eliminar también recibe producto/versión capturados, no buscar una versión nueva para forzar la operación.
- `products` usa `{id,version,databaseId,code,name,brand,category,location,minStock,taxable,cost,stock,prices:{p1,p2,p3}}`. No fabricar categoría/marca para datos vacíos. Las fórmulas no persistidas son una colección vacía, no `SEED_FORMULAS`.
- Extraer shell/rutas para que referencia y operativo compartan componentes. La entrada operativa habilita Inventario; otros módulos todavía incompletos no usan el store demo. Un estado de módulo no habilitado debe ser honesto y permitir volver a Inventario; el alcance final sigue incluyendo todos.
- AppSidebar obtiene avatar del proveedor (demo solo en proveedor de referencia); no mostrar cajero/caja/cuentas inventados en operativo. TopBar actualiza de verdad y muestra estado real de servicio. Una notificación de solicitud pendiente permite reintentar al recargar; no estorba el diseño cuando no hay error/pendiente. No desplegar ni prometer instalación PWA/offline aquí.
- `scripts/build-operational.mjs`: exportar `buildOperational(outdir)`, salida `index.html`, `app.js`, `styles.css`, `assets/fonts/inter-latin-wght-normal.woff2`, `assets/Inter-OFL.txt`; puede copiar iconos/manifiesto/imagen del negocio. La entrada es `frontend/operational.jsx`. Mantener `build:worker` con `public/` hasta integrar todo.

**Verificación:**
- [x] Prueba nueva `tests/pos-client.test.js` con IndexedDB real en Edge y servicios/base desechables: pérdida de respuesta después de COMMIT, recargar cliente y reintentar mismo UUID/cuerpo => una fila/movimiento; almacenamiento fallido => cero escrituras; conflicto preserva borrador; cambio de generación bloquea pendientes; respuesta tardía no regresa revisión/generación.
- [x] Comprobar que el grafo/bundle operativo no contiene `seed-data.js`, proveedor demo ni datos demo; no basta con un comentario. No cambiar el CSS aprobado para resolver la persistencia.
- [x] Pasar `pnpm test:design`, sin requests externos nuevos. No hacer commit/push; informar archivos, contratos y limitaciones al controlador.

### Task 3: formulario y confirmación asíncronos

**Propietario:** implementador de UI. Solo `frontend/src/polymet/pages/inventory-page.jsx`, `components/product-form-sheet.jsx`, `components/confirm-dialog.jsx`; prueba nueva `tests/catalog-forms.test.js` y su fixture si necesita. No modificar datos/HTTP/otros módulos.

**Consumir:** `usePosStore` desde `../../data/pos-context.jsx` en InventoryPage. El proveedor de referencia sigue exportando el hook antiguo durante la transición si se necesita, pero el componente final usa contexto sin semillas. Store operativo provee `runtime` opcional con `databaseId,pending,busy,reload,retryPending`; el demo no necesita runtime. `saveProduct(p)` y `deleteProduct(p)` pueden devolver promesa; pasar objeto producto para eliminar, conservando ID/version/generación. El controlador de datos hará compatible el proveedor demo con este contrato.

**Comportamiento:**
- [x] Crear una prueba que falla antes del cambio: un guardado diferido no muestra éxito/cierra hasta resolver; rechazo conserva los valores/hoja. Doble clic solo envía una vez.
- [x] Capturar `databaseId` al abrir nuevo/editar, junto con versión de producto. Incluirlos en `onSave`, sin renovarlos al llegar un snapshot de otra caja mientras el usuario escribe. Nuevo artículo usa identidad local UUID, nunca un supuesto ID de servidor.
- [x] Validar dinero finito de hasta 2 decimales y cantidades/mínimo enteros dentro de int32; no truncar silenciosamente 1.5, negativos o cantidades gigantes con Math.max. Campos vacíos/precios opcionales conservan el comportamiento de autocompletado aprobado; no convertir un cero explícito en otro precio.
- [x] Esperar `saveProduct` antes de toast/cerrar. Campos/botones bloqueados mientras se envía; preservar borrador/error. Si error expone `uncertain:true`, bloquear modificación del cuerpo y ofrecer reintento del mismo guardado. No generar un UUID nuevo de operación desde la UI: lo administra el cliente.
- [x] No aplicar fórmulas inventadas cuando `formulas` está vacío; permitir precios manuales y deshabilitar cálculo no configurado sin cambiar la distribución de la referencia cuando hay fórmulas.
- [x] ConfirmDialog no se autocierra por Radix Action antes del resultado asíncrono. Evitar doble confirmación, conservar errores y foco; los usos sincrónicos existentes deben seguir funcionando.
- [x] Asignar etiquetas accesibles a los campos tocados sin cambiar la apariencia (usar ID estable); mantener controles de precio/categoría y sus nombres.
- [x] Compatibilidad con la referencia: `await` admite callbacks sincrónicos, éxito luce igual; cambios visibles nuevos solo en estados de envío/error. No tocar fuente/paleta/espaciado ni reescribir el formulario con otro componente.

### Task 4: integración, revisión y continuación

**Propietario:** controlador.

- [x] Probar `buildOperational` con `createApp(pool,{assetsDirectory})` sobre PostgreSQL temporal en `tests/catalog-runtime.test.js`: alta con todos los campos, recarga, edición obsoleta, respuesta perdida/recarga/reintento, baja que conserva historial, errores de formulario y ruta privada. Usar la app renderizada, no solo métodos aislados.
- [x] Revisar cada tarea con agente fresco, corregir hallazgos importantes y verificar el diff real. Ejecutar suite completa, compilaciones, comparar Inventario con datos equivalentes y registrar alcance/limitaciones.
- [x] Actualizar `docs/estado-sistema-unificado.md`, guardar commits en la rama y mantener `main`/base real intactos. No marcar completo el objetivo general: continuar con configuración/contactos, ventas/caja/cuentas, modo local/sincronización, PWA, Windows y publicación.

## Cierre de la entrega

Revisiones por tarea y revisi?n general aprobadas. Suite completa: 124/124; compilaciones de referencia, operativo y Worker correctas; seis pares del contenido principal de Inventario coinciden byte por byte con Polymet. Evidencia en `docs/design/validacion-catalogo-2026-11-21.md`. Se conserva la rama `feat/sistema-unificado-offline`; el objetivo general contin?a con contactos/configuraci?n, los dem?s m?dulos y las plataformas pendientes. Sin migraciones ni pruebas sobre la base del negocio.

Durante el cierre aparecieron cambios concurrentes en `wrangler.jsonc`. Se preservaron fuera de los commits de esta entrega; la cuenta se verific? en modo lectura y no se public? el Worker.
