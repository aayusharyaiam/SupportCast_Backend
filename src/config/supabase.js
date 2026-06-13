import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const wsGlobal = typeof globalThis !== 'undefined' ? globalThis : global;
wsGlobal.WebSocket = wsGlobal.WebSocket || WebSocket;

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: WebSocket
    }
  }
);

export const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: WebSocket
    }
  }
);