-- Acme — APM
-- Migración 008 (17/10/2026): la apertura de la llamada en frío deja de presentar a the owner en la primera frase.
--   Regla de los 4 segundos (Jordan Belfort): «Hi, I'm the owner with Acme Tech» suena a vendedor y cuelgan.
--   Se abre con algo real del negocio del cliente (su web, horario, reseñas, buzón) y se piden 60 segundos;
--   el nombre va después del sí. También el buzón de voz (inglés y español) y la apertura por nicho.
-- Fuente: docs/guiones/recepcionista-ia.md. Solo cambia frases exactas: lo que the owner reescribió desde la
-- pantalla Guiones se queda. La marca "Sixty seconds?" evita aplicarla dos veces.
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm --single-transaction < db/migrations/008_apertura_4_segundos.sql

UPDATE call_script
   SET body = replace(replace(replace(replace(body,
    $g$> "Hi, is this the owner? — Hi [name], this is the owner with Acme Tech. I'll be quick:
> I help local [niche] businesses stop losing customers to missed calls. Can I ask you one question?"

Si dice que sí → paso 2.$g$,
    $g$Los primeros 4 segundos son SU mundo, no el tuyo: abre con algo real de su negocio (su web, su horario, sus reseñas, que el buzón saltó) y pide 60 segundos. Tu nombre va DESPUÉS del sí.
> "Hi, is this [name]? — [name], quick one. I was on [business]'s site this morning: it says [lo que dice: "call anytime" / "24/7 emergency" / "free estimates"].
> I've got one thing on what happens to those calls while you're on a job. Sixty seconds?"

Si dice que sí → "I'm the owner, by the way, local here in NJ." y paso 2.$g$),
    $g$> "Hi, this is the owner with Acme Tech, local here. When you're on a job and miss a call, an AI receptionist
> can answer with your business name, take the job details and email them to you. Call (551) 365-4888
> to hear it, or call me back at this number. Thanks."$g$,
    $g$> "Hi [name], I was on [business]'s site today: it says [lo que dice]. When you're on a job and a call hits
> voicemail, a receptionist can answer with your business name, take the job details and email them to you.
> Call (551) 365-4888 to hear it. This is the owner, local in NJ, you can call me back at this number. Thanks."$g$),
    $g$> "Hola, le habla the owner, de Acme Tech, aquí del área. Cuando usted está en un trabajo y no puede contestar,
> una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los manda al
> correo. Llame al (551) 365-4888 para oírla, o devuélvame la llamada a este número. Gracias."$g$,
    $g$> "Hola [nombre], vi la página de [negocio] hoy: dice [lo que dice]. Cuando usted está en un trabajo y la llamada
> cae al buzón, una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los
> manda al correo. Llame al (551) 365-4888 para oírla. Le habla the owner, aquí del área; devuélvame la llamada a este número. Gracias."$g$),
    $g$- Apertura: "…I help contractors in [barrio] stop losing jobs to missed calls…"$g$,
    $g$- Apertura (su mundo): "Your site says free estimates. I've got one thing on what happens to estimate calls while you're on a roof. Sixty seconds?"$g$),
       updated_at = now()
 WHERE tenant_id = 'main' AND niche = 'home_improvement_contractor' AND deleted_at IS NULL
   AND body NOT LIKE $g$%Sixty seconds?%$g$;

UPDATE call_script
   SET body = replace(replace(replace(replace(body,
    $g$> "Hi, is this the owner? — Hi [name], this is the owner with Acme Tech. I'll be quick:
> I help local [niche] businesses stop losing customers to missed calls. Can I ask you one question?"

Si dice que sí → paso 2.$g$,
    $g$Los primeros 4 segundos son SU mundo, no el tuyo: abre con algo real de su negocio (su web, su horario, sus reseñas, que el buzón saltó) y pide 60 segundos. Tu nombre va DESPUÉS del sí.
> "Hi, is this [name]? — [name], quick one. I was on [business]'s site this morning: it says [lo que dice: "call anytime" / "24/7 emergency" / "free estimates"].
> I've got one thing on what happens to those calls while you're on a job. Sixty seconds?"

Si dice que sí → "I'm the owner, by the way, local here in NJ." y paso 2.$g$),
    $g$> "Hi, this is the owner with Acme Tech, local here. When you're on a job and miss a call, an AI receptionist
> can answer with your business name, take the job details and email them to you. Call (551) 365-4888
> to hear it, or call me back at this number. Thanks."$g$,
    $g$> "Hi [name], I was on [business]'s site today: it says [lo que dice]. When you're on a job and a call hits
> voicemail, a receptionist can answer with your business name, take the job details and email them to you.
> Call (551) 365-4888 to hear it. This is the owner, local in NJ, you can call me back at this number. Thanks."$g$),
    $g$> "Hola, le habla the owner, de Acme Tech, aquí del área. Cuando usted está en un trabajo y no puede contestar,
> una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los manda al
> correo. Llame al (551) 365-4888 para oírla, o devuélvame la llamada a este número. Gracias."$g$,
    $g$> "Hola [nombre], vi la página de [negocio] hoy: dice [lo que dice]. Cuando usted está en un trabajo y la llamada
> cae al buzón, una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los
> manda al correo. Llame al (551) 365-4888 para oírla. Le habla the owner, aquí del área; devuélvame la llamada a este número. Gracias."$g$),
    $g$- Apertura: "…I help firewood and delivery businesses take every order, even on the busiest weekends…"$g$,
    $g$- Apertura (su mundo): "Saw you're taking firewood orders again. I've got one thing on what happens to orders when everyone calls the same weekend. Sixty seconds?"$g$),
       updated_at = now()
 WHERE tenant_id = 'main' AND niche = 'firewood_delivery' AND deleted_at IS NULL
   AND body NOT LIKE $g$%Sixty seconds?%$g$;

UPDATE call_script
   SET body = replace(replace(replace(replace(body,
    $g$> "Hi, is this the owner? — Hi [name], this is the owner with Acme Tech. I'll be quick:
> I help local [niche] businesses stop losing customers to missed calls. Can I ask you one question?"

Si dice que sí → paso 2.$g$,
    $g$Los primeros 4 segundos son SU mundo, no el tuyo: abre con algo real de su negocio (su web, su horario, sus reseñas, que el buzón saltó) y pide 60 segundos. Tu nombre va DESPUÉS del sí.
> "Hi, is this [name]? — [name], quick one. I was on [business]'s site this morning: it says [lo que dice: "call anytime" / "24/7 emergency" / "free estimates"].
> I've got one thing on what happens to those calls while you're on a job. Sixty seconds?"

Si dice que sí → "I'm the owner, by the way, local here in NJ." y paso 2.$g$),
    $g$> "Hi, this is the owner with Acme Tech, local here. When you're on a job and miss a call, an AI receptionist
> can answer with your business name, take the job details and email them to you. Call (551) 365-4888
> to hear it, or call me back at this number. Thanks."$g$,
    $g$> "Hi [name], I was on [business]'s site today: it says [lo que dice]. When you're on a job and a call hits
> voicemail, a receptionist can answer with your business name, take the job details and email them to you.
> Call (551) 365-4888 to hear it. This is the owner, local in NJ, you can call me back at this number. Thanks."$g$),
    $g$> "Hola, le habla the owner, de Acme Tech, aquí del área. Cuando usted está en un trabajo y no puede contestar,
> una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los manda al
> correo. Llame al (551) 365-4888 para oírla, o devuélvame la llamada a este número. Gracias."$g$,
    $g$> "Hola [nombre], vi la página de [negocio] hoy: dice [lo que dice]. Cuando usted está en un trabajo y la llamada
> cae al buzón, una recepcionista con IA contesta con el nombre de su negocio, toma los datos del trabajo y se los
> manda al correo. Llame al (551) 365-4888 para oírla. Le habla the owner, aquí del área; devuélvame la llamada a este número. Gracias."$g$),
    $g$- Apertura: "…I help locksmiths answer every emergency call, day or night…"$g$,
    $g$- Apertura (su mundo): "Your site says 24/7 lockouts. I've got one thing on the 11 pm call that rings while you're on another job. Sixty seconds?"$g$),
       updated_at = now()
 WHERE tenant_id = 'main' AND niche = 'locksmith' AND deleted_at IS NULL
   AND body NOT LIKE $g$%Sixty seconds?%$g$;
