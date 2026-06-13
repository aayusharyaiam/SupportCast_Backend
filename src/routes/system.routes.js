import { Router } from 'express';
import { systemController } from '../controllers/system.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/health', asyncHandler(systemController.health));
router.get('/metrics', asyncHandler(systemController.metrics));

export default router;
