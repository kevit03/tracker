// Calorie tracker tests: clarifying-question selection, query assembly,
// Nutritionix/USDA fallback chain (network mocked), TDEE/budget math, and
// the under-budget streak semantics added to shared/storage.js.
const assert = require('assert');
const path = require('path');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

function freshCalorieTracker() {
  const full = path.join(__dirname, '..', 'shared', 'calorie-tracker.js');
  delete require.cache[require.resolve(full)];
  return require(full);
}

function freshStorage() {
  const full = path.join(__dirname, '..', 'shared', 'storage.js');
  delete require.cache[require.resolve(full)];
  return require(full);
}

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

async function run() {
  console.log('--- Running test/calorie.test.js ---');

  // 1. Clarifying questions: known foods get specific follow-ups, plus the
  //    shared "anything else" question; unknown foods get the generic one.
  {
    const CT = freshCalorieTracker();
    const bread = CT.getClarifyingQuestions('slice of bread');
    assert.strictEqual(bread.length, 3, 'bread type + slice count + sides');
    assert.strictEqual(bread[0].key, 'type');
    assert.strictEqual(bread[1].key, 'qty');
    assert.strictEqual(bread[2].key, 'sides');

    const rice = CT.getClarifyingQuestions('some RICE');
    assert.ok(rice.some(q => q.key === 'qty'), 'case-insensitive keyword match');

    const mystery = CT.getClarifyingQuestions('a bowl of glorp');
    assert.strictEqual(mystery.length, 2, 'unmatched food falls back to one generic question + sides');
    assert.strictEqual(mystery[0].key, 'details');
    console.log('[PASS] Clarifying-question selection: known foods, case-insensitivity, generic fallback');
  }

  // 2. Query assembly folds answers into one sentence; "no" for sides is dropped.
  {
    const CT = freshCalorieTracker();
    const q1 = CT.buildFollowupQuery('slice of bread', { type: 'wheat bread', qty: '2 slices', sides: 'butter and jam' });
    assert.strictEqual(q1, '2 slices wheat bread and butter and jam');

    const q2 = CT.buildFollowupQuery('slice of bread', { type: 'white bread', qty: '1 slice', sides: 'no' });
    assert.strictEqual(q2, '1 slice white bread', '"no" sides answer contributes nothing to the query');

    assert.strictEqual(CT.isSkip('no'), true);
    assert.strictEqual(CT.isSkip('  Nothing.  '), true);
    assert.strictEqual(CT.isSkip('butter'), false);
    console.log('[PASS] Query assembly folds clarifying answers into one sentence, skips "no" sides');
  }

  // 3. Nutritionix success path: sums nf_calories, builds a breakdown.
  {
    const CT = freshCalorieTracker();
    const fetchImpl = () => jsonResponse({
      foods: [
        { food_name: 'bread', nf_calories: 138.4, serving_qty: 2, serving_unit: 'slice' },
        { food_name: 'butter', nf_calories: 102, serving_qty: 1, serving_unit: 'tbsp' }
      ]
    });
    const result = await CT.estimateCalories({
      query: '2 slices wheat bread and butter',
      credentials: { nutritionixAppId: 'id', nutritionixApiKey: 'key' },
      fetchImpl
    });
    assert.strictEqual(result.source, 'nutritionix');
    assert.strictEqual(result.calories, 240);
    assert.strictEqual(result.breakdown.length, 2);
    assert.strictEqual(result.approximate, false);
    console.log('[PASS] Nutritionix path sums nf_calories and reports an exact breakdown');
  }

  // 4. Nutritionix configured but errors/no match -> falls back to USDA.
  {
    const CT = freshCalorieTracker();
    let nutritionixCalled = false;
    let usdaCalled = false;
    const fetchImpl = (url) => {
      if (String(url).includes('nutritionix')) {
        nutritionixCalled = true;
        return jsonResponse({}, false);
      }
      usdaCalled = true;
      return jsonResponse({
        foods: [{ description: 'Bread, wheat', foodNutrients: [{ nutrientId: 1008, value: 250 }] }]
      });
    };
    const result = await CT.estimateCalories({
      query: '2 slices wheat bread',
      credentials: { nutritionixAppId: 'id', nutritionixApiKey: 'key', usdaApiKey: 'usda-key' },
      fetchImpl
    });
    assert.strictEqual(nutritionixCalled, true);
    assert.strictEqual(usdaCalled, true);
    assert.strictEqual(result.source, 'usda');
    assert.strictEqual(result.approximate, true);
    // 2 slices -> 60g estimate, 250 kcal/100g -> 150 kcal
    assert.strictEqual(result.calories, 150);
    console.log('[PASS] Nutritionix failure falls back to USDA with a gram-scaled estimate');
  }

  // 5. Neither provider configured -> manual entry requested, no fetch call made.
  {
    const CT = freshCalorieTracker();
    let called = false;
    const fetchImpl = () => { called = true; return jsonResponse({}); };
    const result = await CT.estimateCalories({ query: 'mystery food', credentials: {}, fetchImpl });
    assert.strictEqual(result.calories, null);
    assert.strictEqual(result.source, 'manual');
    assert.strictEqual(called, false, 'no network call without any configured key');
    console.log('[PASS] No configured provider falls back to manual entry without calling fetch');
  }

  // 6. TDEE / budget estimate: known reference values (Mifflin-St Jeor).
  {
    const CT = freshCalorieTracker();
    const weightLb = 154;
    const heightIn = 68;
    const w = weightLb * 0.45359237;
    const h = heightIn * 2.54;
    const expectedBmr = 10 * w + 6.25 * h - 5 * 30 + 5;
    const expectedTdee = expectedBmr * 1.2;
    const result = CT.estimateCalorieBudget({
      weightLb,
      heightIn,
      age: 30,
      sex: 'male',
      activityLevel: 'sedentary',
      deficit: 500
    });
    assert.strictEqual(result.bmr, Math.round(expectedBmr));
    assert.strictEqual(result.tdee, Math.round(expectedTdee));
    assert.strictEqual(result.suggestedBudget, Math.round(expectedTdee - 500));

    const invalid = CT.estimateCalorieBudget({ weightLb: 0, heightIn: 70, age: 30 });
    assert.strictEqual(invalid, null, 'zero/invalid inputs are rejected rather than producing a bogus budget');

    const floor = CT.estimateCalorieBudget({ weightLb: 90, heightIn: 60, age: 25, sex: 'female', activityLevel: 'sedentary', deficit: 5000 });
    assert.strictEqual(floor.suggestedBudget, 1200, 'budget never suggested below the 1200 kcal safety floor');
    console.log('[PASS] TDEE/budget math matches Mifflin-St Jeor and enforces a safety floor');
  }

  // 7. Under-budget streak semantics in shared/storage.js: a day with no
  //    logged entry does NOT count toward the streak, and the boundary is
  //    inclusive (exactly the budget counts as met).
  {
    const TrackerStorage = freshStorage();
    const today = TrackerStorage.getLocalDateStr();
    const y1 = TrackerStorage.addDays(today, -1);
    const y2 = TrackerStorage.addDays(today, -2);
    const y3 = TrackerStorage.addDays(today, -3);

    const dailyMap = {
      [today]: { calories: 1800 },
      [y1]: { calories: 2000 }, // exactly at budget: inclusive boundary
      [y2]: {}                  // no calories entry logged that day
      // y3 has no entry at all
    };
    assert.strictEqual(TrackerStorage.goalMetOn(dailyMap, today, 'calories', 2000, true), true);
    assert.strictEqual(TrackerStorage.goalMetOn(dailyMap, y1, 'calories', 2000, true), true, 'exactly at budget counts as under');
    assert.strictEqual(TrackerStorage.goalMetOn(dailyMap, y2, 'calories', 2000, true), false, 'a day with nothing logged is not "under budget"');

    const streak = TrackerStorage.computeCurrentStreak(dailyMap, 'calories', 2000, today, true);
    assert.strictEqual(streak, 2, 'streak breaks at the day with no logged entry');

    // Regular (non-budget) semantics stay untouched: >= goal, absence == 0.
    const jobsMap = { [today]: { jobs: 5 }, [y1]: { jobs: 3 } };
    assert.strictEqual(TrackerStorage.goalMetOn(jobsMap, today, 'jobs', 5), true);
    assert.strictEqual(TrackerStorage.goalMetOn(jobsMap, y1, 'jobs', 5), false);
    console.log('[PASS] Under-budget streak: inclusive boundary, un-logged days break the streak, non-budget metrics unaffected');
  }

  // 8. ensureCalorieMetric is idempotent and the metric is undeletable once created.
  {
    installMockChrome();
    const TrackerStorage = freshStorage();
    const before = await TrackerStorage.getMetrics();
    assert.strictEqual(before.some(m => m.id === 'calories'), false, 'calories is not seeded by default');

    const first = await TrackerStorage.ensureCalorieMetric();
    const second = await TrackerStorage.ensureCalorieMetric();
    assert.strictEqual(first.id, 'calories');
    assert.strictEqual(second.id, 'calories');

    const after = await TrackerStorage.getMetrics();
    assert.strictEqual(after.filter(m => m.id === 'calories').length, 1, 'calling ensureCalorieMetric twice does not duplicate it');

    const deleted = await TrackerStorage.deleteMetric('calories');
    assert.strictEqual(deleted, false, 'the calorie tracker cannot be deleted like other built-ins');
    uninstallMockChrome();
    console.log('[PASS] ensureCalorieMetric is idempotent and creates an undeletable built-in tracker');
  }

  console.log('--- test/calorie.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
