# Sistema unificado con el diseño de Polymet

## Resultado solicitado

Reproducir el proyecto `daf93922-3928-485b-9fd0-701458f9a6ad` en una interfaz compartida para web, PWA y aplicación Windows. Todas ofrecen los mismos módulos. Una computadora Windows funciona sin conexión; al reconectar intercambia operaciones con Supabase a través de la API de Cloudflare, sin duplicarlas. Los equipos conectados reciben actualizaciones. Las operaciones realizadas mientras Windows está aislado aparecen en los demás equipos después de sincronizar.

El usuario aprobó usar Polymet literalmente y trabajar en `feat/sistema-unificado-offline`. No hay una nueva propuesta estética que requiera elegir paleta o distribución. Las reglas permanentes están en `AGENTS.md` y `design-system/repuestos-felix/MASTER.md`.

## Evidencia inicial

La API actual usa PostgreSQL normalizado, transacciones, idempotencia y pruebas sobre bases desechables. Su HTML anterior no reproduce Polymet. La PWA solo conserva archivos estáticos, sin ventas durables offline. No existe todavía el instalador Windows ni un protocolo de sincronización. Cloudflare está preparado en código, pendiente de autorización de la cuenta y recursos reales.

El bundle publicado de Polymet contiene los componentes y CSS, React 18.3.1, Router, Radix, Lucide y Recharts. Sus operaciones modifican estado React en memoria; no equivalen a un backend. Usa datos demostrativos, cálculos de ejemplo, NCF simulados y algunas acciones sin persistencia. Recuperar la presentación no autoriza reemplazar la API probada por ese estado en memoria.

## Entregas y orden

1. **Referencia verificable e interfaz recuperada.** Conservar las doce pantallas, formularios y temas en componentes editables, fuentes locales, procedencia y reglas. Compilar una vista de diseño aislada de cualquier base real. Compararla contra la versión publicada. Esta vista no es el producto terminado ni debe desplegarse como POS operativo.
2. **Integración funcional.** Conectar los módulos al servidor, mantener cálculos e integridad en la capa de negocio, implementar con migraciones aditivas las entidades/operaciones que faltan (caja, abonos, anulaciones, fórmulas y configuración). Sin datos de muestra ni botones que simulen éxito. Revisar roles y autenticación antes del acceso público.
3. **Almacenamiento y sincronización.** Contrato de operaciones con UUID estable, diario durable local y estado de confirmación. SQLite para Windows. Reenvío idempotente, descarga de cambios, versiones, política explícita de conflictos y restauración segura. La misma UI muestra estados reales de conexión, cola y última sincronización. No mezclar un reemplazo global de tablas con la sincronización.
4. **PWA, Windows y alojamiento.** Construcción compartida y caché versionada; empaquetado Tauri/WebView2 con instalador para Windows. Configurar Cloudflare cuando se autorice la cuenta. Vercel sigue aplazado.
5. **Validación completa.** Comparaciones visuales en todos los módulos y tamaños, flujos de negocio con persistencia, reinicios offline, reconexiones, repetición de operaciones, concurrencia y recuperación. Instalar y ejecutar el paquete Windows; comprobar la PWA instalada y la web HTTPS real. No declarar el objetivo terminado sin estas evidencias.

## Invariantes

- Un único árbol de componentes y estilos. Las diferencias de plataforma se concentran en almacenamiento e integración nativa.
- Moneda y totales exactos. Ningún cliente puede imponer el total o descontar existencias sin validación.
- Ningún dato ni credencial del negocio en el paquete público, pruebas o capturas de referencia.
- No emitir NCF ficticios. Conservar referencias históricas y separar comprobantes internos de emisión fiscal autorizada.
- Confirmaciones de ventas, pagos, caja y compras solo después de un guardado durable. El estado de React y un toast no bastan.
- Los conflictos de inventario producidos durante una desconexión son visibles y auditables; no se borran ventas ni se promete consistencia global mientras haya dispositivos aislados.
- Conservar el historial de migraciones ya aplicado. Probar migraciones nuevas en bases temporales antes de aplicarlas al negocio.

## Límites y seguimiento

Las primeras capturas se pueden obtener desde la URL pública en un navegador con perfil temporal, sin inspeccionar otras pestañas personales. La descarga pública no trae tipos TypeScript originales; la procedencia de JSX recuperado debe ser explícita. Si el proyecto de Polymet cambia, revisar su versión antes de importar de nuevo y no sobreescribir código integrado sin comparar.

Cada entrega necesita sus pruebas. Los planes posteriores se redactan con los contratos reales de la entrega anterior; no se inventan interfaces de sincronización o identidades de alojamiento que aún no existen. Este documento conserva el alcance completo y no marca como concluidas las entregas pendientes.
