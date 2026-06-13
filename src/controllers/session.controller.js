import { inviteService } from '../services/invite.service.js';
import { sessionService } from '../services/session.service.js';
import { chatService } from '../services/chat.service.js';
import { recordingService } from '../services/recording.service.js';
import { successResponse, emptyResponse } from '../utils/response.js';
import { AppError } from '../utils/errors.js';

const create = async (req, res) => {
  const session = await sessionService.createSession(req.agent.id);
  const inviteUrl = `${req.protocol}://${req.get('host')}/join?token=${session.invite_token}`;

  successResponse(
    res,
    {
      sessionId: session.id,
      inviteToken: session.invite_token,
      inviteUrl,
      status: session.status,
      createdAt: session.created_at
    },
    201
  );
};

const list = async (req, res) => {
  const page = Number(req.validated.query.page || 1);
  const limit = Number(req.validated.query.limit || 20);
  const result = await sessionService.listAgentSessions(req.agent.id, { page, limit });
  successResponse(res, result.sessions, 200, { pagination: result.pagination });
};

const get = async (req, res) => {
  const session = await sessionService.getById(req.validated.params.id);
  ensureSessionAccess(req, session);
  successResponse(res, session);
};

const join = async (req, res) => {
  const { token, displayName } = req.validated.body;
  const session = await sessionService.validateInvite(token);
  const participant = await sessionService.addParticipant({
    sessionId: session.id,
    role: 'customer',
    displayName
  });
  const customerAuth = inviteService.generateCustomerToken({
    sessionId: session.id,
    displayName
  });

  successResponse(res, {
    sessionId: session.id,
    participant,
    accessToken: customerAuth.token,
    customerId: customerAuth.customerId
  });
};

const end = async (req, res) => {
  const session = await sessionService.getById(req.validated.params.id);
  ensureSessionAccess(req, session);
  await sessionService.endSession({ sessionId: session.id, endedBy: req.agent?.role || req.user.role });
  emptyResponse(res);
};

const chatHistory = async (req, res) => {
  const session = await sessionService.getById(req.validated.params.id);
  ensureSessionAccess(req, session);
  const messages = await chatService.getHistory(session.id);
  successResponse(res, messages);
};

const recordingStatus = async (req, res) => {
  const session = await sessionService.getById(req.validated.params.id);
  ensureSessionAccess(req, session);
  const recording = await recordingService.getStatus(session.id);
  successResponse(res, recording);
};

const ensureSessionAccess = (req, session) => {
  if (req.agent?.role === 'admin') {
    return;
  }

  if (req.agent && session.agent_id === req.agent.id) {
    return;
  }

  if (req.user?.type === 'customer' && req.user.sessionId === session.id) {
    return;
  }

  throw new AppError('FORBIDDEN', 'You do not have access to this session.', 403);
};

export const sessionController = {
  create,
  list,
  get,
  join,
  end,
  chatHistory,
  recordingStatus
};
