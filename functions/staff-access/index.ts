// Staff sign up and transfers. A person asks for a hub, and that hub's lead or an admin decides.
// AI plays no part here: people approve people.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { notify } from '../_shared/notify.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

const isWorkEmail = (email: string) => email.trim().toLowerCase().endsWith('@uncommon.org');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in first.', 401);
    const body = await req.json();
    const db = adminClient();

    // Tell the hub's lead and every admin that someone is waiting.
    const tellApprovers = async (hubId: string, title: string, text: string) => {
      const { data: people } = await db.from('profiles').select('id, email, push_token, role, is_hub_lead, hub_id')
        .or(`role.eq.admin,and(is_hub_lead.eq.true,hub_id.eq.${hubId})`);
      await Promise.all((people ?? []).filter((p: Row) => p.id !== caller.id).map((p: Row) =>
        notify({ userId: p.id, kind: 'general', title, body: text, pushToken: p.push_token, email: p.email })));
    };
    const hubName = async (hubId: string) => (await db.from('hubs').select('name').eq('id', hubId).maybeSingle()).data?.name as string | undefined;
    const callerName = (first = caller.first_names, last = caller.surname) => `${first} ${last}`.trim() || caller.email;

    if (body.action === 'start') {
      if (caller.role === 'staff' || caller.role === 'admin') return json({ ok: true });
      if (!isWorkEmail(caller.email)) return fail('Staff accounts need an @uncommon.org email.', 403);
      if (caller.role !== 'applicant') return fail('This account is already a student account.', 403);
      await db.from('profiles').update({ staff_status: 'choosing' }).eq('id', caller.id);
      return json({ ok: true });
    }

    if (body.action === 'request') {
      const isNew = caller.role === 'applicant' && isWorkEmail(caller.email);
      const hasNoHub = caller.role === 'staff' && !caller.hub_id;
      if (!isNew && !hasNoHub) return fail('This account can not ask for a hub.', 403);
      const firstNames = String(body.first_names ?? '').trim().slice(0, 80);
      const surname = String(body.surname ?? '').trim().slice(0, 80);
      const phone = String(body.phone ?? '').trim().slice(0, 30);
      if (!firstNames || !surname || !phone) return fail('Please add your name and phone number.');
      const name = await hubName(body.hub_id);
      if (!name) return fail('Please choose your hub.');
      await db.from('staff_requests').upsert({ user_id: caller.id, hub_id: body.hub_id, kind: 'join', created_at: new Date().toISOString() });
      await db.from('profiles').update({ first_names: firstNames, surname, phone, staff_status: 'pending' }).eq('id', caller.id);
      await tellApprovers(body.hub_id, 'New staff member waiting', `${callerName(firstNames, surname)} asked to join ${name}. Open Staff requests to approve or reject.`);
      return json({ ok: true });
    }

    if (body.action === 'transfer') {
      if (caller.role !== 'staff' || !caller.hub_id) return fail('Only staff with a hub can ask for a transfer.', 403);
      if (body.hub_id === caller.hub_id) return fail('You are already at this hub.');
      const name = await hubName(body.hub_id);
      if (!name) return fail('Please choose a hub.');
      await db.from('staff_requests').upsert({ user_id: caller.id, hub_id: body.hub_id, kind: 'transfer', created_at: new Date().toISOString() });
      await tellApprovers(body.hub_id, 'Transfer request', `${callerName()} asked to transfer to ${name}. Open Staff requests to approve or reject.`);
      return json({ ok: true });
    }

    // Only an admin or a lead can go further. A lead only reaches their own hub.
    const isAdmin = caller.role === 'admin';
    const isLead = caller.role === 'staff' && caller.is_hub_lead && !!caller.hub_id;
    if (!isAdmin && !isLead) return fail('Only a hub lead or an admin can do this.', 403);

    if (body.action === 'list') {
      let query = db.from('staff_requests')
        .select('user_id, kind, created_at, hubs(name), profiles!staff_requests_user_id_fkey(first_names, surname, email, phone)')
        .order('created_at');
      if (!isAdmin) query = query.eq('hub_id', caller.hub_id!).neq('user_id', caller.id);
      const { data, error } = await query;
      if (error) throw error;
      return json({ requests: data ?? [] });
    }

    if (body.action === 'decide') {
      const { data: request } = await db.from('staff_requests')
        .select('user_id, hub_id, kind, profiles!staff_requests_user_id_fkey(id, email, push_token)')
        .eq('user_id', body.user_id).maybeSingle() as { data: Row };
      if (!request) return fail('This request has already been decided.', 404);
      if (!isAdmin && (request.hub_id !== caller.hub_id || request.user_id === caller.id)) return fail('This request is for another hub.', 403);

      const name = await hubName(request.hub_id);
      const person = request.profiles;
      if (body.approve) {
        // A lead who moves is no longer lead of the old hub.
        const change: Row = { role: 'staff', hub_id: request.hub_id, staff_status: null, updated_at: new Date().toISOString() };
        if (request.kind === 'transfer') change.is_hub_lead = false;
        const { error } = await db.from('profiles').update(change).eq('id', request.user_id);
        if (error) throw error;
      } else if (request.kind === 'join') {
        await db.from('profiles').update({ staff_status: 'rejected' }).eq('id', request.user_id);
      }
      await db.from('staff_requests').delete().eq('user_id', request.user_id);
      await notify({
        userId: request.user_id,
        kind: 'general',
        title: body.approve ? 'You have been approved' : 'Your request was not approved',
        body: body.approve ? `You now have staff access to ${name}.` : `Your request for ${name} was not approved. Please speak to your hub lead.`,
        pushToken: person?.push_token,
        email: person?.email,
      });
      return json({ ok: true });
    }

    return fail('Unknown request.');
  } catch (e) {
    console.error(e);
    return fail('Something went wrong. Please try again.', 500);
  }
});
