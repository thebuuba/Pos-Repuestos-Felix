# Comprobación de conexión al arrancar Windows — 23 de noviembre de 2026

## Cambio

El servidor local inicia una comprobación remota en cuanto empieza a escuchar. Antes esperaba el primer intervalo de 30 segundos. Mientras consulta desde un estado sin conexión, la interfaz muestra «Comprobando…» con un indicador animado. Las operaciones locales siguen disponibles durante esa espera.

El estado transitorio se calcula al consultar el estado del servidor local, sin reemplazar el estado persistente del motor. Una conciliación pendiente, un conflicto o una sesión rechazada conservan su aviso. Se mantienen el reintento automático cada 30 segundos y el sondeo de la interfaz cada 15 segundos.

«Última sincronización» conserva la última confirmación real: no avanza al iniciar un intento ni cuando falla la red. Una confirmación de que no hay cambios también actualiza la hora. La interfaz recoge esa confirmación automáticamente en su siguiente sondeo, sin pulsar «Sincronizar». El formato continúa usando la zona `America/Santo_Domingo` y precisión de minutos.

## Validación

Las regresiones de arranque inmediato y del estado de comprobación fallaron antes de la corrección. La revisión del código detectó además que una conciliación pendiente podía dejar un estado transitorio permanente; una prueba reprodujo el problema y la implementación final conserva ese estado de revisión.

El siguiente conjunto terminó con **35 pruebas aprobadas, ninguna fallida**, en 159,3 segundos:

```powershell
pnpm exec node --test --test-concurrency=3 tests/desktop-recovery.test.js tests/desktop-auth-revocation.test.js tests/desktop-concurrency.test.js tests/desktop-status.test.js tests/desktop-http.test.js tests/desktop-engine.test.js
```

Incluye fallo inicial de red y recuperación automática, respuesta sin cambios, acceso local durante la espera, revisión pendiente, cierre durante una consulta, revocación de sesión, ventas offline, reinicio y respuestas perdidas sin duplicación. Se usaron PostgreSQL y SQLite desechables y respuestas remotas controladas; no se escribieron datos de prueba en producción.

Después de preparar la versión 1.2.1 se repitió el mismo conjunto: **35/35 pruebas aprobadas**, en 150,5 segundos. Registro: `dist/verification/startup-sync-release-tests.log`.

Se inspeccionaron ocho capturas del diálogo «Comprobando…» en 320, 390, 768 y 1440 px, en claro y oscuro. No se observó desbordamiento horizontal. Evidencia local: `dist/verification/startup-sync/checking-*.png`. Esta revisión cubre el componente modificado; no constituye una nueva comparación visual completa contra Polymet.

## Compilación y entrega

- `pnpm build`: aprobado.
- `pnpm prepare:windows`: aprobado; payload de 428 archivos y 115,9 MiB.
- `pnpm exec node scripts/build-windows.mjs --verify`: aprobado.
- El servidor local y la entrada HTML del payload coinciden por SHA-256 con los archivos finales del proyecto y la compilación.
- Revisión independiente del diff final: sin hallazgos bloqueantes.

La entrega usa la versión **1.2.1**, sobre la 1.2.0 existente, y conserva la rama `feat/sistema-unificado-offline`. No se sustituyeron los archivos de la aplicación instalada ni se ejecutó el instalador sobre los datos del negocio. Estas pruebas no garantizan la disponibilidad de internet ni eliminan la demora de una consulta remota o del sondeo de la pantalla.
