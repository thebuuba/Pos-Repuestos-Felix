# Estado del sistema unificado

Actualizado el 21 de noviembre de 2026. Trabajo en `feat/sistema-unificado-offline`; `main` se conserva. El alcance completo sigue siendo web, PWA y Windows con el diseño aprobado de Polymet, las mismas funciones y trabajo offline durable/sincronizable en una computadora Windows.

| Área | Evidencia actual | Trabajo pendiente |
| --- | --- | --- |
| Diseño compartido | 71 módulos recuperados, CSS, fuente local, 12 rutas, temas y reglas permanentes. Matriz de 72 casos: 53 PNG idénticos, textos 72/72; [evidencia y diferencias](design/validacion-visual-2026-11-21.md) | Afinar diferencias menores de renderizado, desbordamientos móviles heredados y estados secundarios; integrar con datos reales |
| API y PostgreSQL | API transaccional, versiones, idempotencia, RLS; catálogo ampliado, exentos y respaldos v3 compatibles con v2/legacy probados; suite de 74 pruebas pasa | Conectar el Inventario de Polymet; ampliar contactos/configuración, ventas equivalentes, cuentas/pagos, caja y anulaciones |
| PWA | La versión anterior instala/cachea la interfaz; el nuevo diseño ya tiene recursos locales | Conectar instalación, caché y actualizaciones al frontend compartido; probar instalada |
| Offline y sincronización | Identificados los contratos e invariantes necesarios | Diario durable, operaciones/entidades identificadas, conciliación, cambios remotos, recuperación tras reinicio y pruebas de conflicto |
| Windows | C++ Build Tools disponible; Rust y Cargo 1.100.0 preparados desde el instalador oficial con SHA-256 comprobado; no se modificó PATH persistente | Tauri/WebView2, SQLite, comandos transaccionales locales, instalador y verificación del ejecutable instalado |
| Cloudflare | Compilación del Worker existente pasa; los recursos publicados siguen limitados al POS actual de `public/` | Cuenta autorizada, Hyperdrive/CA/origen reales y despliegue del sistema integrado; Vercel sigue aplazado |

## Referencia ejecutable

`pnpm preview:design` sirve en `http://127.0.0.1:3001` la **demostración de diseño**, sin credenciales ni acceso a la base real. No es todavía el nuevo POS operativo. La fuente y datos de demostración están identificados en [la documentación de recuperación](design/recuperacion-polymet.md). No publicar esta entrada como aplicación del negocio.

La revisión independiente no encontró defectos importantes en el aislamiento de la vista de diseño. Se comprobaron aperturas y foco de formularios/confirmaciones y la apertura del recibo, además de la prueba automática. Las pruebas de la API usan PostgreSQL desechable, no Supabase del negocio. La compilación Worker es un dry run, no un despliegue.

## Siguiente integración

1. La persistencia de los cinco campos de Inventario ya está implementada en la rama mediante `20261121220000_catalogo_polymet.sql`, snapshot y respaldo v3. La migración se probó sobre un esquema anterior poblado y en instalación nueva, conservando históricos y permisos. **No se ha aplicado al Supabase del negocio**: esa actualización controlada precede al despliegue del código nuevo. Las migraciones anteriores permanecen intactas.
2. Extraer contexto y rutas compartidos para que la entrada operativa no importe semillas. Conectar CRUD de Inventario con IDs/versiones reales, UUID de solicitud estable, confirmación asíncrona y conservación de borradores/errores según [la especificación del catálogo](superpowers/specs/2026-11-21-catalogo-polymet-conectado.md). La referencia visual continúa aislada para comparar.
3. Resolver el contrato de precios antes de conectar ventas: la API actual incluye ITBIS en el precio, el prototipo lo suma. Mantener valores/históricos existentes y compartir un cálculo exacto entre previsualización, servidor y modo local. Conservar nivel de precio por línea.
4. Ampliar las entidades y transacciones de caja, cuentas, abonos, compras y anulaciones; después habilitar el almacenamiento local y sincronización. No sustituir esos módulos por callbacks que solo muestren éxito.
5. Integrar PWA y empaquetado Windows, completar las comparaciones y pruebas de negocio/offline, y publicar cuando el alojamiento tenga autorización real.

Las revisiones detalladas de trabajo están en la carpeta ignorada `supabase/.temp/polymet/`; las decisiones obligatorias están en los documentos versionados enlazados arriba y en [la especificación completa](superpowers/specs/2026-11-21-sistema-unificado-polymet.md). No se ha declarado terminado el sistema ni el modo offline.
