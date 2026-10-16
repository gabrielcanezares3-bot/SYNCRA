import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const nativeAuthStorageKey = 'syncra-auth-session';
const secureStoreKeyPattern = /^[A-Za-z0-9._-]+$/;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

const nativeAuthStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(assertSecureStoreKey(key)),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(assertSecureStoreKey(key), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(assertSecureStoreKey(key)),
};

function assertSecureStoreKey(key: string): string {
  if (!secureStoreKeyPattern.test(key)) {
    throw new Error('Supabase generated an invalid native authentication storage key.');
  }
  return key;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    ...(Platform.OS === 'web'
      ? {}
      : { storage: nativeAuthStorage, storageKey: nativeAuthStorageKey }),
  },
});