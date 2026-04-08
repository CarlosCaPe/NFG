# Interview Questions — David C.

**Position**: Senior/Lead Python Data Engineer
**Tone**: Friendly, conversational — get to know the person, not a quiz.
**Tip**: David's CV is an almost 1:1 match with the JD. The risk here is "too good on paper." Dig into the real stories behind the metrics.

---

## 1. The 35% Throughput Improvement
"David, your CV mentions improving data throughput by 35% with Dagster and Snowflake pipelines. That's a specific number. Walk me through what the system looked like before and after — what was the bottleneck you fixed?"

🇪🇸 "David, tu CV menciona que mejoraste el throughput de datos un 35% con pipelines de Dagster y Snowflake. Es un número específico. Cuéntame cómo se veía el sistema antes y después — ¿cuál era el cuello de botella que arreglaste?"

> **Why ask**: Tests whether he owns the result or inherited a metric. Real engineers can narrate the before/after. Also validates Dagster depth.

## 2. Engineering Guardrails
"You designed and enforced Python engineering standards that increased codebase maintainability by 40%. I'm curious — how did you actually enforce them? Linting? Code reviews? An angry Slack bot?"

🇪🇸 "Diseñaste y aplicaste estándares de ingeniería en Python que aumentaron la mantenibilidad del código un 40%. Me da curiosidad — ¿cómo los aplicaste realmente? ¿Linting? ¿Code reviews? ¿Un bot enojado en Slack?"

> **Why ask**: The role's core responsibility is defining standards and guardrails. He claims he's done it. Let him show HOW (culture vs. tooling vs. both).

## 3. The Dagster vs. Airflow Question
"You have direct Dagster experience, which is exactly what this role needs. For someone coming from Airflow, what would you tell them is the biggest mental shift when moving to Dagster?"

🇪🇸 "Tienes experiencia directa con Dagster, que es exactamente lo que este rol necesita. Para alguien que viene de Airflow, ¿cuál le dirías que es el cambio mental más grande al moverse a Dagster?"

> **Why ask**: Tests depth of understanding. Anyone can list Dagster; a real practitioner knows the asset-based model vs. task-based paradigm.

## 4. Healthcare & HIPAA in Practice
"Your most recent role was in healthcare. What's one thing about working with healthcare data that you didn't expect until you were actually in it?"

🇪🇸 "Tu rol más reciente fue en healthcare. ¿Qué es algo de trabajar con datos de salud que no esperabas hasta que realmente estuviste metido en ello?"

> **Why ask**: The role is in regulated healthcare. He has direct experience. This tests whether it's genuine or surface-level.

## 5. SSIS and the Legacy Side
"The job description mentions SSIS as a strong plus — the client is migrating away from legacy SQL/SSIS pipelines. Have you had to work alongside SSIS or help migrate off of it?"

🇪🇸 "La descripción del puesto menciona SSIS como un plus fuerte — el cliente está migrando de pipelines legacy de SQL/SSIS. ¿Te ha tocado trabajar junto a SSIS o ayudar a migrar fuera de él?"

> **Why ask**: Direct JD requirement. His CV lists SSIS in the tech stack but no detail. Let him clarify how deep that goes.

## 6. Mentoring Senior Engineers
"You mention mentoring junior developers in your Django role. But this position asks you to mentor *senior* engineers. That's a different dynamic — senior people don't always want to be mentored. How do you approach that?"

🇪🇸 "Mencionas que mentoreaste developers junior en tu rol de Django. Pero esta posición pide mentorear ingenieros *senior*. Es una dinámica diferente — la gente senior no siempre quiere ser mentoreada. ¿Cómo lo abordas?"

> **Why ask**: The role requires mentoring seniors through design reviews. Mentoring juniors vs. seniors requires different soft skills. Does he see the difference?

## 7. The Incident Story
"You reduced production incidents by 20% and mean time to recovery by 25%. Can you tell me about one specific incident that taught you the most? What broke, and what did you change so it wouldn't break again?"

🇪🇸 "Redujiste los incidentes de producción un 20% y el tiempo medio de recuperación un 25%. ¿Me puedes contar de un incidente específico que te haya enseñado más? ¿Qué se rompió, y qué cambiaste para que no se volviera a romper?"

> **Why ask**: Tests real operational experience. Incident stories reveal character — ownership, blame culture, learning mindset.

## 8. FastAPI + Databricks Chapter
"Between 2020 and 2022 you used FastAPI with Databricks. That's a combination I don't see very often. What was FastAPI doing in front of Databricks — was it an API layer for the data, or something else?"

🇪🇸 "Entre 2020 y 2022 usaste FastAPI con Databricks. Es una combinación que no veo muy seguido. ¿Qué hacía FastAPI enfrente de Databricks — era una capa de API para los datos, o algo más?"

> **Why ask**: Unusual stack combination. Tests whether he was designing the architecture or just implementing someone else's design.

## 9. The Breadth Question
"Your tech skills list is incredibly broad — Python, Go, Rust, Swift, Kotlin, TensorFlow, PyTorch, Cassandra... honestly, it's one of the widest I've seen. If I asked you to rank your top 3 where you could be dropped into a codebase tomorrow and be productive, what would they be?"

🇪🇸 "Tu lista de skills técnicos es increíblemente amplia — Python, Go, Rust, Swift, Kotlin, TensorFlow, PyTorch, Cassandra... honestamente, es una de las más amplias que he visto. Si te pidiera rankear tu top 3 donde podrías caer en un codebase mañana y ser productivo, ¿cuáles serían?"

> **Why ask**: Friendly challenge. A CV this broad invites the question "what do you ACTUALLY know well?" Let him self-select. Expect Python, Dagster, Snowflake/SQL.

## 10. What Would You Do Differently
"If you could go back to day one of your Dagster/Snowflake project and change one architectural decision, what would it be and why?"

🇪🇸 "Si pudieras regresar al día uno de tu proyecto de Dagster/Snowflake y cambiar una decisión arquitectónica, ¿cuál sería y por qué?"

> **Why ask**: Open-ended closer that reveals seniority. Junior engineers say "nothing." Senior engineers have strong opinions about what they'd redo. Also reveals honesty.

---

**Scoring Notes** (for your reference during the call):

| Signal | Strong | Weak |
|--------|--------|------|
| Dagster depth | Explains asset-based model, software-defined assets, materializations | "It's like Airflow but newer" |
| Standards enforcement | Concrete tooling + cultural approach | "I wrote a document" |
| Healthcare awareness | Specific HIPAA/compliance stories | Generic "I followed the rules" |
| Breadth vs. depth | Self-aware about core strengths vs. exposure | Claims mastery in everything |
| Incident ownership | Takes responsibility, describes systemic fix | Blames others or gives vague answer |

---

**Comparative Note — Rafael B. vs. David C.**:

| Dimension | Rafael B. | David C. |
|-----------|-----------|----------|
| **Dagster** | No direct experience (Airflow) | Direct Dagster + Snowflake (3+ years) |
| **Healthcare** | No experience | Yes, recent role |
| **SSIS** | Not mentioned | Listed in tech stack |
| **Airflow** | Deep (custom sensors, operators) | Not listed |
| **Leadership** | Teaching, team management, migrations | Standards/guardrails, design reviews |
| **Years** | 13 years | 10 years |
| **JD match** | ~70% (strong Python/backend, gap in Dagster/healthcare) | ~95% (near-perfect match on paper) |
