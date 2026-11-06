/* teams-routes.js — API endpoints for Teams, Coach Hub, Individual Overrides,
   Live Board, Chat, Nutrition, and AI Advisory */

import * as db from './db-pg.js';

export function createTeamsRouter({ getUser, isAdmin, isOwner }) {
  const routes = {};

  // Helper to parse JSON body
  async function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) { // 2MB max
          reject(new Error('Body too large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
  }

  // 1. PROFILE
  routes['GET /api/profile'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const profile = await db.getProfile(user.id);
    sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email, admin: user.admin }, profile });
  };

  routes['POST /api/profile'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const profile = await db.upsertProfile(user.id, body);
    sendJson(res, 200, { success: true, profile });
  };

  // 2. TEAMS LIST & CREATION
  routes['GET /api/teams'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const teams = await db.getUserTeams(user.id);
    sendJson(res, 200, { teams });
  };

  routes['POST /api/teams'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { error: 'Team name is required' });

    const team = await db.createTeam({
      name: body.name,
      description: body.description,
      avatar_url: body.avatar_url,
      head_coach_uid: user.id,
      schedule_json: body.schedule_json || {}
    });
    sendJson(res, 201, { success: true, team });
  };

  // 3. JOIN TEAM VIA CODE
  routes['POST /api/teams/join'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.invite_code) return sendJson(res, 400, { error: 'Invite code is required' });

    try {
      const result = await db.joinTeamByCode(user.id, body.invite_code);
      sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      sendJson(res, 404, { error: e.message });
    }
  };

  // 4. TEAM DETAILS
  routes['GET /api/teams/details'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    const teamId = url.searchParams.get('teamId');
    if (!teamId) return sendJson(res, 400, { error: 'teamId is required' });

    const details = await db.getTeamDetails(teamId);
    if (!details) return sendJson(res, 404, { error: 'Team not found' });
    sendJson(res, 200, { team: details });
  };

  // 5. TEAM PLAN SAVE
  routes['POST /api/teams/plan'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const teamId = body.team_id || body.teamId;
    const name = body.name;
    if (!teamId || !name) return sendJson(res, 400, { error: 'team_id and name required' });

    const team = await db.getTeamDetails(teamId);
    if (!team) return sendJson(res, 404, { error: 'Team not found' });
    if (team.head_coach_uid !== user.id && !isAdmin(user)) {
      return sendJson(res, 403, { error: 'Only coach can edit team plan' });
    }

    const plan = await db.saveTeamPlan({
      id: body.id,
      team_id: teamId,
      name: name,
      description: body.description || '',
      days_json: body.days_json || body.routineDays || body.daysJson || []
    });
    sendJson(res, 200, { success: true, plan });
  };

  // 6. PLAN OVERRIDES
  routes['GET /api/teams/plan/overrides'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    const planId = url.searchParams.get('planId') || url.searchParams.get('plan_id');
    const memberUid = url.searchParams.get('uid') || url.searchParams.get('memberUid') || user.id;

    if (!planId) return sendJson(res, 400, { error: 'planId required' });
    const overrides = await db.getPlanOverrides(planId, memberUid);
    sendJson(res, 200, { overrides });
  };

  routes['POST /api/teams/plan/override'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const teamPlanId = body.team_plan_id || body.teamPlanId || body.planId;
    const targetUid = body.uid || body.memberUid || body.userId;
    const dayId = body.day_id || body.dayId;
    const exerciseId = body.exercise_id || body.exerciseId;

    if (!teamPlanId || !targetUid || !dayId || !exerciseId) {
      return sendJson(res, 400, { error: 'Missing required override fields' });
    }

    const override = await db.upsertPlanOverride({
      team_plan_id: teamPlanId,
      uid: targetUid,
      day_id: dayId,
      exercise_id: exerciseId,
      replacement_exercise_id: body.replacement_exercise_id || body.replacementExerciseId,
      custom_sets: body.custom_sets || body.customSets,
      custom_reps: body.custom_reps || body.customReps,
      custom_target_weight: body.custom_target_weight || body.customTargetWeight,
      custom_rest_sec: body.custom_rest_sec || body.customRestSec,
      custom_rpe_rir: body.custom_rpe_rir || body.customRpeRir,
      coach_notes: body.coach_notes || body.coachNotes
    });
    sendJson(res, 200, { success: true, override });
  };

  // 7. BATCH SYNC
  routes['POST /api/teams/plan/batch-sync'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const teamPlanId = body.team_plan_id || body.teamPlanId || body.planId;
    const targetUids = body.target_uids || body.targetUids;

    if (!teamPlanId || !Array.isArray(targetUids)) {
      return sendJson(res, 400, { error: 'Invalid batch sync request' });
    }

    const saved = [];
    for (const uid of targetUids) {
      if (Array.isArray(body.overrides)) {
        for (const ov of body.overrides) {
          const resOv = await db.upsertPlanOverride({
            team_plan_id: teamPlanId,
            uid: uid,
            day_id: ov.day_id || ov.dayId,
            exercise_id: ov.exercise_id || ov.exerciseId,
            replacement_exercise_id: ov.replacement_exercise_id || ov.replacementExerciseId,
            custom_sets: ov.custom_sets || ov.customSets,
            custom_reps: ov.custom_reps || ov.customReps,
            custom_target_weight: ov.custom_target_weight || ov.customTargetWeight,
            custom_rest_sec: ov.custom_rest_sec || ov.customRestSec,
            custom_rpe_rir: ov.custom_rpe_rir || ov.customRpeRir,
            coach_notes: ov.coach_notes || ov.coachNotes
          });
          saved.push(resOv);
        }
      }
    }
    sendJson(res, 200, { success: true, count: saved.length });
  };

  // 8. COACH LIVE BOARD
  routes['GET /api/coach/live-board'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const board = await db.getCoachLiveBoard(user.id);
    sendJson(res, 200, { liveBoard: board });
  };

  // 9. WORKOUT LOGGING & FEEDBACK
  routes['POST /api/workout/log'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const log = await db.logWorkout({
      ...body,
      uid: user.id
    });
    sendJson(res, 200, { success: true, workout: log });
  };

  routes['POST /api/coach/review'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.trainee_uid || !body.workout_id || !body.comment) {
      return sendJson(res, 400, { error: 'Missing review fields' });
    }
    const review = await db.addCoachReview({
      coach_uid: user.id,
      trainee_uid: body.trainee_uid,
      workout_id: body.workout_id,
      comment: body.comment,
      video_feedback_url: body.video_feedback_url,
      rating: body.rating
    });
    sendJson(res, 200, { success: true, review });
  };

  // 10. CHAT
  routes['GET /api/chat'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    const targetType = url.searchParams.get('type') || 'team';
    const targetId = url.searchParams.get('id');
    if (!targetId) return sendJson(res, 400, { error: 'id required' });

    const messages = await db.getChatMessages(targetType, targetId);
    sendJson(res, 200, { messages });
  };

  routes['POST /api/chat'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.target_id || !body.message) {
      return sendJson(res, 400, { error: 'target_id and message required' });
    }
    const msg = await db.sendChatMessage({
      sender_uid: user.id,
      target_type: body.target_type || 'team',
      target_id: body.target_id,
      message: body.message,
      media_url: body.media_url
    });
    sendJson(res, 201, { success: true, message: msg });
  };

  // 11. NUTRITION
  routes['GET /api/nutrition'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const logs = await db.getNutritionLogs(user.id);
    sendJson(res, 200, { nutrition: logs });
  };

  routes['POST /api/nutrition'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.log_date) return sendJson(res, 400, { error: 'log_date required' });

    const log = await db.upsertNutritionLog({
      ...body,
      uid: user.id
    });
    sendJson(res, 200, { success: true, log });
  };

  // 12. AI ADVISORY ASSISTANT
  routes['POST /api/ai/coach-assist'] = async (req, res) => {
    const user = await getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    // body: { type: 'plan_gen' | 'substitute' | 'plateau', goal, equipment, experience, muscle }
    const goal = body.goal || 'General Fitness';
    const equip = Array.isArray(body.equipment) ? body.equipment.join(', ') : 'All Equipment';

    // Algorithmic sports science recommendations
    let recommendations = [];
    if (body.type === 'substitute') {
      recommendations = [
        { name: 'دمبل بنش بريس (Dumbbell Bench Press)', reason: 'تفعيل متوازن للصدر وتخفيف الضغط على الكتف مع نطاق حركة أعمق' },
        { name: 'كيبل كروس أوفر (Cable Crossover)', reason: 'ضغط مستمر على ألياف الصدر طوال مدى الحركة' },
        { name: 'غطس بوزن الجسم (Weighted Dips)', reason: 'بناء القوة وتفعيل الصدر السفلي والترايسبس' }
      ];
    } else if (goal.toLowerCase().includes('fat') || goal.includes('خسارة')) {
      recommendations = [
        { phase: 'التكرارات والراحة', suggestion: '12 - 15 تكرار مع فترات راحة 45 ثانية بين المجموعات للحفاظ على معدل حرق عالي' },
        { phase: 'توزيع التمارين', suggestion: 'دمج تمارين مركبة (Supersets) لرفع الكفاءة الزمنية ومعدل نبضات القلب' },
        { phase: 'الكارديو', suggestion: '20 دقيقة كارديو منخفض الشدة (LISS) بعد تدريب المقاومة مباشرة' }
      ];
    } else if (goal.toLowerCase().includes('muscle') || goal.includes('عضل')) {
      recommendations = [
        { phase: 'الحجم التدريبي (Volume)', suggestion: '10 - 16 مجموعة أسبوعياً لكل عضلة أساسية، 8 - 12 تكرار بمقياس RPE 8-9' },
        { phase: 'الزيادة التدريجية (Progressive Overload)', suggestion: 'زيادة 1-2 كغ كل أسبوعين في التمارين الأساسية مع تثبيت التكنيك' },
        { phase: 'الراحة', suggestion: '90 - 120 ثانية بين المجموعات الثقيلة لضمان الاستشفاء العصبي التام' }
      ];
    } else {
      recommendations = [
        { phase: 'التدريب المتوازن', suggestion: '3 إلى 4 أيام تدريب بنظام Push / Pull / Legs أو Full Body' },
        { phase: 'الشدة', suggestion: '3 مجموعات لكل تمرين، 10 تكرارات بشدة متوسطة مع التركيز على التكنيك الصحيح' }
      ];
    }

    sendJson(res, 200, {
      success: true,
      advisory_note: 'ملاحظة: هذه التوصيات مقترحة من نظام الذكاء الاصطناعي بناءً على الأهداف العلمية وتحتاج موافقة المدرب قبل اعتمادها.',
      recommendations
    });
  };

  // 13. SUPERADMIN METRICS
  routes['GET /api/superadmin/metrics'] = async (req, res) => {
    const user = await getUser(req);
    if (!user || (!isAdmin(user) && !isOwner(user))) {
      return sendJson(res, 403, { error: 'Superadmin access required' });
    }
    const metrics = await db.getSystemMetrics();
    sendJson(res, 200, { metrics });
  };

  return routes;
}
