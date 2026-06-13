import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DEMO_USERS = [
  { email: 'admin@supportcast.com', password: 'Admin@1234', displayName: 'Admin User', role: 'admin' },
  { email: 'agent@supportcast.com', password: 'Demo@1234', displayName: 'Demo Agent', role: 'agent' },
  { email: 'judge@supportcast.com', password: 'Judge@1234', displayName: 'Judge Agent', role: 'agent' },
];

async function upsertAgent(user, authId) {
  const { data, error } = await supabase
    .from('agents')
    .upsert(
      { email: user.email, display_name: user.displayName, role: user.role, auth_id: authId },
      { onConflict: 'email' }
    )
    .select('id')
    .single();

  if (error) {
    console.error(`  Failed to upsert agent ${user.email}:`, error.message);
    return null;
  }
  console.log(`  '${user.email}' (${user.role}) → agents.id=${data.id}`);
  return data;
}

async function seedAgents() {
  console.log('\n[1/3] Seeding agents...');

  const { data: allUsers } = await supabase.auth.admin.listUsers();
  const existingByEmail = {};
  if (allUsers?.users) {
    for (const u of allUsers.users) {
      existingByEmail[u.email] = u.id;
    }
  }

  for (const user of DEMO_USERS) {
    let authId = existingByEmail[user.email];

    if (!authId) {
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
          user_metadata: { display_name: user.displayName, role: user.role }
        });
        if (authError) {
          console.error(`  Auth error for ${user.email}:`, authError.message);
          continue;
        }
        authId = authData.user.id;
        console.log(`  Created auth user '${user.email}' → id=${authId}`);
      } catch (err) {
        console.error(`  Exception for ${user.email}:`, err.message);
        continue;
      }
    } else {
      console.log(`  '${user.email}' already in auth → id=${authId} — skipping create`);
    }

    await upsertAgent(user, authId);
  }
}

async function getAgentId(email) {
  const { data } = await supabase.from('agents').select('id').eq('email', email).single();
  return data?.id;
}

async function seedSessions() {
  console.log('\n[2/3] Seeding demo sessions...');

  const agentId = await getAgentId('agent@supportcast.com');
  if (!agentId) { console.error('  agent@supportcast.com not found in agents table'); return; }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const sessionDefs = [
    { daysAgo: 1, hoursAgo: 2, durationMin: 12, messages: [
        { text: 'Hi, I need help with my account access', sender: 'customer', name: 'Alex Chen' },
        { text: 'Of course! I can see your account. What seems to be the issue?', sender: 'agent', name: 'Demo Agent' },
        { text: 'I cannot log in — it says wrong password but I am sure it is correct', sender: 'customer', name: 'Alex Chen' },
        { text: 'Let me reset that for you. Check your email for a reset link.', sender: 'agent', name: 'Demo Agent' },
      ]},
    { daysAgo: 3, hoursAgo: 5, durationMin: 25, messages: [
        { text: 'Hello, my video is not working during calls', sender: 'customer', name: 'Jordan Lee' },
        { text: 'Hi Jordan! Have you allowed camera permissions in your browser?', sender: 'agent', name: 'Demo Agent' },
        { text: 'Yes I did, still shows a black screen', sender: 'customer', name: 'Jordan Lee' },
        { text: 'Let me check your connection. Can you try refreshing the page?', sender: 'agent', name: 'Demo Agent' },
        { text: 'Refreshing worked! Thank you so much!', sender: 'customer', name: 'Jordan Lee' },
      ]},
    { daysAgo: 6, hoursAgo: 1, durationMin: 8, messages: [
        { text: 'Is this the right place for billing support?', sender: 'customer', name: 'Sam Rivera' },
        { text: 'Yes it is! How can I assist you today?', sender: 'agent', name: 'Demo Agent' },
        { text: 'I was charged twice for my last subscription', sender: 'customer', name: 'Sam Rivera' },
        { text: 'I see that here. I have processed a refund for the duplicate charge.', sender: 'agent', name: 'Demo Agent' },
      ]},
  ];

  for (const def of sessionDefs) {
    const createdAt = new Date(now - def.daysAgo * DAY).toISOString();
    const startedAt = new Date(now - def.daysAgo * DAY + def.hoursAgo * 60 * 60 * 1000).toISOString();
    const endedAt = new Date(now - def.daysAgo * DAY + (def.hoursAgo * 60 + def.durationMin) * 60 * 1000).toISOString();

    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .insert({
        agent_id: agentId,
        status: 'ended',
        invite_token: randomUUID(),
        created_at: createdAt,
        started_at: startedAt,
        ended_at: endedAt,
        ended_by: 'agent',
        duration_seconds: def.durationMin * 60
      })
      .select('id')
      .single();

    if (sessErr || !session) {
      console.error('  Failed to insert session:', sessErr?.message);
      continue;
    }

    console.log(`  Session ${session.id} (${def.daysAgo}d ago, ${def.durationMin}min)`);

    await supabase.from('participants').insert([
      { session_id: session.id, role: 'agent', display_name: 'Demo Agent', joined_at: startedAt, left_at: endedAt },
      { session_id: session.id, role: 'customer', display_name: def.messages[0].name, joined_at: startedAt, left_at: endedAt },
    ]);

    const baseTime = new Date(startedAt).getTime();
    const msgSpacing = (def.durationMin * 60 * 1000) / (def.messages.length + 1);
    for (let i = 0; i < def.messages.length; i++) {
      const msg = def.messages[i];
      const ts = new Date(baseTime + (i + 1) * msgSpacing).toISOString();
      await supabase.from('chat_messages').insert({
        session_id: session.id,
        sender_role: msg.sender,
        sender_name: msg.name,
        type: 'text',
        content: msg.text,
        created_at: ts
      });
    }

    await supabase.from('session_events').insert([
      { session_id: session.id, event_type: 'session_created', actor_role: 'agent', actor_name: 'Demo Agent', created_at: createdAt },
      { session_id: session.id, event_type: 'participant_joined', actor_role: 'agent', actor_name: 'Demo Agent', created_at: startedAt },
      { session_id: session.id, event_type: 'participant_joined', actor_role: 'customer', actor_name: def.messages[0].name, created_at: startedAt },
      { session_id: session.id, event_type: 'session_ended', actor_role: 'agent', actor_name: 'Demo Agent', created_at: endedAt },
    ]);
  }
}

async function seedLiveSession() {
  console.log('\n[3/3] Checking live session...');
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .in('status', ['waiting', 'active'])
    .maybeSingle();

  if (existing) {
    console.log('  Live session already exists — skipping');
    return;
  }
  const agentId = await getAgentId('agent@supportcast.com');
  if (!agentId) return;

  const { data: session } = await supabase
    .from('sessions')
    .insert({ agent_id: agentId, status: 'waiting', invite_token: randomUUID(), created_at: new Date().toISOString() })
    .select('id')
    .single();

  if (session) {
    console.log(`  Live session created: ${session.id}`);
    await supabase.from('session_events').insert({
      session_id: session.id, event_type: 'session_created', actor_role: 'agent', actor_name: 'Demo Agent', created_at: new Date().toISOString()
    });
  }
}

async function main() {
  console.log('SupportCast Demo Seed Script');
  console.log('============================');
  await seedAgents();
  await seedSessions();
  await seedLiveSession();
  console.log('\nSeed complete!');
}

main().catch(console.error);