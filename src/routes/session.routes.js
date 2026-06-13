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

router.post(
  '/:id/files/signed-url',
  authenticate,
  roleGuard('agent', 'admin', 'customer'),
  validate(
    z.object({
      body: z.object({
        fileName: z.string().min(1).max(255),
        fileType: z.string().min(1).max(100),
        fileSize: z.number().int().positive().max(10 * 1024 * 1024)
      }),
      params: idParams,
      query: z.object({})
    })
  ),
  asyncHandler(sessionController.getFileSignedUrl)
);

export default router;
