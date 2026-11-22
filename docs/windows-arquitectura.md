# Windows, escáner y PWA

Implementación del alcance aprobado para `feat/sistema-unificado-offline`, 22 de noviembre de 2026. Se conserva una interfaz Polymet para web, PWA y Windows. El lector físico se trata como teclado USB con terminador Enter; la cámara se abre mediante una acción explícita. La marca del lector no es necesaria para ese modo. El equipo indicado tiene Windows 10 u 11; el instalador preparado es x64.

## Persistencia de Windows

Tauri aloja la interfaz compilada en WebView2. Un proceso Node incluido atiende exclusivamente en `127.0.0.1`; el primer puerto asignado queda guardado y se reutiliza al reiniciar para conservar el origen del diario IndexedDB. Si está ocupado, el arranque falla en lugar de abrir otro origen y perder acceso a solicitudes inciertas. El proceso se cierra al terminar la aplicación. Los datos viven en `%LOCALAPPDATA%\RepuestosFelix\POS`, fuera de OneDrive. El bloqueo de apertura impide dos procesos sobre la misma carpeta.

SQLite es la autoridad durable. Usa WAL y `synchronous=FULL`; conserva tablas relacionales, recibos, identidades local/remota y operaciones pendientes. Los importes NUMERIC permanecen como texto exacto. Cada confirmación se devuelve después de confirmar, en una sola transacción SQLite, los cambios relacionales y su operación pendiente.

PGlite funciona sólo en memoria y ejecuta las mismas migraciones y reglas SQL del servidor. Al iniciar se reconstruye desde SQLite. No se depende del sistema de archivos de PGlite para durabilidad. Si falla la escritura SQLite, se descarta el resultado en memoria y se reconstruye el estado confirmado.

## Sincronización

El primer acceso requiere conexión y una cuenta autorizada. Descarga un respaldo consistente mediante `/api/sync/bootstrap`, sin escribir datos de demostración. El servidor transaccional sigue siendo quien confirma las operaciones compartidas.

Las operaciones locales llevan UUID, secuencia por cuenta/equipo/generación de base, instante original, versiones observadas y resultado exacto. Antes de enviarlas se congela su sobre durable. `/api/sync/operations` valida el resultado y las versiones dentro de la misma transacción del negocio. Una respuesta perdida se reintenta con el mismo UUID y sobre; no crea una segunda operación.

Los IDs locales son estables y tienen correspondencia explícita con los remotos, incluso cuando las secuencias del servidor son distintas. La descarga sólo sustituye la proyección cuando no hay operaciones pendientes. La caja comprueba también su última actividad; un cambio concurrente produce un conflicto visible y conserva las operaciones locales. No hay resolución automática que cambie existencias, importes o turnos de caja. Los pendientes pueden revisarse y exportarse para conciliación.

Los recibos locales muestran una referencia UUID y no asignan un NCF. La existencia de una confirmación local no se presenta como confirmación remota.

## Acceso y límites

Las sesiones del servidor se protegen con DPAPI para el usuario de Windows. Las contraseñas no se guardan: la comprobación offline usa scrypt con sal. El acceso offline dura como máximo 30 días desde una autenticación online; una revocación observada en el servidor invalida el acceso local. Los cambios de nombre/contraseña requieren conexión y un nuevo inicio de sesión.

El puerto local exige Host exacto, origen propio para mutaciones, sesión y JSON. No hay comandos Tauri expuestos a la página. El paquete contiene sólo código, recursos públicos, Node y PGlite; no incluye `.env`, credenciales ni bases del negocio.

La PWA registra operaciones conectada; su caché contiene únicamente recursos públicos. Sin conexión avisa de datos desactualizados y no inventa una confirmación. La persistencia operativa offline descrita aquí corresponde a Windows. La restauración administrativa se realiza en el servidor cuando no hay pendientes.

## Verificación prevista

1. Lectura exacta USB, cámara, ceros iniciales, existencias y cierre de cámara.
2. Instalabilidad PWA, aislamiento de caché, reconexión, actualización sin recarga forzada y visuales claro/oscuro.
3. SQLite: reinicio, terminación abrupta, fallo de disco, respuesta perdida, IDs distintos y conflicto de caja, con PostgreSQL desechable.
4. Gateway: autenticación online/offline, protección del origen, revocación, bloqueo de instancia y navegación real.
5. Suite completa, compilación Worker, instalador NSIS y apertura del programa instalado.
6. Publicación autorizada y comprobaciones de lectura; no operaciones de prueba en Supabase real.

La verificación automatizada de un código de prueba no sustituye probar el lector USB y la cámara del teléfono del negocio. Un instalador generado tampoco demuestra por sí solo todos los casos anteriores.
