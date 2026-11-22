# PWA del sistema compartido

La compilación operativa de React/Polymet incluye ahora el manifiesto, los iconos, el registro del service worker y la ayuda de instalación. La PWA abre `/ventas`; sus accesos del sistema son Ventas, Inventario y Caja. El menú conserva los doce módulos de la web. El plan del 21 de noviembre describía la entrada HTML anterior; esta implementación corresponde a `frontend/operational.jsx`.

## Instalación y conexión

Ejecutar `pnpm build` y servir `dist/operational` mediante el servidor o Worker configurado. La instalación pública requiere HTTPS. El botón «Instalar app» abre las instrucciones y, cuando el navegador emite `beforeinstallprompt`, permite abrir su diálogo nativo. Android usa el menú de Chrome; iPhone/iPad usa Compartir → Añadir a pantalla de inicio en Safari. [API del diálogo de instalación](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent/prompt), [instrucciones de Apple](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iphea86e5236/ios).

El service worker guarda únicamente una interfaz pública sin datos, recursos de aplicación identificados por su contenido, fuente, iconos e imagen del negocio. El HTML autenticado, catálogo, API, acceso, salida, cambio de contraseña y respaldos quedan fuera de esa caché. Los recursos se descargan sin credenciales. Las páginas consultan la red y sólo recurren a la interfaz pública si esa consulta falla.

La web/PWA confirma ventas, compras, caja y demás cambios con el servidor. Sin conexión, una sesión abierta señala datos desactualizados y su última lectura confirmada. Al reabrir sin conexión aparece la interfaz sin un catálogo guardado. El diario existente conserva las solicitudes cuyo resultado no se confirmó; esto no habilita ventas nuevas sin internet. Un 401 bloquea y retira los datos de la vista.

Las actualizaciones muestran un aviso y esperan hasta cerrar todas las pestañas y ventanas del POS. No fuerzan recargas ni usan `skipWaiting`; una operación pendiente debe resolverse antes del cierre. La activación elimina sólo las cachés antiguas del prefijo propio, incluida `felix-pos-shell-v5`. [Ciclo de actualización](https://web.dev/learn/pwa/update).

Windows nativo puede establecer `window.__FELIX_DESKTOP__` antes de cargar React para omitir el registro del service worker y la interfaz de instalación. La persistencia local de Windows se valida por separado.

## Comprobación reproducible

`pnpm exec node --test tests/pwa.test.js tests/pwa-browser.test.js tests/http.test.js`

La prueba de navegador usa PostgreSQL desechable y un perfil temporal de Edge. Comprueba el manifiesto y las dimensiones de iconos, criterios de instalación de Chromium, disponibilidad de todos los módulos, apertura de interfaz sin red, ausencia de API en caché, reconexión, bloqueo por 401, espera de actualizaciones, limpieza de la caché anterior y exclusión del registro en Windows nativo. Las capturas locales quedan en `dist/verification/pwa`, a 320, 390, 768 y 1440 px en ambos temas. Los iconos se reproducen con `pnpm exec node scripts/build-pwa-icons.mjs` a partir del símbolo Lucide de `BrandLogo`.

Estas pruebas no equivalen a una publicación ni a una instalación verificada en un Android o iPhone físico. Esas comprobaciones siguen pendientes con el origen HTTPS autorizado. Tampoco prueban que todos los flujos del negocio estén terminados.
