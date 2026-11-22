# Sesión, tema y carga de la PWA

Rama `feat/sistema-unificado-offline`. Publicación del 22 de noviembre de 2026, Worker `1c4a1dbc-6c5a-4e10-8dbf-0b1dedd3b6f1`, en el origen autorizado de Repuestos Félix. No se aplicaron migraciones ni operaciones de prueba a la base real.

## Comportamiento

- La cookie recordada de Supabase dura un año y renueva su plazo al renovar el acceso; el servidor amplía también los tickets antiguos todavía válidos que se acercan a su caducidad. Mantiene cifrado, HttpOnly y Secure en HTTPS. Recordar es el valor predeterminado; la opción temporal conserva ocho horas y no persiste al cerrar el navegador.
- Un acceso rechazado intenta renovar su token antes de pedir otra sesión. Los fallos temporales no borran la cookie; una revocación válida sí bloquea. `SameSite=Lax` permite llegar desde enlaces externos, con origen propio exigido en las escrituras. No se almacenan contraseñas ni tokens en localStorage. Las cookies ya caducadas o borradas no se recuperan sin iniciar sesión. Se conserva el cierre manual y la política offline de Windows. Referencia de renovación: [sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions).
- Acceso, HTML inicial y POS aplican el mismo tema antes del primer pintado, claro por defecto, y conservan la selección local. Se elimina la combinación anterior de acceso según el tema oscuro del sistema y POS forzado a claro.
- La espera distingue preparación de la app, datos de Ventas/Inventario/Caja y descarga de cada módulo. Las actualizaciones de fondo conservan la vista. Si un módulo no se descarga, la navegación sigue disponible y se ofrece Reintentar.
- La compilación divide el código por módulos y separa el decodificador de cámara. Precarga las dependencias comunes. La PWA instala sólo el núcleo; los módulos opcionales se guardan cuando se usan, sin credenciales. Reabrir usa la interfaz pública guardada; la API sigue validando sesión y datos actuales. No se guardan catálogo, HTML autenticado ni transacciones en la caché. Las versiones nuevas siguen esperando al cierre de los clientes.

## Pruebas

La suite completa ejecutó **286 casos** en 369,6 segundos: 281 pasaron y cinco requirieron revisión (`session-theme-fast-full.log`). Cuatro esperaban marcado o títulos anteriores de la interfaz: raíz HTML vacía, Actualizar datos y Punto de venta. El quinto era la captura de WebKit esperando las fuentes mientras la propia prueba retenía el módulo que terminaba de cargar el documento; se comprueba el tema antes de liberar JavaScript y se captura después reteniendo únicamente los datos.

Tras corregir esas comprobaciones, los cinco archivos afectados aprobaron **33/33 casos** en 67,2 segundos (`session-theme-rechecks-final.log`). Después de ajustar la altura del aviso de módulo se repitieron las **8/8 pruebas de arranque**, todas aprobadas (`session-theme-startup-final.log`). No se presenta la repetición como otra ejecución completa. Un intento intermedio de repetir inventario en paralelo a toda la suite agotó el tiempo de creación de su PostgreSQL desechable; la ejecución final con concurrencia 2 lo verificó correctamente.

La verificación previa al commit volvió a ejecutar `pnpm test`: compilación aprobada y **286 casos**, con 285 aprobados y uno cancelado al superar 90 segundos, sin aserciones fallidas (`precommit-2026-11-22.log`, 278,7 segundos). Se revisó el flujo afectado de venta, impresión y cierre de caja y se ejecutó por separado con trazas de Playwright: **1/1 aprobado** en 18,3 segundos, sin cambiar código ni ampliar el tiempo límite (`precommit-sale-recheck.log`). Esa repetición comprueba el caso cancelado; no equivale a una segunda suite completa aprobada ni demuestra por sí sola la causa del agotamiento del tiempo.

La cobertura incluye navegación desde otro sitio y reapertura con la cookie persistida, renovación simulando 400 días de uso, token rechazado con renovación válida, servicio temporalmente caído y permiso revocado; temas claro/oscuro antes de JavaScript y después de recargar en Chromium/WebKit; API lenta, 503, 401, módulo sin conexión y recuperación; PWA, cámara continua, ventas, compras, caja, cuentas, sincronización, Windows y Worker transaccional. Las bases y perfiles de pruebas son desechables.

Capturas inspeccionadas y geometría: `dist/verification/session-theme` y `dist/verification/startup`, incluidos temas en móvil y avisos a 320–1440 px. No se ha probado físicamente el iPhone del negocio.

## Rendimiento medido

Tres aperturas frías y tres reaperturas por versión, ejecutadas consecutivamente tras las pruebas: Edge headless, 390×844, latencia de 150 ms, descarga de 1,6 Mbit/s y CPU limitada a 4×. PWA con service worker real y PostgreSQL desechable vacío; no se simula el volumen del catálogo ni la latencia de Supabase Auth del negocio. La versión anterior se toma del payload de Windows conservado antes de actualizarlo.

| Mediana / recurso | Antes | Después |
| --- | ---: | ---: |
| Primer arranque hasta Ventas | 4.516 ms | 2.611 ms |
| Reapertura con caché | 639 ms | 802 ms |
| JavaScript inicial sin comprimir | 1.546.281 bytes | aproximadamente 472 KB |

El primer arranque se redujo aproximadamente un 42 % y el código inicial un 69,5 %. La reapertura sintética no mejoró: aumentó 163 ms al dividir los módulos; no se afirma una mejora universal en todas las cargas. Los resultados no son tiempos garantizados del teléfono. Reportes completos: `startup-performance-pwa-before.json` y `startup-performance-pwa-after.json` en `dist/verification`. El último ajuste de altura del aviso no modifica el recorrido medido de Ventas.

## Publicación y Windows

El despliegue terminó con código 0 (`deploy-session-theme.log`). El servidor local se reinició con el mismo perfil Supabase y conserva el puerto 3001. Se compararon por SHA-256 los **55 recursos actuales**, incluidos todos los módulos, en el Worker y el servidor local; acceso 200, tema presente y API privada 401 sin sesión (`session-theme-live.json`).

Se cotejaron **447 archivos** del Windows instalado (`session-theme-installed.json`). Su servidor nativo y ejecutable permanecen iguales; los únicos módulos de servidor reemplazados pertenecen a la web y se comprobó con el grafo de esbuild que el proceso nativo no los importa. Los datos del negocio se conservaron. El instalador correspondiente se registra en `windows-instalacion.md`; su empaquetado no equivale a una reinstalación ni a una prueba física en otro equipo.
