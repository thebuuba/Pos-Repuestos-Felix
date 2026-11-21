# Contactos y configuración persistentes de Polymet

Siguiente entrega después de completar el [catálogo conectado](2026-11-21-catalogo-polymet-conectado.md). Este documento prepara sus contratos; no declara implementado el alcance ni autoriza datos de demostración en el negocio. La rama y el objetivo completo permanecen en [la especificación general](2026-11-21-sistema-unificado-polymet.md).

## Evidencia del código

`CustomersPage` pide nombre, RNC/cédula, teléfono, correo, dirección y límite de crédito; presenta saldo, ventas y documentos pendientes. `SuppliersPage` pide nombre, RNC, teléfono, persona de contacto, días de crédito, correo y fórmula de precios. `SettingsPage` muestra datos del negocio, fórmulas, NCF y facturación. La API actual solo crea contactos con nombre/RNC/teléfono y actualiza empresa/ITBIS; no permite editar/desactivar contactos ni guardar el resto. El editor de fórmulas escribe en memoria con cada tecla. No conectar esos callbacks descartando atributos o mostrando éxito anticipado.

## Datos y compatibilidad

Agregar una migración posterior a las existentes, sin modificarlas. Ampliar clientes con correo/dirección y límite de crédito; suplidores con correo/contacto/días de crédito y relación opcional a fórmula. Textos de hasta 2000 caracteres, importes no negativos exactos de hasta dos decimales, días enteros no negativos dentro de int32. El límite histórico no configurado y los días históricos desconocidos deben distinguirse de cero: cero significa solo contado o cero días, respectivamente. No inventar autorizaciones ni vencimientos al migrar.

Crear fórmulas versionadas con identidad asignada por servidor, nombre, factor de costo positivo con hasta tres decimales y recargos P1/P2/P3 no negativos con hasta cuatro decimales. Definir límites explícitos acordes con sus columnas y rechazar desbordamientos; no sustituir valores inválidos por 0 o 1. Sin fórmulas de ejemplo por defecto. El cálculo comercial debe ser exacto, compartido con la previsualización y conservar el redondeo hacia arriba del diseño. Su factor no constituye por sí mismo una deducción o regla tributaria. No cambiar costos ni documentos históricos al editar una fórmula.

Ampliar configuración con RNC, teléfono, correo, dirección, redondeo de sugerencias (0/1/5/10/25 pesos), nivel predeterminado P1/P2/P3, formato de impresión de la referencia y pie del ticket. Conservar empresa/ITBIS existentes. Los valores nuevos no documentados permanecen vacíos o explícitamente no configurados; seleccionar un formato no demuestra que una impresora física esté instalada. El control de existencias negativas sigue rechazándolas mientras no exista una política real implementada. No aceptar un booleano de configuración que deje sin efecto esa integridad.

La configuración de NCF se trata aparte de datos comerciales. Mantener su pestaña/componentes, sin secuencias de muestra ni emitir comprobantes autorizados. La integración fiscal requiere configuración y validación propias antes de habilitar emisión; guardar apariencia o un contador no satisface ese requisito.

## Operaciones

Crear/editar/desactivar clientes y suplidores, y crear/editar/desactivar fórmulas, usan la API transaccional común: UUID idempotente, `databaseId`, versión esperada para filas existentes, incremento de revisión y resultado confirmado. El formulario fija versión/generación al abrirse. Los errores conservan sus valores y una solicitud incierta conserva cuerpo/clave en el diario del cliente. No renovar la versión al guardar para forzar una edición.

Las ediciones legacy que omiten atributos nuevos los preservan. No permitir cambios de saldos mediante el CRUD de contactos. La baja conserva ventas/compras/movimientos/obligaciones y sus instantáneas históricas. Una fórmula utilizada no se elimina ni queda como referencia huérfana; comprobarlo dentro de la transacción, aunque otro equipo la asigne simultáneamente. Proteger el cliente de contado del sistema mediante identidad real, no suponiendo que su ID sea `c-000` o 1.

La configuración conserva control de versión. Guardar una sección envía sus datos desde la base de edición capturada y no reconstruye un borrador con la versión actual para sobrescribir un cambio de otro equipo. Un conflicto mantiene la sección abierta y explica que necesita actualizar. Evitar escrituras por cada pulsación de una fórmula: mantener un borrador local con estado visible y guardarlo de forma explícita, sin cambiar la composición en reposo. Toda modificación pendiente debe distinguirse de un guardado confirmado.

## Saldos e históricos

El saldo actual de clientes es `saldo_apertura + ventas a crédito` según el modelo existente. Preservarlo; no volver a sumar documentos históricos ni inventar sus abonos. Las compras históricas no documentan condición ni pagos: no convertirlas automáticamente en cuentas por pagar ni afirmar que están pagadas. Donde falte el submayor, mostrar disponibilidad real sin ejecutar callbacks demo. La entrega posterior de cuentas/caja completará esos detalles con corte y procedencia explícitos.

Los agregados de contactos pueden usar los documentos reales disponibles, con fecha/hora y estado documentados. No usar listas vacías para presentar como cero un saldo cuyo origen histórico es desconocido. No generar una hora de venta a partir de una fecha documental sin hora.

## Respaldos y evidencia

Versionar el nuevo formato relacional; importar v3/v2/legacy mediante transformaciones explícitas a valores neutrales o desconocidos. Conservar atributos de catálogo, saldos/historial, RLS/rol restringido, restricciones, archivo previo a restauración, rollback y rotación de generación. Validar estrictamente filas/columnas y relaciones nuevas; ningún nombre de tabla/columna procede de SQL subido.

Antes de habilitar las pantallas: pruebas con PostgreSQL desechable de alta/edición/baja completa, omisiones legacy, conflictos, concurrencia fórmula/suplidor, exactitud de sugerencias y respaldos; pruebas renderizadas de formularios y recarga, sin semillas en el bundle operativo. Comparar reposo, edición, errores y móvil/claro/oscuro con Polymet y documentar estados nuevos. No aplicar migraciones ni pruebas al Supabase del negocio.

Esta entrega no equivale a ventas/caja/cuentas, Windows offline, sincronización, instalación PWA o despliegue. Esas obligaciones permanecen abiertas.
