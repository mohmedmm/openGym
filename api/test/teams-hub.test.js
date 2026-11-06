import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../db-pg.js';

test('Teams Hub & Multi-User Architecture Suite', async (t) => {
  await t.test('1. Initialize database engine', async () => {
    const ok = await db.initDb();
    assert.equal(ok, true);
  });

  await t.test('2. Profile creation with goals and adaptive settings', async () => {
    const coachUid = 'coach_123';
    const traineeUid = 'trainee_456';

    const pCoach = await db.upsertProfile(coachUid, {
      primary_goal: 'Strength & Coaching',
      experience_level: 'Advanced',
      days_per_week: 5,
      available_equipment: ['Barbell', 'Dumbbell', 'Cables']
    });
    assert.equal(pCoach.uid, coachUid);
    assert.equal(pCoach.primary_goal, 'Strength & Coaching');

    const pTrainee = await db.upsertProfile(traineeUid, {
      primary_goal: 'Weight Loss',
      current_weight: 95.5,
      target_weight: 80.0,
      experience_level: 'Beginner',
      days_per_week: 3,
      available_equipment: ['Dumbbell', 'Bodyweight']
    });
    assert.equal(pTrainee.uid, traineeUid);
    assert.equal(pTrainee.current_weight, 95.5);
  });

  let createdTeam = null;
  await t.test('3. Team creation and invite system', async () => {
    createdTeam = await db.createTeam({
      name: 'أبطال القوة - Team Alpha',
      description: 'فريق التدريب التنافسي المتقدم',
      avatar_url: 'https://gym.nbox.ly/avatar-team.png',
      head_coach_uid: 'coach_123',
      schedule_json: { days: ['Mon', 'Wed', 'Fri'], time: '17:00' }
    });

    assert.ok(createdTeam.id);
    assert.equal(createdTeam.name, 'أبطال القوة - Team Alpha');
    assert.ok(createdTeam.invite_code);

    // Trainee joins team via code
    const joinResult = await db.joinTeamByCode('trainee_456', createdTeam.invite_code);
    assert.equal(joinResult.already_member, false);
    assert.equal(joinResult.team.id, createdTeam.id);
    assert.equal(joinResult.member.role, 'trainee');

    // Details check
    const details = await db.getTeamDetails(createdTeam.id);
    assert.equal(details.members.length, 2); // Coach + Trainee
  });

  let createdPlan = null;
  await t.test('4. Team Master Plan with individual trainee overrides', async () => {
    createdPlan = await db.saveTeamPlan({
      team_id: createdTeam.id,
      name: 'برنامج الضخامة والقوة المشترك',
      description: 'خطة تدريبية جماعية للموسم',
      days_json: [
        {
          id: 'day_1',
          name: 'اليوم الأول: دفع وصدر',
          exercises: [
            { id: 'bench_press', name: 'Barbell Bench Press', sets: 4, reps: '8-10', rest: 90 },
            { id: 'shoulder_press', name: 'Overhead Press', sets: 3, reps: '10-12', rest: 60 }
          ]
        }
      ]
    });
    assert.ok(createdPlan.id);
    assert.equal(createdPlan.name, 'برنامج الضخامة والقوة المشترك');

    // Override for trainee (Ahmed: fat loss, dumbells only)
    const override = await db.upsertPlanOverride({
      team_plan_id: createdPlan.id,
      uid: 'trainee_456',
      day_id: 'day_1',
      exercise_id: 'bench_press',
      custom_sets: 3,
      custom_reps: '12-15',
      custom_intensity: 'RPE 7',
      custom_rest_seconds: 45,
      alt_exercise_id: 'db_bench_press',
      alt_notes: 'استبدال بالدمبل لتقليل الحمل على الكتف مع زيادة التكرار لحرق الدهون'
    });

    assert.equal(override.custom_sets, 3);
    assert.equal(override.alt_exercise_id, 'db_bench_press');

    // Fetch overrides
    const overrides = await db.getPlanOverrides(createdPlan.id, 'trainee_456');
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0].alt_exercise_id, 'db_bench_press');
  });

  let loggedSession = null;
  await t.test('5. Workout logging and Coach Live Board', async () => {
    loggedSession = await db.logWorkout({
      uid: 'trainee_456',
      team_id: createdTeam.id,
      plan_id: createdPlan.id,
      routine_name: 'اليوم الأول: دفع وصدر',
      duration_seconds: 2700,
      exercises_json: [
        { id: 'db_bench_press', sets: [{ weight: 24, reps: 15 }, { weight: 24, reps: 14 }] }
      ],
      notes: 'تم إكمال التمرين بالدمبل بنجاح مع الالتزام بالراحة',
      status: 'completed',
      video_url: 'https://gym.nbox.ly/video-test.mp4'
    });
    assert.ok(loggedSession.id);
    assert.equal(loggedSession.status, 'completed');

    // Coach checks live board
    const board = await db.getCoachLiveBoard('coach_123');
    assert.ok(Array.isArray(board.completed));
    assert.ok(board.completed.some(w => w.uid === 'trainee_456'));

    // Coach leaves review note
    const review = await db.addCoachReview({
      coach_uid: 'coach_123',
      trainee_uid: 'trainee_456',
      workout_id: loggedSession.id,
      comment: 'أداء ممتاز يا بطل، تحكم رائع بالوزن مع ثبات الكوعين!',
      rating: 5
    });
    assert.equal(review.rating, 5);
  });

  await t.test('6. Chat and Team Messaging', async () => {
    const msg = await db.sendChatMessage({
      sender_uid: 'coach_123',
      target_type: 'team',
      target_id: createdTeam.id,
      message: 'أهلاً بالجميع في الفريق! التمرين القادم غداً الساعة 5 مساءً'
    });
    assert.ok(msg.id);

    const msgs = await db.getChatMessages('team', createdTeam.id);
    assert.ok(msgs.length >= 1);
    assert.equal(msgs[0].message, 'أهلاً بالجميع في الفريق! التمرين القادم غداً الساعة 5 مساءً');
  });

  await t.test('7. Nutrition Tracking & System Metrics', async () => {
    const nutLog = await db.upsertNutritionLog({
      uid: 'trainee_456',
      log_date: '2026-11-06',
      calories: 2150,
      protein_g: 165.5,
      carbs_g: 210,
      fat_g: 65,
      water_ml: 3200,
      sleep_hours: 7.5,
      weight_kg: 94.8
    });
    assert.equal(nutLog.calories, 2150);
    assert.equal(nutLog.protein_g, 165.5);

    const metrics = await db.getSystemMetrics();
    assert.ok(metrics.total_profiles >= 2);
    assert.ok(metrics.total_teams >= 1);
    assert.ok(metrics.total_workouts_logged >= 1);
  });

  await t.test('8. Centralized Team Plans & Live Roster Matrix', async () => {
    const allPlans = await db.getAllTeamPlans('coach_123');
    assert.ok(Array.isArray(allPlans));
    assert.ok(allPlans.length >= 1);
    assert.equal(allPlans[0].team_name, 'أبطال القوة - Team Alpha');

    const liveBoard = await db.getCoachLiveBoard('coach_123');
    assert.ok(Array.isArray(liveBoard.roster));
    assert.ok(liveBoard.roster.length >= 1);
    const member = liveBoard.roster.find(r => r.uid === 'trainee_456');
    assert.ok(member);
    assert.equal(member.status, 'completed');
  });

  await t.test('9. Security hardening verification (BOLA plan owner, chat access control)', async () => {
    // Check plan owner retrieval
    const owner = await db.getTeamPlanOwner(createdPlan.id);
    assert.ok(owner);
    assert.equal(owner.head_coach_uid, 'coach_123');

    // Access control on team chat
    const coachHasAccess = await db.canUserAccessChat('coach_123', 'team', createdTeam.id);
    assert.equal(coachHasAccess, true);

    const traineeHasAccess = await db.canUserAccessChat('trainee_456', 'team', createdTeam.id);
    assert.equal(traineeHasAccess, true);

    const outsiderAccess = await db.canUserAccessChat('attacker_999', 'team', createdTeam.id);
    assert.equal(outsiderAccess, false);
  });

  await t.test('10. Team weekly schedule persistence and plan deletion', async () => {
    const weeklySchedule = {
      0: { day_name: 'الأحد', routine_name: 'صدر وترايسبس', exercises_count: 5 },
      2: { day_name: 'الثلاثاء', routine_name: 'ظهر وبايسبس', exercises_count: 5 },
      4: { day_name: 'الخميس', routine_name: 'أرجل وأكتاف', exercises_count: 6 }
    };
    const updated = await db.updateTeamSchedule(createdTeam.id, weeklySchedule);
    assert.ok(updated);
    assert.equal(updated.schedule_json[0].routine_name, 'صدر وترايسبس');

    // Verify deletion
    const delRes = await db.deleteTeamPlan(createdPlan.id);
    assert.equal(delRes, true);
  });
});

