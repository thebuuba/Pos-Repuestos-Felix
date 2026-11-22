# Corrección de sincronización y recuperación

Autorización: «corrige corrige», después de la auditoría de solo lectura del 22 de noviembre de 2026.

Objetivo: eliminar los bloqueos demostrados sin perder operaciones, duplicar documentos ni relajar los importes, las existencias o la identidad autenticada.

## Diseño

Se conservan Windows/SQLite/PGlite y la API transaccional compartida. La red sale de la sección serial del motor local; la captura de operaciones, los recibos y la adopción de datos siguen protegidos. Una descarga nunca reemplaza nuevas operaciones locales.

Las ventas pueden conciliar actividad concurrente del mismo turno abierto únicamente si la transacción conserva el efecto exacto ya confirmado localmente y las existencias actuales permiten la venta. Aperturas, cierres, cambios de configuración y documentos incompatibles mantienen sus controles. Los sobres enviados siguen inmutables e idempotentes.

Los conflictos incompatibles tienen revisión explícita: el servidor retira el flujo del dispositivo bajo su bloqueo transaccional y rechaza cualquier envío posterior de ese flujo. No puede retirarlo si alguno de los pendientes ya fue confirmado sin recuperar antes su recibo. Después del acuse, Windows archiva originales, sobres y estado local, adopta el servidor y abre un flujo nuevo. Las operaciones archivadas no se presentan como contabilizadas ni desaparecen del historial. Una respuesta perdida conserva la intención y se recupera idempotentemente.

En PWA, una solicitud de una generación anterior se archiva sólo tras revisión expresa y lectura confirmada de la generación actual, mediante una transacción IndexedDB que conserva el paquete completo. No se reenvía a la base nueva.

Las consultas condicionales reducen transferencias; los fallos de lecturas antiguas no sustituyen un estado confirmado más reciente. La selección de cookies respeta nombre y expiración; una renovación automática rechazada no puede borrar una cookie más reciente mediante una respuesta tardía. La vigencia offline sólo se renueva con identidad autenticada.

## Trabajo y validación

- [x] PWA: errores/401 tardíos, ETag de escritura, archivo de pendientes de otra base, recargas automáticas en segundo plano. Pruebas de navegador/IndexedDB con base desechable.
- [x] Autenticación: cookies múltiples/ajenas/borrado y renovación concurrente con tolerancia real de Supabase. Pruebas simuladas sin credenciales reales.
- [x] Windows: red fuera de serial, adopción protegida, reutilización del ejecutor para importación transaccional, reconstrucción si el estado local pudo divergir, ETag local, vigencia autenticada, archivo durable e idempotente. Pruebas SQLite/PostgreSQL desechables y reinicios.
- [x] Servidor: bootstrap condicional, ETag en respuestas de escritura, ventas concurrentes exactas, retiro transaccional de flujos y cursor de secuencias por clave indexada existente (sin migración real).
- [x] Integración: suite completa y repetición de grupos afectados, inspección visual de revisión en móvil/escritorio y claro/oscuro, compilación web, publicación Worker e instalador Windows. Resultados y límites en `docs/validacion-sincronizacion-2026-11-22.md`.

No se ejecutan escrituras de prueba ni migraciones en la base real. Se mantiene la rama `feat/sistema-unificado-offline` y se conservan los cambios previos. La publicación y la actualización instalada se verifican por separado de las pruebas.
