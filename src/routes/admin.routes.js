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
  limit: z.coerce.number().int().min(1).max(100).optional()
});

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

export default router;
