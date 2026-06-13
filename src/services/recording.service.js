import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { supabaseAdmin } from '../config/supabase.js';
import { mediasoupService } from './mediasoup.service.js';
import { metrics } from './metrics.service.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const recordingProcesses = new Map();

const ensureTempDir = () => {
  const dir = env.RECORDING_TEMP_DIR || '/tmp/recordings';
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const startRecording = async (sessionId) => {
  const tempDir = ensureTempDir();
  const tempFilePath = join(tempDir, `${sessionId}.mp4`);

  const { data: existingRecording } = await supabaseAdmin
    .from('recordings')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'recording')
    .maybeSingle();

  if (existingRecording) {
    throw new AppError('RECORDING_ALREADY_ACTIVE', 'A recording is already in progress for this session.', 409);
  }

  const { data, error } = await supabaseAdmin
    .from('recordings')
    .insert({
      session_id: sessionId,
      status: 'recording'
    })
    .select('*')
    .single();

  if (error) {
    metrics.recordingErrors.inc();
    throw new AppError('RECORDING_START_FAILED', error.message, 500);
  }

  let ffmpegProcess = null;
  let plainTransportInfo = null;

  try {
    plainTransportInfo = await mediasoupService.createPlainTransport(sessionId);

    const ffmpegArgs = [
      '-protocol_whitelist', 'file,udp,rtp',
      '-i', `udp://${plainTransportInfo.ip}:${plainTransportInfo.port}`,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'mp4',
      '-y',
      tempFilePath
    ];

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
      logger.info({ event: 'ffmpeg_stderr', data: data.toString() });
    });

    ffmpegProcess.on('error', (err) => {
      logger.error({ event: 'ffmpeg_error', sessionId, error: err.message });
    });

    ffmpegProcess.on('exit', (code) => {
      logger.info({ event: 'ffmpeg_exit', sessionId, code });
    });

    await mediasoupService.pipeProducersToPlainTransport(sessionId, plainTransportInfo.id);

  } catch (ffmpegError) {
    logger.warn({ event: 'ffmpeg_not_available', error: ffmpegError.message });
  }

  const processInfo = {
    recordingId: data.id,
    sessionId,
    tempFilePath,
    startedAt: new Date(),
    ffmpegProcess,
    plainTransportId: plainTransportInfo?.id,
    plainTransportPort: plainTransportInfo?.port
  };

  recordingProcesses.set(sessionId, processInfo);

  logger.info({
    event: 'recording_started',
    sessionId,
    recordingId: data.id,
    tempFilePath
  });

  return {
    ...data,
    plainTransport: plainTransportInfo
  };
};

const stopRecording = async (sessionId) => {
  const processInfo = recordingProcesses.get(sessionId);
  if (!processInfo) {
    throw new AppError('RECORDING_NOT_ACTIVE', 'No active recording was found for this session.', 409);
  }

  const { ffmpegProcess, tempFilePath, recordingId } = processInfo;

  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }

  recordingProcesses.delete(sessionId);

  let fileUrl = null;
  let fileSize = null;
  let durationSeconds = null;
  let status = 'processing';

  try {
    if (existsSync(tempFilePath)) {
      const stats = statSync(tempFilePath);
      fileSize = stats.size;

      const uploadPath = `recordings/${sessionId}/${recordingId}.mp4`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(env.SUPABASE_STORAGE_BUCKET)
        .upload(uploadPath, tempFilePath, {
          contentType: 'video/mp4',
          upsert: true
        });

      if (!uploadError) {
        const { data: urlData } = supabaseAdmin.storage
          .from(env.SUPABASE_STORAGE_BUCKET)
          .getPublicUrl(uploadPath);

        fileUrl = urlData.publicUrl;
        status = 'ready';

        const startedAt = processInfo.startedAt;
        if (startedAt) {
          durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
        }

        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          logger.warn({ event: 'temp_file_delete_failed', path: tempFilePath });
        }
      } else {
        logger.error({ event: 'storage_upload_failed', error: uploadError.message });
        status = 'error';
      }
    } else {
      logger.warn({ event: 'temp_file_not_found', path: tempFilePath });
      status = 'error';
    }
  } catch (err) {
    logger.error({ event: 'recording_processing_error', error: err.message });
    status = 'error';
  }

  const stoppedAt = new Date().toISOString();
  const startedAt = processInfo.startedAt;
  if (!durationSeconds && startedAt) {
    durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  }

  const { data, error } = await supabaseAdmin
    .from('recordings')
    .update({
      status,
      stopped_at: stoppedAt,
      file_url: fileUrl,
      file_size: fileSize,
      duration_seconds: durationSeconds
    })
    .eq('id', recordingId)
    .select('*')
    .single();

  if (error) {
    metrics.recordingErrors.inc();
    throw new AppError('RECORDING_STOP_FAILED', error.message, 500);
  }

  logger.info({
    event: 'recording_stopped',
    sessionId,
    recordingId,
    status,
    fileUrl,
    fileSize
  });

  return data;
};

const getStatus = async (sessionId) => {
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError('RECORDING_LOOKUP_FAILED', error.message, 500);
  }

  return data;
};

const cancelRecording = (sessionId) => {
  const processInfo = recordingProcesses.get(sessionId);
  if (!processInfo) return;

  if (processInfo.ffmpegProcess) {
    processInfo.ffmpegProcess.kill('SIGTERM');
  }

  if (existsSync(processInfo.tempFilePath)) {
    try {
      unlinkSync(processInfo.tempFilePath);
    } catch (e) {}
  }

  recordingProcesses.delete(sessionId);
};

export const recordingService = {
  startRecording,
  stopRecording,
  getStatus,
  cancelRecording
};