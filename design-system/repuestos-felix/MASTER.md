# Lenguaje de diseño de Repuestos Félix

La referencia aprobada por el usuario es [Polymet](https://dev-untitled-pro-bq7q4q8y.polymet.app/), proyecto `daf93922-3928-485b-9fd0-701458f9a6ad`. Se reproduce su interfaz literalmente. Este documento registra lo observado en el código y en la vista renderizada, no propone otra dirección visual.

## Procedencia

Referencia recuperada el 21 de noviembre de 2026. Versión publicada `99fdb61658b9417c680d007618ae1c23bf135b1e`, bundle `repuestos-felix-pos.e3336f21.js`. SHA-256: `e3336f21633d743825d9f4bb1d42fc11ec4796fc11f6d830b7476dfc7a9404a5`.

La descarga pública contiene JavaScript compilado con rutas de origen, componentes y CSS; no equivale a un archivo ZIP exportado por Polymet ni contiene los tipos TypeScript originales. Registrar la recuperación sin atribuirle un origen diferente. No conservar en Git URLs firmadas, cookies ni la instrumentación del editor.

## Composición

- Escritorio desde `lg` (1024 px): barra lateral blanca/oscura de **256 px**, fija al desplazamiento (`sticky`, `top:0`, `height:100vh`), borde derecho de 1 px.
- Por debajo de 1024 px: menú en panel lateral de **288 px**, accesible desde la cabecera; se cierra al navegar.
- Contenido flexible con `min-width:0`; zona principal de ancho máximo **1480 px**, centrada. Relleno **16 px**, desde `md` **24 px**, desde `lg` **32 px**.
- Mantener los puntos de corte Tailwind del original: `sm:640`, `md:768`, `lg:1024`, `xl:1280`, `2xl:1536`.
- Cabecera superior: búsqueda, estado de conexión, fecha/hora, actualizar, instalar, tema y notificaciones. No añadir una cabecera con el banner grande encima.
- Menú: «Menú principal», «Cuentas», «Otros». Enlace activo sobre rojo muy suave, texto/icono rojos e indicador rojo en el borde izquierdo. Mantener los contadores y el acceso F1.
- Marca compacta: recuadro rojo redondeado con llave SVG, «REP.FELIX» y teléfono. Conservar la composición de `BrandLogo`; no usar emojis ni nuevos logos generados.
- Tarjeta del cajero oscura al pie de la barra lateral, importe y acción de caja. Los datos deben venir del usuario/caja real al integrar.

## Tipografía, medidas y componentes

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

## Criterio de aceptación

Comparar con el mismo viewport, fuente cargada, tema, fecha y datos. Inspeccionar capturas y geometría, navegación por teclado, foco de modales y controles táctiles. Revisar todos los módulos; una sola captura del Panel no valida el sistema completo. La interfaz se comparte entre plataformas; SQLite, PostgreSQL y sincronización se validan aparte.
