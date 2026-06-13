import { Router } from 'express';
import { z } from 'zod';
import { adminController } from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const emptyBody = z.any().optional();
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  search: z.string().max(100).optional(),
});

const createAgentBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(100),
  role: z.enum(['agent', 'admin']).optional().default('agent'),
});

const agentParams = z.object({ id: z.string().uuid() });

router.use(authenticate, roleGuard('admin'));

router.get(
  '/sessions/live',
  validate(z.object({ body: emptyBody, params: z.object({}), query: z.object({}) })),
  asyncHandler(adminController.liveSessions)
);

router.get(
  '/sessions/history',
  validate(z.object({ body: emptyBody, params: z.object({}), query: paginationQuery })),
  asyncHandler(adminController.history)
);

router.delete(
  '/sessions/:id',
  validate(
    z.object({
      body: emptyBody,
      params: z.object({ id: z.string().uuid() }),
      query: z.object({})
    })
  ),
  asyncHandler(adminController.forceEnd)
);

router.post(
  '/agents',
  validate(z.object({ body: createAgentBody, params: z.object({}), query: z.object({}) })),
  asyncHandler(adminController.createAgent)
);

router.get(
  '/agents',
  validate(z.object({ body: emptyBody, params: z.object({}), query: z.object({}) })),
  asyncHandler(adminController.getAgents)
);

router.delete(
  '/agents/:id',
  validate(z.object({ body: emptyBody, params: agentParams, query: z.object({}) })),
  asyncHandler(adminController.deleteAgent)
);

export default router;
