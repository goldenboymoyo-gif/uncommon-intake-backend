import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Acts as the signed-in person, so Row Level Security still applies.
export function userClient(req: Request): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

// Service role. Only use after checking who is calling.
export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getCaller(req: Request) {
  const client = userClient(req);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await adminClient()
    .from('profiles')
    .select('id, role, first_names, surname, email, push_token')
    .eq('id', user.id)
    .single();
  return profile as
    | { id: string; role: 'applicant' | 'student' | 'staff' | 'admin'; first_names: string; surname: string; email: string; push_token: string | null }
    | null;
}

export const isStaffRole = (role?: string) => role === 'staff' || role === 'admin';
