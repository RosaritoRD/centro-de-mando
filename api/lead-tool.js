/* Acme — APM · the tool the chat agent uses to SAVE leads.

   Why it exists (26/09/2026): the agent found 29 dental clinics in NJ, returned
   them as a nice table in the chat… and there they stayed. Nothing moved them
   into `lead`, so the Leads tab had no section and the call queue had nobody
   to call. They had to be imported by hand.

   Now the agent has `guardar_leads` and the system prompt tells it to use it
   whenever it finds businesses with a phone number. It goes down the SAME path
   as the other sources (the repo's `guardarLeads`): dedupes by phone, merges
   with what was already there and respects the suppression (do-not-call) list.

   No human approval on purpose: saving a lead calls nobody and never leaves
   the house, and an extra lead can be dismissed from the tab. Asking
   permission for every batch would turn "find clinics" into a queue of buttons. */

import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { normalizarLote, nombreBonito } from './sources/common.js';

export const NOMBRE_HERRAMIENTA = 'mcp__apm__guardar_leads';
export const FUENTE = 'apm_agent';
const NICHO = /^[a-z0-9_]{2,60}$/;
const MAX_LOTE = 200;

/* "Clínicas dentales" → "clinicas_dentales". The niche is the Leads tab
   section: if the model sends "Dental Clinics" one day and "dental clinic"
   another, you get two sections. It's normalized here and the prompt asks for
   English, singular. */
export function normalizaNicho(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

/* What the model sends → leads ready for `guardarLeads`. Pure and tested. */
export function preparaLeads({ niche, leads, runId }) {
  const nicho = normalizaNicho(niche);
  if (!NICHO.test(nicho)) return { error: 'invalid niche: use something like dental_clinic' };
  const filas = Array.isArray(leads) ? leads.slice(0, MAX_LOTE) : [];
  const lote = normalizarLote(filas, (l) => ({
    businessName: nombreBonito(l.name || l.business_name || ''),
    phone: l.phone,
    /* "hudsonfamilydentalnj.com" without a scheme gets completed; anything
       not shaped like a domain is left as-is and webSegura drops it. */
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

/* The in-process MCP server, one per run (it carries the run id so each lead
   knows which conversation it came from). */
export function servidorDeLeads({ repo, tenant = 'main', runId }) {
  return createSdkMcpServer({
    name: 'apm',
    version: '1.0.0',
    tools: [tool(
      'guardar_leads',
      "Saves the businesses you found into APM's Leads tab, to call them later. "
        + 'ALWAYS use it when your reply includes businesses with a phone number, before replying. '
        + 'niche: English, singular, snake_case (dental_clinic, restaurant, barbershop). '
        + 'Leave out chains and big franchises. Returns how many were new and how many already existed.',
      {
        niche: z.string().describe('Section in snake_case, English, singular. E.g. dental_clinic'),
        leads: z.array(z.object({
          name: z.string(),
          phone: z.string().describe('US phone number'),
          website: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional().describe('Two letters, e.g. NJ'),
          zip: z.string().optional()
        })).max(MAX_LOTE)
      },
      async (args) => {
        const p = preparaLeads({ niche: args.niche, leads: args.leads, runId });
        if (p.error) return { content: [{ type: 'text', text: `Nothing saved: ${p.error}` }], isError: true };
        const id = await repo.crearRun({ tenant, source: FUENTE, niche: p.nicho, params: { run: runId } });
        try {
          const g = await repo.guardarLeads({ tenant, niche: p.nicho, source: FUENTE, leads: p.leads });
          await repo.terminarRun(id, { status: 'done', found: p.found, invalid: p.invalid, ...g });
          return { content: [{ type: 'text', text:
            `Saved to Leads → section "${p.nicho}": ${g.inserted} new, ${g.merged} already existed, `
            + `${g.suppressed} on the do-not-call list, ${p.invalid} without a valid phone.` }] };
        } catch (e) {
          await repo.terminarRun(id, { status: 'failed', error: e.message }).catch(() => {});
          return { content: [{ type: 'text', text: `Could not save the leads: ${e.message}` }], isError: true };
        }
      }
    )]
  });
}
