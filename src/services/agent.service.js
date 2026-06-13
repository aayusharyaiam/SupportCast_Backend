import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';

const findByAuthId = async (authId) => {
  const { data, error } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle();

  if (error) {
    throw new AppError('AGENT_LOOKUP_FAILED', error.message, 500);
  }

  return data;
};

const ensureFromAuthUser = async (authUser) => {
  const existing = await findByAuthId(authUser.id);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from('agents')
    .insert({
      auth_id: authUser.id,
      email: authUser.email,
      display_name: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Agent',
      role: authUser.user_metadata?.role || 'agent'
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError('AGENT_CREATE_FAILED', error.message, 500);
  }

  return data;
};

export const agentService = {
  findByAuthId,
  ensureFromAuthUser
};
