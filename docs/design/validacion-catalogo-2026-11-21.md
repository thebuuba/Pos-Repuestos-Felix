# Inventario conectado: evidencia y límites

La entrada `frontend/operational.jsx` usa el catálogo confirmado por la API; la entrada `frontend/reference.jsx` conserva la demostración para comparar. El diseño y la versión de Polymet están identificados en [el manifiesto de referencia](polymet-reference.json).

## Comparación del contenido de Inventario

Se cargaron los mismos 16 artículos del prototipo mediante la API en PostgreSQL desechable. No se usó Supabase del negocio. `scripts/compare-catalog.mjs` comprueba el SHA-256 del bundle público antes de abrir la referencia en Edge con perfil aislado.

Se comparan 390×844, 768×1024 y 1440×1000 en claro y oscuro. En los seis casos coinciden los textos, las medidas inspeccionadas y los bytes de las capturas del contenido principal. Ninguna página registra errores JavaScript ni desbordamiento horizontal del documento. La tabla conserva su desplazamiento interno para acceder a todas las columnas. La prueba de funcionamiento comprueba además el reflujo a 320 px.

La captura del elemento `main` desplaza la página. Se oculta únicamente la pintura de la cabecera fija durante esa captura, mediante `visibility:hidden`, para que no tape el título al desplazarse; no se cambia la geometría. La comparación excluye la cabecera, la tarjeta de cajero y las cuentas: la entrada operativa todavía no tiene esos servicios completos y no usa sus cifras de ejemplo. La igualdad del contenido de Inventario no significa que las doce pantallas operativas estén terminadas.

Los hashes de todos los pares están en [el informe de comparación](catalog-comparison-2026-11-21.json). Se conservan muestras de [escritorio claro, referencia](reference/inventory-1440-light-reference.png), [escritorio claro, operativo](reference/inventory-1440-light-local.png), [móvil oscuro, referencia](reference/inventory-390-dark-reference.png) y [móvil oscuro, operativo](reference/inventory-390-dark-local.png). Los seis pares completos permanecen en `dist/catalog-comparison-inventory-final/`, fuera de Git.

## Persistencia y formularios

Las pruebas renderizadas usan el frontend compilado, Edge aislado, el adaptador HTTP compartido y PostgreSQL temporal con el rol `pos_app`. Comprueban alta completa, recarga, versión obsoleta, baja lógica con historial, cambio de generación y recepción de una modificación de otro cliente sin recargar. El guardado no cierra ni muestra éxito antes de recibir confirmación.

La solicitud se registra en IndexedDB antes de enviar y se conserva ante respuestas inciertas. Se comprobaron pérdida del 200 después de COMMIT, reinicio de la página, autenticación vencida, respuesta ilegible, generación reemplazada y recuperación desde otra pestaña. El reintento mantiene el cuerpo y UUID originales, incluso cuando otra pestaña ya recuperó la operación y renombró el artículo. Una solicitud ajena no se sustituye. Los rechazos acreditados de catálogo permiten corregir el borrador sin conservar un bloqueo indefinido.

La acreditación de rechazo incluye la operación, ruta, método y generación. Solo se emite después de una ejecución nueva rechazada y un rollback confirmado, antes de iniciar COMMIT. El cliente exige una lectura nueva de la misma generación. Un error de autenticación, replay, contención ambigua o lectura no demuestra ese rechazo. Se probaron asimismo respuestas 200 con importes, cantidades o identificadores imposibles y la limpieza de conexiones tras tiempos de espera.

Las cantidades inválidas no se truncan; los importes conservan hasta dos decimales y los ceros explícitos de precios opcionales. Los textos que exceden el límite normalizado se conservan en el formulario para corregirlos y no generan una solicitud. Un formulario sin fórmulas configuradas permite precios manuales, sin inventar recargos. Las pruebas de teclado comprueban el foco después de rechazar, cancelar y eliminar la última fila.

Las cadenas vacías de marca, categoría y ubicación de un histórico permanecen vacías al editar su descripción. Los ceros explícitos de costo y P1 son válidos, como en la API; un campo requerido vacío sigue siendo inválido. Esto corrige la restricción del prototipo que obligaba a inventar un importe positivo. Las proporciones sin denominador se representan sin `NaN` ni valores infinitos.

La validación condicional reconoce etiquetas con el mismo valor opaco aunque cambie el prefijo de debilidad. Es la equivalencia definida para `If-None-Match` en [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2); Cloudflare documenta la posible transformación de etiquetas al cambiar la compresión en [su referencia de ETag](https://developers.cloudflare.com/cache/reference/etag-headers/). Una etiqueta ausente, malformada o de otra versión no confirma la copia local.

`tests/operational-build.test.js` inspecciona el grafo real de esbuild: la entrada operativa no depende de `pos-store.jsx`, `pos-data.js`, `seed-data.js` ni del avatar de demostración. También comprueba la fuente local y su licencia. La presencia de la referencia en el repositorio no la convierte en un fallback de datos.

## Reproducir

La suite completa pasó con **124 pruebas**, sin fallos ni omisiones, incluyendo las correcciones y regresiones de la revisión final. Las compilaciones de referencia, entrada operativa y Worker también finalizaron correctamente. Dos mensajes de error de la suite pertenecen a casos existentes que retiran deliberadamente la configuración ficticia del Worker; no representan fallos de las pruebas.

```powershell
pnpm exec node --test --test-concurrency=2 tests/*.test.js
pnpm build:reference
pnpm build:operational
pnpm build:worker
node scripts/compare-catalog.mjs inventory-final
```

Las pruebas requieren PostgreSQL local y Edge. `build:worker` es una compilación de prueba, sin despliegue. Los ensayos de la PWA anterior siguen referidos a `public/`; no demuestran instalación del frontend nuevo.

Inventario conectado no acredita aún los servicios de contactos/configuración, ventas equivalentes a Polymet, caja, cuentas, Windows con SQLite, sincronización offline, instalador ni publicación. La migración de atributos del catálogo sigue pendiente de aplicación controlada en el negocio. El alcance y el siguiente trabajo permanecen en [el estado del sistema](../estado-sistema-unificado.md).
