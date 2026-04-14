# Cheat Sheet Personal — Junta Apr 15, 2026

**Esto es tu acordeon. No lo compartas — es para que tu sepas de que hablan.**

## 1. Temas Abiertos de Juntas Pasadas

| Tema | Que significa en cristiano | Status | Quien lo mueve |
|------|---------------------------|--------|----------------|
| **Manual eligibility records** | Cuando un agente corrige a mano la elegibilidad de un paciente (ej: el archivo del payer dice "no cubierto" pero SI esta cubierto), donde se guarda esa correccion? Nick dice tabla aparte, Jack dice misma tabla con un flag. No se pusieron de acuerdo. | Ticket viejo (#185716) eliminado, nuevo #187564 creado con scope refinado. Nadie lo ha tocado. | Michal |
| **T1 vs T2 NPI split** | T1 = doctor (persona). T2 = clinica (organizacion). La pregunta es: dos tablas separadas o una sola con un campo "tipo"? Ya decidieron dos tablas, pero Nick le preocupa duplicar columnas iguales en ambas. | Bajo discusion. Arben debe actualizar el diagrama de Provider. | Arben / Nick |
| **Phase 1 scope boundary** | Que tan profundo llega la taxonomia de payers en V1? Cada payer (BlueCross, Aetna, etc.) tiene su propia jerarquia de productos/grupos. Si metes todo en V1, es enorme. Si no, que cortas? | Necesita escalamiento ejecutivo. Nadie lo ha escalado. | Michal |
| **Dual/DSNP eligibility** | Un paciente puede tener DOS seguros a la vez (Medicare + Medicaid = "dual eligible"). Cuando pasa eso, se crean 2 registros o 1 registro con 2 lineas? Eso afecta toda la estructura de PotentialEligibility. | Formalizado como ticket #183771 (Inna). Existe pero no hay decision. | Inna |
| **Eligibility final adjustment** | Ajustes finales al schema de eligibility despues de todos los workshops. Es el "cierre" del diseño antes de congelar para V1. | Activo — #187385. Michal lo tiene. | Michal |
| **Mid-case re-evaluation** | Si un paciente esta en medio de un caso y llega eligibilidad nueva (ej: cambio de plan), que pasa? Se recarga el caso? Se crea uno nuevo? No hay diseño. | Sin dueño, sin ticket, sin diseño. Riesgo silencioso. | TBD |

## 2. Case Schema — Lo que TU hiciste en Miro

- **CaseOfficeContact** — cuando un agente abre un caso, mete a mano el telefono/fax/email de la oficina del doctor. No viene del master de providers, es dato del caso. Dos filas: una para el ordering (quien pide la autorizacion) y otra para el servicing (quien da el tratamiento).
- **CasePOSCode** — codigo de 2 digitos de CMS que dice DONDE se da el servicio (11 = consultorio, 22 = hospital ambulatorio). Cada payer decide su lista. Sin este codigo, la autorizacion puede no cuadrar con el claim.
- **15/15 entidades** auditadas contra el System Design Doc. Todo cuadra.

## 3. Eligibility Silver Mapping — Lo que Nick entrego

Nick comparo lo que hay en Databricks HOY contra lo que el Miro dice que DEBERIA haber. Su Excel dice:

- **Verde** = "esto ya lo tenemos en el ETL, todo bien"
- **Amarillo** = "esto falta en Miro, habria que agregarlo"
- **Naranja** = "esto esta en Miro pero nadie sabe para que sirve"

**Lo que acordaron en la grabacion:**
- `version` → `eligibility_key` (nombre mas claro)
- `coverage_start` / `coverage_end` = cuando el paciente TIENE cobertura (fechas del negocio)
- `created_at` = cuando el ETL metio el registro al sistema (fecha tecnica, distinta)

**Tu accion:** Contestar a Nick con acuse de recibo. Nada mas.

## 4. Cross-Domain Integration Map — Tu diagrama

Tu ER muestra como fluyen los datos entre 3 dominios: Eligibility → Provider → Case. Nadie en el equipo tiene uno asi — los ERs existentes son por dominio aislado. Tienes version light (fondo blanco) lista para arrastrar a Miro.

**Si preguntan:** "Es un Context Map de DDD — muestra donde se tocan los dominios, no el detalle interno de cada uno."

## 5. Cosas que NO te tocan (no opines)

- Las preguntas naranjas de Nick (RiskPatient, SpanType, etc.) — son de product/Jack
- Facility Type configurable por payer — es de config team (Phoenix)
- Specialty/Taxonomy en providers — es de Arben/data team provider side
- El POC de Arben (ADLS+Airflow+COPY) — es su solucion, tu Option D es aparte y va con Michal

---

**Regla de oro para la junta:** Presenta lo tuyo (secciones 2, 3, 4). Escucha lo demas. No cuestiones lo que no te toca.
