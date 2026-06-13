import { Router } from 'express';
import { z } from 'zod';
import { sessionController } from '../controllers/session.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const idParams = z.object({
  id: z.string().uuid()
});

const emptyBody = z.any().optional();

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

router.post(
  '/',
  authenticate,
  roleGuard('agent', 'admin'),
  validate(z.object({ body: emptyBody, params: z.object({}), query: z.object({}) })),
  asyncHandler(sessionController.create)
);

router.get(
  '/',
  authenticate,
  roleGuard('agent', 'admin'),
  validate(z.object({ body: emptyBody, params: z.object({}), query: paginationQuery })),
  asyncHandler(sessionController.list)
);

router.post(
  '/join',
  validate(
    z.object({
      body: z.object({
        token: z.string().uuid(),
        displayName: z.string().trim().min(1).max(80)
      }),
      params: z.object({}),
      query: z.object({})
    })
  ),
  asyncHandler(sessionController.join)
);

router.get(
  '/:id',
  authenticate,
  roleGuard('agent', 'admin', 'customer'),
  validate(z.object({ body: emptyBody, params: idParams, query: z.object({}) })),
  asyncHandler(sessionController.get)
);

router.delete(
  '/:id',
  authenticate,
  roleGuard('agent', 'admin'),
  validate(z.object({ body: emptyBody, params: idParams, query: z.object({}) })),
  asyncHandler(sessionController.end)
);

router.get(
  '/:id/chat',
  authenticate,
  roleGuard('agent', 'admin', 'customer'),
  validate(z.object({ body: emptyBody, params: idParams, query: z.object({}) })),
  asyncHandler(sessionController.chatHistory)
);

router.get(
  '/:id/recording',
  authenticate,
  roleGuard('agent', 'admin'),
  validate(z.object({ body: emptyBody, params: idParams, query: z.object({}) })),
  asyncHandler(sessionController.recordingStatus)
);

export default router;
