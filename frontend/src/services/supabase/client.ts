import { createClient } from '@supabase/supabase-js'
import { environment } from '../../config/environment'

// Only public credentials belong in browser configuration.
export const supabase =
  environment.supabaseUrl && environment.supabasePublishableKey
    ? createClient(
        environment.supabaseUrl,
        environment.supabasePublishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
          },
        },
      )
    : null
