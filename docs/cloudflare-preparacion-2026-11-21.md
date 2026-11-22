# Preparación del acceso web

La sesión de Wrangler fue autorizada con la cuenta del negocio. Se verificó mediante la API que el subdominio de Workers es `repuestosfelix1994`; no había Workers ni configuraciones Hyperdrive antes de esta preparación.

Se cargó el certificado público CA de Supabase y se creó Hyperdrive `repuestos-felix-supabase`, ID `1687e8b168374a5d8478baf4c0d6eeb0`. La respuesta de creación confirmó `verify-full`, CA `8a77ec9b-12b4-47de-b4f9-a6324d859256` y caché SQL desactivada. Usa la conexión directa y el rol limitado `pos_app`; las contraseñas no se guardaron en archivos versionados ni en argumentos de terminal.

`wrangler.jsonc` contiene la cuenta verificada, el binding real y el origen previsto `https://repuestos-felix-pos.repuestosfelix1994.workers.dev`. Este origen es una dirección preparada; **no acredita un Worker publicado**. La configuración todavía sirve `public/`, correspondiente al POS anterior. Publicar la entrada operativa de Polymet requiere seleccionar su compilación como assets; la entrada de referencia demostrativa no se debe publicar como sistema operativo.

Una consulta de solo lectura con `pos_app` confirmó que la tabla real `productos` todavía no tiene `marca`, `categoria`, `ubicacion`, `stock_minimo` ni `gravado`. El backend actual necesita estos campos. No se ejecutaron migraciones ni escrituras de prueba en Supabase. La migración pendiente está en `supabase/migrations/20261121220000_catalogo_polymet.sql`: añade esas cinco columnas con valores iniciales neutros para los metadatos y conserva el comportamiento tributario anterior.

Validación realizada: compilación Worker en seco y compilación de la entrada operativa aprobadas; `tests/catalog-metadata.test.js`, `tests/deployment.test.js` y `tests/worker.test.js`, 12 pruebas aprobadas sobre bases desechables. La suite completa iniciada antes del reinicio quedó interrumpida y no cuenta como una ejecución aprobada.

Falta autorización expresa para la migración real, exigida por la prohibición de `AGENTS.md`, y resolver qué entrada operativa se publicará. Después se debe enviar el secreto de acceso, desplegar y verificar HTTPS, autenticación, assets y lectura real de datos sin hacer escrituras de prueba. Polymet tiene conectado el inventario; sus demás módulos, la nueva PWA y Windows/offline siguen pendientes.
