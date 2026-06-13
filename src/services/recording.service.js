import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from '../config/supabase.js';
import { mediasoupService } from './mediasoup.service.js';
import { metrics } from './metrics.service.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const recordingProcesses = new Map();

const waitForFfmpegStartup = (ffmpegProcess) => new Promise((resolve, reject) => {
  const startupTimer = setTimeout(resolve, 2000);

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

  const exitTimer = setTimeout(resolve, 5000);
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

/**
 * Generate an SDP file for ffmpeg to understand the incoming RTP streams.
 * Without this, ffmpeg can't decode raw RTP over UDP (it doesn't know the codec).
 */
const generateSdp = ({ audioPort, audioPayloadType, audioClockRate, videoPort, videoPayloadType, videoClockRate, ip }) => {
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=mediasoup recording',
    `c=IN IP4 ${ip}`,
    't=0 0',
  ];

  if (audioPort && audioPayloadType !== undefined) {
    lines.push(
      `m=audio ${audioPort} RTP/AVP ${audioPayloadType}`,
      `a=rtpmap:${audioPayloadType} opus/${audioClockRate}/2`,
      'a=recvonly',
    );
  }

  if (videoPort && videoPayloadType !== undefined) {
    lines.push(
      `m=video ${videoPort} RTP/AVP ${videoPayloadType}`,
      `a=rtpmap:${videoPayloadType} VP8/${videoClockRate}`,
      'a=recvonly',
    );
  }

  return lines.join('\r\n') + '\r\n';
};

const startRecording = async (sessionId) => {
  const tempDir = ensureTempDir();
  const tempFilePath = join(tempDir, `${sessionId}.webm`);
  const sdpFilePath = join(tempDir, `${sessionId}.sdp`);

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
  let audioPlainTransport = null;
  let videoPlainTransport = null;
  let allConsumers = [];

  try {
    // Create separate plain transports for audio and video so they get distinct ports
    audioPlainTransport = await mediasoupService.createPlainTransport(sessionId);
    videoPlainTransport = await mediasoupService.createPlainTransport(sessionId);

    // Pipe existing producers to the plain transports
    const room = mediasoupService.rooms.get(sessionId);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', 'Session room not found for recording.', 404);
    }

    let audioConsumer = null;
    let videoConsumer = null;

    // Find audio and video producers and consume them on the respective plain transports
    for (const [, peer] of room.peers) {
      for (const [, producer] of peer.producers) {
        try {
          if (producer.kind === 'audio' && !audioConsumer) {
            const audioTransport = mediasoupService.getPlainTransport(sessionId, audioPlainTransport.id);
            if (audioTransport && room.router.canConsume({ producerId: producer.id, rtpCapabilities: room.router.rtpCapabilities })) {
              audioConsumer = await audioTransport.consume({
                producerId: producer.id,
                rtpCapabilities: room.router.rtpCapabilities,
                paused: false
              });
              allConsumers.push(audioConsumer);
            }
          } else if (producer.kind === 'video' && !videoConsumer) {
            const videoTransport = mediasoupService.getPlainTransport(sessionId, videoPlainTransport.id);
            if (videoTransport && room.router.canConsume({ producerId: producer.id, rtpCapabilities: room.router.rtpCapabilities })) {
              videoConsumer = await videoTransport.consume({
                producerId: producer.id,
                rtpCapabilities: room.router.rtpCapabilities,
                paused: false
              });
              allConsumers.push(videoConsumer);
            }
          }
        } catch (err) {
          logger.error({ event: 'recording_consume_failed', producerId: producer.id, error: err.message });
        }
      }
    }

    if (!audioConsumer && !videoConsumer) {
      throw new AppError('NO_PRODUCERS', 'No audio or video producers found to record.', 409);
    }

    // Generate SDP file for ffmpeg
    const sdpContent = generateSdp({
      audioPort: audioConsumer ? audioPlainTransport.port : null,
      audioPayloadType: audioConsumer ? audioConsumer.rtpParameters.codecs[0].payloadType : undefined,
      audioClockRate: audioConsumer ? audioConsumer.rtpParameters.codecs[0].clockRate : undefined,
      videoPort: videoConsumer ? videoPlainTransport.port : null,
      videoPayloadType: videoConsumer ? videoConsumer.rtpParameters.codecs[0].payloadType : undefined,
      videoClockRate: videoConsumer ? videoConsumer.rtpParameters.codecs[0].clockRate : undefined,
      ip: '127.0.0.1'
    });

    writeFileSync(sdpFilePath, sdpContent);
    logger.info({ event: 'sdp_generated', sessionId, sdpContent });

    // Build ffmpeg arguments with proper SDP input
    const ffmpegArgs = [
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts',
      '-i', sdpFilePath,
    ];

    // Add codec handling
    if (videoConsumer) {
      ffmpegArgs.push('-c:v', 'libvpx');
    }
    if (audioConsumer) {
      ffmpegArgs.push('-c:a', 'libopus');
    }

    ffmpegArgs.push(
      '-f', 'webm',
      '-y',
      tempFilePath
    );

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    let stderrOutput = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrOutput += text;
      // Only log important ffmpeg messages
      if (text.includes('Error') || text.includes('error') || text.includes('Invalid')) {
        logger.error({ event: 'ffmpeg_stderr', sessionId, data: text });
      }
    });

    ffmpegProcess.on('error', (err) => {
      logger.error({ event: 'ffmpeg_error', sessionId, error: err.message });
    });

    ffmpegProcess.on('exit', (code) => {
      logger.info({ event: 'ffmpeg_exit', sessionId, code });
      if (code !== 0 && stderrOutput) {
        logger.error({ event: 'ffmpeg_stderr_on_exit', sessionId, stderr: stderrOutput.slice(-500) });
      }
    });

    await waitForFfmpegStartup(ffmpegProcess);

  } catch (ffmpegError) {
    metrics.recordingErrors.inc();
    logger.error({ event: 'recording_start_failed', sessionId, error: ffmpegError.message });

    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGTERM');
    }

    // Close consumers
    for (const consumer of allConsumers) {
      try { consumer.close(); } catch { /* ignore */ }
    }

    // Close plain transports
    const closeTransport = (info) => {
      if (info?.id) {
        const t = mediasoupService.getPlainTransport(sessionId, info.id);
        t?.close();
      }
    };
    closeTransport(audioPlainTransport);
    closeTransport(videoPlainTransport);

    // Clean up SDP file
    if (existsSync(sdpFilePath)) {
      try { unlinkSync(sdpFilePath); } catch { /* ignore */ }
    }

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
    sdpFilePath,
    startedAt: new Date(),
    ffmpegProcess,
    consumers: allConsumers,
    audioPlainTransportId: audioPlainTransport?.id,
    videoPlainTransportId: videoPlainTransport?.id,
  };

  recordingProcesses.set(sessionId, processInfo);

  logger.info({
    event: 'recording_started',
    sessionId,
    recordingId: data.id,
    tempFilePath,
    hasAudio: allConsumers.some(c => c.kind === 'audio'),
    hasVideo: allConsumers.some(c => c.kind === 'video'),
  });

  return data;
};

const stopRecording = async (sessionId) => {
  const processInfo = recordingProcesses.get(sessionId);
  if (!processInfo) {
    throw new AppError('RECORDING_NOT_ACTIVE', 'No active recording was found for this session.', 409);
  }

  const { ffmpegProcess, tempFilePath, sdpFilePath, recordingId } = processInfo;

  // Signal ffmpeg to finish writing
  if (ffmpegProcess && ffmpegProcess.exitCode === null) {
    ffmpegProcess.stdin?.write('q');
    // Give it a moment, then force kill if needed
    await new Promise(r => setTimeout(r, 1000));
    if (ffmpegProcess.exitCode === null) {
      ffmpegProcess.kill('SIGTERM');
    }
    await waitForFfmpegExit(ffmpegProcess);
  }

  // Close consumers
  for (const consumer of processInfo.consumers || []) {
    try { consumer.close(); } catch { /* ignore */ }
  }

  // Close plain transports
  const closeTransport = (id) => {
    if (id) {
      const t = mediasoupService.getPlainTransport(sessionId, id);
      t?.close();
    }
  };
  closeTransport(processInfo.audioPlainTransportId);
  closeTransport(processInfo.videoPlainTransportId);

  // Clean up SDP file
  if (sdpFilePath && existsSync(sdpFilePath)) {
    try { unlinkSync(sdpFilePath); } catch { /* ignore */ }
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

      if (fileSize < 1024) {
        // File too small — likely no media was received
        logger.warn({ event: 'recording_file_too_small', sessionId, fileSize });
        status = 'error';
      } else {
        const uploadPath = `recordings/${sessionId}/${recordingId}.webm`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(env.SUPABASE_STORAGE_BUCKET)
          .upload(uploadPath, readFileSync(tempFilePath), {
            contentType: 'video/webm',
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
        } else {
          logger.error({ event: 'storage_upload_failed', error: uploadError.message });
          status = 'error';
        }
      }

      try {
        unlinkSync(tempFilePath);
      } catch (err) {
        logger.warn({ event: 'temp_file_delete_failed', path: tempFilePath, error: err.message });
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

  for (const consumer of processInfo.consumers || []) {
    try { consumer.close(); } catch { /* ignore */ }
  }

  const closeTransport = (id) => {
    if (id) {
      const t = mediasoupService.getPlainTransport(sessionId, id);
      t?.close();
    }
  };
  closeTransport(processInfo.audioPlainTransportId);
  closeTransport(processInfo.videoPlainTransportId);

  // Clean up temp files
  for (const filePath of [processInfo.tempFilePath, processInfo.sdpFilePath]) {
    if (filePath && existsSync(filePath)) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
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
