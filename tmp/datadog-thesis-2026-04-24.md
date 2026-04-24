# Datadog — Estudio Estratégico de Producto
### Grado Tesis · Estilo McKinsey · Abril 2026
**Preparado por:** Carlos Carrillo, NewFire Global  
**Pregunta central:** ¿Compramos Datadog o lo construimos en Databricks?

---

## Tabla de Contenido
1. Executive Summary
2. ¿Qué es Datadog? Historia y posicionamiento
3. Arquitectura técnica y capacidades del producto
4. Modelo de negocio y pricing
5. Fortalezas (What Datadog does best)
6. Debilidades, quejas y puntos de dolor
7. Análisis competitivo — Dynatrace y New Relic
8. Tabla comparativa de los 3 productos
9. Marco de Decisión: Comprar vs. Construir en Databricks
10. Recomendación final y criterios de adopción

---

## 1. Executive Summary

**Veredicto:** **Comprar Datadog** para observabilidad de aplicaciones e infraestructura. **Construir en Databricks** es viable SOLO para la capa de observabilidad de datos (pipelines, calidad de datos). La combinación óptima para la mayoría de los clientes enterprise es Datadog + Databricks integrados — no uno versus el otro.

**Números que importan:**
- Datadog: $3.43B revenue (2025), S&P 500, Nasdaq:DDOG, 8,100 empleados, 750+ integraciones
- Competitor gap: Dynatrace $1.7B, New Relic $926M (privatizado) — Datadog duplica en tamaño
- Precio mínimo: ~$18/mes base, creciente por host/GB/módulo
- ROI típico reportado: reducción del 10-15% en costos de cloud + reducción de downtime no planeado

**La única razón legítima para NO comprar Datadog** es presupuesto limitado (<20 hosts, startup), stack 100% data/Databricks sin apps web, o restricciones de compliance con datos sensibles en tránsito.

---

## 2. ¿Qué es Datadog? Historia y Posicionamiento

### Fundación y misión
Datadog fue fundada en **Nueva York en 2010** por **Olivier Pomel** (CEO) y **Alexis Lê-Quôc** (CTO), ex-compañeros del Ecole Centrale Paris que se conocieron trabajando en Wireless Generation (adquirida por NewsCorp). La frustración entre equipos de Dev y Ops fue el catalizador del producto.

**Misión original:** Eliminar el friction entre desarrolladores y equipos de operaciones de sistemas mediante visibilidad unificada.

### Hitos de crecimiento
| Año | Evento |
|-----|--------|
| 2010 | Seed round, NYC |
| 2012 | Serie A $6.2M (Index Ventures + RTP) |
| 2014 | Serie B $15M — expande a AWS, Azure, GCP |
| 2016 | Beta APM lanzado — primer full-stack monitoring |
| 2016 | Serie D $94.5M (ICONIQ Capital) |
| 2019 | IPO Nasdaq — $648M recaudados, market cap $8.7B el día 1 |
| 2019 | Rechaza oferta de Cisco por más de $7B para ir a bolsa |
| 2025 | Ingresa al S&P 500 |
| 2026 | Lanza Bits AI — agentes autónomos de SRE y Seguridad |

### Posición de mercado (2026)
- **Líder** del cuadrante Gartner Magic Quadrant for Observability Platforms (junto con Dynatrace)
- **Ticker:** NASDAQ: DDOG — Nasdaq-100 component, S&P 500 component
- **Revenue 2025:** $3.43B (+25% YoY estimado)
- **Empleados:** 8,100 en 33 países
- **HQ:** New York City (New York Times Building)

---

## 3. Arquitectura Técnica y Capacidades del Producto

### El Agente Datadog
- Escrito en **Go** (desde v6, lanzado febrero 2018; antes en Python)
- Se instala en hosts, contenedores, funciones Lambda, pods de Kubernetes
- Recolecta: métricas, trazas, logs, procesos, network flows, security events
- Envía a backend Datadog via HTTPS (comprimido, cifrado TLS)

### Stack de backend
- **Apache Cassandra** — almacenamiento de métricas de series de tiempo
- **Apache Kafka** — ingestión de streams de alta velocidad  
- **PostgreSQL** — metadatos, configuraciones
- **D3.js** — visualizaciones frontend
- Mix de open-source + código propietario

### Módulos del producto (Full Suite 2026)

**Infraestructura:**
- Infrastructure Monitoring — hosts, VMs, containers, serverless
- Network Performance Monitoring (NPM) — flows, latencia entre servicios
- Network Device Monitoring — switches, routers
- Cloud Cost Management — análisis y optimización de gasto cloud

**Aplicaciones:**
- APM (Application Performance Monitoring) — traces, flame graphs, distributed tracing
- Continuous Profiler — CPU/memory profiling a nivel código en producción
- Error Tracking — agrupación de errores, root cause
- Database Monitoring — query performance, explain plans, wait events (MS-SQL, PostgreSQL, MySQL, MongoDB)

**Logs:**
- Log Management — ingestión, indexación, parseo, búsqueda full-text
- Log Archives — tiered storage (warm/cold)
- Audit Trail — log de actividad del usuario

**Experiencia Digital:**
- Real User Monitoring (RUM) — performance desde el browser/mobile del usuario real
- Synthetic Monitoring — tests automatizados de APIs y navegador desde 30+ locaciones globales
- Session Replay — grabación de sesiones de usuario

**Seguridad (Datadog Security):**
- Cloud SIEM — correlación de eventos de seguridad
- Application Security Management (ASM) — OWASP Top 10, WAF en runtime (adquirido de Sqreen)
- Cloud Security Posture Management (CSPM)
- Cloud Workload Security (CWS) — detección de amenazas en runtime (eBPF)

**CI/CD y Developer:**
- CI Visibility — test performance, flaky tests, build analytics
- Deployment Tracking — correlación de deploys con incidentes
- Code Profiling en CI/CD

**Observabilidad de Datos (2025-2026):**
- Data Observability (Metaplane, adquirida abril 2025) — calidad de datos, lineage, anomalías en pipelines
- Integración nativa con Databricks, dbt, Airflow, Snowflake

**AI/ML:**
- AI Observability — monitoreo de modelos LLM, tokens, latencia, costos
- Bits AI (lanzado 2026) — agentes autónomos:
  - **SRE Agent** — detecta, diagnostica y remedia incidentes automáticamente
  - **Security Analyst** — investiga alertas de seguridad sin intervención humana

### Integraciones
**750+ integraciones** incluyendo: AWS (todos los servicios), Azure, GCP, Kubernetes, Docker, Redis, Kafka, Spark, Databricks, Snowflake, dbt, Airflow, GitHub, Jira, PagerDuty, Slack, SAP HANA, Vertica, MongoDB, PostgreSQL, MySQL, MS-SQL, y virtualmente todo el stack de DevOps/DataOps moderno.

---

## 4. Modelo de Negocio y Pricing

### Modelo de consumo
Datadog NO tiene un precio fijo. Es **consumption-based** con múltiples dimensiones:

| Dimensión | Qué se cobra | Nivel aprox. |
|-----------|-------------|--------------|
| Infrastructure | Por host/mes (Pro: ~$23/host) | $15-35/host/mes |
| APM | Por host monitoreado + Spans indexados | $31/host APM Pro |
| Logs | Por GB ingestado + GB indexado | $0.10/GB ingest, $1.70/GB indexed |
| Custom Metrics | Por métrica personalizada (1,000 incluidas) | $0.05/metric/mes |
| RUM | Por 10,000 sesiones | $1.50 por 10K sessions |
| Synthetics | Por test ejecutado | Variable |
| Security | Por host con CSPM/CWS activado | Adicional |

**Precio mínimo de entrada:** ~$18/mes (Free trial disponible, plan Free con 5 hosts)  
**Tamaño medio de empresa:** $200K-1M/año para 100-500 hosts con APM + Logs  
**Enterprise deals:** $1M-5M/año para deployments grandes; negociables con Enterprise agreements

### Trampa del pricing — la queja #1
El modelo de pricing es complejo y puede causar **bill shock**:
- Logs indexados se acumulan rápidamente — equipos sin retención configurada pagan exponencialmente más
- Custom metrics cuestan extra — si un equipo emite 100K métricas custom, el costo explota
- Por host es predecible, pero orquestadores elásticos (K8s, Lambda) requieren cálculo cuidadoso

---

## 5. Fortalezas — Lo que Datadog Hace Mejor

### 5.1 Unified observability — las tres columnas en un lugar
La propuesta de valor central es la correlación automática de **métricas + trazas + logs** en una sola plataforma. Cuando ocurre un incidente, el ingeniero puede ir de una alerta de infraestructura → al trace de la request afectada → a los logs del microservicio específico → al deploy que causó el problema. Sin cambiar de herramienta.

> *"Engineers can quickly correlate logs, metrics, and traces in one place instead of spending hours searching across servers."* — TrustRadius 2025

### 5.2 Facilidad de instalación (Time-to-value < 30 minutos)
El agente se instala con un comando y auto-descubre la mayoría de los servicios. No requiere instrumentación manual en la mayoría de los casos (auto-instrumentation para Java, Python, .NET, Go, Node.js).

### 5.3 Integraciones de clase mundial
Con 750+ integraciones pre-construidas, Datadog se conecta a prácticamente cualquier componente de un stack moderno en minutos. Esto es imposible de replicar internamente.

### 5.4 Alerting y on-call
Monitores altamente configurables con multi-condition, anomaly detection con ML, forecasting. Integra nativamente con PagerDuty, OpsGenie, Slack, Teams, email, phone.

### 5.5 Dashboards y visualización
Cientos de dashboards out-of-the-box por tecnología + builder de dashboards con sintaxis de query propia. Muy potente para operational analytics.

### 5.6 Bits AI — ventaja competitiva 2026
La suite de agentes autónomos de Datadog (lanzada en 2026) marca una transición de **observabilidad pasiva → remediación activa**. El SRE Agent puede detectar, diagnosticar y resolver incidentes sin intervención humana. Este es el estado del arte del mercado APM.

### 5.7 Moat acumulado en 15 años
Los modelos de anomaly detection de Datadog han sido entrenados con billones de puntos de datos de miles de clientes. Esta ventaja en ML es imposible de replicar en 1-2 años.

---

## 6. Debilidades, Quejas y Puntos de Dolor

### 6.1 Pricing opaco y costoso a escala
La queja más frecuente. El modelo multi-dimensional hace difícil estimar costos. En organizaciones grandes, Datadog puede convertirse en el tercero o cuarto mayor gasto de software.

> *"For custom metrics it gets costly."* — TrustRadius 2025  
> *"Working with powerpacks can be difficult... time-consuming workarounds."* — TrustRadius 2025

**Mitigación:** Configurar Log Retention policies agresivas, Metrics Cardinality controls, y negociar Enterprise agreements con compromisos anuales.

### 6.2 Curva de aprendizaje en features avanzados
La plataforma es muy amplia. Usar solo métricas básicas es fácil; construir monitores complejos, dashboards con APM avanzado, o configurar Security require expertise dedicado.

> *"There is a learning curve when building complex queries or nested monitors — requires training or expert help."* — TrustRadius 2025  
> *"Building dashboards is often painful — the query syntax, especially for APM, is challenging."* — TrustRadius 2025

### 6.3 UI en constante cambio
Frecuentes rediseños de UI rompen flujos de trabajo establecidos. Los usuarios reportan que features que conocían bien cambian de lugar o comportamiento sin aviso.

> *"A recent update made it so I'm not sure how to view the flame graph for large traces."* — TrustRadius 2025

### 6.4 Nuevos productos lanzan en beta por mucho tiempo
Bits AI, AI Observability, y otros módulos nuevos han tenido rollouts lentos e inconsistentes.

> *"Still waiting for Bits AI access — negative experience on new product rollouts."* — TrustRadius 2025

### 6.5 Vendor lock-in
Datadog usa formatos propietarios. Migrar a otro vendor después de 2+ años de uso es costoso en tiempo e ingeniería. Este es el riesgo estratégico principal.

### 6.6 No es open source
A diferencia de Prometheus+Grafana, no hay forma de self-host Datadog. Todo el dato pasa por los servidores de Datadog — importante para clientes con restricciones de compliance de datos en tránsito.

---

## 7. Análisis Competitivo

### Competidor #1: Dynatrace (NYSE: DT)
**Fundada:** 2005 (Austria) · **Revenue 2025:** $1.7B · **Empleados:** ~5,200

| Aspecto | Dynatrace |
|---------|-----------|
| **Diferenciador clave** | Dynatrace Intelligence — AI causal (no solo anomaly detection), identifica ROOT CAUSE automáticamente |
| **Agente** | OneAgent — cero configuración, auto-descubrimiento de todo el stack |
| **Data layer** | Grail — data lakehouse propietario (indexless, schema-on-read) con DQL query language |
| **AI** | Causal AI + predictive analytics + generative AI integrados en el core |
| **Integraciones** | 800+ tecnologías |
| **Deployment** | SaaS + Managed (on-premise) — flexible para regulated industries |
| **Fortaleza** | Empresas grandes que quieren menos configuración manual y más automatización. "Autonomous Operations." |
| **Debilidad** | Precio más alto que Datadog; menos comunidad de developers; menos coverage de startups/SMB |
| **Ideal para** | Enterprises grandes (>1,000 hosts), sectores regulated (finanzas, salud), máxima automatización |

**Veredicto vs. Datadog:** Dynatrace gana en inteligencia automática y enterprise automation. Datadog gana en cobertura de integraciones, adopción de developers, y ecosystem de partners.

---

### Competidor #2: New Relic (Private — Francisco Partners/TPG)
**Fundada:** 2008 (San Francisco) · **Revenue 2023:** $926M · **Adquirida:** $6.5B en 2023

| Aspecto | New Relic |
|---------|-----------|
| **Diferenciador clave** | Modelo de pricing por GB de datos ingestados (no por host) — potencialmente más económico para orgs con muchos hosts pequeños |
| **Plataforma** | New Relic One — observabilidad full-stack unificada |
| **Fortaleza** | Developer-centric; modelo de pricing alternativo; open telemetry first |
| **Debilidad** | Privatizada en 2023 — inversión en producto más incierta; menor escala que Datadog; pérdidas operativas antes de la adquisición |
| **AI** | GitHub Copilot integration (2025); menor inversión en AI agents vs. Datadog/Dynatrace |
| **Ideal para** | Orgs con muchos microservicios pequeños donde el modelo por-GB es más económico que por-host |

**Veredicto vs. Datadog:** New Relic es una alternativa legítima para presupuesto-conscientes. El riesgo es la incertidumbre post-PE sobre roadmap y continuidad del producto. Datadog es más seguro a largo plazo.

---

## 8. Tabla Comparativa — Los Tres Productos

| Criterio | **Datadog** | **Dynatrace** | **New Relic** |
|----------|------------|---------------|---------------|
| **Revenue (2025)** | $3.43B | $1.7B | ~$1B est. (privada) |
| **Estabilidad** | ★★★★★ S&P 500 | ★★★★☆ NYSE | ★★★☆☆ PE-owned |
| **Integraciones** | 750+ | 800+ | ~600+ |
| **AI/Automation** | ★★★★★ Bits AI | ★★★★★ Causal AI | ★★★☆☆ |
| **Facilidad de uso** | ★★★★☆ | ★★★☆☆ más complejo | ★★★★☆ |
| **Pricing modelo** | Por host/GB | Por host (GiB) | Por GB ingestado |
| **Precio relativo** | Medio | Alto | Medio-bajo |
| **Data observability** | ★★★★☆ (Metaplane '25) | ★★★☆☆ | ★★★☆☆ |
| **Security** | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| **Developer adoption** | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| **Enterprise features** | ★★★★★ | ★★★★★ | ★★★★☆ |
| **Open source friendly** | ★★★☆☆ | ★★★☆☆ | ★★★★☆ OTel-first |
| **Self-host option** | ❌ SaaS only | ✅ Managed available | ❌ SaaS only |
| **Gartner MQ** | Leader | Leader | Challenger |
| **TrustRadius score** | 8.6/10 (347 reviews) | 8.7/10 | 8.1/10 |

**Winner general:** Datadog para la mayoría de los casos. Dynatrace para enterprises que priorizan automatización sobre configurabilidad.

---

## 9. Marco de Decisión: Comprar Datadog vs. Construir en Databricks

### La pregunta correcta
Antes de responder, hay que separar **dos tipos de observabilidad**:

| Tipo | ¿Qué monitorea? | ¿Datadog lo cubre? | ¿Databricks lo cubre? |
|------|----------------|--------------------|-----------------------|
| **App/Infra Observability** | Hosts, pods, services, APIs, front-end, network, security | ✅ Core product | ❌ No nativo |
| **Data Observability** | Pipelines de datos, calidad de datos, freshness, lineage, anomalías en tablas | ✅ (post-Metaplane 2025) | ✅ Parcialmente |

La confusión "Datadog vs. Databricks" surge porque Databricks es una **plataforma de datos**, no una plataforma de observabilidad general. Solo compiten en la intersección de **Data Observability**.

---

### Escenario A: Cliente con Apps Web + Microservicios + Data Pipelines

```
¿Necesita monitorear APIs, microservicios, Kubernetes, front-end, red, seguridad?
    → SÍ → COMPRAR DATADOG. No existe alternativa realista en Databricks.
    → NO → Ver Escenario B.
```

**Costo de construir App/Infra Observability desde cero en Databricks:**
- No es posible. Databricks no tiene: agente de host, APM distributed tracing, RUM, Synthetics, Network monitoring, Security agents (eBPF), ni Log Management full-text search con latencia <1s.
- Un equivalente parcial requeriría: Prometheus + Grafana + Loki + Jaeger + Falco + OpenTelemetry Collector + custom pipelines hacia Delta Lake. Esto es un stack de 5-7 herramientas Open Source que alguien tiene que mantener.
- **Costo de construir y mantener:** 2-3 SREs × $150K/año = $300K-450K/año solo en ingeniería, más el costo de cloud compute para self-hosting, más años de ramp-up.
- **Costo de Datadog** para el mismo escenario (100 hosts + APM + Logs): ~$150K-250K/año, listo en semanas.

**Veredicto Escenario A: COMPRAR DATADOG. ROI positivo vs. build en <12 meses.**

---

### Escenario B: Cliente Data-First con Databricks como Stack Central

```
¿El cliente solo necesita monitorear calidad de datos, freshness, pipelines de Databricks/dbt/Airflow?
    → SÍ → Evaluar construir en Databricks O usar Datadog con módulo Metaplane.
```

**Construir Data Observability en Databricks (viable):**
- Delta Live Tables + Great Expectations para calidad de datos
- Databricks Jobs API + Lakeview Dashboards para monitoring de pipelines
- Unity Catalog para lineage
- MLflow para model monitoring
- Custom Python alerts → Slack/PagerDuty

**Pros de construir:**
- Zero costo adicional si ya tienes Databricks Premium/Enterprise
- Control total sobre los datos (no salen de tu tenant)
- Customización ilimitada para pipelines propietarios

**Contras de construir:**
- Solo cubre la capa de datos — no apps, no infra, no seguridad
- Requiere ingeniería dedicada para construir + mantener
- Sin soporte SLA de producto
- Datadog Metaplane (2025) ya ofrece data observability comercial con lineage, anomaly detection, y UI polida — integrado con el mismo Datadog que ya monitorea el resto del stack

**Veredicto Escenario B:** Si el cliente SOLO tiene Databricks y no tiene apps web/APIs/microservicios: construir es viable y económico. Si el cliente tiene apps + datos: integrar Datadog+Databricks es la solución más eficiente.

---

### Matriz de Decisión Final

| Situación del cliente | Recomendación |
|----------------------|---------------|
| Apps web + microservicios + K8s (con o sin Databricks) | **COMPRAR DATADOG** |
| Solo pipelines de datos en Databricks, sin apps | **CONSTRUIR en Databricks** (o usar Datadog solo para data observability) |
| Stack híbrido: apps + datos | **COMPRAR DATADOG + habilitar Databricks integration** |
| Compliance restricts data leaving tenant | **Considerar Dynatrace Managed** (on-premise option) o Open Source stack |
| Startup <20 hosts, presupuesto muy limitado | **Prometheus + Grafana OSS** mientras crece, luego migrar a Datadog |
| Enterprise que quiere máxima automatización de incidentes | **Datadog (Bits AI) o Dynatrace** — evaluar según stack existente |

---

## 10. Recomendación Final

### COMPRAR Datadog — con condiciones

**La respuesta directa es Comprar**, no construir. Estas son las razones irrefutables:

#### Razón 1: Time-to-value
Datadog puede estar completamente operacional en **días**. Un stack de observabilidad custom en Databricks toma **6-18 meses** para alcanzar paridad parcial (solo en data layer) y nunca alcanzará paridad en app/infra observability.

#### Razón 2: 15 años de moat imposible de replicar
Los modelos ML de anomaly detection, forecasting, y correlación de Datadog están entrenados con billones de puntos de datos de miles de clientes en producción. Este conocimiento acumulado es el activo más valioso del producto y es imposible de construir internamente.

#### Razón 3: 750+ integraciones son la alternativa al headcount
Cada integración que Datadog tiene construida es días-semanas de ingeniería que el cliente no necesita hacer. A $23/host/mes, el retorno de inversión de las integraciones solo ya justifica el costo en la mayoría de los casos.

#### Razón 4: Bits AI (2026) cambia la ecuación de ROI
La suite de agentes autónomos de Datadog (SRE Agent, Security Analyst) puede reducir el tiempo de resolución de incidentes de horas a minutos. Para un equipo de ingeniería, cada hora de downtime evitada vale órdenes de magnitud más que el costo mensual de la herramienta.

#### Razón 5: Estabilidad a largo plazo
S&P 500, $3.43B revenue, crecimiento sostenido, sin deuda significativa, rechazó $7B de Cisco. Datadog será un vendor relevante por al menos 10 años más. La continuidad del producto está garantizada.

---

### Condiciones de compra (cómo evitar los errores más comunes)

1. **Negociar un Enterprise Agreement (EA)** — los descuentos por commitment anual son del 20-40%
2. **Activar solo los módulos que se necesitan desde el día 1** — no habilitar Security ni RUM "porque está incluido" si no se va a usar activamente
3. **Configurar Log Retention policies ANTES de encender Log Management** — los logs sin política de retención son la causa #1 de bill shock
4. **Establecer Custom Metrics budget** — definir un límite de métricas custom por servicio desde el inicio
5. **Asignar un Datadog Champion** — una persona dedicada a optimizar el uso y el costo. En 100+ hosts es un rol de tiempo parcial.
6. **Usar la integración Databricks-Datadog** — monitorear Databricks jobs, clusters, y DLT pipelines desde Datadog directamente

---

### ¿Por qué NO construir en Databricks para observabilidad general?

| Dimensión | Construir en Databricks | Comprar Datadog |
|-----------|------------------------|-----------------|
| **Costo inicial** | $0 si ya tienes Databricks | $0 (trial gratuito) |
| **Costo operativo (100 hosts, año 1)** | $300K-450K ingeniería | $150K-250K |
| **Tiempo hasta valor** | 6-18 meses | 1-4 semanas |
| **Cobertura** | Solo datos; sin APM, sin infra | Todo el stack |
| **Mantenimiento** | Alta carga interna permanente | Zero — vendor responsibility |
| **Riesgo de versión** | Alta — requiere actualización manual | Zero — SaaS auto-actualizado |
| **Support SLA** | Interno | 24/7 enterprise support |
| **AI capabilities** | Básico (MLflow, custom models) | Bits AI autónomo (2026) |

**La construcción en Databricks solo tiene sentido cuando:** el cliente ya tiene Databricks Enterprise y EXCLUSIVAMENTE necesita Data Observability (calidad de datos, freshness, lineage) y NO tiene apps web, APIs, ni infraestructura cloud que monitorear.

---

## Apéndices

### A. Acquisitions Timeline de Datadog (relevantes al producto)
| Año | Empresa | Capacidad agregada |
|-----|---------|-------------------|
| 2017 | Logmatic | Log Management |
| 2019 | Madumbo | AI-based app testing |
| 2021 | Sqreen | Application Security (ASM) |
| 2021 | Timber | Data pipeline observability |
| 2022 | Seekret | API Observability |
| 2022 | Cloudcraft | Infrastructure architecture diagrams |
| 2023 | Codiga | Static code analysis |
| 2025 | Quickwit | Cloud-native search engine para logs |
| 2025 | Metaplane | AI-powered Data Observability |
| 2026 | Propolis | AI-powered QA testing |

### B. Señales de madurez del producto para el cliente
Antes de vender Datadog a un cliente, validar:
- [ ] ¿Cuántos hosts/containers/lambdas tienen?
- [ ] ¿Usan Kubernetes? (multiplicador de valor de Datadog)
- [ ] ¿Tienen ya una herramienta de observabilidad? (si es AWS CloudWatch o Grafana OSS, Datadog gana fácil)
- [ ] ¿Tienen equipo de seguridad? (CSPM/ASM puede ser upsell)
- [ ] ¿Tienen pipelines de datos en Databricks/Snowflake/dbt? (Metaplane data observability es diferenciador)
- [ ] ¿Cuántos logs generan por día en GB?
- [ ] ¿Tienen presupuesto para Software? (si no, Grafana Cloud o New Relic Free tier como puente)

### C. Preguntas de discovery para el cliente
1. "¿Cuánto tiempo promedio tarda su equipo en detectar un incidente de producción hoy?"
2. "¿Cuántas herramientas diferentes abren durante una investigación de incidente?"
3. "¿Tienen visibilidad del rendimiento de sus APIs y base de datos correlacionado con los logs?"
4. "¿Cuánto downtime no planeado tuvieron el último año? ¿Cuál fue el costo por hora?"
5. "¿Su equipo de seguridad tiene visibilidad sobre lo que ocurre en producción en tiempo real?"

---

*Documento preparado el 24 de abril de 2026. Basado en fuentes públicas: Wikipedia, TrustRadius (347 reviews, score 8.6/10), SEC filings, VentureBeat, TechCrunch, Gartner MQ references.*
