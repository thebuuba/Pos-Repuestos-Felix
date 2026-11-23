# Lenguaje de diseño de Repuestos Félix

La referencia aprobada por el usuario es [Polymet](https://dev-untitled-pro-bq7q4q8y.polymet.app/), proyecto `daf93922-3928-485b-9fd0-701458f9a6ad`. Se reproduce su interfaz literalmente. Este documento registra lo observado en el código y en la vista renderizada, no propone otra dirección visual.

## Procedencia

Referencia recuperada el 21 de noviembre de 2026. Versión publicada `99fdb61658b9417c680d007618ae1c23bf135b1e`, bundle `repuestos-felix-pos.e3336f21.js`. SHA-256: `e3336f21633d743825d9f4bb1d42fc11ec4796fc11f6d830b7476dfc7a9404a5`.

La descarga pública contiene JavaScript compilado con rutas de origen, componentes y CSS; no equivale a un archivo ZIP exportado por Polymet ni contiene los tipos TypeScript originales. Registrar la recuperación sin atribuirle un origen diferente. No conservar en Git URLs firmadas, cookies ni la instrumentación del editor.

## Composición

- Escritorio desde `lg` (1024 px): barra lateral blanca/oscura de **256 px**, fija al desplazamiento (`sticky`, `top:0`, `height:100vh`), borde derecho de 1 px.
- La referencia original usa un panel lateral móvil de 288 px. Por instrucción posterior del usuario (22 de noviembre de 2026), se sustituye por **Más opciones**, un panel a pantalla completa entre la cabecera y la barra inferior que reutiliza la misma lista del menú lateral de escritorio (grupos, iconos, indicador rojo del activo y contadores, con alto táctil de 44 px). Se abre desde «Más», mantiene visibles la cabecera y la barra inferior, se cierra al pulsar «Más» de nuevo, al navegar o con Escape y devuelve el foco al cerrarse. No hay menú lateral ni botón de hamburguesa en teléfono.
- Bajo 1024 px se conserva la navegación inferior **Ventas, Inventario, Caja y Más**, compartida por web, PWA y Windows. Reutilizar iconos y tokens de Polymet, respetar zonas seguras y reservar espacio para no tapar acciones; los diálogos quedan por encima. Los filtros/paginación de Inventario, períodos de Reportes, montos rápidos de Caja y pestañas de Configuración conservan su forma y estilo con un alto táctil mínimo de 44 px solo bajo 1024 px.
- Contenido flexible con `min-width:0`; zona principal de ancho máximo **1480 px**, centrada. Relleno **16 px**, desde `md` **24 px**, desde `lg` **32 px**.
- Mantener los puntos de corte Tailwind del original: `sm:640`, `md:768`, `lg:1024`, `xl:1280`, `2xl:1536`.
- Cabecera superior: búsqueda, estado de conexión, fecha/hora, actualizar, instalar, tema y notificaciones. No añadir una cabecera con el banner grande encima.
- Por petición posterior del usuario (23 de noviembre de 2026), el diálogo de instalación conserva el título, el botón «Instalar ahora» cuando el navegador ofrece instalación y el cierre. Se retiran el subtítulo y las explicaciones permanentes de plataformas y conexión; los fallos reales conservan su aviso.
- En teléfono, por petición posterior del mismo día, se retiran «Actualizar datos» y las notificaciones aún deshabilitadas. La cabecera conserva la marca compacta, tema, instalación cuando corresponda y cierre de sesión. Los datos se actualizan en segundo plano al navegar, al volver a la app, cada cinco segundos mientras está visible y con la respuesta confirmada de cada operación. No recargar el documento ni borrar borradores para refrescar datos.
- Menú: «Menú principal», «Cuentas», «Otros». Enlace activo sobre rojo muy suave, texto/icono rojos e indicador rojo en el borde izquierdo. Mantener los contadores y el acceso F1.
- Marca compacta: recuadro rojo redondeado con llave SVG, «REP.FELIX» y teléfono. Conservar la composición de `BrandLogo`; no usar emojis ni nuevos logos generados.
- Por instrucción posterior del usuario (22 de noviembre de 2026), eliminar la tarjeta del cajero al pie de la barra lateral en todas las plataformas. El nombre, saldo y acceso de apertura/cierre de esa tarjeta no se muestran en el menú; la gestión de caja permanece en su página.
- Por petición posterior del mismo día, el escáner de cámara usa un visor horizontal 16:9 con cuatro esquinas, línea roja central y sombreado exterior. En pantallas horizontales de poca altura los controles se colocan al lado del vídeo; en vertical se indica que se puede girar el teléfono. Conservar los diálogos, botones y tokens compartidos; no bloquear la orientación de toda la aplicación.
- La venta operativa móvil conserva datos de factura y catálogo desplegables, búsqueda/cámara y cantidad/precio compactos, artículos sin desplazamiento horizontal y un botón **Cobrar** que muestra las formas de pago y confirmación. Se conservan las mismas reglas y componentes; desde 1024 px sigue la distribución completa. Las funciones deshabilitadas de espera, descuento y cotización no ocupan espacio en teléfono. La referencia de demostración conserva su formulario original.
- La PWA instalada en teléfono permite desplazarse y restringe el zoom de página mediante `touch-action: pan-x pan-y`; las entradas usan 16 px. El navegador de escritorio conserva el zoom. Las versiones de la app se aplican automáticamente al reabrir, sin aviso de actualización móvil y sin interrumpir operaciones abiertas.
- Por petición posterior, una lectura aceptada de cámara o lector USB emite un pitido breve y muestra el aviso de éxito existente, «Agregado a la venta», con cantidad y nombre del producto. El aviso respeta la zona segura superior del teléfono. No emitir éxito al detectar sólo las barras: primero debe aceptarse el artículo en el carrito; códigos desconocidos, ambiguos o sin existencias mantienen su error y no pitan. El aviso visual funciona aunque no haya salida de audio.
- Por petición posterior, la cámara permanece abierta después de cada lectura aceptada o rechazada. Mostrar el resultado dentro del visor y permitir seguir con otro producto usando el mismo vídeo. Un código sostenido se cuenta una sola vez; para repetirlo se debe apartar durante al menos 800 ms y volver a enfocarlo. Cerrar cámara termina la captura; también se libera al abandonar la pantalla, pasar al fondo o bloquearse la venta/sesión.
- Por petición posterior, la venta operativa retira la fila de filtros de categorías importadas ajenas al taller. El catálogo muestra ocho artículos por página, con columnas que caben en su contenedor y sin desplazamiento interno. Se mantienen todos los productos, la búsqueda y sus datos originales. Los códigos largos se ajustan al ancho; la tabla de venta deja de exigir 720 px. Entre 1024 y 1279 px el cobro pasa debajo, y entre 1024 y 1439 px la búsqueda ocupa una fila completa. No ocultar barras globalmente ni recortar controles para disimular desbordamientos.
- Por petición posterior, confirmada por el usuario, el orden operativo es **Agregar productos → Detalle de la factura → Datos de la factura → Catálogo**. En escritorio con espacio horizontal (`1024–1279 px` y desde `1360 px`), por petición posterior del usuario (23 de noviembre de 2026), **Datos de la factura** pasa a colocarse compacto al lado izquierdo de **Agregar productos** en la misma fila superior (conservando el orden móvil y el apilado en `1280–1359 px`). Se retiran el título grande «Facturación / Punto de venta»/«Nueva venta» y el subtítulo. «Agregar productos» pasa a ser el encabezado principal, compacto; Nueva venta/Limpiar y En espera se mantienen junto a él. Corrección explícita posterior: la cámara conserva el icono original de 16 px, sin texto visible, dentro de un botón independiente de 44×44 px a la derecha del buscador, separado por 8 px en todas las pantallas. Su nombre accesible y ayuda siguen siendo «Escanear con cámara». Cantidad, precio y Agregar van debajo; en teléfono Cantidad ocupa 72 px y el precio aprovecha el resto con etiquetas breves P1/P2/P3, conservando las opciones completas al abrirlo. Los cambios se comparten entre web, PWA y Windows; la referencia de demostración conserva su composición.

## Tipografía, medidas y componentes

Por petición posterior del usuario, el lector USB puede agregar a la venta desde cualquier módulo. La cabecera operativa sustituye las notificaciones deshabilitadas por el icono Lucide `ScanBarcode` con el botón y tokens existentes: acento rojo mientras está activo, superficie neutra si se desactiva o espera la confirmación de una venta. El control aparece también en teléfono, sin desplazar la navegación inferior. El aviso existente «Agregado a la venta» añade la acción **Ver venta** fuera de Ventas; no se abre ni cobra automáticamente la factura. Las entradas de formularios conservan su función, y diálogos/cobro pausan el agregado global. El borrador y su confirmación se conservan al navegar.

- Fuente **Inter variable**, pesos del original. Alojarla localmente para que Windows y la PWA no dependan de Google Fonts al abrir sin conexión.
- Texto normal: 14 px/20 px en los controles y tablas; etiquetas auxiliares 11–12 px según el componente. Título de página 24 px, desde `md` 28 px, peso 600, espaciado reducido.
- Números con `tabular-nums`. `MoneyDisplay` conserva moneda más pequeña, parte entera destacada y centavos atenuados. Mostrar dos decimales con `RD$`.
- Radio base `--radius:0.875rem` (14 px). Respetar radios propios: controles `rounded-xl` (12 px), tarjetas grandes `rounded-3xl` (24 px), botones principales de cabecera `rounded-full`.
- Navegación: alto 40 px, relleno horizontal 12 px, separación icono/texto 12 px, icono 18 px.
- Acciones de cabecera: alto 40 px. Iconos Lucide y Radix del original; conservar trazo y tamaño. Botón primario rojo con sombra roja suave donde la referencia la usa.
- Bordes finos, superficies blancas sobre fondo gris muy claro, sombras moderadas. No añadir gradientes, ilustraciones, animaciones o efectos nuevos.
- Reutilizar los componentes recuperados (`PageHeader`, `StatCard`, `SectionCard`, `MoneyDisplay`, tablas, formularios, sheets y dialogs) antes de crear variantes.
- Tema oscuro mediante `.dark`, con los mismos tokens y estructura; no invertir colores con filtros.

## Tokens de color exactos (valores HSL)

| Token | Claro | Oscuro |
| --- | --- | --- |
| background | `240 10% 96.5%` | `240 6% 5.5%` |
| foreground | `240 10% 8%` | `0 0% 96%` |
| card / card-foreground | `0 0% 100%` / `240 10% 8%` | `240 5% 9%` / `0 0% 96%` |
| popover / popover-foreground | `0 0% 100%` / `240 10% 8%` | `240 5% 10%` / `0 0% 96%` |
| primary / primary-foreground | `356 82% 42%` / `0 0% 100%` | `356 78% 52%` / `0 0% 100%` |
| secondary / secondary-foreground | `240 7% 95%` / `240 6% 12%` | `240 4% 15%` / `0 0% 96%` |
| muted / muted-foreground | `240 7% 95%` / `240 4% 46%` | `240 4% 14%` / `240 5% 64%` |
| accent / accent-foreground | `356 90% 96.5%` / `356 75% 34%` | `356 45% 16%` / `356 90% 82%` |
| destructive / destructive-foreground | `0 84% 56%` / `0 0% 100%` | `0 70% 48%` / `0 0% 100%` |
| border | `240 6% 90.5%` | `240 4% 17%` |
| input | `240 6% 88%` | `240 4% 20%` |
| ring | `356 82% 42%` | `356 78% 52%` |
| chart-1 | `356 82% 46%` | `356 78% 54%` |
| chart-2 | `356 85% 72%` | `356 70% 68%` |
| chart-3 | `356 80% 88%` | `356 45% 30%` |
| chart-4 | `240 5% 26%` | `240 5% 70%` |
| chart-5 | `152 55% 40%` | `152 50% 48%` |
| sidebar | `0 0% 100%` | `240 5% 8%` |
| sidebar-foreground | `240 6% 30%` | `240 5% 72%` |
| sidebar-primary / sidebar-primary-foreground | `356 82% 42%` / `0 0% 100%` | `356 78% 52%` / `0 0% 100%` |
| sidebar-accent / sidebar-accent-foreground | `356 90% 96.5%` / `356 75% 34%` | `356 45% 16%` / `356 90% 82%` |
| sidebar-border | `240 6% 92%` | `240 4% 15%` |
| sidebar-ring | `356 82% 42%` | `356 78% 52%` |

## Pantallas y estados

Conservar las doce rutas del manifiesto de referencia: Panel, Punto de venta, Inventario, Compras, Caja, Clientes, Suplidores, Reportes, Cuentas x cobrar, Cuentas x pagar, Configuración y Centro de ayuda. Copiar también filtros, búsqueda, diálogos de factura, producto, contacto, cobro/pago, caja y confirmación.

Panel: cuatro indicadores superiores; primera tarjeta roja; actividad de ventas con barras redondeadas y trama; medidor semicircular de meta; mapa de horas pico; ventas recientes. Sustituir todas las cifras de muestra por agregaciones reales sin alterar la estructura.

No eliminar funciones en teléfono. Reproducir los apilados y desplazamientos del original. Verificar como mínimo 390×844, 768×1024 y 1440×1000, claro y oscuro; comprobar reflujo a 320 px. Si la referencia presenta un fallo que impide usarla, corregirlo conservando su lenguaje y documentar la diferencia.

La vista publicada omite `DOCTYPE` y usa `BackCompat`. Nuestro documento conserva HTML5 (`CSS1Compat`). `frontend/standards.css` establece cajas de etiqueta explícitas para reproducir el espaciado de sus formularios: en 390 px, la factura vacía mide 2317 px de alto en la referencia; sin ese ajuste el modo estándar añadía 56 px. No quitar el doctype para imitar ese comportamiento accidental.

Los estados de carga, error, datos vacíos, desconexión, sincronización y conflicto usan estos mismos tokens y componentes. Nunca mostrar «Conectado» solo porque `navigator.onLine` es verdadero; comprobar el servicio y la sincronización. No mostrar un guardado exitoso antes de su confirmación durable.

Por petición posterior del usuario (22 de noviembre de 2026), el arranque operativo muestra una pantalla centrada con el icono existente y «Félix POS». La carga describe su fase real: «Preparando la aplicación…» durante la descarga inicial, «Cargando productos para la venta…» o «Cargando datos de [módulo]…» durante la lectura confirmada, y «Abriendo [módulo]…» dentro del contenido al descargar una sección nueva. No simular porcentajes ni sustituir una actualización de fondo por otra pantalla completa. El indicador respeta movimiento reducido. No presentar la espera como un catálogo pendiente de sincronización ni mostrar módulos vacíos durante el arranque. Un fallo real ofrece Reintentar, y se mantienen los estados reales de desconexión, sesión y operaciones pendientes.

El acceso, la carga inicial y el POS comparten el tema elegido. Aplicarlo desde el `head`, antes del primer pintado, y conservarlo al volver a entrar; el valor predeterminado es claro. El botón de tema mantiene su diseño e iconos originales. La preferencia visual se guarda localmente, sin guardar credenciales ni datos del negocio allí.

Tras el reporte de bloqueo de ventas en iOS del 22 de noviembre, los fallos transitorios del arranque muestran «Restableciendo la conexión…» y anuncian el reintento automático, con el botón Reintentar disponible. Una venta incierta presenta un único aviso de confirmación pendiente; al recuperarse muestra el recibo real. Los rechazos permanentes y los conflictos de base conservan su explicación. No sustituir el contenido ya cargado por la pantalla inicial durante una interrupción.

La corrección de sincronización permite revisar una solicitud que pertenece a una base anterior desde el aviso existente. El diálogo compartido presenta sus datos legibles, exige aceptación explícita y conserva el paquete original en un historial descargable al archivar. Windows incorpora la revisión de su lote pendiente dentro del diálogo de Sincronización: no repite dos listas, distingue pendientes de archivados y permite reanudar una revisión sin acuse. Archivar nunca se anuncia como una venta confirmada. Se mantienen los tokens, botones y diálogos existentes; las acciones nuevas y su aceptación tienen al menos 44 px de alto. Los controles técnicos de revisión sólo aparecen cuando corresponden, sin reinstalar el panel de almacenamiento que el usuario retiró.

## Criterio de aceptación

Por petición del usuario, los montos rápidos del cobro en efectivo muestran «Exacto» y los billetes de RD$50, RD$100, RD$200, RD$500, RD$1,000 y RD$2,000. Cada botón establece el monto recibido; «Exacto» usa el total de la venta. Se conservan todos los billetes aunque uno coincida con el total, con el estilo compartido y ajuste en varias filas según el ancho.

Comparar con el mismo viewport, fuente cargada, tema, fecha y datos. Inspeccionar capturas y geometría, navegación por teclado, foco de modales y controles táctiles. Revisar todos los módulos; una sola captura del Panel no valida el sistema completo. La interfaz se comparte entre plataformas; SQLite, PostgreSQL y sincronización se validan aparte.
