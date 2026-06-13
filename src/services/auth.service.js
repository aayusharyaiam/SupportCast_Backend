import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import { agentService } from './agent.service.js';
import { AppError } from '../utils/errors.js';

const login = async ({ email, password }) => {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    throw new AppError('LOGIN_FAILED', 'Email or password is incorrect.', 401);
  }

  const agent = await agentService.ensureFromAuthUser(data.user);

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    agent
  };
};

const logout = async (token) => {
  const { error } = await supabaseAdmin.auth.admin.signOut(token);
  if (error) {
    throw new AppError('LOGOUT_FAILED', error.message, 500);
  }
};

export const authService = {
  login,
  logout
};
