const { membership } = require('../models/membership');

async function up () {
  const cond = [{ role: 'owner' }, { role: 'manager' }];
  await membership.updateMany(
    { $or: cond },
    { $set: { 'perms.appidentifications': 15 } },
    { upsert: false }
  );
  await membership.updateMany(
    { $nor: cond },
    { $set: { 'perms.appidentifications': 1 } },
    { upsert: false }
  );
}

async function down () {
  await membership.updateMany(
    {},
    { $unset: { 'perms.appidentifications': '' } },
    { upsert: false }
  );
}

module.exports = { up, down };
