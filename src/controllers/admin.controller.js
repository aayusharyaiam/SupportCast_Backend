import { supabaseAdmin } from '../config/supabase.js';
import { sessionService } from '../services/session.service.js';
import { successResponse, emptyResponse } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { getSocketServer } from '../socket.js';

const liveSessions = async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*, agents(*), participants(*), recordings(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError('ADMIN_LIVE_SESSIONS_FAILED', error.message, 500);
  }

  successResponse(res, data);
};

const history = async (req, res) => {
  const page = Number(req.validated.query.page || 1);
  const limit = Number(req.validated.query.limit || 20);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('sessions')
    .select('*, agents(*), participants(*), recordings(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (req.validated.query.date_from) {
    query = query.gte('created_at', req.validated.query.date_from);
  }
  if (req.validated.query.date_to) {
    query = query.lte('created_at', req.validated.query.date_to);
  }
  if (req.validated.query.search) {
    query = query.or(`id.ilike.%${req.validated.query.search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new AppError('ADMIN_HISTORY_FAILED', error.message, 500);
  }

  res.status(200).json({
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit)
    }
  });
};

const forceEnd = async (req, res) => {
  await sessionService.endSession({ sessionId: req.validated.params.id, endedBy: 'admin' });
  getSocketServer()?.to(req.validated.params.id).emit('session-ended', {
    sessionId: req.validated.params.id,
    endedBy: 'admin'
  });
  emptyResponse(res);
};

const createAgent = async (req, res) => {
  const { email, password, displayName, role = 'agent' } = req.validated.body;

  if (!['agent', 'admin'].includes(role)) {
    throw new AppError('INVALID_ROLE', 'Role must be agent or admin', 400);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, role }
  });

  if (authError) {
    if (authError.message.includes('already been registered')) {
      throw new AppError('EMAIL_EXISTS', 'An agent with this email already exists.', 409);
    }
    throw new AppError('CREATE_USER_FAILED', authError.message, 400);
  }

  const { data: agentData, error: agentError } = await supabaseAdmin
    .from('agents')
    .upsert(
      { email, display_name: displayName, role, auth_id: authData.user.id },
      { onConflict: 'email' }
    )
    .select('id, email, display_name, role, created_at')
    .single();

  if (agentError) {
    throw new AppError('UPSERT_AGENT_FAILED', agentError.message, 500);
  }

  successResponse(res, agentData, 201);
};

const getAgents = async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('agents')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError('GET_AGENTS_FAILED', error.message, 500);
  }

  successResponse(res, data);
};

const deleteAgent = async (req, res) => {
  const { id } = req.validated.params;

  const { error } = await supabaseAdmin
    .from('agents')
    .delete()
    .eq('id', id);

  if (error) {
    throw new AppError('DELETE_AGENT_FAILED', error.message, 500);
  }

  emptyResponse(res);
};

export const adminController = {
  liveSessions,
  history,
  forceEnd,
  createAgent,
  getAgents,
  deleteAgent
};
