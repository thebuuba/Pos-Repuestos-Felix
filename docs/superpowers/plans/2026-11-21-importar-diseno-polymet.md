# Importación fiel del diseño de Polymet

**Objetivo:** recuperar la presentación aprobada como componentes editables y comprobarla contra las doce rutas publicadas, sin afectar la base real ni sustituir el POS operativo por una demostración.

**Arquitectura:** componentes React compartidos, CSS exacto de la versión publicada, recursos locales y compilación esbuild. La vista de diseño usa exclusivamente fixtures en memoria y un servidor de desarrollo local separado. Se integra con la API real en la siguiente entrega del sistema unificado.

**Especificación:** `docs/superpowers/specs/2026-11-21-sistema-unificado-polymet.md`.

## Restricciones

pnpm; rama `feat/sistema-unificado-offline`; no modificar migraciones aplicadas ni datos reales; no conservar enlaces firmados, instrumentación del editor o credenciales. No alterar la composición aprobada. Las pruebas visuales usan sesiones aisladas y datos de referencia.

## Tareas

- [x] Verificar rama, descargar la versión publicada por HTTPS, identificar SHA-256, doce rutas, componentes y tokens. Capturar el Panel de referencia en Edge aislado.
- [x] Registrar contexto, procedencia, lenguaje de diseño, alcance total y criterios de aceptación en `AGENTS.md`, `design-system/repuestos-felix/MASTER.md` y `docs/design/polymet-reference.json`.
- [x] Recuperar módulos propios desde los límites de archivo del bundle, resolver importaciones entre ellos y a bibliotecas instaladas; convertir las llamadas JSX compiladas en JSX editable. No copiar código de dependencias dentro de los módulos.
- [x] Conservar el código recuperado en `frontend/src/`, con datos demostrativos identificados. Añadir entrada de diseño independiente, fuente Inter local y compilación a `dist/design-preview/`; el comando `build:worker` no publica esa carpeta.
- [x] Añadir una prueba de navegación real: iniciar la compilación en servidor local aislado, abrir las doce rutas en Edge con perfil temporal, comprobar títulos y ausencia de excepciones; probar el menú móvil y el tema. Verla fallar antes de completar la importación.
- [x] Capturar la referencia y la implementación con igual fecha/tema/viewport/datos, revisar diferencias de geometría y capturas de todos los módulos. Registrar qué tamaños, rutas y estados se han comprobado; no extender la afirmación a estados no probados. Evidencia y diferencias pendientes: `docs/design/validacion-visual-2026-11-21.md`.
- [x] Ejecutar pruebas existentes y compilación Worker para demostrar que el POS actual sigue íntegro. Actualizar documentación del comando de vista de diseño y estado de integración; revisar el diff sin secretos.

## Continuación obligatoria

La vista de diseño no cierra el objetivo. Seguir con la integración funcional, persistencia y operaciones adicionales, modo offline y sincronización, PWA, instalador Windows y despliegue descritos en la especificación del sistema unificado. Registrar progreso con evidencias y mantener el objetivo activo mientras falte cualquiera de ellas.
