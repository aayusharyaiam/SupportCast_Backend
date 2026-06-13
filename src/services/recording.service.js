import { supabaseAdmin } from '../config/supabase.js';
import { metrics } from './metrics.service.js';
import { AppError } from '../utils/errors.js';

const recordingProcesses = new Map();

const startRecording = async (sessionId) => {
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

  recordingProcesses.set(sessionId, {
    recordingId: data.id,
    startedAt: new Date()
  });

  return data;
};

const stopRecording = async (sessionId) => {
  const processInfo = recordingProcesses.get(sessionId);
  if (!processInfo) {
    throw new AppError('RECORDING_NOT_ACTIVE', 'No active recording was found for this session.', 409);
  }

  const { data, error } = await supabaseAdmin
    .from('recordings')
    .update({
      status: 'processing',
      stopped_at: new Date().toISOString()
    })
    .eq('id', processInfo.recordingId)
    .select('*')
    .single();

  recordingProcesses.delete(sessionId);

  if (error) {
    metrics.recordingErrors.inc();
    throw new AppError('RECORDING_STOP_FAILED', error.message, 500);
  }

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

export const recordingService = {
  startRecording,
  stopRecording,
  getStatus
};
