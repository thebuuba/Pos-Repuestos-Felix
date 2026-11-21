# Repuestos Félix: contexto obligatorio

## Objetivo y alcance

- Trabajar en `feat/sistema-unificado-offline`. Conservar `main` hasta que el usuario decida integrar.
- Entregar un mismo POS con las mismas funciones en web, PWA y Windows. Windows debe operar sin internet en una sola computadora y sincronizar al reconectarse. La web/PWA también permiten registrar operaciones cuando están conectadas.
- El diseño aprobado es **el proyecto de Polymet**, no una reinterpretación. Vista: https://dev-untitled-pro-bq7q4q8y.polymet.app/ . Código/canvas: https://polymet.ai/canvas/daf93922-3928-485b-9fd0-701458f9a6ad .
- Antes de cambiar una pantalla, leer `design-system/repuestos-felix/MASTER.md` y `docs/design/polymet-reference.json`. Mantener componentes, distribución, textos, iconos, estados, temas y adaptación del original. No sustituirlos por un diseño genérico.
- La instrucción posterior de reproducir Polymet tiene prioridad sobre las decisiones visuales anteriores del HTML (cabecera grande, barra horizontal y ancho sin límite). Conservar la imagen original del negocio como recurso; su existencia no autoriza cambiar la composición de Polymet.

## Implementación compartida

- Usar los mismos componentes y estilos para web, PWA y Windows; adaptar al ancho disponible con los puntos de corte del original. No crear tres interfaces independientes.
- Separar presentación, reglas del negocio, almacenamiento y transporte. Windows propuesto: Tauri/WebView2 y SQLite; servidor: Cloudflare Workers; base compartida: Supabase PostgreSQL. Validar las decisiones con el código antes de añadir dependencias.
- Usar **pnpm** y conservar el lockfile. No introducir npm ni un segundo gestor.
- Interfaz y mensajes en español. Moneda DOP (`RD$`), formato `es-DO`, zona del negocio `America/Santo_Domingo`. Identificadores de componentes recuperados pueden conservar el inglés original.
- El diseño puede contener datos de ejemplo. Nunca cargar esos datos en Supabase ni confundir un prototipo en memoria con operaciones guardadas.

## Integridad del negocio

- Conservar la API transaccional y su idempotencia, importes exactos, control de existencias y versiones. El servidor confirma cada operación. No volver al guardado global de JSON.
- No emitir NCF simulados como comprobantes autorizados. Las secuencias de muestra de Polymet son demostrativas; la emisión real requiere configuración y validación propias.
- Las funciones adicionales de Polymet (abonos, caja, anulaciones, fórmulas, permisos) necesitan persistencia y reglas reales antes de presentarse como terminadas. Un toast o `useState` no prueba un guardado.
- Sin internet, mostrar qué datos están desactualizados, última sincronización y operaciones pendientes. Una operación local confirmada debe sobrevivir a cerrar/reabrir y sincronizarse sin duplicados. No ocultar conflictos ni prometer datos globales en tiempo real mientras un equipo esté desconectado.
- No poner contraseñas, tokens, conexiones administrativas, enlaces firmados o respaldos en Git, archivos públicos o logs. No ejecutar migraciones ni escrituras de prueba en la base real.
- Cloudflare primero; Vercel queda para después. La publicación necesita una cuenta autorizada y configuración real. No inventar identificadores ni contratar servicios de pago.

## Evidencia y validación

- Comparar el resultado renderizado con Polymet al mismo tamaño y con los mismos datos, en claro/oscuro y móvil/escritorio. Conservar evidencia y revisar también diálogos, tablas y navegación.
- Probar ventas, compras, cuentas, caja y sincronización con bases desechables. Nunca sacrificar la integridad para copiar un comportamiento incorrecto del prototipo.
- Distinguir en los informes: referencia importada, funcionalidad conectada, compilación, prueba visual, instalador y despliegue. Ninguno demuestra por sí solo los demás.
- No afirmar «idéntico», «sin errores», «offline listo» o «publicado» sin la evidencia correspondiente. El objetivo completo sigue pendiente mientras falte una plataforma, persistencia, sincronización o verificación.
