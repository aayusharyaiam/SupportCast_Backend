import { supabaseAdmin } from '../config/supabase.js';
import { metrics } from './metrics.service.js';
import { AppError } from '../utils/errors.js';

const saveMessage = async ({ sessionId, senderRole, senderName, content }) => {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      sender_role: senderRole,
      sender_name: senderName,
      content
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError('MESSAGE_SAVE_FAILED', error.message, 500);
  }

  metrics.messagesSent.inc();
  return data;
};

const saveFileMessage = async ({ sessionId, senderRole, senderName, fileName, fileUrl, fileSize }) => {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      sender_role: senderRole,
      sender_name: senderName,
      type: 'file',
      content: null,
      file_name: fileName,
      file_url: fileUrl,
      file_size: fileSize
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError('FILE_MESSAGE_SAVE_FAILED', error.message, 500);
  }

  metrics.messagesSent.inc();
  return data;
};

const getHistory = async (sessionId) => {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new AppError('CHAT_HISTORY_FAILED', error.message, 500);
  }

  return data;
};

export const chatService = {
  saveMessage,
  saveFileMessage,
  getHistory
};
