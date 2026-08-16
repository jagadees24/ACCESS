require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { query } = require('../src/db');

async function seedAdmin() {
  const email = 'admin@wifi.local';
  const password = 'admin123';

  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await query('SELECT id FROM admins WHERE email = ?', [email]);

  if (existing.length) {
    console.log('Default admin already exists.');
    return;
  }

  await query('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', ['Demo Admin', email, passwordHash]);
  console.log(`Seeded admin account: ${email} / ${password}`);
  process.exit(0);
}

seedAdmin().catch((error) => {
  console.error('Seeding failed:', error.message);
  process.exit(1);
});
