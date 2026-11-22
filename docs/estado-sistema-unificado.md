# Estado del sistema unificado

Actualizado el 22 de noviembre de 2026. Trabajo en `feat/sistema-unificado-offline`; `main` se conserva. El alcance completo sigue siendo web, PWA y Windows con el diseño aprobado de Polymet, las mismas funciones y trabajo offline durable/sincronizable en una computadora Windows.

El inventario de NetPOS ya se cargó en Supabase. El POS local y la web consultan el mismo catálogo de 7.681 artículos. Para localizar los datos, abre la [guía del panel de Supabase](donde-esta-cada-dato.md). Los detalles de la importación están en [inventario y Excel](inventario-excel.md).

| Área | Evidencia actual | Trabajo pendiente |
| --- | --- | --- |
| Diseño compartido | 71 módulos recuperados, CSS, fuente local, 12 rutas y temas. [Referencia general](design/validacion-visual-2026-11-21.md), [Inventario](design/validacion-catalogo-2026-11-21.md) y [paneles conectados](design/validacion-paneles-2026-11-22.md) con sus diferencias y pruebas | Afinar estados secundarios y funciones pendientes sin alterar el diseño aprobado |
| API y PostgreSQL | API transaccional, versiones, idempotencia, RLS, respaldos v6 compatibles con versiones anteriores. Inventario, ventas, compras, caja, contactos, configuración y fórmulas conectados. Panel/Reportes calculan los datos confirmados; lectura condicional y recuperación de solicitudes inciertas entre pestañas | Cuentas/pagos, conciliación y anulaciones |
| Acceso | Usuarios y contraseñas individuales en Supabase Auth, permiso de acceso verificado en servidor, sesión recordada, cambio de usuario/contraseña en Mi cuenta y cierre de sesión | Roles diferenciados de dueño y cajero |
| PWA | La versión anterior instala/cachea la interfaz; el nuevo diseño ya tiene recursos locales | Conectar instalación, caché y actualizaciones al frontend compartido; probar instalada |
| Offline y sincronización | Diario IndexedDB para una solicitud web incierta: persistencia antes del envío, reintento exacto y recuperación al recargar. Clientes visibles reciben cambios mediante consultas condicionales cada cinco segundos | Cola de operaciones confirmadas localmente en Windows, identidades compartidas, conciliación, descarga incremental, reinicios y conflictos. El diario web no constituye ese modo offline |
| Windows | C++ Build Tools, Rust/Cargo 1.100.0 y dependencias de Tauri 2.12.7 preparados. Una comprobación Rust sobre una fixture aislada compila sin red; no se modificó PATH persistente | Proyecto de aplicación, SQLite, comandos transaccionales locales, instalador y verificación del ejecutable instalado |
| Cloudflare | Frontend, API, caja y cuenta publicados con Hyperdrive y Supabase. Versión actual `a95e7bdc-2b7e-43ed-8a9a-3719b24c0501`; acceso autenticado comprobado en local y web | Completar abonos y conciliación. Vercel queda para después |

## Referencia ejecutable

`pnpm build` y `pnpm build:design` generan el POS operativo con sus doce rutas en `dist/operational/`, sin datos de demostración. La entrada abre el Panel. `pnpm preview:design` sirve una vista estática de la misma interfaz en `http://127.0.0.1:3001`; muestra conexión pendiente cuando falta la API y no reemplaza la lectura por muestras. Node sirve esa compilación con su perfil de conexión. La demostración original requiere `pnpm preview:reference` y se conserva aislada para pruebas visuales; no se publica como aplicación del negocio.

La revisión independiente de los paneles detectó y resolvió la sobrescritura concurrente de precios en Compras y la selección del formato de impresión. La ejecución final aprobó 199 pruebas con PostgreSQL desechable y los flujos de navegador correspondientes. La compilación Worker y la publicación son verificaciones separadas; el [informe](design/validacion-paneles-2026-11-22.md) detalla la evidencia y sus límites.

## Siguiente integración

1. La persistencia de Inventario, contactos/configuración y fórmulas está implementada y sus migraciones formaron parte de la activación autorizada de NetPOS. Se conservan los históricos y archivos originales. No se ejecutaron migraciones ni escrituras operativas de prueba en Supabase al conectar estas pantallas.
2. El contexto y el shell compartidos separan la entrada operativa de las semillas. Inventario usa IDs/versiones reales, generación capturada al abrir, confirmación asíncrona y reintento durable de la solicitud. Las pruebas usan Edge y PostgreSQL desechable; el grafo operativo excluye los módulos demo. El [informe del catálogo](design/validacion-catalogo-2026-11-21.md) distingue esos resultados de la publicación y los módulos pendientes. La referencia visual continúa aislada.
3. Ventas utiliza precios con ITBIS incluido y comparte el cálculo exacto de línea entre previsualización y servidor. Las cantidades tienen dos decimales y las tarifas unitarias cuatro. El servidor comprueba versiones, stock y límite de crédito; el recibo usa el documento confirmado. No emite NCF autorizados. La rama registra efectivo, tarjeta, transferencia y crédito vinculados al turno de caja. Descuentos, cotizaciones, ventas en espera y anulaciones siguen pendientes.
4. Compras guarda documento y entrada de inventario; las facturas repetidas por suplidor se rechazan. Su API aún no registra condición de pago, categoría de un alta ni cuentas por pagar. Clientes, suplidores, configuración y fórmulas esperan la confirmación durable antes de cerrar sus formularios. Caja registra turnos, movimientos y cierres; las ventas nuevas necesitan turno abierto y medio de pago. Los abonos siguen deshabilitados: falta su persistencia y la conciliación de históricos. Cuentas por cobrar muestra las ventas a crédito nuevas; el saldo de apertura también se conserva en Clientes. No se ha declarado completo ningún módulo basado solo en su apariencia.
5. Integrar PWA y empaquetado Windows y completar sus pruebas de instalación, negocio y sincronización. La web ya dispone del alojamiento autorizado en Cloudflare.

Las revisiones detalladas de trabajo están en la carpeta ignorada `supabase/.temp/polymet/`; las decisiones obligatorias están en los documentos versionados enlazados arriba y en [la especificación completa](superpowers/specs/2026-11-21-sistema-unificado-polymet.md). No se ha declarado terminado el sistema ni el modo offline.

Revisión del 22 de noviembre: [esquema y auditoría](revision-base-datos-2026-11-22.md). El usuario autorizó expresamente aplicar la migración de caja y actualizar el POS local y web. No se registran operaciones de prueba en la base real.

La [activación de caja y cuenta](activacion-caja-cuenta-2026-11-22.md) recoge la migración aplicada, 220 pruebas aprobadas, publicación final y comprobación autenticada de ambos servidores. La [revisión visual de caja](design/validacion-caja-2026-11-22.md) documenta sus diferencias y evidencia móvil.
