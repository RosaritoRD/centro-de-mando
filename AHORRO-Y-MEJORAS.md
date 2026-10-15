# 💸 Ahorro y mejoras

## Gastar menos

1. **Un modelo para cada trabajo.** El orquestador usa el modelo más capaz, porque decidir mal cuesta más que el token. Los barridos de volumen (leads, resúmenes) van con un modelo medio, y el triaje "¿esto es urgente, sí o no?" con el más barato.
2. **Caché de prompt.** Es la palanca de coste más grande y la más ignorada. Ojo: por debajo del mínimo de tokens cacheables **no cachea y no avisa**. Comprueba `cache_creation_input_tokens`.
3. **Cuenta con `total_cost_usd`, no con `usage`.** `usage` no incluye los tokens de los subagentes, y un sistema multiagente puede gastar unas 15 veces más que un solo agente.
4. **Tope diario en dólares** (`DAILY_BUDGET_USD`). Al alcanzarlo, el orquestador se niega a empezar ejecuciones nuevas. Lo aplica el código.
5. **Precios en la base de datos, no en el código.** Las promociones caducan, y si el precio está escrito en el código, el panel de costes empieza a mentir ese día sin avisar.
6. **Reutiliza lo que ya tienes:** la base de datos vive dentro de un Postgres que ya existe (otra base, otro rol) y el login reutiliza Firebase. Cero servidores nuevos.
7. **Panel estático.** React se compila al construir la imagen y nginx sirve archivos: cero RAM de Node para la interfaz.
8. **Límite de agentes simultáneos** (`MAX_CONCURRENT_RUNS`). Cada uno usa ~1 GB, así que el tope evita tener que pagar un servidor más grande.

## Hacerlo mejor

1. **La aprobación vive en el servidor.** Nunca confíes en que el modelo "se acuerde" de pedir permiso.
2. **Eventos *append-only*.** Si algo se cae a mitad, se reconstruye releyendo, y nada queda a medias sin saberlo.
3. **Una lista de usuarios permitidos, no "no le paso el enlace".** Tener una cuenta válida no basta para entrar.
4. **Investiga antes de programar.** Los 8 informes de `docs/research/` evitaron descartar tarde piezas enteras (y mostraron límites legales como CAN-SPAM antes de construir el envío).
5. **Prueba lo arriesgado con un *spike*.** `spike/` demuestra que una aprobación diferida sobrevive a un reinicio antes de construir encima.
6. **Ideas para ampliarlo:** subagente de correo de solo lectura, alertas al móvil cuando algo espera tu aprobación o un informe semanal de coste por tarea.
