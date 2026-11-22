# Activación de caja y cuenta — 22 de noviembre de 2026

Caja y los cambios de usuario/contraseña están habilitados en el POS local y en [la web del negocio](https://repuestos-felix-pos.repuestosfelix1994.workers.dev). Se trabajó en `feat/sistema-unificado-offline`; `main` se conserva. El usuario autorizó expresamente la migración y la actualización local/web.

## Uso

- **Caja:** indicar el fondo inicial y abrir el turno. Permite entradas/salidas con concepto y cierre con conteo de efectivo. Las ventas nuevas requieren caja abierta y medio de pago; tarjeta, transferencia y crédito no aumentan el efectivo esperado.
- **Configuración → Mi cuenta:** editar usuario o contraseña, indicar la contraseña actual y guardar. Después se vuelve a iniciar sesión. El UUID y el permiso de acceso se conservan.
- **Esquema:** [estructura SQL](../supabase/schema.sql), [migraciones](../supabase/migrations/) e [informe de revisión de la base](revision-base-datos-2026-11-22.md). No se encontraron tablas operativas sobrantes que justifiquen eliminarlas.

## Activación comprobada

Se aplicó `20261122030000_caja.sql`. La comprobación posterior en una transacción `READ ONLY` encontró ocho migraciones, doce tablas operativas con RLS, ocho tablas privadas y 49 tablas del archivo NetPOS. Confirmó `turnos_caja`, `movimientos_caja`, `ventas.caja_id` y `ventas.metodo_pago`. Las ventas históricas no reciben turnos ni métodos de pago inventados.

La versión publicada en Cloudflare es `a95e7bdc-2b7e-43ed-8a9a-3719b24c0501`. El servidor Node de `http://127.0.0.1:3001` fue reiniciado con su configuración privada. Ambos utilizan Supabase y necesitan conexión; esto no acredita un instalador Windows ni operación sin internet.

Se desconectó la sesión anterior del CLI. El usuario inició sesión con el perfil `repuestos-felix` y se verificó su acceso al proyecto `uzbranexwuzcwkxaifsq` de Repuestos Félix. El comando de creación de usuarios usa ese perfil por defecto. La sesión del CLI es independiente del navegador y de las cuentas de acceso al POS.

La clave administrativa del proyecto está configurada únicamente en el entorno privado del servidor y como secreto de Cloudflare. El despliegue la incluye cuando está presente. La comprobación de los ocho recursos compilados no encontró la clave administrativa, el secreto de sesión ni la conexión de base de datos.

## Evidencia y límites

`pnpm test` aprobó **220 de 220 pruebas**, sin fallos, omisiones ni cancelaciones, sobre bases desechables y servicios de autenticación de prueba. Incluye caja transaccional, concurrencia, importes exactos, restauración compatible, reintentos sin duplicación, cambio de cuenta y protección de credenciales. La publicación compiló y cargó el Worker y los recursos de la interfaz.

El ajuste posterior solicitado para las contraseñas reduce el mínimo de doce a seis caracteres, sin exigir combinaciones de letras, números ni símbolos. Conserva espacios, cuenta caracteres Unicode y mantiene el máximo de 72 bytes compatible con Supabase Auth. Las **16 pruebas dirigidas de cuenta y acceso** pasaron después de este ajuste, incluido el cambio y posterior inicio de sesión con una clave de seis dígitos. La suite completa anterior corresponde al estado previo a ese ajuste.

La [validación visual de caja](design/validacion-caja-2026-11-22.md) documenta 18 pares de comparación con Polymet y la corrección deliberada de altura en el diálogo móvil. Las pruebas de cuenta revisaron cuatro anchos, ambos temas y mensajes de validación. Estas comprobaciones son independientes del despliegue.

La verificación autenticada posterior al despliegue obtuvo HTTP 200 en `/api/state` y `/api/account` tanto en local como en web; confirmó caja disponible y `canChangeUsername` / `canChangePassword` habilitados. La consulta administrativa de lectura a Auth respondió 200. Se abrieron Caja y Mi cuenta sin errores de JavaScript y con el usuario editable. Las capturas y el resultado de esta verificación permanecen fuera del repositorio, en `%LOCALAPPDATA%\RepuestosFelix\validacion-caja-20261122`.

No se registraron ventas, aperturas, movimientos ni cierres de prueba en la base real. Tampoco se modificaron las credenciales del usuario real para probar el formulario. El guardado de esos flujos se comprobó con bases y cuentas de prueba; en producción se verificaron configuración, acceso y lectura. La caja quedó cerrada, lista para que el negocio indique su fondo inicial.

Abonos, conciliación histórica de cuentas, anulaciones, emisión fiscal autorizada, permisos diferenciados, PWA instalada y Windows offline/sincronización conservan los pendientes descritos en el [estado del sistema](estado-sistema-unificado.md).
