import { agentService } from '../services/agent.service.js';
import { AppError } from '../utils/errors.js';

export const roleGuard = (...allowedRoles) => async (req, _res, next) => {
  try {
    if (req.user?.type === 'customer') {
      if (!allowedRoles.includes('customer')) {
        throw new AppError('FORBIDDEN', 'This action is not available to customers.', 403);
      }
      return next();
    }

    const agent = await agentService.findByAuthId(req.user.id);
    if (!agent || !allowedRoles.includes(agent.role)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.', 403);
    }

    req.agent = agent;
    return next();
  } catch (error) {
    return next(error);
  }
};
