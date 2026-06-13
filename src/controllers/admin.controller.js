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
  emptyResponse(res);
};

export const adminController = {
  liveSessions,
  history,
  forceEnd
};
