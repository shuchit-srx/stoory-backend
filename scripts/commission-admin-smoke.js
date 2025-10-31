/*
  Smoke test for admin commission settings by invoking controllers directly.
  Avoids binding to network ports and works without running the HTTP server.
*/
const commissionController = require('../controllers/commissionSettingsController');

function makeRes(label) {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; console.log(label, this.statusCode, JSON.stringify(payload)); },
  };
}

async function run() {
  try {
    // Mock admin request context
    const reqCurrent = { user: { id: 'test-admin', role: 'admin' }, query: {} };
    const resCurrent = makeRes('GET /current ->');
    await commissionController.getCurrentCommission(reqCurrent, resCurrent);
    if (!resCurrent.body?.success) throw new Error('getCurrentCommission failed');

    const reqUpdate = { user: { id: 'test-admin', role: 'admin' }, body: { commission_percentage: 12.5 } };
    const resUpdate = makeRes('PUT /update ->');
    await commissionController.updateCommission(reqUpdate, resUpdate);
    if (!resUpdate.body?.success) throw new Error('updateCommission failed');

    const reqCheck = { user: { id: 'test-admin', role: 'admin' }, query: {} };
    const resCheck = makeRes('GET /current (post-update) ->');
    await commissionController.getCurrentCommission(reqCheck, resCheck);
    if (!resCheck.body?.success) throw new Error('post-update getCurrentCommission failed');

    const pct = Number(resCheck.body.data?.commission_percentage);
    if (pct !== 12.5) throw new Error(`Mismatch after update: expected 12.5, got ${pct}`);

    console.log('\n🎉 Commission admin controller smoke test passed.');
  } catch (err) {
    console.error('\n❌ Commission admin controller smoke test failed:', err.message);
    process.exitCode = 1;
  }
}

run();


