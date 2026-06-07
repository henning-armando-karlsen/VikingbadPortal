import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'sales' | 'admin';
};

/** Hvilken HTML-applikasjon en portal_html-rad tilhører. */
export type PortalSlot = 'analyse' | 'crm';
