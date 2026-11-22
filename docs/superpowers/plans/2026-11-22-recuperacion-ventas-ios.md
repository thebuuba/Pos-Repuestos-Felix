# Recuperación de ventas en la PWA

Solicitud: al perder la respuesta de una venta en el iPhone, el POS presenta dos reintentos distintos y puede quedar bloqueado al volver a entrar.

## Diagnóstico comprobado

- La petición de escritura no tenía tiempo máximo de espera.
- El diario conservaba la operación, pero su recuperación dependía del usuario.
- Confirmar desde el aviso general no resolvía el error y el recibo del borrador de venta.
- La lectura real del catálogo respondió correctamente durante el diagnóstico: 7.682 productos, revisión 10 y 5.224.840 bytes JSON antes de compresión. Esto no identifica el motivo del fallo inicial de red/servidor de la captura.
- No se realizan migraciones ni ventas de prueba en la base real.

## Cambio acordado

1. Limitar la espera de lectura y escritura con AbortController, incluyendo la recepción del cuerpo.
2. Tras comprobar conexión e identidad de base, recuperar automáticamente la venta original: mismo UUID, método, ruta y cuerpo. Hasta tres intentos con espera progresiva; no reintentar automáticamente rechazos permanentes, sesión revocada o cambio de base. Los formularios de otros recursos conservan su reintento manual y reciben el mismo límite de espera.
3. Resolver el borrador por el UUID confirmado, conservando el recibo y sin afectar borradores de otras pestañas. Guardar únicamente el UUID de propiedad en sessionStorage; el diario durable sigue siendo la autoridad sobre lo enviado.
4. Mantener acceso a la interfaz ya cargada durante interrupciones y reintentar la carga inicial. Presentar un solo estado comprensible de recuperación, conservando avisos reales de conflictos.
5. Reducir metadatos repetidos del catálogo operativo, sin modificar existencias, importes, movimientos ni respaldos. Invalidar el ETag de la representación anterior.
6. Verificar con PostgreSQL desechable: respuesta perdida, petición colgada, reapertura, concurrencia, rechazos, autenticación y cambio de base. Cubrir WebKit móvil, además de Chromium.
7. Revisar de forma independiente, ejecutar regresiones, publicar en Cloudflare y preparar los mismos cambios para Windows. Verificar los archivos publicados y el instalador por separado.

## Límites

La PWA sigue necesitando conexión para que el servidor confirme una operación. Conservar una solicitud pendiente no equivale a confirmar su venta. No se borra ni se vuelve a crear con otra clave para desbloquear la interfaz. La recuperación del transporte no permite prometer ausencia absoluta de fallos de red o del servicio.
