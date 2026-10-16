import { supabase } from './supabase';

export type Role = 'student' | 'teacher';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Your profile could not be loaded.');
  }
  if (!data) {
    return null;
  }
  if (data.role !== 'student' && data.role !== 'teacher') {
    throw new Error('Your account has an unrecognized role. Please contact an administrator.');
  }
  if (
    data.id !== userId ||
    typeof data.email !== 'string' ||
    data.email.trim().length === 0 ||
    (data.full_name !== null && typeof data.full_name !== 'string')
  ) {
    throw new Error('Your profile is incomplete. Please contact an administrator.');
  }

  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    role: data.role,
  };
}

export async function updateProfile(
  userId: string,
  updates: { full_name?: string }
): Promise<{ error: string | null }> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.id !== userId) {
    return { error: 'Your session could not be verified. Please sign in again.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  return { error: error?.message ?? null };
}