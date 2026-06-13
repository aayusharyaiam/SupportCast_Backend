import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from '../config/supabase.js';
import { mediasoupService } from './mediasoup.service.js';
import { metrics } from './metrics.service.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const recordingProcesses = new Map();

const waitForFfmpegStartup = (ffmpegProcess) => new Promise((resolve, reject) => {
  const startupTimer = setTimeout(resolve, 500);

  ffmpegProcess.once('error', (err) => {
    clearTimeout(startupTimer);
    reject(err);
  });

  ffmpegProcess.once('exit', (code) => {
    clearTimeout(startupTimer);
    if (code !== 0) {
      reject(new Error(`FFmpeg exited before recording started with code ${code}`));
    } else {
      resolve();
    }
  });
});

const waitForFfmpegExit = (ffmpegProcess) => new Promise((resolve) => {
  if (!ffmpegProcess || ffmpegProcess.exitCode !== null) {
    resolve();
    return;
  }

  const exitTimer = setTimeout(resolve, 3000);
  ffmpegProcess.once('exit', () => {
    clearTimeout(exitTimer);
    resolve();
  });
});

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
    // Check if there's actually a live recording process in memory.
    // After a server restart/redeploy the DB row is stale — no ffmpeg is running.
    if (recordingProcesses.has(sessionId)) {
      throw new AppError('RECORDING_ALREADY_ACTIVE', 'A recording is already in progress for this session.', 409);
    }

    // Stale DB row from a previous server instance — clean it up
    logger.warn({ event: 'stale_recording_cleaned', sessionId, recordingId: existingRecording.id });
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'error',
        stopped_at: new Date().toISOString(),
        error_message: 'Recording interrupted by server restart'
      })
      .eq('id', existingRecording.id);
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
  let plainTransportConsumers = [];

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

    await waitForFfmpegStartup(ffmpegProcess);
    plainTransportConsumers = await mediasoupService.pipeProducersToPlainTransport(sessionId, plainTransportInfo.id);

  } catch (ffmpegError) {
    metrics.recordingErrors.inc();
    logger.error({ event: 'recording_start_failed', sessionId, error: ffmpegError.message });

    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGTERM');
    }

    const plainTransport = plainTransportInfo?.id
      ? mediasoupService.getPlainTransport(sessionId, plainTransportInfo.id)
      : null;
    plainTransport?.close();

    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'error',
        stopped_at: new Date().toISOString(),
        error_message: ffmpegError.message
      })
      .eq('id', data.id);

    throw new AppError('RECORDING_START_FAILED', ffmpegError.message, 500);
  }

  const processInfo = {
    recordingId: data.id,
    sessionId,
    tempFilePath,
    startedAt: new Date(),
    ffmpegProcess,
    plainTransportConsumers,
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
    await waitForFfmpegExit(ffmpegProcess);
  }

  for (const consumer of processInfo.plainTransportConsumers || []) {
    consumer.close();
  }

  const plainTransport = processInfo.plainTransportId
    ? mediasoupService.getPlainTransport(sessionId, processInfo.plainTransportId)
    : null;
  plainTransport?.close();

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
        .upload(uploadPath, readFileSync(tempFilePath), {
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
        } catch (err) {
          logger.warn({ event: 'temp_file_delete_failed', path: tempFilePath, error: err.message });
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

  for (const consumer of processInfo.plainTransportConsumers || []) {
    consumer.close();
  }

  const plainTransport = processInfo.plainTransportId
    ? mediasoupService.getPlainTransport(sessionId, processInfo.plainTransportId)
    : null;
  plainTransport?.close();

  if (existsSync(processInfo.tempFilePath)) {
    try {
      unlinkSync(processInfo.tempFilePath);
    } catch (err) {
      logger.warn({ event: 'temp_file_delete_failed', path: processInfo.tempFilePath, error: err.message });
    }
  }

  recordingProcesses.delete(sessionId);
};

export const recordingService = {
  startRecording,
  stopRecording,
  getStatus,
  cancelRecording
};
