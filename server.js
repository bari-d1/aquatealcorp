require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { Resend } = require('resend');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
}));

// Seed default cohort options if none exist
async function seedCohorts() {
  const count = await prisma.cohortOption.count();
  if (count === 0) {
    await prisma.cohortOption.createMany({
      data: [
        { label: 'Early Bird', price: '$499' },
        { label: 'Regular', price: '$699' },
      ],
    });
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── Public pages ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ─── Admin auth ───────────────────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Incorrect password.' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/admin/me', (req, res) => {
  res.json({ authenticated: !!req.session.isAdmin });
});

// ─── Admin: enrollments ───────────────────────────────────────────────────────
app.get('/admin/enrollments', requireAdmin, async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(enrollments);
});

app.delete('/admin/enrollments/:id', requireAdmin, async (req, res) => {
  await prisma.enrollment.delete({ where: { id: Number(req.params.id) } });
  res.json({ success: true });
});

// ─── Admin: cohort options ────────────────────────────────────────────────────
app.get('/admin/cohorts', requireAdmin, async (req, res) => {
  const cohorts = await prisma.cohortOption.findMany({ orderBy: { id: 'asc' } });
  res.json(cohorts);
});

app.post('/admin/cohorts', requireAdmin, async (req, res) => {
  const { label, price } = req.body;
  if (!label || !price) return res.status(400).json({ error: 'label and price are required.' });
  try {
    const cohort = await prisma.cohortOption.create({ data: { label, price } });
    res.status(201).json(cohort);
  } catch {
    res.status(409).json({ error: 'A cohort with that label already exists.' });
  }
});

app.put('/admin/cohorts/:id', requireAdmin, async (req, res) => {
  const { label, price } = req.body;
  const cohort = await prisma.cohortOption.update({
    where: { id: Number(req.params.id) },
    data: { label, price },
  });
  res.json(cohort);
});

app.delete('/admin/cohorts/:id', requireAdmin, async (req, res) => {
  await prisma.cohortOption.delete({ where: { id: Number(req.params.id) } });
  res.json({ success: true });
});

// ─── Public: cohort options (for signup form) ─────────────────────────────────
app.get('/cohorts', async (req, res) => {
  const cohorts = await prisma.cohortOption.findMany({ orderBy: { id: 'asc' } });
  res.json(cohorts);
});

// ─── Signup ───────────────────────────────────────────────────────────────────
app.post('/bootcamp/signup', async (req, res) => {
  const { first_name, last_name, email, phone, role, cohort, province, referral } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'First name, last name, and email are required.' });
  }

  try {
    await prisma.enrollment.create({
      data: {
        firstName: first_name,
        lastName: last_name,
        email,
        phone: phone || null,
        role: role || null,
        cohort: cohort || null,
        province: province || null,
        referral: referral || null,
      },
    });

    await resend.emails.send({
      from: 'Aqua Teal <onboarding@resend.dev>',
      to: email,
      subject: 'Your Spot is Reserved - Construction Contract Administration Bootcamp',
      html: `
        <h2>Hi ${first_name},</h2>
        <p>Thank you for registering for the <strong>Construction Contract Administration Bootcamp</strong>.</p>
        <p>We have received your enrollment and will be in touch shortly with next steps.</p>
        <br/>
        <p><strong>Your Details:</strong></p>
        <p>Name: ${first_name} ${last_name}</p>
        <p>Email: ${email}</p>
        ${phone ? `<p>Phone: ${phone}</p>` : ''}
        ${cohort ? `<p>Cohort: ${cohort}</p>` : ''}
        <br/>
        <p>See you in the bootcamp!</p>
        <p>The Aqua Teal Team</p>
      `,
    });

    res.status(201).json({ message: 'Enrollment successful.' });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'This email is already registered.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
seedCohorts().then(() => {
  app.listen(PORT, () => {
    console.log(`Aqua Teal server running at http://localhost:${PORT}`);
  });
});
