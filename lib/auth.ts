import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

let globalState: AuthState = {
  session: null,
  user: null,
  loading: true,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function setAuth(session: Session | null) {
  globalState = {
    session,
    user: session?.user ?? null,
    loading: false,
  };
  notify();
}

let authListenerStarted = false;

function ensureAuthListener() {
  if (authListenerStarted) return;
  authListenerStarted = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    setAuth(session);
  });
  supabase.auth.getSession().then(({ data }) => {
    setAuth(data.session);
  });
}

function subscribe(onStoreChange: () => void) {
  ensureAuthListener();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): AuthState {
  return globalState;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export type SignUpProfile = {
  full_name: string;
};

export async function signUp(
  email: string,
  password: string,
  profile?: SignUpProfile
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: profile ? { data: { full_name: profile.full_name } } : undefined,
  });
  if (!error && data.session) {
    setAuth(data.session);
  }
  return { data, error };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.session) {
    setAuth(data.session);
  }
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message || 'Failed to sign out.');
  setAuth(null);
  return { error: null };
}