import { supabaseAdmin } from '../config/supabase.js';
import { sessionService } from '../services/session.service.js';
import { successResponse, emptyResponse } from '../utils/response.js';
import { AppError } from '../utils/errors.js';

const liveSessions = async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*, agents(*), participants(*), recordings(*)')
    .in('status', ['waiting', 'active'])
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

  const { data, error, count } = await supabaseAdmin
    .from('sessions')
    .select('*, agents(*), participants(*), recordings(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError('ADMIN_HISTORY_FAILED', error.message, 500);
  }

  successResponse(res, data, 200, {
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
  emptyResponse(res);
};

export const adminController = {
  liveSessions,
  history,
  forceEnd
};
