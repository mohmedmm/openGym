/* db-pg.js — Relational database adapter for openGym (PostgreSQL + Durable fallback)
   Powers Multi-user, Teams, Coach Hub, Individual Overrides, Live Tracking & Chat */
import fs from 'node:fs';
import path from 'node:path';

let pg = null;
try {
  const pgModule = await import('pg');
  pg = pgModule.default || pgModule;
} catch (e) {
  // pg will be available in container or when installed
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const FALLBACK_DB_FILE = path.join(DATA_DIR, 'relational_gym.json');

let pool = null;
let fallbackData = null;

function loadFallbackData() {
  if (fallbackData) return fallbackData;
  try {
    if (fs.existsSync(FALLBACK_DB_FILE)) {
      fallbackData = JSON.parse(fs.readFileSync(FALLBACK_DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading fallback db:', e.message);
  }
  if (!fallbackData) {
    fallbackData = {
      profiles: [],
      teams: [],
      team_members: [],
      team_plans: [],
      member_plan_overrides: [],
      workouts_logged: [],
      coach_reviews: [],
      chat_messages: [],
      nutrition_logs: [],
      ai_recommendations: []
    };
  }
  return fallbackData;
}

function saveFallbackData() {
  if (!fallbackData) return;
  try {
    const tmp = FALLBACK_DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(fallbackData, null, 2), 'utf8');
    fs.renameSync(tmp, FALLBACK_DB_FILE);
  } catch (e) {
    console.error('Failed saving fallback db:', e.message);
  }
}

export async function initDb() {
  if (DATABASE_URL && pg) {
    try {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      // test connection
      await pool.query('SELECT 1');
      console.log('✅ Connected to PostgreSQL successfully!');
      await createTables();
      return true;
    } catch (e) {
      console.warn('⚠️ PostgreSQL connection failed, falling back to durable JSON storage:', e.message);
      pool = null;
    }
  }
  console.log('ℹ️ Using durable file storage for relational gym database:', FALLBACK_DB_FILE);
  loadFallbackData();
  return true;
}

async function createTables() {
  if (!pool) return;
  const schema = `
    CREATE TABLE IF NOT EXISTS gym_profiles (
      uid VARCHAR(128) PRIMARY KEY,
      primary_goal VARCHAR(64) DEFAULT 'General Fitness',
      current_weight NUMERIC(6,2),
      target_weight NUMERIC(6,2),
      height_cm NUMERIC(5,1),
      age INT,
      experience_level VARCHAR(32) DEFAULT 'Beginner',
      days_per_week INT DEFAULT 3,
      session_duration_mins INT DEFAULT 60,
      available_equipment JSONB DEFAULT '[]'::jsonb,
      preferred_exercises JSONB DEFAULT '[]'::jsonb,
      avoid_exercises JSONB DEFAULT '[]'::jsonb,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_teams (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      description TEXT,
      avatar_url TEXT,
      head_coach_uid VARCHAR(128) NOT NULL,
      schedule_json JSONB DEFAULT '{}'::jsonb,
      invite_code VARCHAR(32) UNIQUE,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_team_members (
      id VARCHAR(64) PRIMARY KEY,
      team_id VARCHAR(64) NOT NULL REFERENCES gym_teams(id) ON DELETE CASCADE,
      uid VARCHAR(128) NOT NULL,
      role VARCHAR(32) DEFAULT 'trainee',
      joined_at BIGINT,
      UNIQUE(team_id, uid)
    );

    CREATE TABLE IF NOT EXISTS gym_team_plans (
      id VARCHAR(64) PRIMARY KEY,
      team_id VARCHAR(64) NOT NULL REFERENCES gym_teams(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      description TEXT,
      days_json JSONB DEFAULT '[]'::jsonb,
      created_at BIGINT,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_member_plan_overrides (
      id VARCHAR(64) PRIMARY KEY,
      team_plan_id VARCHAR(64) NOT NULL REFERENCES gym_team_plans(id) ON DELETE CASCADE,
      uid VARCHAR(128) NOT NULL,
      day_id VARCHAR(64) NOT NULL,
      exercise_id VARCHAR(64) NOT NULL,
      custom_sets INT,
      custom_reps VARCHAR(32),
      custom_weight NUMERIC(6,2),
      custom_intensity VARCHAR(32),
      custom_rest_seconds INT,
      alt_exercise_id VARCHAR(64),
      alt_notes TEXT,
      updated_at BIGINT,
      UNIQUE(team_plan_id, uid, day_id, exercise_id)
    );

    CREATE TABLE IF NOT EXISTS gym_workouts_logged (
      id VARCHAR(64) PRIMARY KEY,
      uid VARCHAR(128) NOT NULL,
      team_id VARCHAR(64),
      plan_id VARCHAR(64),
      routine_name VARCHAR(128),
      started_at BIGINT,
      finished_at BIGINT,
      duration_seconds INT,
      exercises_json JSONB DEFAULT '[]'::jsonb,
      notes TEXT,
      status VARCHAR(32) DEFAULT 'completed',
      video_url TEXT,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_coach_reviews (
      id VARCHAR(64) PRIMARY KEY,
      coach_uid VARCHAR(128) NOT NULL,
      trainee_uid VARCHAR(128) NOT NULL,
      workout_id VARCHAR(64) NOT NULL,
      comment TEXT NOT NULL,
      video_feedback_url TEXT,
      rating INT,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_chat_messages (
      id VARCHAR(64) PRIMARY KEY,
      sender_uid VARCHAR(128) NOT NULL,
      target_type VARCHAR(16) NOT NULL,
      target_id VARCHAR(64) NOT NULL,
      message TEXT NOT NULL,
      media_url TEXT,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS gym_nutrition_logs (
      id VARCHAR(64) PRIMARY KEY,
      uid VARCHAR(128) NOT NULL,
      log_date VARCHAR(16) NOT NULL,
      calories INT DEFAULT 0,
      protein_g NUMERIC(6,1) DEFAULT 0,
      carbs_g NUMERIC(6,1) DEFAULT 0,
      fat_g NUMERIC(6,1) DEFAULT 0,
      water_ml INT DEFAULT 0,
      sleep_hours NUMERIC(4,1) DEFAULT 0,
      weight_kg NUMERIC(6,2),
      notes TEXT,
      created_at BIGINT,
      UNIQUE(uid, log_date)
    );

    CREATE TABLE IF NOT EXISTS gym_ai_recommendations (
      id VARCHAR(64) PRIMARY KEY,
      requester_uid VARCHAR(128) NOT NULL,
      target_uid VARCHAR(128),
      team_id VARCHAR(64),
      rec_type VARCHAR(64) NOT NULL,
      suggestion_json JSONB NOT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      created_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_gym_team_members_uid ON gym_team_members(uid);
    CREATE INDEX IF NOT EXISTS idx_gym_workouts_uid ON gym_workouts_logged(uid);
    CREATE INDEX IF NOT EXISTS idx_gym_workouts_team ON gym_workouts_logged(team_id);
    CREATE INDEX IF NOT EXISTS idx_gym_chat_target ON gym_chat_messages(target_type, target_id);
  `;
  await pool.query(schema);
  console.log('✅ PostgreSQL tables and indexes verified.');
}

// ----------------- PROFILE METHODS -----------------
export async function getProfile(uid) {
  if (pool) {
    const res = await pool.query('SELECT * FROM gym_profiles WHERE uid = $1', [uid]);
    return res.rows[0] || null;
  }
  const db = loadFallbackData();
  return db.profiles.find(p => p.uid === uid) || null;
}

export async function upsertProfile(uid, data) {
  const now = Date.now();
  if (pool) {
    const q = `
      INSERT INTO gym_profiles (
        uid, primary_goal, current_weight, target_weight, height_cm, age,
        experience_level, days_per_week, session_duration_mins, available_equipment,
        preferred_exercises, avoid_exercises, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (uid) DO UPDATE SET
        primary_goal = EXCLUDED.primary_goal,
        current_weight = EXCLUDED.current_weight,
        target_weight = EXCLUDED.target_weight,
        height_cm = EXCLUDED.height_cm,
        age = EXCLUDED.age,
        experience_level = EXCLUDED.experience_level,
        days_per_week = EXCLUDED.days_per_week,
        session_duration_mins = EXCLUDED.session_duration_mins,
        available_equipment = EXCLUDED.available_equipment,
        preferred_exercises = EXCLUDED.preferred_exercises,
        avoid_exercises = EXCLUDED.avoid_exercises,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;
    const res = await pool.query(q, [
      uid,
      data.primary_goal || 'General Fitness',
      data.current_weight || null,
      data.target_weight || null,
      data.height_cm || null,
      data.age || null,
      data.experience_level || 'Beginner',
      data.days_per_week || 3,
      data.session_duration_mins || 60,
      JSON.stringify(data.available_equipment || []),
      JSON.stringify(data.preferred_exercises || []),
      JSON.stringify(data.avoid_exercises || []),
      now
    ]);
    return res.rows[0];
  }
  const db = loadFallbackData();
  let p = db.profiles.find(x => x.uid === uid);
  if (!p) {
    p = { uid, ...data, updated_at: now };
    db.profiles.push(p);
  } else {
    Object.assign(p, data, { updated_at: now });
  }
  saveFallbackData();
  return p;
}

// ----------------- TEAMS & MEMBERS -----------------
export async function createTeam({ id, name, description, avatar_url, head_coach_uid, schedule_json, invite_code }) {
  const now = Date.now();
  const teamId = id || 'team_' + Math.random().toString(36).substring(2, 10);
  const code = invite_code || Math.random().toString(36).substring(2, 8).toUpperCase();

  if (pool) {
    await pool.query(
      `INSERT INTO gym_teams (id, name, description, avatar_url, head_coach_uid, schedule_json, invite_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [teamId, name, description || '', avatar_url || '', head_coach_uid, JSON.stringify(schedule_json || {}), code, now]
    );
    // add creator as head coach member
    const memberId = 'mem_' + Math.random().toString(36).substring(2, 10);
    await pool.query(
      `INSERT INTO gym_team_members (id, team_id, uid, role, joined_at) VALUES ($1, $2, $3, 'coach', $4)`,
      [memberId, teamId, head_coach_uid, now]
    );
    return { id: teamId, name, description, avatar_url, head_coach_uid, schedule_json, invite_code: code, created_at: now };
  }

  const db = loadFallbackData();
  const team = { id: teamId, name, description: description || '', avatar_url: avatar_url || '', head_coach_uid, schedule_json: schedule_json || {}, invite_code: code, created_at: now };
  db.teams.push(team);
  db.team_members.push({ id: 'mem_' + Math.random().toString(36).substring(2, 10), team_id: teamId, uid: head_coach_uid, role: 'coach', joined_at: now });
  saveFallbackData();
  return team;
}

export async function getUserTeams(uid) {
  if (pool) {
    const q = `
      SELECT t.*, tm.role as user_role
      FROM gym_teams t
      JOIN gym_team_members tm ON t.id = tm.team_id
      WHERE tm.uid = $1
      ORDER BY t.created_at DESC
    `;
    const res = await pool.query(q, [uid]);
    return res.rows;
  }
  const db = loadFallbackData();
  const memberships = db.team_members.filter(m => m.uid === uid);
  return memberships.map(m => {
    const t = db.teams.find(x => x.id === m.team_id);
    return t ? { ...t, user_role: m.role } : null;
  }).filter(Boolean);
}

export async function getTeamDetails(teamId) {
  if (pool) {
    const tRes = await pool.query('SELECT * FROM gym_teams WHERE id = $1', [teamId]);
    if (!tRes.rows[0]) return null;
    const mRes = await pool.query(`
      SELECT tm.*, p.primary_goal, p.current_weight, p.target_weight, p.experience_level
      FROM gym_team_members tm
      LEFT JOIN gym_profiles p ON tm.uid = p.uid
      WHERE tm.team_id = $1
    `, [teamId]);
    const pRes = await pool.query('SELECT * FROM gym_team_plans WHERE team_id = $1 ORDER BY created_at DESC', [teamId]);
    return { ...tRes.rows[0], members: mRes.rows, plans: pRes.rows };
  }
  const db = loadFallbackData();
  const team = db.teams.find(t => t.id === teamId);
  if (!team) return null;
  const members = db.team_members.filter(m => m.team_id === teamId).map(m => {
    const p = db.profiles.find(x => x.uid === m.uid) || {};
    return { ...m, primary_goal: p.primary_goal, current_weight: p.current_weight, target_weight: p.target_weight, experience_level: p.experience_level };
  });
  const plans = db.team_plans.filter(p => p.team_id === teamId);
  return { ...team, members, plans };
}

export async function joinTeamByCode(uid, inviteCode) {
  const code = (inviteCode || '').trim().toUpperCase();
  const now = Date.now();
  if (pool) {
    const tRes = await pool.query('SELECT * FROM gym_teams WHERE invite_code = $1', [code]);
    if (!tRes.rows[0]) throw new Error('رمز الدعوة غير صحيح');
    const team = tRes.rows[0];
    const mRes = await pool.query('SELECT * FROM gym_team_members WHERE team_id = $1 AND uid = $2', [team.id, uid]);
    if (mRes.rows[0]) return { team, member: mRes.rows[0], already_member: true };
    const memId = 'mem_' + Math.random().toString(36).substring(2, 10);
    const ins = await pool.query(
      `INSERT INTO gym_team_members (id, team_id, uid, role, joined_at) VALUES ($1, $2, $3, 'trainee', $4) RETURNING *`,
      [memId, team.id, uid, now]
    );
    return { team, member: ins.rows[0], already_member: false };
  }

  const db = loadFallbackData();
  const team = db.teams.find(t => (t.invite_code || '').toUpperCase() === code);
  if (!team) throw new Error('رمز الدعوة غير صحيح');
  let mem = db.team_members.find(m => m.team_id === team.id && m.uid === uid);
  if (mem) return { team, member: mem, already_member: true };
  mem = { id: 'mem_' + Math.random().toString(36).substring(2, 10), team_id: team.id, uid, role: 'trainee', joined_at: now };
  db.team_members.push(mem);
  saveFallbackData();
  return { team, member: mem, already_member: false };
}

// ----------------- TEAM PLANS & INDIVIDUAL OVERRIDES -----------------
export async function saveTeamPlan({ id, team_id, name, description, days_json }) {
  const now = Date.now();
  const planId = id || 'plan_' + Math.random().toString(36).substring(2, 10);
  if (pool) {
    const q = `
      INSERT INTO gym_team_plans (id, team_id, name, description, days_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        days_json = EXCLUDED.days_json,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;
    const res = await pool.query(q, [planId, team_id, name, description || '', JSON.stringify(days_json || []), now, now]);
    return res.rows[0];
  }

  const db = loadFallbackData();
  let p = db.team_plans.find(x => x.id === planId);
  if (!p) {
    p = { id: planId, team_id, name, description: description || '', days_json: days_json || [], created_at: now, updated_at: now };
    db.team_plans.push(p);
  } else {
    Object.assign(p, { name, description, days_json, updated_at: now });
  }
  saveFallbackData();
  return p;
}

export async function getPlanOverrides(planId, uid = null) {
  if (pool) {
    let q = 'SELECT * FROM gym_member_plan_overrides WHERE team_plan_id = $1';
    const params = [planId];
    if (uid) {
      q += ' AND uid = $2';
      params.push(uid);
    }
    const res = await pool.query(q, params);
    return res.rows;
  }
  const db = loadFallbackData();
  return db.member_plan_overrides.filter(o => o.team_plan_id === planId && (!uid || o.uid === uid));
}

export async function upsertPlanOverride({ team_plan_id, uid, day_id, exercise_id, custom_sets, custom_reps, custom_weight, custom_intensity, custom_rest_seconds, alt_exercise_id, alt_notes }) {
  const now = Date.now();
  const id = `ovr_${team_plan_id}_${uid}_${day_id}_${exercise_id}`.replace(/[^a-zA-Z0-9_]/g, '');
  if (pool) {
    const q = `
      INSERT INTO gym_member_plan_overrides (
        id, team_plan_id, uid, day_id, exercise_id, custom_sets, custom_reps,
        custom_weight, custom_intensity, custom_rest_seconds, alt_exercise_id, alt_notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (team_plan_id, uid, day_id, exercise_id) DO UPDATE SET
        custom_sets = EXCLUDED.custom_sets,
        custom_reps = EXCLUDED.custom_reps,
        custom_weight = EXCLUDED.custom_weight,
        custom_intensity = EXCLUDED.custom_intensity,
        custom_rest_seconds = EXCLUDED.custom_rest_seconds,
        alt_exercise_id = EXCLUDED.alt_exercise_id,
        alt_notes = EXCLUDED.alt_notes,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;
    const res = await pool.query(q, [
      id, team_plan_id, uid, day_id, exercise_id,
      custom_sets ?? null, custom_reps ?? null, custom_weight ?? null,
      custom_intensity ?? null, custom_rest_seconds ?? null,
      alt_exercise_id ?? null, alt_notes ?? null, now
    ]);
    return res.rows[0];
  }

  const db = loadFallbackData();
  let o = db.member_plan_overrides.find(x => x.team_plan_id === team_plan_id && x.uid === uid && x.day_id === day_id && x.exercise_id === exercise_id);
  const data = { id, team_plan_id, uid, day_id, exercise_id, custom_sets, custom_reps, custom_weight, custom_intensity, custom_rest_seconds, alt_exercise_id, alt_notes, updated_at: now };
  if (!o) {
    db.member_plan_overrides.push(data);
  } else {
    Object.assign(o, data);
  }
  saveFallbackData();
  return data;
}

// ----------------- WORKOUT LOGGING & LIVE BOARD -----------------
export async function logWorkout({ id, uid, team_id, plan_id, routine_name, started_at, finished_at, duration_seconds, exercises_json, notes, status, video_url }) {
  const now = Date.now();
  const workoutId = id || 'wlog_' + Math.random().toString(36).substring(2, 12);
  if (pool) {
    const q = `
      INSERT INTO gym_workouts_logged (
        id, uid, team_id, plan_id, routine_name, started_at, finished_at,
        duration_seconds, exercises_json, notes, status, video_url, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        finished_at = EXCLUDED.finished_at,
        duration_seconds = EXCLUDED.duration_seconds,
        exercises_json = EXCLUDED.exercises_json,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        video_url = EXCLUDED.video_url
      RETURNING *;
    `;
    const res = await pool.query(q, [
      workoutId, uid, team_id || null, plan_id || null, routine_name || 'Workout',
      started_at || now, finished_at || null, duration_seconds || 0,
      JSON.stringify(exercises_json || []), notes || '', status || 'completed',
      video_url || '', now
    ]);
    return res.rows[0];
  }

  const db = loadFallbackData();
  let w = db.workouts_logged.find(x => x.id === workoutId);
  const item = {
    id: workoutId, uid, team_id: team_id || null, plan_id: plan_id || null,
    routine_name: routine_name || 'Workout', started_at: started_at || now,
    finished_at: finished_at || null, duration_seconds: duration_seconds || 0,
    exercises_json: exercises_json || [], notes: notes || '', status: status || 'completed',
    video_url: video_url || '', created_at: now
  };
  if (!w) db.workouts_logged.push(item);
  else Object.assign(w, item);
  saveFallbackData();
  return item;
}

export async function getCoachLiveBoard(coachUid) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (pool) {
    // Teams coached by this user
    const teamsRes = await pool.query('SELECT id, name FROM gym_teams WHERE head_coach_uid = $1', [coachUid]);
    const teamIds = teamsRes.rows.map(t => t.id);
    if (!teamIds.length) return { in_progress: [], completed: [], missed: [] };

    // Members of these teams
    const membersRes = await pool.query(`
      SELECT tm.uid, tm.team_id, t.name as team_name, p.primary_goal
      FROM gym_team_members tm
      JOIN gym_teams t ON tm.team_id = t.id
      LEFT JOIN gym_profiles p ON tm.uid = p.uid
      WHERE tm.team_id = ANY($1) AND tm.role = 'trainee'
    `, [teamIds]);

    const logsRes = await pool.query(`
      SELECT w.*, r.comment as coach_comment
      FROM gym_workouts_logged w
      LEFT JOIN gym_coach_reviews r ON w.id = r.workout_id
      WHERE (w.team_id = ANY($1) OR w.uid = ANY($2)) AND w.started_at > $3
      ORDER BY w.started_at DESC
    `, [teamIds, membersRes.rows.map(m => m.uid), oneDayAgo]);

    const active = [];
    const done = [];
    const memberUidsSeen = new Set();

    for (const log of logsRes.rows) {
      memberUidsSeen.add(log.uid);
      if (log.status === 'in_progress') active.push(log);
      else done.push(log);
    }

    const missed = membersRes.rows.filter(m => !memberUidsSeen.has(m.uid));
    return { in_progress: active, completed: done, missed };
  }

  const db = loadFallbackData();
  const myTeams = db.teams.filter(t => t.head_coach_uid === coachUid);
  const myTeamIds = new Set(myTeams.map(t => t.id));
  const myMembers = db.team_members.filter(m => myTeamIds.has(m.team_id) && m.role === 'trainee');
  const myMemberUids = new Set(myMembers.map(m => m.uid));

  const recentLogs = db.workouts_logged.filter(w =>
    (myTeamIds.has(w.team_id) || myMemberUids.has(w.uid)) && (w.started_at || 0) > oneDayAgo
  );

  const active = recentLogs.filter(w => w.status === 'in_progress');
  const done = recentLogs.filter(w => w.status === 'completed');
  const seenUids = new Set(recentLogs.map(w => w.uid));
  const missed = myMembers.filter(m => !seenUids.has(m.uid)).map(m => {
    const p = db.profiles.find(x => x.uid === m.uid) || {};
    const t = db.teams.find(x => x.id === m.team_id) || {};
    return { uid: m.uid, team_id: m.team_id, team_name: t.name, primary_goal: p.primary_goal };
  });

  return { in_progress: active, completed: done, missed };
}

export async function addCoachReview({ coach_uid, trainee_uid, workout_id, comment, video_feedback_url, rating }) {
  const now = Date.now();
  const id = 'rev_' + Math.random().toString(36).substring(2, 10);
  if (pool) {
    const q = `
      INSERT INTO gym_coach_reviews (id, coach_uid, trainee_uid, workout_id, comment, video_feedback_url, rating, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const res = await pool.query(q, [id, coach_uid, trainee_uid, workout_id, comment, video_feedback_url || '', rating || 5, now]);
    return res.rows[0];
  }
  const db = loadFallbackData();
  const rev = { id, coach_uid, trainee_uid, workout_id, comment, video_feedback_url: video_feedback_url || '', rating: rating || 5, created_at: now };
  db.coach_reviews.push(rev);
  saveFallbackData();
  return rev;
}

// ----------------- CHAT & MESSAGES -----------------
export async function sendChatMessage({ sender_uid, target_type, target_id, message, media_url }) {
  const now = Date.now();
  const id = 'msg_' + Math.random().toString(36).substring(2, 12);
  if (pool) {
    const q = `
      INSERT INTO gym_chat_messages (id, sender_uid, target_type, target_id, message, media_url, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const res = await pool.query(q, [id, sender_uid, target_type, target_id, message, media_url || '', now]);
    return res.rows[0];
  }
  const db = loadFallbackData();
  const item = { id, sender_uid, target_type, target_id, message, media_url: media_url || '', created_at: now };
  db.chat_messages.push(item);
  saveFallbackData();
  return item;
}

export async function getChatMessages(target_type, target_id, limit = 50) {
  if (pool) {
    const q = `
      SELECT * FROM gym_chat_messages
      WHERE target_type = $1 AND target_id = $2
      ORDER BY created_at ASC
      LIMIT $3
    `;
    const res = await pool.query(q, [target_type, target_id, limit]);
    return res.rows;
  }
  const db = loadFallbackData();
  return db.chat_messages
    .filter(m => m.target_type === target_type && m.target_id === target_id)
    .slice(-limit);
}

// ----------------- NUTRITION LOGS -----------------
export async function upsertNutritionLog({ uid, log_date, calories, protein_g, carbs_g, fat_g, water_ml, sleep_hours, weight_kg, notes }) {
  const now = Date.now();
  const id = `nutr_${uid}_${log_date}`.replace(/[^a-zA-Z0-9_]/g, '');
  if (pool) {
    const q = `
      INSERT INTO gym_nutrition_logs (
        id, uid, log_date, calories, protein_g, carbs_g, fat_g, water_ml, sleep_hours, weight_kg, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (uid, log_date) DO UPDATE SET
        calories = EXCLUDED.calories,
        protein_g = EXCLUDED.protein_g,
        carbs_g = EXCLUDED.carbs_g,
        fat_g = EXCLUDED.fat_g,
        water_ml = EXCLUDED.water_ml,
        sleep_hours = EXCLUDED.sleep_hours,
        weight_kg = EXCLUDED.weight_kg,
        notes = EXCLUDED.notes
      RETURNING *;
    `;
    const res = await pool.query(q, [
      id, uid, log_date, calories || 0, protein_g || 0, carbs_g || 0,
      fat_g || 0, water_ml || 0, sleep_hours || 0, weight_kg || null, notes || '', now
    ]);
    return res.rows[0];
  }
  const db = loadFallbackData();
  let item = db.nutrition_logs.find(n => n.uid === uid && n.log_date === log_date);
  const data = { id, uid, log_date, calories: calories || 0, protein_g: protein_g || 0, carbs_g: carbs_g || 0, fat_g: fat_g || 0, water_ml: water_ml || 0, sleep_hours: sleep_hours || 0, weight_kg: weight_kg || null, notes: notes || '', created_at: now };
  if (!item) db.nutrition_logs.push(data);
  else Object.assign(item, data);
  saveFallbackData();
  return data;
}

export async function getNutritionLogs(uid, days = 30) {
  if (pool) {
    const res = await pool.query('SELECT * FROM gym_nutrition_logs WHERE uid = $1 ORDER BY log_date DESC LIMIT $2', [uid, days]);
    return res.rows;
  }
  const db = loadFallbackData();
  return db.nutrition_logs.filter(n => n.uid === uid).sort((a,b) => b.log_date.localeCompare(a.log_date)).slice(0, days);
}

// ----------------- SUPERADMIN STATS -----------------
export async function getSystemMetrics() {
  const db = loadFallbackData();
  if (pool) {
    try {
      const uCount = await pool.query('SELECT COUNT(*) FROM gym_profiles');
      const tCount = await pool.query('SELECT COUNT(*) FROM gym_teams');
      const wCount = await pool.query('SELECT COUNT(*) FROM gym_workouts_logged');
      const cCount = await pool.query("SELECT COUNT(DISTINCT uid) FROM gym_team_members WHERE role = 'coach'");
      return {
        total_profiles: parseInt(uCount.rows[0].count, 10),
        total_teams: parseInt(tCount.rows[0].count, 10),
        total_coaches: parseInt(cCount.rows[0].count, 10),
        total_workouts_logged: parseInt(wCount.rows[0].count, 10),
        storage_engine: 'PostgreSQL'
      };
    } catch (e) {
      // fallback
    }
  }
  return {
    total_profiles: db.profiles.length,
    total_teams: db.teams.length,
    total_coaches: new Set(db.team_members.filter(m => m.role === 'coach').map(m => m.uid)).size,
    total_workouts_logged: db.workouts_logged.length,
    storage_engine: 'Durable File Storage'
  };
}
