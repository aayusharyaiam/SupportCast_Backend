import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';

const createSession = async (agentId) => {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .insert({ agent_id: agentId })
    .select('*')
    .single();

  if (error) {
    throw new AppError('SESSION_CREATE_FAILED', error.message, 500);
  }

  await logEvent({
    sessionId: data.id,
    eventType: 'session_created',
    actorRole: 'agent'
  });

  return data;
};

const listAgentSessions = async (agentId, { page = 1, limit = 20 }) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabaseAdmin
    .from('sessions')
    .select('*, participants(*), recordings(*)', { count: 'exact' })
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError('SESSION_LIST_FAILED', error.message, 500);
  }

  return {
    sessions: data,
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit)
    }
  };
};

const getById = async (sessionId) => {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*, participants(*), recordings(*), session_events(*)')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw new AppError('SESSION_LOOKUP_FAILED', error.message, 500);
  }

  if (!data) {
    throw new AppError('SESSION_NOT_FOUND', 'The requested session does not exist.', 404);
  }

  return data;
};

const validateInvite = async (inviteToken) => {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .eq('invite_token', inviteToken)
    .neq('status', 'ended')
    .maybeSingle();

  if (error) {
    throw new AppError('INVITE_LOOKUP_FAILED', error.message, 500);
  }

  if (!data) {
    throw new AppError('INVALID_INVITE', 'This link has expired or is invalid.', 404);
  }

  return data;
};

const addParticipant = async ({ sessionId, role, displayName }) => {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .insert({
      session_id: sessionId,
      role,
      display_name: displayName
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError('PARTICIPANT_CREATE_FAILED', error.message, 500);
  }

  await logEvent({
    sessionId,
    eventType: 'participant_joined',
    actorRole: role,
    actorName: displayName,
    metadata: { participantId: data.id }
  });

  await supabaseAdmin
    .from('sessions')
    .update({
      status: 'active',
      started_at: new Date().toISOString()
    })
    .eq('id', sessionId)
    .eq('status', 'waiting');

  return data;
};

const endSession = async ({ sessionId, endedBy }) => {
  const now = new Date().toISOString();
  const existing = await getById(sessionId);
  const startedAt = existing.started_at ? new Date(existing.started_at).getTime() : Date.now();
  const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

  const { data, error } = await supabaseAdmin
    .from('sessions')
    .update({
      status: 'ended',
      ended_at: now,
      ended_by: endedBy,
      duration_seconds: durationSeconds
    })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) {
    throw new AppError('SESSION_END_FAILED', error.message, 500);
  }

  await supabaseAdmin
    .from('participants')
    .update({ left_at: now })
    .eq('session_id', sessionId)
    .is('left_at', null);

  await logEvent({
    sessionId,
    eventType: 'session_ended',
    actorRole: endedBy
  });

  return data;
};

const logEvent = async ({ sessionId, eventType, actorRole, actorName, metadata = {} }) => {
  const { error } = await supabaseAdmin.from('session_events').insert({
    session_id: sessionId,
    event_type: eventType,
    actor_role: actorRole,
    actor_name: actorName,
    metadata
  });

  if (error) {
    throw new AppError('SESSION_EVENT_FAILED', error.message, 500);
  }
};

export const sessionService = {
  createSession,
  listAgentSessions,
  getById,
  validateInvite,
  addParticipant,
  endSession,
  logEvent
};
