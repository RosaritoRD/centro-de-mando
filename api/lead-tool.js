/* tu empresa — APM · la herramienta con la que el agente del chat GUARDA leads.

   Por qué existe (26/09/2026): el agente buscó 29 clínicas dentales en NJ, las
   devolvió como una tabla bonita en el chat… y ahí se quedaron. Nada las
   pasaba a `lead`, así que la pestaña Leads no tenía la sección ni la cola de
   llamadas tenía a quién llamar. Hubo que importarlas a mano.

   Ahora el agente tiene `guardar_leads` y el system prompt le dice que la use
   siempre que encuentre negocios con teléfono. Entra por el MISMO camino que
   las otras fuentes (`guardarLeads` del repo): deduplica por teléfono, une con
   lo que ya había y respeta la lista de supresión (no llamar).

   Sin aprobación humana a propósito: guardar un lead no llama a nadie ni sale
   de la casa, y un lead de más se descarta desde la pestaña. Pedir permiso por
   cada lote convertiría "busca clínicas" en una cola de botones. */

import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { normalizarLote, nombreBonito } from './sources/common.js';

export const NOMBRE_HERRAMIENTA = 'mcp__apm__guardar_leads';
export const FUENTE = 'apm_agent';
const NICHO = /^[a-z0-9_]{2,60}$/;
const MAX_LOTE = 200;

/* "Clínicas dentales" → "clinicas_dentales". El nicho es la sección de la
   pestaña Leads: si el modelo manda "Dental Clinics" y otro día "dental
   clinic", salen dos secciones. Se normaliza aquí y el prompt pide inglés en
   singular. */
export function normalizaNicho(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

/* Lo que manda el modelo → leads listos para `guardarLeads`. Puro y probado. */
export function preparaLeads({ niche, leads, runId }) {
  const nicho = normalizaNicho(niche);
  if (!NICHO.test(nicho)) return { error: 'nicho no válido: usa algo como dental_clinic' };
  const filas = Array.isArray(leads) ? leads.slice(0, MAX_LOTE) : [];
  const lote = normalizarLote(filas, (l) => ({
    businessName: nombreBonito(l.name || l.business_name || ''),
    phone: l.phone,
    /* "hudsonfamilydentalnj.com" sin esquema se completa; lo que no tenga
       forma de dominio se deja tal cual y webSegura lo descarta. */
    website: /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(String(l.website || '').trim())
      ? `https://${String(l.website).trim()}` : l.website,
    address: l.address ? String(l.address).trim().slice(0, 300) : null,
    zip: (String(l.zip || l.address || '').match(/\b(\d{5})\b/) || [])[1] || null,
    boroughCity: l.city ? String(l.city).trim().slice(0, 80) : null,
    state: l.state ? String(l.state).trim().toUpperCase().slice(0, 2) : null,
    sourceIds: runId ? { apm_run: runId } : {},
    internalOnly: false
  }));
  return { nicho, ...lote };
}

/* El servidor MCP en proceso, uno por ejecución (lleva el id del run para
   que cada lead sepa de qué conversación salió). */
export function servidorDeLeads({ repo, tenant = 'principal', runId }) {
  return createSdkMcpServer({
    name: 'apm',
    version: '1.0.0',
    tools: [tool(
      'guardar_leads',
      'Guarda en la pestaña Leads de APM los negocios que encontraste, para llamarlos después. '
        + 'Úsala SIEMPRE que tu respuesta incluya negocios con teléfono, antes de responder. '
        + 'niche: en inglés, singular, snake_case (dental_clinic, restaurant, barbershop). '
        + 'Omite cadenas y franquicias grandes. Devuelve cuántos entraron nuevos y cuántos ya existían.',
      {
        niche: z.string().describe('Sección en snake_case, inglés, singular. Ej: dental_clinic'),
        leads: z.array(z.object({
          name: z.string(),
          phone: z.string().describe('Teléfono de EE. UU.'),
          website: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional().describe('Dos letras, ej: NJ'),
          zip: z.string().optional()
        })).max(MAX_LOTE)
      },
      async (args) => {
        const p = preparaLeads({ niche: args.niche, leads: args.leads, runId });
        if (p.error) return { content: [{ type: 'text', text: `No guardé nada: ${p.error}` }], isError: true };
        const id = await repo.crearRun({ tenant, source: FUENTE, niche: p.nicho, params: { run: runId } });
        try {
          const g = await repo.guardarLeads({ tenant, niche: p.nicho, source: FUENTE, leads: p.leads });
          await repo.terminarRun(id, { status: 'done', found: p.found, invalid: p.invalid, ...g });
          return { content: [{ type: 'text', text:
            `Guardados en Leads → sección "${p.nicho}": ${g.inserted} nuevos, ${g.merged} ya existían, `
            + `${g.suppressed} en la lista de no llamar, ${p.invalid} sin teléfono válido.` }] };
        } catch (e) {
          await repo.terminarRun(id, { status: 'failed', error: e.message }).catch(() => {});
          return { content: [{ type: 'text', text: `No pude guardar los leads: ${e.message}` }], isError: true };
        }
      }
    )]
  });
}
