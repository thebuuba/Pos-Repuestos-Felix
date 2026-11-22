# Escáner de ventas desde cualquier módulo

**Objetivo:** incorporar lecturas de un lector USB que escribe como teclado a la venta actual, sin seleccionar el buscador y conservando el borrador al navegar. Aprobado por el usuario con «sí, trabaja». El cálculo automático de precios queda fuera por petición posterior.

**Diseño:** trasladar el estado operativo de la venta a un contexto compartido por las rutas, incluidos envío, error recuperable y recibo. Reutilizar las reglas exactas de cantidades, existencias, versiones y cobro. El detector escucha ráfagas terminadas en Enter únicamente con la app activa, fuera de entradas, diálogos y cobro. Un botón con el icono existente en la cabecera permite desactivarlo. Se reutilizan el pitido y el aviso de agregado; fuera de Ventas el aviso permite abrir el borrador.

**Límites:** un lector tipo teclado no expone su marca ni se distingue infaliblemente de la escritura humana. Se admite una ráfaga de 4–256 caracteres con intervalos de hasta 80 ms y promedio de hasta 50 ms. Para lectores lentos o códigos cortos sigue disponible el buscador. Cada lectura global añade una unidad al nivel de precio seleccionado. El borrador se conserva al navegar dentro de la app, no tras recargar/cerrar; las operaciones enviadas mantienen el diario durable existente. Se descarta el borrador al perder la sesión o cambiar de base. No hay cobro automático ni escrituras de prueba en producción.

**Implementación y comprobación:**

- [x] Añadir pruebas de navegador que fallen: escanear fuera de Ventas, volver al borrador, repetir/agotados/desconocidos, pausa en formularios y modal, tecla humana lenta y modo desactivado.
- [x] Extraer estado y acciones de `point-of-sale-page.jsx` a `data/sale-draft.jsx`; montar sobre las rutas en `pos-shell.jsx`.
- [x] Compartir el audio/aviso de `product-search-bar.jsx`; añadir detector de teclado y control de cabecera usando componentes existentes, sin dependencias.
- [x] Comprobar con PostgreSQL desechable que navegar durante una confirmación incierta conserva el reintento y la misma clave, con una sola venta.
- [x] Ejecutar pruebas de escáner/cámara, venta móvil, sesiones, compilación y revisión independiente. Revisar geometría y capturas claro/oscuro a 320, 390, 768 y 1440 px.
- [x] Documentar evidencia y límites del lector físico, publicación e instalador por separado.
