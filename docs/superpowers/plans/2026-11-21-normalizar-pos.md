# Implementación del POS relacional

**Objetivo:** sustituir la persistencia global JSON por tablas y operaciones transaccionales completas.
**Spec:** `docs/superpowers/specs/2026-11-21-pos-relacional.md`.
**Tecnologías:** Node.js, pg, PostgreSQL 17, JavaScript nativo, pnpm; no añadir framework ni ORM.

- [x] Esquema y migración con respaldo, conversión de históricos, integridad, rol restringido y pruebas PostgreSQL.
- [x] API de operaciones y dinero exacto, concurrencia, idempotencia, migrador explícito y pruebas API.
- [x] Interfaz con IDs, operaciones específicas, edición versionada, reintentos, respaldos y pruebas DOM.
- [x] Revisión independiente e integración; corregir todos los defectos importantes.
- [x] Aplicar con respaldo a Supabase, provisionar rol de aplicación, reiniciar servidor y verificar lecturas/escrituras controladas.
- [x] Documentación actualizada y pruebas completas. Sincronización de GitHub comprobada al cerrar el trabajo.

## Registro

Respaldo remoto previo: `supabase/.temp/respaldo-previo-relacional-20261121.json` (ignorado). Estado comprobado: revisión 1, 1 cliente, 0 productos/suplidores/ventas/compras. No se requiere copiar información del proyecto educativo.

La publicación web queda como trabajo posterior a esta corrección de datos. No se ampliará el alcance a fiscalidad ni módulos que la interfaz actual no implementa.

Verificación final: `pnpm test`, 50 pruebas aprobadas. La revisión independiente reprodujo y verificó las correcciones de impuestos históricos fraccionarios, reintentos tras caducar sesión, borradores tras restauración y snapshots concurrentes. No quedan hallazgos materiales abiertos.

Migración `20261121190000` aplicada al proyecto `uzbranexwuzcwkxaifsq`: 9 tablas del negocio con RLS. Conservados 1 cliente y las colecciones vacías existentes, revisión 1. Copia normalizada posterior en `supabase/.temp/respaldo-relacional-20261121.json` (ignorada). Lectura y escritura con rollback verificadas como `pos_app`, sin CREATE en public ni acceso al archivo anterior. Credencial administrativa separada en `.env.migrations`; no se carga al iniciar el servidor web.

Servidor local reiniciado: `/health` y `/api/state` responden 200; la antigua escritura global responde 410. La comprobación del navegador integrado no pudo ejecutarse porque su host no estaba disponible; los flujos se verificaron mediante DOM y API. La instalación en un teléfono real requiere la dirección HTTPS definitiva.
