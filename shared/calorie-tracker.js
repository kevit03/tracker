// Calorie estimation and profile helpers for the calorie tracker feature.
//
// Pure logic lives here so it is testable headlessly (see test/calorie.test.js):
// clarifying-question selection, query assembly, TDEE/budget math, and the
// Nutritionix -> USDA fallback chain. DOM and chrome.storage plumbing live in
// popup/popup.js; CalorieKeys below only wraps chrome.storage.local (never
// .sync, since these are personal API credentials, not data to carry
// cross-device through a Google-synced store).
const CalorieTracker = (() => {
  // Each rule's `questions` are asked in order, then a shared "anything else"
  // question is appended by getClarifyingQuestions. Matching is deliberately
  // simple keyword/regex sniffing, not real NLU: it only has to narrow down
  // common vague entries enough to build a specific lookup query.
  const FOOD_RULES = [
    { matches: /\bbread\b|\btoast\b/, questions: [
      { key: 'type', prompt: 'What kind of bread — white, wheat, sourdough, rye, whole grain?' },
      { key: 'qty', prompt: 'How many slices?' }
    ] },
    { matches: /\brice\b/, questions: [
      { key: 'type', prompt: 'What kind of rice — white, brown, jasmine, basmati, fried rice?' },
      { key: 'qty', prompt: 'About how many cups, cooked?' }
    ] },
    { matches: /\bchicken\b/, questions: [
      { key: 'cut', prompt: 'What cut/prep — breast, thigh, wing, fried, grilled, rotisserie?' },
      { key: 'qty', prompt: 'About how many ounces or pieces?' }
    ] },
    { matches: /\bpizza\b/, questions: [
      { key: 'type', prompt: 'What kind of pizza — cheese, pepperoni, veggie, thin crust, deep dish?' },
      { key: 'qty', prompt: 'How many slices?' }
    ] },
    { matches: /\bsandwich\b|\bsub\b/, questions: [
      { key: 'fillings', prompt: 'What\'s on it — bread type, meat/cheese, spreads?' }
    ] },
    { matches: /\bsalad\b/, questions: [
      { key: 'contents', prompt: 'What\'s in it, and what dressing (and about how much)?' }
    ] },
    { matches: /\bpasta\b|\bspaghetti\b|\bnoodles?\b/, questions: [
      { key: 'type', prompt: 'What kind of pasta and sauce?' },
      { key: 'qty', prompt: 'About how many cups?' }
    ] },
    { matches: /\beggs?\b/, questions: [
      { key: 'prep', prompt: 'How were the eggs prepared — fried, scrambled, boiled, with oil/butter?' },
      { key: 'qty', prompt: 'How many eggs?' }
    ] },
    { matches: /\bburger\b/, questions: [
      { key: 'type', prompt: 'What kind — beef, chicken, veggie patty — and single or double?' },
      { key: 'toppings', prompt: 'Cheese, bacon, sauces, bun type?' }
    ] },
    { matches: /\bsmoothie\b|\bshake\b/, questions: [
      { key: 'contents', prompt: 'What\'s blended in it (fruits, milk/yogurt, protein powder, sweetener)?' },
      { key: 'qty', prompt: 'About how many ounces?' }
    ] },
    { matches: /\bcereal\b/, questions: [
      { key: 'type', prompt: 'What brand/kind of cereal?' },
      { key: 'qty', prompt: 'About how many cups, and what milk (and how much)?' }
    ] },
    { matches: /\bmilk\b/, questions: [
      { key: 'type', prompt: 'What kind — whole, 2%, skim, oat, almond, soy?' },
      { key: 'qty', prompt: 'About how many cups or ounces?' }
    ] },
    { matches: /\bcoffee\b|\blatte\b|\bcappuccino\b/, questions: [
      { key: 'type', prompt: 'What kind — black coffee, latte, cappuccino, cold brew?' },
      { key: 'milk', prompt: 'What milk and how much, and any sugar/syrup?' },
      { key: 'size', prompt: 'What size (small/medium/large, or oz)?' }
    ] },
    { matches: /\bburrito\b|\btaco\b/, questions: [
      { key: 'fillings', prompt: 'What\'s in it — protein, rice/beans, cheese, sour cream, guac?' },
      { key: 'qty', prompt: 'How many?' }
    ] },
    { matches: /\bsoup\b/, questions: [
      { key: 'type', prompt: 'What kind of soup, and about how many cups?' }
    ] },
    { matches: /\byogurt\b/, questions: [
      { key: 'type', prompt: 'What kind — Greek, regular, flavored, plain, fat %?' },
      { key: 'qty', prompt: 'About how many ounces or cups, and any toppings?' }
    ] },
    { matches: /\bsteak\b/, questions: [
      { key: 'cut', prompt: 'What cut, and about how many ounces?' },
      { key: 'prep', prompt: 'How was it cooked (grilled, pan-fried in butter, etc.)?' }
    ] },
    { matches: /\bfries\b/, questions: [
      { key: 'size', prompt: 'About how much — small, medium, large, or a cup estimate?' }
    ] },
    { matches: /\bsushi\b/, questions: [
      { key: 'type', prompt: 'What rolls/pieces, and about how many?' }
    ] }
  ];

  const SIDES_QUESTION = { key: 'sides', prompt: 'Anything else you had with it? (sides, drink, condiments — or say "no")', optional: true };
  const GENERIC_QUESTION = { key: 'details', prompt: 'About how much (cups/oz/pieces), and the exact kind or brand, so I can look it up accurately?' };

  function getClarifyingQuestions(text) {
    const lower = (text || '').toLowerCase();
    const rule = FOOD_RULES.find(r => r.matches.test(lower));
    const questions = (rule ? rule.questions : [GENERIC_QUESTION]).slice();
    questions.push(SIDES_QUESTION);
    return questions;
  }

  function isSkip(answer) {
    return !answer || /^(no|none|nothing|nope|n\/a|skip)\.?$/i.test(answer.trim());
  }

  // Folds the clarifying answers back into one natural-language sentence fit
  // to hand a nutrition API, e.g. "2 slices wheat bread with butter and jam".
  function buildFollowupQuery(originalText, answers) {
    const a = answers || {};
    const lead = [a.qty, a.type || a.cut || a.contents || a.fillings || originalText].filter(Boolean).join(' ');
    const parts = [lead || originalText];
    if (a.prep) parts.push(a.prep);
    if (a.toppings) parts.push('with ' + a.toppings);
    if (a.milk) parts.push('with ' + a.milk);
    if (a.size) parts.push(a.size);
    if (a.details && !answers.type) parts.push(a.details);
    if (!isSkip(a.sides)) parts.push('and ' + a.sides.trim());
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  async function queryNutritionix(query, credentials, doFetch) {
    const res = await doFetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': credentials.nutritionixAppId,
        'x-app-key': credentials.nutritionixApiKey
      },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const foods = Array.isArray(data && data.foods) ? data.foods : [];
    if (foods.length === 0) return null;
    const calories = Math.round(foods.reduce((sum, f) => sum + (Number(f.nf_calories) || 0), 0));
    const breakdown = foods.map(f => ({
      name: f.food_name,
      calories: Math.round(Number(f.nf_calories) || 0),
      servingQty: f.serving_qty,
      servingUnit: f.serving_unit
    }));
    return { calories, breakdown, source: 'nutritionix', approximate: false };
  }

  const GRAM_ESTIMATES = {
    slice: 30, slices: 30, cup: 240, cups: 240, oz: 28.35, ounce: 28.35, ounces: 28.35,
    tbsp: 15, tablespoon: 15, tablespoons: 15, piece: 100, pieces: 100, egg: 50, eggs: 50
  };

  function splitFoodTerms(query) {
    return String(query || '').split(/\s+(?:and|with)\s+/i).map(s => s.trim()).filter(Boolean);
  }

  function estimateGrams(term) {
    const qtyMatch = term.match(/^(\d+(?:\.\d+)?)/);
    const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
    const unitMatch = term.toLowerCase().match(/\b(slices?|cups?|oz|ounces?|tbsp|tablespoons?|pieces?|eggs?)\b/);
    const perUnit = unitMatch ? (GRAM_ESTIMATES[unitMatch[1].toLowerCase()] || 100) : 100;
    return qty * perUnit;
  }

  // USDA FoodData Central has no natural-language endpoint, so each clause of
  // the query is searched separately and scaled by a rough gram estimate from
  // its quantity word. Coarser than Nutritionix by design; callers should
  // mark it approximate to the user.
  async function queryUSDA(query, credentials, doFetch) {
    const terms = splitFoodTerms(query);
    let total = 0;
    const breakdown = [];
    let matchedAny = false;
    for (const term of terms) {
      const searchTerm = term.replace(/^\d+(?:\.\d+)?\s*/, '').trim() || term;
      const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(credentials.usdaApiKey)
        + '&query=' + encodeURIComponent(searchTerm) + '&pageSize=1';
      let res;
      try {
        res = await doFetch(url);
      } catch (e) {
        continue;
      }
      if (!res.ok) continue;
      const data = await res.json();
      const food = data && Array.isArray(data.foods) ? data.foods[0] : null;
      if (!food) continue;
      const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
      const energy = nutrients.find(n => n.nutrientId === 1008 || /^energy$/i.test(n.nutrientName || ''));
      if (!energy) continue;
      matchedAny = true;
      const grams = estimateGrams(term);
      const calories = Math.round((Number(energy.value) || 0) * grams / 100);
      total += calories;
      breakdown.push({ name: food.description, calories, gramsEstimate: Math.round(grams) });
    }
    if (!matchedAny) return null;
    return { calories: total, breakdown, source: 'usda', approximate: true };
  }

  // Tries Nutritionix's natural-language endpoint first (best fit for a free-
  // text query built from the chat's clarifying answers); falls back to a
  // per-clause USDA search when Nutritionix has no key configured, errors, or
  // recognizes nothing. Returns { calories: null, source: 'manual' } so the
  // caller can fall back to asking the user for the number directly.
  async function estimateCalories({ query, credentials, fetchImpl }) {
    const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    const creds = credentials || {};
    if (!doFetch) return { calories: null, source: 'manual', reason: 'no-fetch' };

    if (creds.nutritionixAppId && creds.nutritionixApiKey) {
      try {
        const result = await queryNutritionix(query, creds, doFetch);
        if (result) return result;
      } catch (e) { /* fall through to USDA / manual */ }
    }
    if (creds.usdaApiKey) {
      try {
        const result = await queryUSDA(query, creds, doFetch);
        if (result) return result;
      } catch (e) { /* fall through to manual */ }
    }
    return { calories: null, source: 'manual', reason: 'no-match' };
  }

  const ACTIVITY_MULTIPLIERS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9
  };

  const LB_TO_KG = 0.45359237;
  const IN_TO_CM = 2.54;
  const MIN_BUDGET = 1200;

  // Mifflin-St Jeor BMR, scaled by activity level, minus a deficit. weightLb
  // and heightIn are the units the settings form collects; converted here so
  // the arithmetic itself works in the metric units the formula expects.
  function estimateCalorieBudget({ weightLb, heightIn, age, sex, activityLevel, deficit }) {
    const w = Number(weightLb) * LB_TO_KG;
    const h = Number(heightIn) * IN_TO_CM;
    const a = Number(age);
    if (!isFinite(w) || !isFinite(h) || !isFinite(a) || w <= 0 || h <= 0 || a <= 0) return null;
    const bmr = 10 * w + 6.25 * h - 5 * a + (sex === 'female' ? -161 : 5);
    const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.sedentary;
    const tdee = bmr * multiplier;
    const deficitAmount = isFinite(Number(deficit)) ? Number(deficit) : 500;
    const suggestedBudget = Math.max(MIN_BUDGET, Math.round(tdee - deficitAmount));
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), suggestedBudget };
  }

  // chrome.storage.local only: API keys and body-profile inputs are personal
  // credentials/PII, not tracker data, so they deliberately never go through
  // chrome.storage.sync the way logs and metrics do.
  const KEYS_STORAGE_KEY = 'pt_calorie_keys';
  const PROFILE_STORAGE_KEY = 'pt_calorie_profile';

  function getLocalArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return chrome.storage.local;
    return {
      get: (keys, cb) => {
        const result = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (typeof localStorage !== 'undefined') {
            const val = localStorage.getItem(k);
            if (val !== null && val !== undefined) {
              try { result[k] = JSON.parse(val); } catch (e) { /* ignore */ }
            }
          }
        });
        cb(result);
      },
      set: (items, cb) => {
        if (typeof localStorage !== 'undefined') {
          Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        }
        if (cb) cb();
      }
    };
  }

  const CalorieKeys = {
    async getCredentials() {
      return new Promise(resolve => getLocalArea().get([KEYS_STORAGE_KEY], r => {
        resolve(Object.assign({ nutritionixAppId: '', nutritionixApiKey: '', usdaApiKey: '' }, (r && r[KEYS_STORAGE_KEY]) || {}));
      }));
    },
    async saveCredentials(creds) {
      const clean = {
        nutritionixAppId: ((creds && creds.nutritionixAppId) || '').trim(),
        nutritionixApiKey: ((creds && creds.nutritionixApiKey) || '').trim(),
        usdaApiKey: ((creds && creds.usdaApiKey) || '').trim()
      };
      return new Promise(resolve => getLocalArea().set({ [KEYS_STORAGE_KEY]: clean }, () => resolve(clean)));
    },
    async getProfile() {
      return new Promise(resolve => getLocalArea().get([PROFILE_STORAGE_KEY], r => resolve((r && r[PROFILE_STORAGE_KEY]) || null)));
    },
    async saveProfile(profile) {
      return new Promise(resolve => getLocalArea().set({ [PROFILE_STORAGE_KEY]: profile }, () => resolve(profile)));
    }
  };

  return {
    FOOD_RULES,
    getClarifyingQuestions,
    buildFollowupQuery,
    estimateCalories,
    queryNutritionix,
    queryUSDA,
    splitFoodTerms,
    estimateGrams,
    estimateCalorieBudget,
    ACTIVITY_MULTIPLIERS,
    CalorieKeys,
    isSkip
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalorieTracker;
}
