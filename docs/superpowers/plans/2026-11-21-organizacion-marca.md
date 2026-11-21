# Organización del código e identidad visual

**Objetivo:** incorporar la imagen original de Repuestos Félix y separar claramente los archivos públicos, el servidor y las herramientas administrativas.

**Alcance aprobado:** organización solicitada a partir de la propuesta de carpetas y uso de la imagen adjunta. Se conservan JavaScript nativo, Node.js, pnpm, API, datos y migraciones ya aplicadas. Este cambio no incorpora usuarios, nuevos módulos del negocio ni publicación externa.

**Estructura:** `public/` contiene HTML, CSS, JS del navegador, manifiesto, iconos e imagen original. `src/server.js` contiene HTTP/arranque; `src/hosting.js`, la protección del alojamiento; `src/db/`, configuración y migrador; `src/pos/`, operaciones y lector de respaldos anteriores. `supabase/schema.sql` documenta la base. `scripts/`, `tests/` y `docs/` mantienen sus funciones. El servidor conserva una lista explícita de archivos públicos; nunca sirve `src/`.

**Diseño:** imagen completa, sin recorte ni modificación, dentro de la cabecera; rojo, negro y blanco en colores de interfaz; proporción y texto alternativo; cabecera adaptable al teléfono. Se mantienen los identificadores usados por la aplicación y las rutas públicas actuales, salvo el antiguo `state.js`, que contiene utilidades privadas y ya no usa el navegador. Caché de PWA incrementada y ampliada con la imagen.

- [x] Añadir pruebas de entrega de la imagen, aislamiento de archivos privados y caché sin conexión; comprobar que fallan antes de implementar.
- [x] Reubicar archivos y actualizar imports, migrador, scripts, Docker y pruebas; separar configuración de la conexión del servidor HTTP.
- [x] Integrar la imagen, paleta y cabecera responsive; conservar accesibilidad y navegación.
- [x] Verificar suite completa, revisar cambios, reiniciar servidor, comprobar Supabase y sincronizar GitHub.

La imagen se conserva como JPEG original de 2272 × 464, sin regenerar su contenido. Las credenciales y respaldos siguen fuera de Git.

Validación: `pnpm test` aprobó 52/52 pruebas; revisión independiente sin hallazgos materiales. `pnpm db:migrate` confirmó historial actualizado sin nuevas migraciones. Tras reiniciar, API Supabase HTTP 200, JPEG original HTTP 200 con 176929 bytes y ruta privada HTTP 404.

La verificación visual automática no pudo completarse: el navegador integrado no estaba disponible, la revisión automática bloqueó el intento de capturas de Chrome y el control de Windows se detuvo al no poder verificar la URL del navegador. No se realizó más control de ventanas o navegador después de la instrucción del usuario de no usar la PC. La interfaz se verificó mediante DOM/API y revisión de estilos, sin afirmar una comprobación visual en un teléfono real.
