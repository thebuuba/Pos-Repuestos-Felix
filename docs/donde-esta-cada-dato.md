# Dónde encontrar los datos de Repuestos Félix

Abre el proyecto **Repuestos Felix** de Virginia en Supabase. En el menú izquierdo, **Authentication → Users** reúne las cuentas que pueden iniciar sesión. **Table Editor** muestra los datos del negocio. El selector de esquema en la parte superior del editor permite elegir entre los datos actuales y el archivo histórico.

| Quiero encontrar… | Dónde abrirlo |
| --- | --- |
| La cuenta de una persona que usa el POS | [Authentication → Users](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/auth/users). Busca el nombre de usuario antes de la arroba. |
| Artículos, códigos, precios y existencia actual | [Inventario · public.productos](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17731?schema=public) |
| Las entradas, salidas y ajustes de una pieza | [Movimientos de inventario](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17865?schema=public). Cada fila indica el artículo, la cantidad y la existencia resultante. |
| Las personas o empresas que compran en el negocio | [Clientes](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17691?schema=public) |
| Quienes le venden mercancía al negocio | [Suplidores](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17712?schema=public) |
| Las ventas del POS actual y los artículos de cada una | [Ventas](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17754?schema=public) y [detalle por artículo](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17784?schema=public). El campo `venta_id` une las dos tablas. |
| Las compras del POS actual y los artículos recibidos | [Compras](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17814?schema=public) y [detalle por artículo](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17835?schema=public). El campo `compra_id` une las dos tablas. |
| Datos del negocio, ITBIS y reglas de precios | [Configuración](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/17677?schema=public) y [fórmulas de precios](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor/18050?schema=public) |
| Documentos e históricos importados del sistema anterior | [Table Editor](https://supabase.com/dashboard/project/uzbranexwuzcwkxaifsq/editor) → esquema `netpos_historico`. Conserva las 49 tablas del archivo NetPOS. |
| Copias originales de la importación y controles internos | En Table Editor, esquema `pos_privado`. `netpos_archivos` conserva los originales y `netpos_importaciones` identifica la carga. |

Para registrar o corregir una operación, utiliza el POS. Por ejemplo, un ajuste de inventario debe actualizar tanto la existencia como su movimiento asociado. La aplicación guarda ambos cambios juntos.

## Cuentas de acceso

Cada empleado entra con un **nombre de usuario y una contraseña**. En Supabase aparece con un identificador como `caja1@usuarios.repuestosfelix.invalid`. La persona escribe únicamente `caja1` en el POS. El dominio interno permite usar la autenticación por contraseña de Supabase sin pedir un correo personal. El administrador puede buscar la cuenta en **Users** para consultar el último acceso o bloquearla.

Para dar de alta a una persona desde la computadora administrativa, usa el CLI de Supabase con la cuenta de Repuestos Félix y ejecuta lo siguiente desde la carpeta del proyecto. Sustituye `caja1` por el nombre de esa persona.

```powershell
pnpm usuarios:crear caja1
```

El comando pide la contraseña en privado y confirma el alta en Supabase. También asigna el permiso de acceso al POS. Cada cuenta habilitada tiene las funciones operativas que ofrece actualmente el sistema. Los permisos diferenciados de dueño y cajero siguen pendientes.

Para cambiar una contraseña conocida, abre **Iniciar sesión → Cambiar mi contraseña**, escribe la actual y elige una nueva. Si alguien la olvida, un administrador del proyecto debe restablecerla con las herramientas de administración de Supabase. Los identificadores internos carecen de buzón para recibir correos de recuperación.
