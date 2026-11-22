# Coordinación de desarrollo

Codex es el coordinador: concreta el objetivo con el usuario, reparte tareas, revisa las propuestas, ejecuta las pruebas pertinentes e integra únicamente el trabajo aceptado en `feat/sistema-unificado-offline`. Antigravity y Codex CLI son trabajadores invocados mediante sus sesiones locales; no hace falta poner claves en el proyecto.

```powershell
pnpm agentes estado
pnpm agentes ejecutar docs/agentes/lector-usb.json
```

`estado` comprueba la disponibilidad y versión de los ejecutables, no su autenticación. El primer uso de cada CLI requiere una sesión válida (`agy` o `codex login`). El comando encuentra la instalación habitual de Windows aunque la terminal abierta todavía tenga el PATH anterior. Ejecutar tareas consume la cuota de la cuenta conectada.

## Contrato de una tarea

Usa un JSON como `lector-usb.json`. `motor` admite `codex` o `antigravity`; `modo`, `analisis` o `implementacion`. `archivos` contiene rutas relativas exactas, o directorios terminados en `/`. `criterios` describe lo que debe comprobarse. `modelo` es opcional: Antigravity utiliza Gemini 4 Neon High por defecto y Codex utiliza el valor predeterminado de su CLI.

Cada ejecución crea un worktree separado en `.agent-runs/` desde el **último commit**, registra su hash y señala si omitió cambios locales. No copia `.env`, datos locales, dependencias ni otros archivos ignorados. Los trabajadores reciben las reglas del negocio y la prohibición de publicar, hacer commits o usar la base real. El proceso no hereda variables de conexión o despliegue. Las protecciones de los CLI permanecen activas; un worktree es aislamiento de cambios Git y no una máquina virtual.

El comando adjunta al mensaje `AGENTS.md` y el contenido de los archivos de texto asignados, hasta 160 KB. Excluye rutas sensibles y rechaza enlaces, submódulos o archivos binarios. Así los análisis no dependen de que el trabajador pueda abrir una terminal. En este equipo se verificó que Codex CLI respondía, pero su entorno bloqueaba lecturas por terminal y una edición de prueba; el contexto adjunto permite usarlo para análisis y revisión. Eso no demuestra que su edición directa esté disponible.

## Entrega y revisión

En cada ejecución se conservan `result.json`, `response.md`, `changes.patch` y `workspace/`. Un resultado válido queda en **requiere_revision**. Salida 0 del CLI y una respuesta convincente no acreditan una funcionalidad terminada. Antigravity puede denegar herramientas aunque termine con código 0; el informe avisa cuando lo comunica por stderr.

Una implementación sin cambios se marca **fallida**, aunque el CLI responda con éxito. Si falla después de modificar archivos, se registra la lista de cambios y se conserva el parche cuando todo está dentro del alcance; si aparecen archivos sensibles o ajenos al encargo no se exporta su contenido al parche. También se detectan archivos nuevos ignorados por Git. Al ejecutar una tarea de implementación se transmite autorización explícita para proceder dentro del alcance, respetando las restricciones técnicas del CLI.

El coordinador comprueba criterios y alcance, revisa el parche y ejecuta las pruebas en la copia aislada, instalando dependencias con `pnpm install --frozen-lockfile` si hace falta. Las operaciones de negocio se prueban solo con bases desechables. Después integra el parche desde la raíz mediante `git apply --check <ruta-del-parche>` y `git apply <ruta-del-parche>`, vuelve a comprobar lo afectado y realiza los commits autorizados. Si hubo otros cambios en la rama, resuelve las diferencias antes de integrar; no se hace merge, commit, push, despliegue ni migración automáticamente.

Pueden repartirse tareas independientes con copias separadas. Codex debe asignar archivos que no se solapen y revisar las dependencias antes de integrar. Las tareas dependientes se ejecutan después de guardar el resultado anterior en un commit. Una tarea de análisis que escribe, una implementación que sale de su alcance o un trabajador que crea commits se marca **fallida** y conserva su copia para revisión.

El límite de cada ejecución es diez minutos. Un timeout detiene el proceso local y marca la entrega fallida. Si se termina abruptamente el coordinador, un registro puede conservar `en_ejecucion`; ese texto no acredita que siga trabajando y debe revisarse antes de repetirlo. Las copias no se eliminan automáticamente. Para retirar una entrega ya integrada, usa `git worktree remove <workspace>` sin forzar, tras verificar que su contenido está guardado.

Referencias: [ejecución no interactiva de Antigravity](https://antigravity.google/docs/cli/headless) y ayuda local `codex exec --help`.

## Verificación del 22 de noviembre de 2026

- Codex CLI 0.167.0 y Antigravity CLI 1.5.14 detectados.
- Ambos CLI analizaron correctamente `productForBarcode` desde el contexto asignado, con entregas sin cambios sobre la base `386004889e9a27b31cd6481bcd5f767654c445bc`.
- Antigravity realizó además el análisis del lector USB de ejemplo: confirmó la dependencia del foco y de Enter y propuso cómo conservar una venta entre rutas. Ese análisis no implementa el escaneo global ni sustituye una prueba del lector físico.
- En un repositorio desechable, Antigravity cambió `demo.txt` de `antes` a `correcto`, mantuvo el original intacto y entregó un parche que aprobó `git apply --check`. La verificación acepta CRLF conservado por Windows. La primera ejecución pidió confirmación por una regla global; la ejecución con autorización acotada explícita realizó el cambio.
- Codex CLI analizó correctamente el contexto, pero la edición sintética quedó bloqueada por su entorno de solo lectura. Aquí Codex sigue coordinando e integrando mediante las herramientas de la sesión; no se declara verificada la edición directa del CLI.
- `node --test tests/orchestrator.test.js`: 4/4 pruebas aprobadas, con casos de alcance, archivos ignorados y sensibles, trabajo parcial, ausencia de cambios, protocolo, proceso y timeout. Revisión independiente de código y corrección de sus tres hallazgos. No se modificó código del POS ni se probó contra la base del negocio.

Los informes y las copias locales están en `.agent-runs/`; la comprobación de edición se registra en `.agent-runs/implementation-evidence.json`. No se versionan sesiones ni respuestas privadas de los CLI.
