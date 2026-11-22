# Referencia de Polymet y código compartido

El usuario eligió reproducir su [proyecto de Polymet](https://dev-untitled-pro-bq7q4q8y.polymet.app/). Las reglas persistentes están en [MASTER.md](../../design-system/repuestos-felix/MASTER.md) y [AGENTS.md](../../AGENTS.md). [polymet-reference.json](polymet-reference.json) registra proyecto, versión, hash y rutas.

## Estado de esta entrega

Se recuperaron 71 módulos propios con JSX editable y el CSS de la versión publicada. No se copiaron las implementaciones de bibliotecas dentro del código de la aplicación. Se instalaron sus versiones declaradas con pnpm para conservar la referencia. La fuente Inter y el avatar demostrativo se sirven localmente; no se ejecuta la instrumentación del editor ni se requiere una CDN para esta vista.

`frontend/reference.jsx` compila una **demostración de diseño** que usa el estado en memoria original. Sirve para comparar las doce pantallas, no para registrar operaciones del negocio. El POS operativo sigue en `public/`, con su API y PostgreSQL. La integración funcional, el almacenamiento offline, la sincronización y Windows siguen pendientes en el alcance del [sistema unificado](../superpowers/specs/2026-11-21-sistema-unificado-polymet.md).

## Ejecutar y comprobar

```powershell
pnpm build:reference
pnpm preview:reference
```

La vista se abre manualmente en `http://127.0.0.1:3001`. El servidor escucha solo en la interfaz local, no carga archivos `.env`, no expone la API y solo sirve los recursos compilados y las rutas conocidas. Su carpeta `dist/design-preview/` queda fuera de la publicación Worker.

```powershell
pnpm test:design
node scripts/compare-design.mjs
```

La prueba usa Microsoft Edge instalado y un perfil temporal; no usa el perfil personal. Verifica navegación, títulos de todos los módulos, tema oscuro, menú móvil, espaciado de la factura en 390 px, ausencia de errores JavaScript y de solicitudes externas, y que el servidor de diseño no exponga API ni `.env`.

La comparación accede únicamente a la vista pública de Polymet, comprueba su hash antes de comenzar y produce capturas de referencia/local y un informe por ruta, tamaño y tema en `dist/design-comparison-current/` (puede pasarse otro nombre como argumento). Fija la fecha, zona y datos para comparaciones reproducibles. Su informe registra diferencias, incluso cuando las encuentra; ejecutar el comando no equivale a aprobar automáticamente la fidelidad. No utiliza la base real. Los resultados completos se revisan antes de registrar una conclusión.

## Recuperar otra copia sin sobrescribir trabajo

La fuente pública descargada se conserva solo en `supabase/.temp/polymet/reference.js`, excluida de Git. La URL firmada del almacenamiento no se guarda. No es un ZIP original de Polymet y sus tipos TypeScript no están disponibles; el script reconstruye JSX desde su JavaScript compilado con límites de archivo.

```powershell
node scripts/recover-polymet.mjs supabase/.temp/polymet/reference.js supabase/.temp/polymet/nueva-recuperacion
```

El destino debe ser nuevo. El script verifica el hash y se niega a sobrescribir código integrado. Una nueva versión del prototipo requiere revisar primero su procedencia y diferencias; no cambiar el hash solo para saltarse la comprobación. El avatar local y `standards.css` son ajustes conscientes para servir recursos offline y conservar el aspecto con HTML5.

## Diferencias verificadas de la importación

- Polymet omite el doctype. Mantener HTML5 en la copia y cajas de etiqueta explícitas reproduce su espaciado sin depender del modo quirks; una prueba reproduce y evita la diferencia de 56 px de alto en la factura móvil.
- `Trash2` es el nombre original del icono Lucide; su número no es un sufijo de compilación. El recuperador conserva los nombres canónicos de iconos.
- Recharts 2.15.4 coincide con la referencia pero su rama está deprecada. Antes de usar el paquete final, evaluar la migración con capturas y pruebas; no actualizar a ciegas alterando gráficas y medidas.
