# Coordinación de Codex y Antigravity

## Objetivo

Codex coordina el desarrollo de Repuestos Félix y puede encargar análisis o implementaciones a Codex CLI y Antigravity CLI. Cada encargo declara objetivo, archivos y criterios de aceptación. El coordinador revisa el resultado, ejecuta las pruebas pertinentes e integra los cambios en `feat/sistema-unificado-offline`.

## Diseño

Un comando Node sin dependencias adicionales crea un worktree separado del último commit para cada tarea. Ejecuta el CLI elegido sin construir comandos de shell y conserva respuesta, estado, base Git y parche en `.agent-runs/`, excluido de Git. Los cambios fuera de los archivos asignados o los commits realizados por el trabajador hacen fallar la entrega. Un resultado válido queda pendiente de revisión, nunca se integra ni publica automáticamente.

Las tareas de análisis usan modo de planificación/solo lectura. Las implementaciones usan permisos de edición del workspace; no se desactivan las protecciones de los CLI. No se copian archivos ignorados ni variables de conexión a la base real. Un worktree separa cambios de Git, pero no equivale a una máquina virtual ni es una barrera de seguridad frente a procesos maliciosos.

## Entregas y comprobaciones

- [x] Implementar `scripts/orchestrate.mjs`: `estado`, `ejecutar <tarea.json>`, validación del encargo, ejecución de ambos CLI, límite de tiempo y resultado auditable.
- [x] Probar en repositorios desechables: aislamiento, nuevos archivos en el parche, cambios fuera de alcance, análisis que modifica archivos, errores de protocolo, salida no cero y tiempo agotado.
- [x] Añadir `pnpm agentes`, un ejemplo de análisis del lector USB y documentación del flujo de revisión e integración.
- [x] Comprobar ambos CLI con una tarea sintética y revisar el código antes de dar por terminada la conexión. Ambos verificaron análisis; Antigravity editó y produjo un parche comprobado. La edición directa de Codex CLI está bloqueada en este equipo; se documenta sin ampliar permisos ni presentarla como disponible.

## Alcance

El coordinador de esta conversación decide y revisa los encargos. El comando ejecuta una tarea explícita; no crea una organización autónoma, no decide publicar y no garantiza que el modelo haya satisfecho los criterios. La implementación de captura global del lector sigue siendo una propuesta separada.
