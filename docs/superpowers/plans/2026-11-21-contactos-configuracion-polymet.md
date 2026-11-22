# Contactos y configuración de Polymet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardar clientes, suplidores, fórmulas y configuración completos desde los componentes aprobados de Polymet, con integridad e intentos durables.

**Architecture:** Ampliar la API transaccional y el respaldo relacional existentes. El cliente operativo comparte el diario de solicitudes del catálogo y adapta sus instantáneas a los mismos componentes de la referencia. Los borradores fijan identidad, versión y generación; la presentación solo confirma después de un resultado durable.

**Tech Stack:** JavaScript ESM, React 18.3.1, componentes recuperados Radix/Lucide, PostgreSQL, Node/Cloudflare Fetch, pnpm, node:test y Playwright con Edge aislado.

**Spec:** `docs/superpowers/specs/2026-11-21-contactos-configuracion-polymet.md`; objetivo completo en `docs/superpowers/specs/2026-11-21-sistema-unificado-polymet.md`.

## Global Constraints

- Trabajar en `feat/sistema-unificado-offline`. Conservar `main` hasta que el usuario decida integrar.
- El diseño aprobado es el proyecto de Polymet, no una reinterpretación. Leer `design-system/repuestos-felix/MASTER.md` y `docs/design/polymet-reference.json` antes de cambiar pantallas.
- Usar los mismos componentes y estilos para web, PWA y Windows; adaptar al ancho disponible con los puntos de corte del original. No crear tres interfaces independientes.
- Usar **pnpm** y conservar el lockfile. No introducir npm ni un segundo gestor.
- Interfaz y mensajes en español. Moneda DOP (`RD$`), formato `es-DO`, zona del negocio `America/Santo_Domingo`.
- Conservar la API transaccional y su idempotencia, importes exactos, control de existencias y versiones. El servidor confirma cada operación. No volver al guardado global de JSON.
- El diseño puede contener datos de ejemplo. Nunca cargar esos datos en Supabase ni confundir un prototipo en memoria con operaciones guardadas.
- No emitir NCF simulados como comprobantes autorizados. No ejecutar migraciones ni escrituras de prueba en la base real.
- No poner contraseñas, tokens, conexiones administrativas, enlaces firmados o respaldos en Git, archivos públicos o logs.
- No modificar ni incluir en commits propios `wrangler.jsonc` y `docs/cloudflare-preparacion-2026-11-21.md`: cambios concurrentes ajenos a este plan.
- Pruebas de base con `temporaryPostgres()` de `tests/postgres.js`; pruebas de navegador con procesos/perfiles aislados. No usar las pestañas personales.
- Esta entrega no equivale a ventas/caja/cuentas, Windows offline, sincronización, instalación PWA o despliegue. Esas obligaciones permanecen abiertas.

## Contratos entre tareas

La API mantiene los nombres anteriores y agrega:

```js
// CRUD: POST colección; PUT/DELETE /:id. DELETE exige version.
// Todas las operaciones llevan databaseId e Idempotency-Key UUID.
// IDs/versiones públicos: enteros positivos seguros; importes públicos: number.
// Los nuevos atributos omitidos en ediciones legacy conservan su valor.
// POST omitiendo atributos nuevos usa ''/null; no inventa crédito ni fórmulas.
const cliente = { id, version, nombre, rnc, tel, correo, direccion,
  limiteCredito: null, esContado: false, deuda }; // null | importe no negativo
const suplidor = { id, version, nombre, rnc, tel, correo, contacto,
  diasCredito: null, formulaId: null }; // null | int32 y null | id
const formula = { id, version, nombre, factorCosto, recargo1, recargo2, recargo3 };
// factor: >0, <=999999.999, tres decimales; recargos: 0..99999.9999, cuatro.
const configuracion = { version, empresa, rnc, tel, correo, direccion,
  itbisPorcentaje, redondeo, nivelPrecioPredeterminado: null,
  formatoImpresion: null, pieTicket, permitirStockNegativo: false };
// redondeo: 0|1|5|10|25; nivel null|'p1'|'p2'|'p3'; formato null|
// 'Térmica 80 mm'|'Térmica 58 mm'|'Carta (8.5 x 11)'.
// PUT /api/configuracion es un patch de campos reconocidos + version:
// omisiones preservadas; sin campos mutables, ncf o stock negativo => 400.
// state conserva empresa,itbisRate,configuracionVersion y agrega configuracion,
// formulas; clientes/suplidores siguen sus arrays anteriores ampliados.
```

Los textos admiten hasta 2000 caracteres antes y después de normalizar; nombres requeridos no vacíos. No aceptar claves desconocidas en operaciones nuevas que parezcan guardadas. Crédito/días desconocidos permanecen `null`. `saldo_apertura`, `deuda`, identidad de contado e históricos no son editables mediante CRUD. Una baja de contacto es lógica y conserva documentos; la de cliente con deuda no nula se rechaza. El cliente de contado marcado se protege de edición/baja. El marcador se deriva únicamente de la entrada canónica inequívoca del inicializador (`Cliente Contado`, RNC/tel vacíos, apertura cero, activo, sin ventas a crédito); si hay ambigüedad no se asigna. No inferirlo por ID ni crear una segunda persona. La migración y la conversión de respaldos antiguos usan la misma condición documentada. Una marca explícita válida se preserva en v4.

`GET /api/state` y respuestas de escritura validan todos los campos operativos consumidos, no solo productos. Los fixtures de pruebas deben reflejar este contrato. `POST/PUT /api/formulas` y `DELETE /api/formulas/:id` usan las reglas comunes; una fórmula vinculada a cualquier suplidor conservado no se desactiva. Bloqueo de fila de fórmula antes de validar/asignar o eliminar evita la carrera entre ambas operaciones.

```js
// src/domain/pricing.js: módulo puro, sin Node/React/DB.
normalizeFormula({ costFactor, margins: {p1,p2,p3} })
// => {costFactor: '1.180', margins:{p1:'35.0000',p2:'25.0000',p3:'15.0000'}}
calculateFormula(cost, formula, rounding)
// => { adjustedCost: '1180.00', prices:{p1:'1595.00',p2:'1475.00',p3:'1360.00'}}
// cost acepta number|string decimal simple, máximo 999999999999.99.
// Rechaza blancos, signo, exponente, NaN, infinito y precisión/límites excedidos.
```

El adaptador de presentación `pricing.js` conserva sus exports y números para componentes, pero delega el cálculo al módulo exacto. El dominio redondea costo ajustado a centavos HALF_UP; aplica recargo racional; con paso 0 HALF_UP a centavos; con paso >0 eleva el racional no redondeado directamente al múltiplo de pesos. No redondear a centavos antes del techo. Desbordamientos son errores, no valores truncados.

El provider produce `customers`, `suppliers`, `formulas`, `settings`, `sales`, `purchases`, `receivables: []`, y `runtime.accountDetailsAvailable:false`. Los vacíos de cuentas no significan saldo cero. Customers usan `isCashCustomer` del marcador. Suppliers usan `balance:null` mientras no exista submayor. `sales/purchases.date` es `fechaISO` documental, sin hora inventada; números de documento no fiscales pueden derivarse del ID identificándolo como registro. `sales.status` no inventa pago/anulación. Detalle histórico se limita a datos disponibles.

```js
// DTO de componente preservado como objeto durante reintento incierto:
saveCustomer({id,version,databaseId,name,rnc,phone,email,address,creditLimit})
deleteCustomer({id,version,databaseId})
saveSupplier({id,version,databaseId,name,rnc,phone,email,contact,creditDays,formulaId})
deleteSupplier({id,version,databaseId})
saveFormula({id,version,databaseId,name,costFactor,margins:{p1,p2,p3}})
deleteFormula({id,version,databaseId})
updateSettings({version,databaseId,business:{name,rnc,phone,email,address}})
updateSettings({version,databaseId,itbisRate,rounding,defaultPriceLevel,printer,ticketFooter})
// Todos devuelven Promise de confirmación. id UUID local => POST; id numérico => PUT.
// settings mapea business, itbisRate en porcentaje, rounding, defaultPriceLevel,
// printer, ticketFooter, allowNegativeStock:false,ncf:[],version,databaseId.
```

El diario conserva el mismo paquete en resultados inciertos; ningún formulario reconstruye DTO desde una versión nueva durante un reintento. Un rechazo definitivo probado libera el borrador; una respuesta desconocida no se convierte en éxito. Configuración captura versión/generación al empezar a editar cada sección; cambios remotos no sobrescriben borradores sucios ni se usan para forzar su guardado. Tras éxito propio una sección limpia puede adoptar la nueva versión. Antes de la primera instantánea confirmada, usar estado de carga/error y deshabilitar escrituras; no abrir un borrador con generación/versión nulas ni presentarlo como configuración real. Los últimos datos confirmados pueden consultarse con su advertencia de desconexión.

### Task 1: Cálculo exacto de fórmulas y fechas documentales

**Files:** Create `src/domain/pricing.js`, `tests/pricing.test.js`; modify `frontend/src/polymet/lib/pricing.js`, `frontend/src/polymet/lib/accounts.js`, `frontend/src/polymet/components/product-form-sheet.jsx`, `frontend/src/polymet/components/purchase-entry-form.jsx`, `frontend/src/polymet/components/price-formulas-editor.jsx`; create `tests/document-dates.test.js`, `tests/pricing-preview.test.js`.

**Interfaces:** Consumes no nueva dependencia. Produces `normalizeFormula`/`calculateFormula` y los exports existentes de pricing/accounts para las tareas 2 y 5. Leer los contratos anteriores en la copia de restricciones del brief.

- [x] **Step 1: Escribir pruebas que fallen.** Ejemplos normativos:

```js
const f={costFactor:'1.18',margins:{p1:'35',p2:'25',p3:'15'}};
assert.deepEqual(calculateFormula('1000',f,5),{
  adjustedCost:'1180.00',prices:{p1:'1595.00',p2:'1475.00',p3:'1360.00'}});
assert.equal(calculateFormula('1.00', {costFactor:1,margins:{p1:0.0001,p2:0,p3:0}},1).prices.p1,'2.00');
assert.equal(calculateFormula('0.01',{costFactor:'0.5',margins:{p1:0,p2:0,p3:0}},0).adjustedCost,'0.01');
assert.throws(()=>normalizeFormula({costFactor:'',margins:{p1:0,p2:0,p3:0}}));
assert.throws(()=>calculateFormula('999999999999.99',f,0));
```

Incluir límites/precisión para factor/recargos/costo, paso inválido, cero explícito válido. Fechas: `formatDate('2026-01-01')` conserva día 1 bajo UTC y Santo Domingo; `formatDateTime`/`formatTime` no inventan hora para fecha sin hora. Instantes usan America/Santo_Domingo. Mantener textos del diseño salvo corrección documentada de día/hora.
- [x] **Step 2: Ejecutar** `node --test tests/pricing.test.js tests/document-dates.test.js` y registrar fallo de comportamiento real.
- [x] **Step 3: Implementar.** BigInt decimal escalado; errores de dominio en español. Adaptar exports existentes sin fixtures ni lógica de persistencia. Parsear fecha documental mediante componentes de calendario, no una medianoche UTC convertida a hora del negocio. No cambiar envejecimiento de cuentas aún no conectado salvo la función de formato requerida. Proteger los llamadores de sugerencias ProductFormSheet/PurchaseEntryForm/PriceFormulasEditor frente a borradores inválidos o cálculo desbordado: feedback inline, recuperación al corregir y no caída de render ni aplicar/agregar sugerencias inválidas. Conservar guardado manual válido del producto aunque una fórmula no pueda sugerir un precio. Una edición de renglón de compra admite costo cero explícito y rechaza blanco, conservando la regla positiva original para agregar. Prueba de navegador de referencia con fórmulas y costo/factor/recargos inválidos o desbordados; conservar el caso manual sin fórmula. El editor sigue con persistencia/borradores pendientes de Task 5; aquí solo se protege el nuevo contrato de errores del cálculo.
- [x] **Step 4: Ejecutar las pruebas del paso 2 y** `node --test tests/pricing-preview.test.js tests/catalog-forms.test.js`, `pnpm build:design`, `pnpm build:operational`. Informar comandos y resultados.
- [x] **Step 5: Revisar diff y commit** solo archivos propios: `git commit -m "Calculate price suggestions with exact decimal arithmetic"`.

### Task 2: Persistencia transaccional, migración y respaldo v4

**Files:** Create `supabase/migrations/20261122000000_contactos_configuracion.sql`, `src/pos/contact-operations.js`, `tests/contact-settings.test.js`; modify `src/pos/store.js`, `supabase/schema.sql`, pruebas que dependan del contrato de respaldo (`tests/catalog-metadata.test.js`, `tests/database.test.js`, `tests/operations.test.js` solo cuando el cambio sea necesario). Un helper pequeño de respaldo separado es válido si mantiene un único validador/listado de tablas.

**Interfaces:** Consumes `normalizeFormula` de Task 1. Produces API/snapshot definidos en Contratos, CRUD de contactos/fórmulas y respaldo `version:4` con diez tablas. Rutas y respuestas siguen `writeOperation`/`readSnapshot`; no nuevas transacciones anidadas ni saltos del protocolo de rechazo.

- [ ] **Step 1: Añadir pruebas HTTP + PostgreSQL desechable que fallen.** Prueba alta/edición con todos los campos y recarga independiente; omisión de nuevos campos; null desconocido frente a cero; rechazo de cambios a deuda/marker y claves desconocidas; conflicto de versión y misma clave concurrente; baja con historia y cliente con deuda; protección de contado sin ID fijo; fórmula completa, desactivación, asignación inexistente/inactiva y carrera asignación/baja. La configuración parcial preserva campos/versiones y rechaza NCF/stock negativo/valores fuera del conjunto. Incluir ITBIS `18.1234` en el roundtrip: snapshot de porcentaje con hasta cuatro decimales, sin residuos de multiplicación flotante. Verificar RLS/rol sin DDL para la tabla nueva.

```js
// Seguir harness write/state de tests/catalog-metadata.test.js.
const r = await write('clientes',{nombre:'Cliente prueba',rnc:'',tel:'',
 correo:'correo@ejemplo.test',direccion:'Dirección',limiteCredito:'1250.50'});
assert.equal(r.status,200);
const created=(await r.json()).state.clientes.find(c=>c.nombre==='Cliente prueba');
assert.equal(created.limiteCredito,1250.5);
const stale=await write(`clientes/${created.id}`,{nombre:'Conflicto',rnc:created.rnc,
 tel:created.tel,version:created.version},'PUT');
// Construir un cambio confirmado antes de stale; esperar 409 sin perder campos.
```

Respaldo: export v4, restauración completa incluyendo inactivos y referencia de fórmula, actualización v3/v2/legacy neutral, rechazo fila/tabla/relación/importe inválidos, rollback + archivo previo + rotación generación. Actualizar expectativas previas explícitamente sin reducir cobertura.
- [ ] **Step 2: Ejecutar** `node --test tests/contact-settings.test.js` para comprobar ausencia del comportamiento.
- [ ] **Step 3: Implementar migración aditiva.** Textos nuevos `NOT NULL DEFAULT ''` con longitud 2000; límite `numeric(14,2) NULL CHECK>=0`; días `integer NULL CHECK>=0`; cliente `es_contado boolean NOT NULL DEFAULT false`, único parcial para true, proteger marca de edición/baja. Fórmulas `id bigint identity`, nombre requerido, `factor_costo numeric(9,3)>0`, `recargo1/2/3 numeric(9,4)>=0`, activo/version/timestamps como catálogo. Suplidor `formula_id bigint NULL REFERENCES formulas_precios(id) ON DELETE RESTRICT`. Configuración nuevos campos según contratos; solo permitir stock negativo false. Valores desconocidos de nivel/formato null. Redondeo inicial 0. Dar únicamente privilegios/RLS pos_app necesarios. Actualizar `supabase/schema.sql` sin modificar migraciones previas. Import legacy/upgrade debe aplicar misma política inequívoca del marcador; documentar y probar ambigüedad sin adivinar.
- [ ] **Step 4: Implementar operaciones y snapshot.** Conservar callbacks transaccionales en store; extraer CRUD a módulo enfocado mediante funciones exportadas en vez de ampliar dispatch monolítico. Fórmula se bloquea antes de asignar/baja y vuelve a comprobar activa. Baja rechaza fórmula usada incluso por suplidor inactivo; clientes con deuda no nula o contado protegido. No generar obligaciones/hora/pagos ni recalcular documentos. Respaldo contiene orden fijo con fórmulas antes de suplidores; restaurar en orden y borrar al revés; validar atributos nuevos y comparar formato esperado por versión. No leer campos de usuario como identificadores SQL. No ejecutar SQL fuera de bases desechables.
- [ ] **Step 5: Ejecutar** `node --test tests/contact-settings.test.js tests/catalog-metadata.test.js tests/database.test.js tests/operations.test.js tests/transaction-cleanup.test.js tests/state-cache.test.js`; corregir solo regresiones justificadas. Commit `"Persist Polymet contacts formulas and business preferences"` con informe de TDD y compatibilidad.

### Task 3: Cliente durable y adaptador operativo para contactos/configuración

**Files:** Modify `frontend/src/data/pos-client.js`, `frontend/src/data/operational-store.jsx`, `frontend/src/polymet/components/product-form-sheet.jsx` (frontera de ID de fórmula); create `frontend/src/data/sales-options.js`; modify `frontend/src/polymet/data/pos-data.js` para reexportar constantes; update fixtures de `tests/pos-client.test.js`/`tests/catalog-forms.test.js` por el contrato ampliado; create `tests/contact-client.test.js`.

**Interfaces:** Consumes snapshot/operations Task 2, diario y protocolo de rechazo existentes. Produces métodos/DTO/settings de Contratos. No habilitar pantallas antes de su tarea UI. No importar `pos-data`, `seed-data`, `pos-store` demo al grafo operativo.

- [ ] **Step 1: Añadir pruebas renderizadas de provider/cliente que fallen.** Verificar mapeo de todos los campos, null/0 separados, ID numérico de relaciones, fecha sin hora, proveedor balance desconocido, ausencia de NCF demo y límites de configuraciones. Incluir selección de fórmula numérica real en ProductFormSheet por teclado: convertir valores de Radix a string y comparar IDs en la frontera sin cambiar la identidad de servidor. Ejercitar cada ruta permitida (POST/PUT/DELETE contactos/fórmulas, PUT configuración), rechazo de `restore`, URLs ajenas y campos arbitrarios. Verificar respuesta incompleta/falsa/malformada conserva journal/instantánea anterior. Reintento con mismo objeto/UUID/cuerpo tras respuesta incierta + recarga, rechazo definitivo desbloquea, otra pestaña no duplica operación.

```js
// Esquemas permitidos son finitos por ruta; claves anidadas no se aceptan en journal.
await client.writeOperation({method:'PUT',path:'/api/configuracion',databaseId,
 payload:{version:1,empresa:'Negocio',correo:'contacto@ejemplo.test'}});
// Provider traduce updateSettings({databaseId,version,business:{...}}) al patch plano.
```

- [ ] **Step 2: Ejecutar** `node --test tests/contact-client.test.js` y registrar rojo.
- [ ] **Step 3: Ampliar validación de snapshot y rutas/payload.** Campos reconocidos por operación y null solo donde permite contrato; no aflojar límites de catálogo ni aceptar JSON genérico. Rechazar números no finitos antes de JSON.stringify: NaN/Infinity no pueden convertirse silenciosamente en null en crédito/días/preferencias. El protocolo de errores conserva exactamente sus garantías. Reutilizar patrón WeakMap por acción mediante helper local pequeño. Métodos de guardado deben recordar el objeto original incierto; no transformar de nuevo antes de consultar su retry. `runtime.accountDetailsAvailable=false`. Agregados de ventas/compras solo de documentos reales; no calcular `suppliers.balance` desde compras ni inventar abonos. Extraer constantes de selección sin mover STORE_INFO/fixtures al bundle operativo.
- [ ] **Step 4: Ejecutar** `node --test tests/contact-client.test.js tests/pos-client.test.js tests/catalog-forms.test.js tests/operational-build.test.js` y `pnpm build:operational`; commit `"Connect durable contact and settings operations to the shared frontend"`.

### Task 4: Formularios y pantallas de clientes/suplidores confirmados

**Files:** Modify `frontend/src/polymet/components/party-form-sheet.jsx`, `frontend/src/polymet/pages/customers-page.jsx`, `frontend/src/polymet/pages/suppliers-page.jsx`, `frontend/operational.jsx`; create `tests/contact-forms.test.js` y `tests/contact-runtime.test.js`. Modificar `frontend/src/polymet/data/pos-store.jsx` solo para compatibilidad demo de delete DTO/Promise si hace falta.

**Interfaces:** Consumes provider Task 3 y `ConfirmDialog` async existente. Produce rutas reales `/clientes` y `/suplidores` manteniendo JSX/layout/iconos/temas de Polymet y sus formularios completos. `PartyFormSheet` agrega `toDTO(values)` opcional para capturar una vez el objeto preparado; onSave recibe ese mismo objeto durante retry, default identidad conserva usos demo. Error/definitive siguen ProductFormSheet.

- [ ] **Step 1: Añadir pruebas de navegador que fallen.** Alta y edición con todos los campos; guardado lento no cierra ni muestra toast; doble click 1 solicitud; rechazo conserva campos; incierto bloquea edición y repite paquete; rechazo definitivo libera; borrador no adopta version/DBgen de poll; edición null no se convierte en0; foco al abrir/cerrar/borrar última fila. Runtime real Node/PG con recarga verifica correo/dirección/límite/contacto/días/fórmula y baja histórica. A 320/390 px controles alcanzables, tabla con scroll interno; teclado y claro/oscuro sin errores JS.
- [ ] **Step 2: Ejecutar** `node --test tests/contact-forms.test.js` y capturar fallo esperado.
- [ ] **Step 3: Implementar guardado esperado y DTO estable.** Validación previa a journal con textos 2000/money2/int32 y null explícito para desconocido; etiquetas accesibles como ProductFormSheet. Capturar editing object/version/databaseId al abrir; UUID local para creación. `toDTO` solo se ejecuta para primer intento o nueva edición tras rechazo definitivo. Padres retornan Promise y notifican únicamente después de resolve; bajas reciben fila completa. IDs de Radix select se representan como string y se convierten en frontera, opción vacía válida de fórmula sin asignar. No seleccionar primera fórmula automáticamente para un histórico null.
- [ ] **Step 4: Conservar estructura y corregir estados reales.** Ocultar cliente de contado usando marcador operativo, conservar referencia c-000 solo en demo mediante isCashCustomer explícito. Crédito null muestra «Sin configurar», cero «Solo contado». Proveedor balance null y agregado muestran «No disponible», no RD$0. Cuentas aún sin submayor explican estado desconocido y no presentan lista vacía como prueba de ausencia de deuda. Detalles muestran las compras/ventas reales y fecha documental correcta; no botón de cobro con callback ficticio. El agregado mensual compara fechas documentales de calendario con el mes de America/Santo_Domingo; no excluir el primer día convirtiéndolo a medianoche UTC ni usar el huso del teléfono. Probar una compra del día 1 con navegador en otro huso. Resolver overflow conocido de tarjetas suplidor con min-w-0/wordwrap conservando composición. Habilitar solo estas dos rutas además del inventario.
- [ ] **Step 5: Ejecutar** `node --test tests/contact-forms.test.js tests/contact-runtime.test.js tests/catalog-forms.test.js tests/operational-build.test.js`, builds operativa/referencia y commit `"Save complete Polymet contact forms with confirmed results"`.

### Task 5: Configuración y fórmulas con borradores explícitos

**Files:** Modify `frontend/src/polymet/pages/settings-page.jsx`, `frontend/src/polymet/components/price-formulas-editor.jsx`, `frontend/operational.jsx`; create `tests/settings-forms.test.js`, `tests/settings-runtime.test.js`; demo provider solo si se necesita compatibilidad de su callback.

**Interfaces:** Consumes Task 1 cálculo, Task 3 provider confirmado, Task 4 patrón UI de solicitudes. Produce `/configuracion` con todas las preferencias comerciales persistentes. FormulaEditor acepta metadata de generación para nuevas fórmulas (`databaseId` prop desde settings); recibe filas con version/databaseId. No modificar operaciones de inventario/cuentas ni atributos fiscales autorizados.

- [ ] **Step 1: Añadir pruebas de navegador que fallen.** Negocio/facturación guardan todos los campos y sobreviven reload realPG. Versión capturada al inicio; poll/cambio remoto no fuerza overwrite. Error conserva borrador. Incierto congela exactamente DTO y mantiene UUID. Campos no se pierden en save de otra sección. Fórmula editar por tecla NO dispara fetch; alta/edición solo guardado explícito; cancelar descarta local sin escribir; eliminar espera confirmación y en uso muestra error conservando fila. Precisión/valores inválidos no se sustituyen por defaults ni crean journal. Previsualización coherente con cálculos Task1 incluyendo redondeo. NCF sin muestras y switch existencias negativas no finge configuración compatible. A 320/390 px no overflow de documento y controles accesibles.
- [ ] **Step 2: Ejecutar** `node --test tests/settings-forms.test.js` con fallo real.
- [ ] **Step 3: Implementar sección con borrador/version fija.** Usar los mismos Inputs/Selects/Sections/Tabs y clases del original. Al primer cambio capturar base versión/generación, si limpia adoptar snapshot. No sobrescribir cambios sucios cuando cambie snapshot o se guarde otra pestaña. Validar campos sin coerción silenciosa; ninguna escritura por tecla. Agregar botones existentes de estilo Guardar/Cancelar y estado «Cambios sin guardar» únicamente cuando hay draft; cambios visuales de estado documentados. Tras rechazo definitivo permitir corregir; tras incierto repetir mismo DTO. Prevención de envío doble y foco correcto. `settings.printer` vacío conserva null/no configurada; nombre no vacío y datos trim<=2000. `ncf:[]`: conservar pestaña y tarjeta con explicación/controles deshabilitados, sin texto que prometa emisión ya implementada. Deshabilitar switch negativo con explicación real; no guardarlo como política activa.
- [ ] **Step 4: FormulaEditor mantiene drafts de filas separados de snapshot.** Nueva fórmula es draft local nombrado por usuario, factor/recargos iniciales revisables; no persistir preset al agregar. Filas limpias conservan composición original. Guardar usa DTO estable y metadata fija; null/blank/factor0 inválidos se presentan como error. El preview captura error en vez de mostrar NaN o coerción. Uso de fórmula desde snapshot solo orienta; servidor decide baja/asignación. No perder draft por polling. En modo demo conservar la referencia en reposo y callbacks legítimos en memoria sin alterar bundle operativo.
- [ ] **Step 5: Ejecutar** `node --test tests/settings-forms.test.js tests/settings-runtime.test.js tests/pricing.test.js tests/operational-build.test.js`; builds y commit `"Persist Polymet settings and explicit price formula drafts"`.

### Task 6: Integración visual, regresión y evidencia de alcance

**Files:** Create `scripts/compare-contacts-settings.mjs`, `docs/design/validacion-contactos-configuracion-2026-11-21.md`, manifest/capturas seleccionadas bajo `docs/design/`; modify `docs/estado-sistema-unificado.md` y este plan (checkboxes), pruebas de runtime solo ante defectos concretos.

**Interfaces:** Consumes todas las tareas. Produce evidencia reproducible sin datos de negocio ni paquetes de respaldo; mantiene separación referencia/función/build/Windows/deploy.

- [ ] **Step 1: Crear comparación antes de adjudicar igualdad.** Reutilizar aislamiento/hashing de `scripts/compare-catalog.mjs`: datos iguales solo en PostgreSQL desechable, misma fuente/render del public preview, sin tokens/editor/URLs firmadas. Rutas Clientes/Suplidores/Configuración, 390×844/768×1024/1440×1000, claro/oscuro. Comparar main y formularios elegidos; explicar que shell/datos no disponibles no son equivalentes todavía. No sembrar estado demo en producción.
- [ ] **Step 2: Ejecutar matriz.** Capturas de reposo y diálogos en viewport comparable; revisar imágenes y overflow/errorconsole; cuantificar diferencias. Las diferencias por crédito/saldo/fiscal desconocidos o por guardado explícito son estados documentados y necesarios; otras diferencias de composición se corrigen antes de cerrar. Si preview remoto cambió respecto al SHA aprobado, conservar evidencia local original y no sustituir referencia sin decisión registrada.
- [ ] **Step 3: Ejecutar** `pnpm test`, `pnpm build:design`, `pnpm build:operational`, `pnpm build:worker` (dryrun). No desplegar, no ejecutar migración real. Registrar conteos, comandos y limitaciones; afirmar solo lo observado. No repetir suite sin cambios/concern real.
- [ ] **Step 4: Documentar** API/atributos/compatibilidad/null/marcador de contado/drafts/fórmulas, vistas revisadas y las obligaciones pendientes del objetivo completo. Mantener estado de migración real pendiente y reconocer preparación Cloudflare actual sin revertir cambios concurrentes. No prometer PWA instalada/Windows offline/publicación. Actualizar checkboxes con evidencia y commit `"Verify connected contact and settings screens against Polymet"`.

## Verificación de cobertura previa a ejecución

Campos/contactos, configuración y fórmulas: tareas 1–5. Idempotencia/versiones y saldos históricos: 2–5. Respaldo/RLS/legacy: 2. Diario/retry y respuestas completas: 3–5. Diseño/adaptación/accesibilidad: 4–6. Evidencia multiplataforma y límites: 6. La especificación completa permanece abierta tras esta etapa.


