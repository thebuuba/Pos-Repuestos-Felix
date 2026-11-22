# Estado del sistema unificado

Actualizado el 22 de noviembre de 2026. Trabajo en `feat/sistema-unificado-offline`; `main` se conserva. El alcance completo sigue siendo web, PWA y Windows con el diseño aprobado de Polymet, las mismas funciones y trabajo offline durable/sincronizable en una computadora Windows.

El inventario de NetPOS ya se cargó en Supabase. El POS local y la web consultan el mismo catálogo de 7.681 artículos. Para localizar los datos, abre la [guía del panel de Supabase](donde-esta-cada-dato.md). Los detalles de la importación están en [inventario y Excel](inventario-excel.md).

| Área | Evidencia actual | Trabajo pendiente |
| --- | --- | --- |
| Diseño compartido | 71 módulos recuperados, CSS, fuente local, 12 rutas y temas. Referencia general: matriz de 72 casos, 53 PNG idénticos, textos 72/72; [diferencias](design/validacion-visual-2026-11-21.md). Inventario operativo: seis capturas del contenido principal coinciden con Polymet; [alcance de esa comparación](design/validacion-catalogo-2026-11-21.md) | Afinar diferencias generales, desbordamientos móviles heredados y estados secundarios; integrar los módulos restantes |
| API y PostgreSQL | API transaccional, versiones, idempotencia, RLS; catálogo ampliado, exentos y respaldos v3 compatibles con v2/legacy. Entrada de Inventario conectada y probada con PostgreSQL temporal; lectura condicional y recuperación de solicitudes inciertas entre pestañas | Ampliar contactos/configuración, ventas equivalentes, cuentas/pagos, caja y anulaciones |
| PWA | La versión anterior instala/cachea la interfaz; el nuevo diseño ya tiene recursos locales | Conectar instalación, caché y actualizaciones al frontend compartido; probar instalada |
| Offline y sincronización | Diario IndexedDB para una solicitud web incierta: persistencia antes del envío, reintento exacto y recuperación al recargar. Clientes visibles reciben cambios mediante consultas condicionales cada cinco segundos | Cola de operaciones confirmadas localmente en Windows, identidades compartidas, conciliación, descarga incremental, reinicios y conflictos. El diario web no constituye ese modo offline |
| Windows | C++ Build Tools, Rust/Cargo 1.100.0 y dependencias de Tauri 2.12.7 preparados. Una comprobación Rust sobre una fixture aislada compila sin red; no se modificó PATH persistente | Proyecto de aplicación, SQLite, comandos transaccionales locales, instalador y verificación del ejecutable instalado |
| Cloudflare | El POS de inventario se publicó en Workers con Hyperdrive y Supabase. La verificación de la importación enlazada arriba recoge la lectura real en el sitio y en localhost | Completar los módulos restantes. Vercel queda para después |

## Referencia ejecutable

`pnpm build` y `pnpm build:design` generan el inventario operativo en `dist/operational/`, sin datos de demostración. `pnpm preview:design` sirve una vista estática de la misma interfaz en `http://127.0.0.1:3001`; muestra conexión pendiente cuando falta la API y no reemplaza la lectura por muestras. Node sirve el inventario operativo en el puerto 3001. La demostración original requiere `pnpm preview:reference` y se conserva aislada para pruebas visuales; no se publica como aplicación del negocio.

La revisión independiente no encontró defectos importantes en el aislamiento de la vista de diseño. Se comprobaron aperturas y foco de formularios/confirmaciones y la apertura del recibo, además de la prueba automática. Las pruebas de la API usan PostgreSQL desechable, no Supabase del negocio. La compilación Worker es un dry run, no un despliegue.

## Siguiente integración

1. La persistencia de los cinco campos de Inventario ya está implementada en la rama mediante `20261121220000_catalogo_polymet.sql`, snapshot y respaldo v3. La migración se probó sobre un esquema anterior poblado y en instalación nueva, conservando históricos y permisos. **No se ha aplicado al Supabase del negocio**: esa actualización controlada precede al despliegue del código nuevo. Las migraciones anteriores permanecen intactas.
2. El contexto y el shell compartidos separan la entrada operativa de las semillas. Inventario usa IDs/versiones reales, generación capturada al abrir, confirmación asíncrona y reintento durable de la solicitud. Las pruebas usan Edge y PostgreSQL desechable; el grafo operativo excluye los módulos demo. El [informe del catálogo](design/validacion-catalogo-2026-11-21.md) distingue esos resultados de la publicación y los módulos pendientes. La referencia visual continúa aislada.
3. Resolver el contrato de precios antes de conectar ventas: la API actual incluye ITBIS en el precio, el prototipo lo suma. Mantener valores/históricos existentes y compartir un cálculo exacto entre previsualización, servidor y modo local. Conservar nivel de precio por línea.
4. Completar [contactos/configuración y fórmulas](superpowers/specs/2026-11-21-contactos-configuracion-polymet.md) y las entidades/transacciones de caja, cuentas, abonos, compras y anulaciones; después habilitar el almacenamiento local y sincronización. No sustituir esos módulos por callbacks que solo muestren éxito.
5. Integrar PWA y empaquetado Windows, completar las comparaciones y pruebas de negocio/offline, y publicar cuando el alojamiento tenga autorización real.

Las revisiones detalladas de trabajo están en la carpeta ignorada `supabase/.temp/polymet/`; las decisiones obligatorias están en los documentos versionados enlazados arriba y en [la especificación completa](superpowers/specs/2026-11-21-sistema-unificado-polymet.md). No se ha declarado terminado el sistema ni el modo offline.
